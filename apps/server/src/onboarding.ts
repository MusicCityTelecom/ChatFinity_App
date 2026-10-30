import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "./db/index.js";
import type { Config } from "./config.js";
import type { Context } from "./types.js";
import { uid } from "./types.js";
import { member } from "./access.js";
import { fail } from "./security.js";
export async function effectiveSettings(db: DB, c: Config) {
  const [row] = await db.q("SELECT * FROM platform_settings WHERE id=1");
  return (
    row || { registration_open: c.registration, default_org_creation: true }
  );
}
export async function findOrganization(db: DB, identifier: string) {
  const normalized = identifier.replace(/\s/g, "").toUpperCase();
  const [org] = await db.q(
    "SELECT * FROM organizations WHERE upper(id::text)=$1 OR upper(join_code)=$1",
    [normalized],
  );
  return org;
}
export async function requestMembership(db: DB, userId: string, orgId: string) {
  const [existing] = await db.q(
    "SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2",
    [orgId, userId],
  );
  if (existing) fail(409, "You already belong to this organization.");
  const [old] = await db.q(
    "SELECT * FROM join_requests WHERE org_id=$1 AND user_id=$2",
    [orgId, userId],
  );
  if (
    old?.status === "rejected" &&
    Date.now() - new Date(old.reviewed_at).getTime() < 86400000
  )
    fail(429, "Please wait a day before requesting access again.");
  await db.q(
    "INSERT INTO join_requests(id,org_id,user_id) VALUES($1,$2,$3) ON CONFLICT(org_id,user_id) DO UPDATE SET status='pending',reviewed_at=NULL,reviewed_by=NULL",
    [randomUUID(), orgId, userId],
  );
}
export async function assignMembership(
  db: DB,
  userId: string,
  orgId: string,
  role: string,
) {
  const [u] = await db.q(
    "SELECT id FROM users WHERE id=$1 AND disabled_at IS NULL",
    [userId],
  );
  if (!u) fail(404, "Active user not found.");
  const [org] = await db.q(
    "SELECT id FROM organizations WHERE id=$1 FOR UPDATE",
    [orgId],
  );
  if (!org) fail(404, "Organization not found.");
  const [old] = await db.q(
    "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2",
    [orgId, userId],
  );
  if (old?.role === "owner" && role !== "owner") {
    const [count] = await db.q(
      "SELECT count(*)::int AS n FROM memberships WHERE org_id=$1 AND role='owner'",
      [orgId],
    );
    if (count.n <= 1)
      fail(409, "Promote another owner before changing the last owner.");
  }
  await db.q(
    "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(org_id,user_id) DO UPDATE SET role=excluded.role",
    [orgId, userId, role],
  );
  await db.q(
    "INSERT INTO channel_members(org_id,channel_id,user_id) SELECT org_id,id,$1 FROM channels WHERE org_id=$2 AND kind='public' ON CONFLICT DO NOTHING",
    [userId, orgId],
  );
}
export function onboardingRoutes({ app, db, events }: Context) {
  app.get("/api/me/join-requests", async (req) => ({
    requests: await db.q(
      "SELECT j.id,j.org_id,j.status,j.created_at,o.name AS organization_name FROM join_requests j JOIN organizations o ON o.id=j.org_id WHERE j.user_id=$1 ORDER BY j.created_at DESC",
      [uid(req)],
    ),
  }));
  app.post(
    "/api/join-requests",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req) => {
      const { organizationId } = z
        .object({ organizationId: z.string().trim().min(1).max(80) })
        .parse(req.body);
      const org = await findOrganization(db, organizationId);
      if (!org || !org.allow_join_requests)
        fail(
          400,
          "Organization ID unavailable. Ask an organization administrator for an invitation.",
        );
      await db.tx((tx) => requestMembership(tx, uid(req), org.id));
      return {
        ok: true,
        message:
          "Your verified request is waiting for an organization administrator to approve it.",
      };
    },
  );
  app.get("/api/orgs/:orgId/join-requests", async (req) => {
    const { orgId } = z.object({ orgId: z.uuid() }).parse(req.params);
    await member(db, uid(req), orgId, ["owner", "admin"]);
    return {
      requests: await db.q(
        "SELECT j.*,u.name,u.email FROM join_requests j JOIN users u ON u.id=j.user_id WHERE j.org_id=$1 AND j.status='pending' AND u.verified_at IS NOT NULL AND u.disabled_at IS NULL ORDER BY j.created_at",
        [orgId],
      ),
    };
  });
  app.post("/api/orgs/:orgId/join-requests/:id", async (req) => {
    const { orgId, id } = z
        .object({ orgId: z.uuid(), id: z.uuid() })
        .parse(req.params),
      { approve, role } = z
        .object({
          approve: z.boolean(),
          role: z.enum(["member", "admin"]).default("member"),
        })
        .parse(req.body);
    await db.tx(async (tx) => {
      await tx.q("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        orgId,
      ]);
      const actor = await member(tx, uid(req), orgId, ["owner", "admin"]);
      if (role === "admin" && actor.role !== "owner")
        fail(403, "Only an owner can delegate administrator access.");
      const [request] = await tx.q(
        "SELECT j.* FROM join_requests j JOIN users u ON u.id=j.user_id WHERE j.id=$1 AND j.org_id=$2 AND j.status='pending' AND u.verified_at IS NOT NULL AND u.disabled_at IS NULL FOR UPDATE",
        [id, orgId],
      );
      if (!request) fail(404, "Pending verified request not found.");
      if (approve) await assignMembership(tx, request.user_id, orgId, role);
      await tx.q(
        "UPDATE join_requests SET status=$1,reviewed_at=now(),reviewed_by=$2 WHERE id=$3",
        [approve ? "approved" : "rejected", uid(req), id],
      );
      await tx.q(
        "INSERT INTO audit_events(id,org_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          randomUUID(),
          orgId,
          uid(req),
          approve ? "join.approved" : "join.rejected",
          JSON.stringify({ userId: request.user_id, role }),
        ],
      );
    });
    await events.publish(orgId, null, { type: "organization.updated" });
    return { ok: true };
  });
}
