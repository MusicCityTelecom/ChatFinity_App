import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AccessToken } from "livekit-server-sdk";
import type { Context } from "./types.js";
import { uid } from "./types.js";
import { channelMember } from "./access.js";
import { fail } from "./security.js";
export function meetingRoutes({ app, db, c, events, media }: Context) {
  function configured() {
    if (!c.livekitUrl || !c.livekitKey || !c.livekitSecret)
      fail(503, "Meetings are not configured on this server yet.");
  }
  app.post("/api/channels/:channelId/meetings", async (req) => {
    configured();
    const { channelId } = z.object({ channelId: z.uuid() }).parse(req.params),
      ch = await channelMember(db, uid(req), channelId),
      { title } = z
        .object({
          title: z.string().trim().min(1).max(100).default("Team meeting"),
        })
        .parse(req.body);
    const id = await db.tx(async (tx) => {
      await tx.q("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        ch.org_id,
      ]);
      await channelMember(tx, uid(req), channelId);
      const [m] = await tx.q(
        "INSERT INTO meetings(id,org_id,channel_id,host_id,title) VALUES($1,$2,$3,$4,$5) ON CONFLICT(channel_id) WHERE ended_at IS NULL DO UPDATE SET channel_id=excluded.channel_id RETURNING id",
        [randomUUID(), ch.org_id, channelId, uid(req), title],
      );
      await media.ensureRoom("chatfinity-" + m.id);
      return m.id;
    });
    await events.publish(ch.org_id, channelId, {
      type: "meeting.started",
      meetingId: id,
    });
    return { id };
  });
  app.get("/api/meetings/:id", async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [m] = await db.q("SELECT * FROM meetings WHERE id=$1", [id]);
    if (!m) fail(404, "Meeting not found.");
    await channelMember(db, uid(req), m.channel_id);
    return { meeting: m };
  });
  app.post("/api/meetings/:id/token", async (req) => {
    configured();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const meeting = await db.tx(async (tx) => {
      const [m] = await tx.q(
        "SELECT * FROM meetings WHERE id=$1 AND ended_at IS NULL FOR UPDATE",
        [id],
      );
      if (!m) fail(404, "This meeting has ended.");
      await channelMember(tx, uid(req), m.channel_id);
      await media.ensureRoom("chatfinity-" + id);
      return m;
    });
    const token = new AccessToken(c.livekitKey, c.livekitSecret, {
      identity: uid(req),
      name: req.user!.name,
      ttl: 60,
    });
    token.addGrant({
      roomJoin: true,
      room: "chatfinity-" + id,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return { token: await token.toJwt(), url: c.livekitUrl, meeting };
  });
  app.post("/api/meetings/:id/end", async (req) => {
    configured();
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [m] = await db.q("SELECT * FROM meetings WHERE id=$1", [id]);
    if (!m) fail(404, "Meeting not found.");
    const ch = await channelMember(db, uid(req), m.channel_id);
    if (m.host_id !== uid(req) && !["owner", "admin"].includes(ch.role))
      fail(
        403,
        "Only the host or an administrator in this conversation can end the meeting.",
      );
    await db.tx(async (tx) => {
      await tx.q("SELECT id FROM meetings WHERE id=$1 FOR UPDATE", [id]);
      await channelMember(tx, uid(req), m.channel_id);
      await media.deleteRoom("chatfinity-" + id);
      await tx.q(
        "UPDATE meetings SET ended_at=coalesce(ended_at,now()) WHERE id=$1",
        [id],
      );
    });
    await events.publish(m.org_id, m.channel_id, {
      type: "meeting.ended",
      meetingId: id,
    });
    return { ok: true };
  });
}
