import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context } from "./types.js";
import { uid } from "./types.js";
import { member } from "./access.js";
import { fail } from "./security.js";
export function broadcastRoutes({ app, db, events }: Context) {
  app.post(
    "/api/broadcasts",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req) => {
      const { organizationIds, body } = z
          .object({
            organizationIds: z.array(z.uuid()).min(1).max(20),
            body: z.string().trim().min(1).max(10000),
          })
          .parse(req.body),
        orgs = [...new Set(organizationIds)].sort(),
        id = randomUUID(),
        deliveries: { orgId: string; channelId: string; messageId: string }[] =
          [];
      await db.tx(async (tx) => {
        for (const orgId of orgs) {
          const rows = await tx.q(
            "SELECT id FROM organizations WHERE id=$1 FOR UPDATE",
            [orgId],
          );
          if (!rows.length) fail(404, "Organization not found.");
          if (!req.user!.is_system_admin) await member(tx, uid(req), orgId);
        }
        await tx.q(
          "INSERT INTO broadcasts(id,sender_id,body) VALUES($1,$2,$3)",
          [id, uid(req), body],
        );
        for (const orgId of orgs) {
          const [channel] = await tx.q(
            "INSERT INTO channels(id,org_id,name,topic,kind,system_key,created_by) VALUES($1,$2,'announcements','Organization-wide messages. Every member receives broadcasts.','public','broadcasts',$3) ON CONFLICT(org_id,system_key) WHERE system_key IS NOT NULL DO UPDATE SET system_key=excluded.system_key RETURNING id",
            [randomUUID(), orgId, uid(req)],
          );
          await tx.q(
            "INSERT INTO channel_members(org_id,channel_id,user_id) SELECT org_id,$1,user_id FROM memberships WHERE org_id=$2 ON CONFLICT DO NOTHING",
            [channel.id, orgId],
          );
          const messageId = randomUUID();
          await tx.q(
            "INSERT INTO messages(id,org_id,channel_id,sender_id,body,client_id,broadcast_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [messageId, orgId, channel.id, uid(req), body, randomUUID(), id],
          );
          await tx.q(
            "INSERT INTO broadcast_organizations(broadcast_id,org_id) VALUES($1,$2)",
            [id, orgId],
          );
          deliveries.push({ orgId, channelId: channel.id, messageId });
        }
      });
      for (const d of deliveries)
        await events.publish(d.orgId, d.channelId, {
          type: "message.created",
          messageId: d.messageId,
          senderId: uid(req),
          broadcast: true,
        });
      return { id, organizationCount: orgs.length };
    },
  );
}
