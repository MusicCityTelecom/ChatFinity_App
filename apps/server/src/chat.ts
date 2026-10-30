import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context } from "./types.js";
import { uid } from "./types.js";
import { member, channelMember, accessibleMessage } from "./access.js";
import { fail } from "./security.js";
import type { DB } from "./db/index.js";
const orgParams = z.object({ orgId: z.uuid() }),
  channelParams = z.object({ channelId: z.uuid() }),
  messageParams = z.object({ id: z.uuid() });
export async function messageRows(
  db: DB,
  userId: string,
  channelId: string,
  opts: { before?: string; search?: string; saved?: boolean } = {},
) {
  let before = null;
  if (opts.before) {
    const [cursor] = await db.q(
      "SELECT created_at FROM messages WHERE id=$1 AND channel_id=$2",
      [opts.before, channelId],
    );
    if (!cursor)
      fail(400, "History cursor does not belong to this conversation.");
    before = cursor.created_at;
  }
  const rows = await db.q(
    `SELECT m.*,u.name AS sender_name,
 CASE WHEN parent.deleted_at IS NULL THEN parent.body ELSE '[Message removed]' END AS reply_body,pu.name AS reply_name,
 coalesce((SELECT json_agg(json_build_object('id',a.id,'name',a.name,'size',a.size,'mime',a.mime)) FROM attachments a WHERE a.message_id=m.id AND m.deleted_at IS NULL),'[]') AS attachments,
 coalesce((SELECT json_agg(r) FROM (SELECT emoji,count(*)::int AS count,bool_or(user_id=$1) AS mine FROM reactions WHERE message_id=m.id GROUP BY emoji) r),'[]') AS reactions,
 EXISTS(SELECT 1 FROM saved_messages sm WHERE sm.message_id=m.id AND sm.user_id=$1) AS saved
 FROM messages m JOIN users u ON u.id=m.sender_id LEFT JOIN messages parent ON parent.id=m.reply_id LEFT JOIN users pu ON pu.id=parent.sender_id
 WHERE m.channel_id=$2 AND ($3::timestamptz IS NULL OR (m.created_at,m.id)<($3::timestamptz,$4::uuid))
 AND ($5::text IS NULL OR (m.deleted_at IS NULL AND m.body ILIKE $5))
 AND (NOT $6::boolean OR EXISTS(SELECT 1 FROM saved_messages sm WHERE sm.message_id=m.id AND sm.user_id=$1))
 ORDER BY m.created_at DESC,m.id DESC LIMIT 51`,
    [
      userId,
      channelId,
      before,
      opts.before ?? null,
      opts.search ? "%" + opts.search.replace(/[\\%_]/g, "\\$&") + "%" : null,
      !!opts.saved,
    ],
  );
  const more = rows.length > 50;
  if (more) rows.pop();
  return { messages: rows.reverse(), more };
}
export function chatRoutes({ app, db, events }: Context) {
  app.get("/api/orgs/:orgId/channels", async (req) => {
    const { orgId } = orgParams.parse(req.params);
    await member(db, uid(req), orgId);
    const rows = await db.q(
      `SELECT c.*,cm.user_id IS NOT NULL AS joined,
   CASE WHEN c.kind='dm' THEN (SELECT u.name FROM channel_members other JOIN users u ON u.id=other.user_id WHERE other.channel_id=c.id AND other.user_id<>$1 LIMIT 1) ELSE c.name END AS display_name,
   (SELECT count(*)::int FROM messages m WHERE m.channel_id=c.id AND m.sender_id<>$1 AND m.deleted_at IS NULL AND m.created_at>coalesce((SELECT read_at FROM read_markers WHERE channel_id=c.id AND user_id=$1),'-infinity'::timestamptz)) AS unread,
   (SELECT body FROM messages WHERE channel_id=c.id AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1) AS last_message,
   (SELECT id FROM meetings WHERE channel_id=c.id AND ended_at IS NULL LIMIT 1) AS meeting_id
   FROM channels c LEFT JOIN channel_members cm ON cm.channel_id=c.id AND cm.user_id=$1 WHERE c.org_id=$2 AND (cm.user_id IS NOT NULL OR c.kind='public') ORDER BY c.created_at`,
      [uid(req), orgId],
    );
    // Public discovery is allowed, message snippets and unread counts are private until joined.
    return {
      channels: rows.map((row) =>
        row.joined
          ? row
          : { ...row, unread: 0, last_message: null, meeting_id: null },
      ),
    };
  });
  app.post("/api/orgs/:orgId/channels", async (req) => {
    const { orgId } = orgParams.parse(req.params);
    await member(db, uid(req), orgId);
    const input = z
        .object({
          name: z.string().trim().min(1).max(60),
          topic: z.string().trim().max(240).default(""),
          kind: z.enum(["public", "private"]).default("public"),
          members: z.array(z.uuid()).max(100).default([]),
        })
        .parse(req.body),
      id = randomUUID();
    await db.tx(async (tx) => {
      await tx.q("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        orgId,
      ]);
      await member(tx, uid(req), orgId);
      const members = [...new Set([uid(req), ...input.members])];
      for (const id of members) await member(tx, id, orgId);
      await tx.q(
        "INSERT INTO channels(id,org_id,name,topic,kind,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [id, orgId, input.name, input.topic, input.kind, uid(req)],
      );
      for (const userId of members)
        await tx.q(
          "INSERT INTO channel_members(org_id,channel_id,user_id) VALUES($1,$2,$3)",
          [orgId, id, userId],
        );
    });
    await events.publish(orgId, null, { type: "channel.created" });
    return { id };
  });
  app.post("/api/orgs/:orgId/dm", async (req) => {
    const { orgId } = orgParams.parse(req.params),
      { userId } = z.object({ userId: z.uuid() }).parse(req.body);
    if (userId === uid(req)) fail(400, "Choose another person.");
    const id = await db.tx(async (tx) => {
      await tx.q("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        orgId,
      ]);
      await member(tx, uid(req), orgId);
      await member(tx, userId, orgId);
      const dmKey = [uid(req), userId].sort().join(":");
      const [row] = await tx.q(
        "INSERT INTO channels(id,org_id,name,kind,dm_key,created_by) VALUES($1,$2,'Direct message','dm',$3,$4) ON CONFLICT(org_id,dm_key) DO UPDATE SET dm_key=excluded.dm_key RETURNING id",
        [randomUUID(), orgId, dmKey, uid(req)],
      );
      for (const u of [uid(req), userId])
        await tx.q(
          "INSERT INTO channel_members(org_id,channel_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [orgId, row.id, u],
        );
      return row.id;
    });
    await events.publish(orgId, id, { type: "channel.created" });
    return { id };
  });
  app.post("/api/channels/:channelId/join", async (req) => {
    const { channelId } = channelParams.parse(req.params);
    const [ch] = await db.q(
      "SELECT * FROM channels WHERE id=$1 AND kind='public'",
      [channelId],
    );
    if (!ch) fail(404, "Public channel not found.");
    await member(db, uid(req), ch.org_id);
    await db.q(
      "INSERT INTO channel_members(org_id,channel_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [ch.org_id, channelId, uid(req)],
    );
    return { ok: true };
  });
  app.get("/api/channels/:channelId/members", async (req) => {
    const { channelId } = channelParams.parse(req.params);
    await channelMember(db, uid(req), channelId);
    return {
      members: await db.q(
        "SELECT u.id,u.name,r.read_at FROM channel_members cm JOIN users u ON u.id=cm.user_id LEFT JOIN read_markers r ON r.channel_id=cm.channel_id AND r.user_id=cm.user_id WHERE cm.channel_id=$1",
        [channelId],
      ),
    };
  });
  app.post("/api/channels/:channelId/members", async (req) => {
    const { channelId } = channelParams.parse(req.params),
      { userId } = z.object({ userId: z.uuid() }).parse(req.body),
      ch = await channelMember(db, uid(req), channelId);
    if (
      ch.kind === "dm" ||
      (ch.created_by !== uid(req) && !["owner", "admin"].includes(ch.role))
    )
      fail(
        403,
        "Only the channel creator or an administrator in this channel can add members.",
      );
    await member(db, userId, ch.org_id);
    await db.q(
      "INSERT INTO channel_members(org_id,channel_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [ch.org_id, channelId, userId],
    );
    await events.publish(ch.org_id, channelId, { type: "channel.updated" });
    return { ok: true };
  });
  app.get("/api/channels/:channelId/messages", async (req) => {
    const { channelId } = channelParams.parse(req.params);
    await channelMember(db, uid(req), channelId);
    const query = z
      .object({
        before: z.uuid().optional(),
        search: z.string().trim().max(100).optional(),
        saved: z.enum(["true", "false"]).optional(),
      })
      .parse(req.query);
    return messageRows(db, uid(req), channelId, {
      ...query,
      saved: query.saved === "true",
    });
  });
  app.post(
    "/api/channels/:channelId/messages",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req) => {
      const { channelId } = channelParams.parse(req.params);
      const input = z
        .object({
          body: z.string().trim().max(10000).default(""),
          clientId: z.uuid(),
          replyId: z.uuid().nullable().optional(),
          attachments: z.array(z.uuid()).max(5).default([]),
        })
        .parse(req.body);
      if (!input.body && !input.attachments.length)
        fail(400, "Write a message or attach a file.");
      const ch = await channelMember(db, uid(req), channelId);
      const result = await db.tx(async (tx) => {
        await tx.q("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
          ch.org_id,
        ]);
        await channelMember(tx, uid(req), channelId);
        const [existing] = await tx.q(
          "SELECT id,channel_id FROM messages WHERE sender_id=$1 AND client_id=$2",
          [uid(req), input.clientId],
        );
        if (existing) {
          if (existing.channel_id !== channelId)
            fail(
              409,
              "This message identifier was already used in another conversation.",
            );
          return { id: existing.id, duplicate: true };
        }
        if (input.replyId) {
          const [parent] = await tx.q(
            "SELECT id FROM messages WHERE id=$1 AND channel_id=$2 AND deleted_at IS NULL",
            [input.replyId, channelId],
          );
          if (!parent) fail(400, "Reply must belong to this conversation.");
        }
        for (const attachment of input.attachments) {
          const [file] = await tx.q(
            "SELECT id FROM attachments WHERE id=$1 AND channel_id=$2 AND uploader_id=$3 AND message_id IS NULL FOR UPDATE",
            [attachment, channelId, uid(req)],
          );
          if (!file) fail(400, "Attachment unavailable or already used.");
        }
        const id = randomUUID();
        await tx.q(
          "INSERT INTO messages(id,org_id,channel_id,sender_id,body,client_id,reply_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            id,
            ch.org_id,
            channelId,
            uid(req),
            input.body,
            input.clientId,
            input.replyId ?? null,
          ],
        );
        for (const attachment of input.attachments)
          await tx.q("UPDATE attachments SET message_id=$1 WHERE id=$2", [
            id,
            attachment,
          ]);
        return { id, duplicate: false };
      });
      await events.publish(ch.org_id, channelId, {
        type: "message.created",
        messageId: result.id,
        senderId: uid(req),
      });
      return result;
    },
  );
  app.patch("/api/messages/:id", async (req) => {
    const { id } = messageParams.parse(req.params),
      { body } = z
        .object({ body: z.string().trim().min(1).max(10000) })
        .parse(req.body),
      m = await accessibleMessage(db, uid(req), id);
    if (m.sender_id !== uid(req))
      fail(403, "You can only edit your own messages.");
    await db.q("UPDATE messages SET body=$1,edited_at=now() WHERE id=$2", [
      body,
      id,
    ]);
    await events.publish(m.org_id, m.channel_id, {
      type: "message.updated",
      messageId: id,
    });
    return { ok: true };
  });
  app.delete("/api/messages/:id", async (req) => {
    const { id } = messageParams.parse(req.params),
      m = await accessibleMessage(db, uid(req), id),
      ch = await channelMember(db, uid(req), m.channel_id);
    if (m.sender_id !== uid(req) && !["owner", "admin"].includes(ch.role))
      fail(403, "You can only remove your own messages.");
    await db.tx(async (tx) => {
      await tx.q("UPDATE messages SET body='',deleted_at=now() WHERE id=$1", [
        id,
      ]);
      await tx.q("DELETE FROM reactions WHERE message_id=$1", [id]);
      await tx.q("DELETE FROM saved_messages WHERE message_id=$1", [id]);
    });
    await events.publish(m.org_id, m.channel_id, {
      type: "message.updated",
      messageId: id,
    });
    return { ok: true };
  });
  app.post("/api/messages/:id/react", async (req) => {
    const { id } = messageParams.parse(req.params),
      { emoji, active } = z
        .object({
          emoji: z.enum(["👍", "❤️", "😂", "🎉", "👀", "✅"]),
          active: z.boolean(),
        })
        .parse(req.body),
      m = await accessibleMessage(db, uid(req), id);
    if (active)
      await db.q(
        "INSERT INTO reactions(message_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, uid(req), emoji],
      );
    else
      await db.q(
        "DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3",
        [id, uid(req), emoji],
      );
    await events.publish(m.org_id, m.channel_id, {
      type: "message.updated",
      messageId: id,
    });
    return { ok: true };
  });
  app.post("/api/messages/:id/save", async (req) => {
    const { id } = messageParams.parse(req.params),
      { active } = z.object({ active: z.boolean() }).parse(req.body);
    await accessibleMessage(db, uid(req), id);
    if (active)
      await db.q(
        "INSERT INTO saved_messages(message_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, uid(req)],
      );
    else
      await db.q(
        "DELETE FROM saved_messages WHERE message_id=$1 AND user_id=$2",
        [id, uid(req)],
      );
    return { ok: true };
  });
  app.post("/api/channels/:channelId/read", async (req) => {
    const { channelId } = channelParams.parse(req.params),
      { messageId } = z.object({ messageId: z.uuid() }).parse(req.body),
      ch = await channelMember(db, uid(req), channelId);
    const [m] = await db.q(
      "SELECT created_at FROM messages WHERE id=$1 AND channel_id=$2",
      [messageId, channelId],
    );
    if (!m) fail(404, "Message not found.");
    await db.q(
      "INSERT INTO read_markers(channel_id,user_id,read_at) VALUES($1,$2,$3) ON CONFLICT(channel_id,user_id) DO UPDATE SET read_at=greatest(read_markers.read_at,excluded.read_at)",
      [channelId, uid(req), m.created_at],
    );
    await events.publish(ch.org_id, channelId, {
      type: "conversation.read",
      userId: uid(req),
    });
    return { ok: true };
  });
}
