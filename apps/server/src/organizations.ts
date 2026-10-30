import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context } from "./types.js";
import { uid } from "./types.js";
import { member, channelMember } from "./access.js";
import { secret, hash, fail } from "./security.js";
import { enqueue } from "./mail.js";
const params = z.object({ orgId: z.uuid() });
export function orgRoutes({ app, db, c, events }: Context) {
  app.get("/api/orgs", async (req) => ({
    organizations: await db.q(
      "SELECT o.*,m.role FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=$1 ORDER BY o.created_at",
      [uid(req)],
    ),
  }));
  app.post("/api/orgs", async (req) => {
    if (!req.user!.is_system_admin && !req.user!.can_create_org)
      fail(
        403,
        "Your account needs permission to create organizations. Contact a system administrator.",
      );
    const { name } = z
        .object({ name: z.string().trim().min(2).max(80) })
        .parse(req.body),
      id = randomUUID(),
      channel = randomUUID();
    await db.tx(async (tx) => {
      await tx.q("SELECT id FROM users WHERE id=$1 FOR UPDATE", [uid(req)]);
      const [count] = await tx.q(
        "SELECT count(*)::int AS n FROM organizations WHERE created_by=$1",
        [uid(req)],
      );
      if (count.n >= 20)
        fail(409, "This account has reached its 20-organization limit.");
      await tx.q(
        "INSERT INTO organizations(id,name,created_by,join_code) VALUES($1,$2,$3,$4)",
        [
          id,
          name,
          uid(req),
          "CF-" + id.replaceAll("-", "").slice(0, 16).toUpperCase(),
        ],
      );
      await tx.q(
        "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')",
        [id, uid(req)],
      );
      await tx.q(
        "INSERT INTO channels(id,org_id,name,topic,kind,created_by) VALUES($1,$2,'general','A place for everyone to connect.','public',$3)",
        [channel, id, uid(req)],
      );
      await tx.q(
        "INSERT INTO channel_members(org_id,channel_id,user_id) VALUES($1,$2,$3)",
        [id, channel, uid(req)],
      );
    });
    return { id };
  });
  app.get("/api/orgs/:orgId/members", async (req) => {
    const { orgId } = params.parse(req.params);
    await member(db, uid(req), orgId);
    const rows = await db.q(
      "SELECT u.id,u.name,u.email,u.status,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 ORDER BY u.name",
      [orgId],
    );
    return {
      members: rows.map((u) => ({
        ...u,
        online: u.status !== "invisible" && events.presence(u.id) !== "offline",
        status:
          u.status === "invisible"
            ? "offline"
            : u.status === "online"
              ? events.presence(u.id)
              : u.status,
      })),
    };
  });
  app.patch("/api/orgs/:orgId", async (req) => {
    const { orgId } = params.parse(req.params);
    await member(db, uid(req), orgId, ["owner", "admin"]);
    const { name } = z
      .object({ name: z.string().trim().min(2).max(80) })
      .parse(req.body);
    await db.q("UPDATE organizations SET name=$1 WHERE id=$2", [name, orgId]);
    return { ok: true };
  });
  app.patch("/api/orgs/:orgId/members/:userId", async (req) => {
    const { orgId, userId } = params
        .extend({ userId: z.uuid() })
        .parse(req.params),
      { role } = z
        .object({ role: z.enum(["owner", "admin", "member"]) })
        .parse(req.body);
    await db.tx(async (tx) => {
      await tx.q("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        orgId,
      ]);
      const actor = await member(tx, uid(req), orgId, ["owner", "admin"]),
        target = await member(tx, userId, orgId);
      if (
        actor.role !== "owner" &&
        (target.role !== "member" || role !== "member")
      )
        fail(403, "Only owners can delegate administrative roles.");
      if (target.role === "owner" && role !== "owner") {
        const [count] = await tx.q(
          "SELECT count(*)::int AS total FROM memberships WHERE org_id=$1 AND role='owner'",
          [orgId],
        );
        if (count.total <= 1)
          fail(
            409,
            "Every organization needs at least one owner. Promote another owner first.",
          );
      }
      await tx.q(
        "UPDATE memberships SET role=$1 WHERE org_id=$2 AND user_id=$3",
        [role, orgId, userId],
      );
      await tx.q(
        "INSERT INTO audit_events(id,org_id,actor_id,action,detail) VALUES($1,$2,$3,'member.role',$4::jsonb)",
        [randomUUID(), orgId, uid(req), JSON.stringify({ userId, role })],
      );
    });
    await events.publish(orgId, null, { type: "organization.updated" });
    return { ok: true };
  });
  app.delete("/api/orgs/:orgId/members/:userId", async (req) => {
    const { orgId, userId } = params
      .extend({ userId: z.uuid() })
      .parse(req.params);
    await db.tx(async (tx) => {
      await tx.q("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        orgId,
      ]);
      const actor = await member(tx, uid(req), orgId),
        target = await member(tx, userId, orgId);
      if (uid(req) !== userId && !["owner", "admin"].includes(actor.role))
        fail(403, "Only administrators can remove other members.");
      if (
        uid(req) !== userId &&
        actor.role !== "owner" &&
        target.role !== "member"
      )
        fail(403, "Only owners can remove administrators.");
      if (target.role === "owner") {
        const [count] = await tx.q(
          "SELECT count(*)::int AS total FROM memberships WHERE org_id=$1 AND role='owner'",
          [orgId],
        );
        if (count.total <= 1)
          fail(409, "Promote another owner before leaving.");
      }
      // Fail closed if meetings are active: end them before revoking access, because media tokens remain valid until expiry.
      const active = await tx.q(
        "SELECT id FROM meetings WHERE org_id=$1 AND (ended_at IS NULL OR ended_at>now()-interval '2 minutes')",
        [orgId],
      );
      if (active.length)
        fail(
          409,
          "End active meetings in this organization, then wait two minutes before removing a member.",
        );
      await tx.q("DELETE FROM memberships WHERE org_id=$1 AND user_id=$2", [
        orgId,
        userId,
      ]);
      await tx.q(
        "INSERT INTO audit_events(id,org_id,actor_id,action,detail) VALUES($1,$2,$3,'member.removed',$4::jsonb)",
        [randomUUID(), orgId, uid(req), JSON.stringify({ userId })],
      );
    });
    events.disconnectUser(userId);
    await events.publish(orgId, null, { type: "organization.updated" });
    return { ok: true };
  });
  app.get("/api/orgs/:orgId/invitations", async (req) => {
    const { orgId } = params.parse(req.params);
    await member(db, uid(req), orgId, ["owner", "admin"]);
    return {
      invitations: await db.q(
        "SELECT id,email,role,expires_at,accepted_at,revoked_at FROM invitations WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100",
        [orgId],
      ),
    };
  });
  app.post(
    "/api/orgs/:orgId/invitations",
    { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (req) => {
      const { orgId } = params.parse(req.params),
        actor = await member(db, uid(req), orgId, ["owner", "admin"]);
      const input = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          role: z.enum(["admin", "member"]).default("member"),
        })
        .parse(req.body);
      if (input.role === "admin" && actor.role !== "owner")
        fail(403, "Only an owner can invite an administrator.");
      const token = secret(),
        id = randomUUID();
      await db.tx(async (tx) => {
        await tx.q("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
          orgId,
        ]);
        await member(
          tx,
          uid(req),
          orgId,
          input.role === "admin" ? ["owner"] : ["owner", "admin"],
        );
        const [org] = await tx.q("SELECT name FROM organizations WHERE id=$1", [
          orgId,
        ]);
        await tx.q(
          "UPDATE invitations SET revoked_at=now() WHERE org_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL",
          [orgId, input.email],
        );
        await tx.q(
          "INSERT INTO invitations(id,org_id,email,role,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days')",
          [id, orgId, input.email, input.role, hash(token), uid(req)],
        );
        await enqueue(
          tx,
          input.email,
          `You’re invited to ${org.name} on ChatFinity`,
          `${req.user!.name} invited you to ${org.name}.\n\nAccept your invitation: ${c.origin}/?invite=${token}\n\nUse this email address to sign in or create an account. The invitation expires in seven days.`,
        );
        await tx.q(
          "INSERT INTO audit_events(id,org_id,actor_id,action,detail) VALUES($1,$2,$3,'member.invited',$4::jsonb)",
          [
            randomUUID(),
            orgId,
            uid(req),
            JSON.stringify({ email: input.email, role: input.role }),
          ],
        );
      });
      return { id, message: "Invitation queued for email delivery." };
    },
  );
  app.delete("/api/orgs/:orgId/invitations/:id", async (req) => {
    const { orgId, id } = params.extend({ id: z.uuid() }).parse(req.params);
    await member(db, uid(req), orgId, ["owner", "admin"]);
    await db.q(
      "UPDATE invitations SET revoked_at=now() WHERE id=$1 AND org_id=$2 AND accepted_at IS NULL",
      [id, orgId],
    );
    return { ok: true };
  });
  app.post("/api/invitations/accept", async (req) => {
    const { token } = z
      .object({ token: z.string().min(20).max(100) })
      .parse(req.body);
    const orgId = await db.tx(async (tx) => {
      const [inv] = await tx.q(
        "SELECT * FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",
        [hash(token)],
      );
      if (!inv || inv.email !== req.user!.email)
        fail(
          400,
          "Invitation unavailable. Sign in using the email address it was sent to.",
        );
      // Email invitation proves control of this exact mailbox, including invite-only signup.
      await tx.q(
        "UPDATE users SET verified_at=coalesce(verified_at,now()) WHERE id=$1",
        [uid(req)],
      );
      await tx.q(
        "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [inv.org_id, uid(req), inv.role],
      );
      await tx.q(
        "INSERT INTO channel_members(org_id,channel_id,user_id) SELECT org_id,id,$1 FROM channels WHERE org_id=$2 AND kind='public' ON CONFLICT DO NOTHING",
        [uid(req), inv.org_id],
      );
      await tx.q("UPDATE invitations SET accepted_at=now() WHERE id=$1", [
        inv.id,
      ]);
      return inv.org_id;
    });
    await events.publish(orgId, null, { type: "organization.updated" });
    return { orgId };
  });
  app.get("/api/orgs/:orgId/audit", async (req) => {
    const { orgId } = params.parse(req.params);
    await member(db, uid(req), orgId, ["owner", "admin"]);
    return {
      events: await db.q(
        "SELECT a.*,u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.org_id=$1 ORDER BY a.created_at DESC LIMIT 100",
        [orgId],
      ),
    };
  });
}
