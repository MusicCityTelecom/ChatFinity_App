import { randomUUID } from "node:crypto";
import { mkdir, unlink, open } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Context } from "./types.js";
import { uid } from "./types.js";
import { channelMember } from "./access.js";
import { fail } from "./security.js";
const magic = (b: Buffer, ext: string) => {
  if (["txt", "csv"].includes(ext)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(b);
      return !b.includes(0) ? "text/plain" : null;
    } catch {
      return null;
    }
  }
  if (ext === "pdf" && b.subarray(0, 5).toString() === "%PDF-")
    return "application/pdf";
  if (
    ["jpg", "jpeg"].includes(ext) &&
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255
  )
    return "image/jpeg";
  if (
    ext === "png" &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (ext === "gif" && /^GIF8[79]a/.test(b.subarray(0, 6).toString()))
    return "image/gif";
  if (
    ext === "webp" &&
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return null;
};
export function fileRoutes({ app, db, c }: Context) {
  app.post(
    "/api/channels/:channelId/files",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const { channelId } = z.object({ channelId: z.uuid() }).parse(req.params),
        ch = await channelMember(db, uid(req), channelId);
      const file = await req.file();
      if (!file) fail(400, "Choose a file.");
      const id = randomUUID(),
        path = join(c.uploadDir, id);
      await mkdir(c.uploadDir, { recursive: true, mode: 0o700 });
      try {
        await pipeline(
          file.file,
          createWriteStream(path, { flags: "wx", mode: 0o600 }),
        );
        if (file.file.truncated) fail(413, "Files must be 20 MB or smaller.");
        const handle = await open(path, "r");
        let buffer: Buffer, size: number;
        try {
          size = (await handle.stat()).size;
          buffer = Buffer.alloc(Math.min(8192, size));
          await handle.read(buffer, 0, buffer.length, 0);
        } finally {
          await handle.close();
        }
        if (size === 0) fail(400, "Empty files cannot be attached.");
        const name = file.filename
            .replace(/[\\/\x00-\x1f\x7f]/g, "_")
            .slice(0, 240),
          ext = name.split(".").pop()?.toLowerCase() || "",
          mime = magic(buffer, ext);
        if (!mime)
          fail(400, "Use a JPG, PNG, GIF, WebP, PDF, UTF-8 text or CSV file.");
        await db.tx(async (tx) => {
          await tx.q("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
            ch.org_id,
          ]);
          await channelMember(tx, uid(req), channelId);
          const [used] = await tx.q(
            "SELECT coalesce(sum(size),0)::bigint AS bytes FROM attachments WHERE org_id=$1",
            [ch.org_id],
          );
          if (Number(used.bytes) + size > c.orgStorageMb * 1024 * 1024)
            fail(
              413,
              "This organization has reached its attachment storage limit.",
            );
          await tx.q(
            "INSERT INTO attachments(id,org_id,channel_id,uploader_id,name,mime,size) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [id, ch.org_id, channelId, uid(req), name, mime, size],
          );
        });
        return { id, name, size, mime };
      } catch (e) {
        await unlink(path).catch(() => {});
        throw e;
      }
    },
  );
  app.get("/api/files/:id", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [file] = await db.q(
      "SELECT a.*,m.deleted_at FROM attachments a LEFT JOIN messages m ON m.id=a.message_id WHERE a.id=$1",
      [id],
    );
    if (!file || file.deleted_at) fail(404, "Attachment not found.");
    await channelMember(db, uid(req), file.channel_id);
    if (!file.message_id && file.uploader_id !== uid(req))
      fail(404, "Attachment not found.");
    reply
      .header("Content-Type", "application/octet-stream")
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Disposition",
        `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, "%27")}`,
      )
      .header("Cache-Control", "private, no-store");
    return reply.send(createReadStream(join(c.uploadDir, id)));
  });
}
