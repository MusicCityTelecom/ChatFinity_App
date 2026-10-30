import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context } from "./types.js";
import { uid } from "./types.js";
import type { DB } from "./db/index.js";
import { fail, secret, hash, passwordHash } from "./security.js";
import { enqueue } from "./mail.js";
import { assignMembership, effectiveSettings } from "./onboarding.js";
const idParams = z.object({ id: z.uuid() });
async function audit(db: DB, actor: string, action: string, detail: unknown) {
  await db.q(
    "INSERT INTO platform_audit_events(id,actor_id,action,detail) VALUES($1,$2,$3,$4::jsonb)",
    [randomUUID(), actor, action, JSON.stringify(detail)],
  );
}
export function adminRoutes(ctx: Context) {
  const { app, db, c, events } = ctx;
  app.register(async (admin) => {
    admin.addHook("preHandler", async (req) => {
      if (!req.user?.is_system_admin)
        fail(403, "System administrator access is required.");
    });
    admin.get("/api/admin/overview", async () => ({
      counts: (
        await db.q(
          "SELECT (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM organizations) AS organizations,(SELECT count(*)::int FROM messages WHERE deleted_at IS NULL) AS messages,(SELECT count(*)::int FROM meetings WHERE ended_at IS NULL) AS meetings,(SELECT count(*)::int FROM mail_outbox WHERE sent_at IS NULL AND attempts>=10) AS failed_mail",
        )
      )[0],
      settings: await effectiveSettings(db, c),
    }));
    admin.get("/api/admin/users", async () => ({
      users: await db.q(
        `SELECT u.id,u.email,u.name,u.verified_at,u.status,u.is_system_admin,u.can_create_org,u.must_change_password,u.disabled_at,u.created_at,coalesce((SELECT json_agg(json_build_object('id',o.id,'name',o.name,'role',m.role)) FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.user_id=u.id),'[]') AS organizations FROM users u ORDER BY u.created_at DESC LIMIT 1000`,
      ),
    }));
    admin.get("/api/admin/orgs", async () => ({
      organizations: await db.q(
        `SELECT o.*,(SELECT count(*)::int FROM memberships WHERE org_id=o.id) AS member_count,(SELECT count(*)::int FROM channels WHERE org_id=o.id) AS channel_count FROM organizations o ORDER BY o.created_at`,
      ),
    }));
    admin.get("/api/admin/audit", async () => ({
      events: await db.q(
        "SELECT a.*,u.name AS actor_name FROM platform_audit_events a LEFT JOIN users u ON u.id=a.actor_id ORDER BY created_at DESC LIMIT 200",
      ),
    }));
    admin.get("/api/admin/join-requests", async () => ({
      requests: await db.q(
        "SELECT j.*,u.name,u.email,o.name AS organization_name FROM join_requests j JOIN users u ON u.id=j.user_id JOIN organizations o ON o.id=j.org_id WHERE j.status='pending' AND u.verified_at IS NOT NULL ORDER BY j.created_at",
      ),
    }));
    admin.post("/api/admin/users", async (req) => {
      const input = z
          .object({
            email: z
              .email()
              .max(254)
              .transform((v) => v.toLowerCase()),
            name: z.string().trim().min(1).max(100),
            canCreateOrg: z.boolean().default(true),
            systemAdmin: z.boolean().default(false),
            memberships: z
              .array(
                z.object({
                  orgId: z.uuid(),
                  role: z.enum(["owner", "admin", "member"]),
                }),
              )
              .max(50)
              .default([]),
          })
          .parse(req.body),
        id = randomUUID(),
        token = secret(),
        encoded = await passwordHash(secret());
      await db.tx(async (tx) => {
        await tx.q(
          "INSERT INTO users(id,email,name,password_hash,verified_at,can_create_org,is_system_admin,must_change_password) VALUES($1,$2,$3,$4,now(),$5,$6,true)",
          [
            id,
            input.email,
            input.name,
            encoded,
            input.canCreateOrg,
            input.systemAdmin,
          ],
        );
        for (const m of [...input.memberships].sort((a, b) =>
          a.orgId.localeCompare(b.orgId),
        ))
          await assignMembership(tx, id, m.orgId, m.role);
        await tx.q(
          "INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'reset',now()+interval '24 hours')",
          [hash(token), id],
        );
        await enqueue(
          tx,
          input.email,
          "Set up your ChatFinity account",
          `Your ChatFinity administrator created your account.\n\nChoose your password: ${c.origin}/?reset=${token}\n\nThis setup link expires in 24 hours.`,
        );
        await audit(tx, uid(req), "user.created", {
          userId: id,
          email: input.email,
          canCreateOrg: input.canCreateOrg,
          systemAdmin: input.systemAdmin,
        });
      });
      return {
        id,
        message:
          "Account created. A password setup link is queued for email delivery.",
      };
    });
    admin.patch("/api/admin/users/:id", async (req) => {
      const { id } = idParams.parse(req.params),
        input = z
          .object({
            name: z.string().trim().min(1).max(100).optional(),
            canCreateOrg: z.boolean().optional(),
            systemAdmin: z.boolean().optional(),
            disabled: z.boolean().optional(),
            verified: z.boolean().optional(),
          })
          .parse(req.body);
      await db.tx(async (tx) => {
        await tx.q(
          "SELECT id FROM users WHERE is_system_admin=true ORDER BY id FOR UPDATE",
        );
        const [target] = await tx.q("SELECT * FROM users WHERE id=$1", [id]);
        if (!target) fail(404, "User not found.");
        if (
          target.is_system_admin &&
          !target.disabled_at &&
          target.verified_at &&
          (input.systemAdmin === false ||
            input.disabled === true ||
            input.verified === false)
        ) {
          const [count] = await tx.q(
            "SELECT count(*)::int AS n FROM users WHERE is_system_admin=true AND disabled_at IS NULL AND verified_at IS NOT NULL",
          );
          if (count.n <= 1)
            fail(409, "At least one enabled system administrator must remain.");
        }
        await tx.q(
          "UPDATE users SET name=coalesce($1,name),can_create_org=coalesce($2,can_create_org),is_system_admin=coalesce($3,is_system_admin),disabled_at=CASE WHEN $4::boolean IS NULL THEN disabled_at WHEN $4 THEN now() ELSE NULL END,verified_at=CASE WHEN $5::boolean IS NULL THEN verified_at WHEN $5 THEN coalesce(verified_at,now()) ELSE NULL END WHERE id=$6",
          [
            input.name ?? null,
            input.canCreateOrg ?? null,
            input.systemAdmin ?? null,
            input.disabled ?? null,
            input.verified ?? null,
            id,
          ],
        );
        if (input.disabled === true)
          await tx.q("DELETE FROM sessions WHERE user_id=$1", [id]);
        await audit(tx, uid(req), "user.updated", { userId: id, ...input });
      });
      events.disconnectUser(id);
      return { ok: true };
    });
    admin.post("/api/admin/users/:id/password-reset", async (req) => {
      const { id } = idParams.parse(req.params),
        input = z
          .object({ temporaryPassword: z.string().min(12).max(200).optional() })
          .parse(req.body || {}),
        token = secret();
      await db.tx(async (tx) => {
        const [u] = await tx.q("SELECT id,email FROM users WHERE id=$1", [id]);
        if (!u) fail(404, "User not found.");
        await tx.q(
          "DELETE FROM email_tokens WHERE user_id=$1 AND purpose='reset'",
          [id],
        );
        if (input.temporaryPassword) {
          await tx.q(
            "UPDATE users SET password_hash=$1,must_change_password=true WHERE id=$2",
            [await passwordHash(input.temporaryPassword), id],
          );
        } else {
          await tx.q(
            "INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'reset',now()+interval '30 minutes')",
            [hash(token), id],
          );
          await enqueue(
            tx,
            u.email,
            "Your ChatFinity administrator requested a password reset",
            `Choose a new password: ${c.origin}/?reset=${token}\n\nThis link expires in 30 minutes.`,
          );
        }
        await tx.q("DELETE FROM sessions WHERE user_id=$1", [id]);
        await audit(tx, uid(req), "user.password_reset", {
          userId: id,
          method: input.temporaryPassword ? "temporary_password" : "email_link",
        });
      });
      events.disconnectUser(id);
      return {
        ok: true,
        message: input.temporaryPassword
          ? "Temporary password set. The user must change it after signing in."
          : "Password reset link queued for email delivery.",
      };
    });
    admin.post("/api/admin/users/:id/memberships", async (req) => {
      const { id } = idParams.parse(req.params),
        { memberships } = z
          .object({
            memberships: z
              .array(
                z.object({
                  orgId: z.uuid(),
                  role: z.enum(["owner", "admin", "member"]),
                }),
              )
              .min(1)
              .max(50),
          })
          .parse(req.body);
      await db.tx(async (tx) => {
        for (const m of [...memberships].sort((a, b) =>
          a.orgId.localeCompare(b.orgId),
        ))
          await assignMembership(tx, id, m.orgId, m.role);
        await audit(tx, uid(req), "user.memberships_assigned", {
          userId: id,
          memberships,
        });
      });
      events.disconnectUser(id);
      return { ok: true };
    });
    admin.delete("/api/admin/users/:id/memberships/:orgId", async (req) => {
      const { id, orgId } = idParams
        .extend({ orgId: z.uuid() })
        .parse(req.params);
      await db.tx(async (tx) => {
        await tx.q("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
          orgId,
        ]);
        const [m] = await tx.q(
          "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2",
          [orgId, id],
        );
        if (m?.role === "owner") {
          const [n] = await tx.q(
            "SELECT count(*)::int AS n FROM memberships WHERE org_id=$1 AND role='owner'",
            [orgId],
          );
          if (n.n <= 1) fail(409, "Promote another organization owner first.");
        }
        const active = await tx.q(
          "SELECT id FROM meetings WHERE org_id=$1 AND (ended_at IS NULL OR ended_at>now()-interval '2 minutes')",
          [orgId],
        );
        if (active.length)
          fail(
            409,
            "End meetings and wait two minutes before revoking membership.",
          );
        await tx.q("DELETE FROM memberships WHERE org_id=$1 AND user_id=$2", [
          orgId,
          id,
        ]);
        await audit(tx, uid(req), "user.membership_removed", {
          userId: id,
          orgId,
        });
      });
      events.disconnectUser(id);
      return { ok: true };
    });
    admin.patch("/api/admin/orgs/:id", async (req) => {
      const { id } = idParams.parse(req.params),
        input = z
          .object({
            name: z.string().trim().min(2).max(80).optional(),
            allowJoinRequests: z.boolean().optional(),
          })
          .parse(req.body);
      await db.tx(async (tx) => {
        await tx.q(
          "UPDATE organizations SET name=coalesce($1,name),allow_join_requests=coalesce($2,allow_join_requests) WHERE id=$3",
          [input.name ?? null, input.allowJoinRequests ?? null, id],
        );
        await audit(tx, uid(req), "organization.updated", {
          orgId: id,
          ...input,
        });
      });
      return { ok: true };
    });
    admin.post("/api/admin/orgs/:id/join", async (req) => {
      const { id } = idParams.parse(req.params);
      await db.tx(async (tx) => {
        await assignMembership(tx, uid(req), id, "owner");
        await audit(tx, uid(req), "organization.admin_joined", { orgId: id });
      });
      return { orgId: id };
    });
    admin.post("/api/admin/join-requests/:id", async (req) => {
      const { id } = idParams.parse(req.params),
        { approve } = z.object({ approve: z.boolean() }).parse(req.body);
      let organizationId = "";
      await db.tx(async (tx) => {
        const [initial] = await tx.q(
          "SELECT org_id FROM join_requests WHERE id=$1",
          [id],
        );
        if (!initial) fail(404, "Request not found.");
        organizationId = initial.org_id;
        await tx.q("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
          organizationId,
        ]);
        const [j] = await tx.q(
          "SELECT j.* FROM join_requests j JOIN users u ON u.id=j.user_id WHERE j.id=$1 AND j.status='pending' AND u.verified_at IS NOT NULL AND u.disabled_at IS NULL FOR UPDATE",
          [id],
        );
        if (!j) fail(404, "Pending verified request not found.");
        if (approve) await assignMembership(tx, j.user_id, j.org_id, "member");
        await tx.q(
          "UPDATE join_requests SET status=$1,reviewed_at=now(),reviewed_by=$2 WHERE id=$3",
          [approve ? "approved" : "rejected", uid(req), id],
        );
        await audit(tx, uid(req), approve ? "join.approved" : "join.rejected", {
          userId: j.user_id,
          orgId: j.org_id,
        });
      });
      await events.publish(organizationId, null, {
        type: "organization.updated",
      });
      return { ok: true };
    });
    admin.patch("/api/admin/settings", async (req) => {
      const input = z
        .object({
          registrationOpen: z.boolean(),
          defaultOrgCreation: z.boolean(),
        })
        .parse(req.body);
      await db.tx(async (tx) => {
        await tx.q(
          "INSERT INTO platform_settings(id,registration_open,default_org_creation) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET registration_open=excluded.registration_open,default_org_creation=excluded.default_org_creation",
          [input.registrationOpen, input.defaultOrgCreation],
        );
        await audit(tx, uid(req), "platform.settings_updated", input);
      });
      return { ok: true };
    });
  });
}
