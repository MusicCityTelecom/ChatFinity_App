import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context } from "./types.js";
import {
  secret,
  hash,
  passwordHash,
  passwordMatches,
  fail,
} from "./security.js";
import { enqueue } from "./mail.js";
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const password = z.string().min(12, "Use at least 12 characters.").max(200);
const dummyHash = passwordHash(secret());
const authLimit = { rateLimit: { max: 10, timeWindow: "15 minutes" } };
export function authRoutes({ app, db, c, events }: Context) {
  app.get("/api/config", async () => ({
    name: "ChatFinity",
    registration: c.registration,
    meetings: !!(c.livekitUrl && c.livekitKey && c.livekitSecret),
  }));
  app.post("/api/auth/signup", { config: authLimit }, async (req) => {
    const input = z
      .object({
        email,
        password,
        name: z.string().trim().min(1).max(100),
        invite: z.string().min(20).max(100).optional(),
      })
      .parse(req.body);
    if (!c.registration) {
      const rows = input.invite
        ? await db.q(
            "SELECT id FROM invitations WHERE token_hash=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()",
            [hash(input.invite), input.email],
          )
        : [];
      if (!rows.length)
        fail(
          403,
          "Public signup is disabled. Use an email invitation from your administrator.",
        );
    }
    const id = randomUUID(),
      token = secret(),
      encoded = await passwordHash(input.password);
    await db.tx(async (tx) => {
      const rows = await tx.q(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id",
        [id, input.email, input.name, encoded],
      );
      if (rows.length) {
        await tx.q(
          "INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'verify',now()+interval '24 hours')",
          [hash(token), id],
        );
        await enqueue(
          tx,
          input.email,
          "Verify your ChatFinity email",
          `Welcome to ChatFinity, ${input.name}.\n\nVerify your email: ${c.origin}/?verify=${token}\n\nThis link expires in 24 hours. If you did not create this account, ignore this email.`,
        );
      }
    });
    return {
      ok: true,
      message:
        "Check your email to verify your account. If an account already exists, sign in or reset your password.",
    };
  });
  app.post("/api/auth/login", { config: authLimit }, async (req, reply) => {
    const input = z
      .object({ email, password: z.string().max(200) })
      .parse(req.body);
    const [u] = await db.q("SELECT * FROM users WHERE email=$1", [input.email]);
    // Perform equivalent expensive work even when the email is unknown.
    const encoded = u?.password_hash || (await dummyHash);
    if (!(await passwordMatches(input.password, encoded)) || !u)
      fail(401, "Email or password is incorrect.");
    const token = secret(),
      csrf = secret();
    await db.q(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",
      [hash(token), u.id, csrf],
    );
    reply.setCookie("cf_session", token, {
      httpOnly: true,
      secure: c.production,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return {
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        verified_at: u.verified_at,
        status: u.status,
      },
      csrf,
    };
  });
  app.post("/api/auth/verify", { config: authLimit }, async (req) => {
    const { token } = z
      .object({ token: z.string().min(20).max(100) })
      .parse(req.body);
    await db.tx(async (tx) => {
      const [t] = await tx.q(
        "DELETE FROM email_tokens WHERE token_hash=$1 AND purpose='verify' AND expires_at>now() RETURNING user_id",
        [hash(token)],
      );
      if (!t)
        fail(
          400,
          "This verification link has expired or has already been used.",
        );
      await tx.q(
        "UPDATE users SET verified_at=coalesce(verified_at,now()) WHERE id=$1",
        [t.user_id],
      );
    });
    return { ok: true };
  });
  app.post("/api/auth/forgot", { config: authLimit }, async (req) => {
    const input = z.object({ email }).parse(req.body),
      token = secret();
    await db.tx(async (tx) => {
      const [u] = await tx.q("SELECT id FROM users WHERE email=$1", [
        input.email,
      ]);
      if (!u) return;
      await tx.q(
        "DELETE FROM email_tokens WHERE user_id=$1 AND purpose='reset'",
        [u.id],
      );
      await tx.q(
        "INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'reset',now()+interval '30 minutes')",
        [hash(token), u.id],
      );
      await enqueue(
        tx,
        input.email,
        "Reset your ChatFinity password",
        `Reset your password: ${c.origin}/?reset=${token}\n\nThis link expires in 30 minutes. If you did not request it, ignore this email.`,
      );
    });
    return {
      ok: true,
      message: "If this email has an account, a reset link is on its way.",
    };
  });
  app.post("/api/auth/reset", { config: authLimit }, async (req) => {
    const input = z
        .object({ token: z.string().min(20).max(100), password })
        .parse(req.body),
      encoded = await passwordHash(input.password);
    const id = await db.tx(async (tx) => {
      const [t] = await tx.q(
        "DELETE FROM email_tokens WHERE token_hash=$1 AND purpose='reset' AND expires_at>now() RETURNING user_id",
        [hash(input.token)],
      );
      if (!t)
        fail(400, "This reset link has expired or has already been used.");
      await tx.q("UPDATE users SET password_hash=$1 WHERE id=$2", [
        encoded,
        t.user_id,
      ]);
      await tx.q("DELETE FROM sessions WHERE user_id=$1", [t.user_id]);
      return t.user_id;
    });
    events.disconnectUser(id);
    return { ok: true };
  });
  app.get("/api/me", async (req) => ({ user: req.user, csrf: req.csrf }));
  app.patch("/api/me", async (req) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        status: z.enum(["online", "away", "busy", "invisible"]).optional(),
      })
      .parse(req.body);
    const [u] = await db.q(
      "UPDATE users SET name=coalesce($1,name),status=coalesce($2,status) WHERE id=$3 RETURNING id,email,name,status,verified_at",
      [input.name ?? null, input.status ?? null, req.user!.id],
    );
    return { user: u };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    await db.q("DELETE FROM sessions WHERE token_hash=$1", [req.sessionHash]);
    events.disconnectUser(req.user!.id);
    reply.clearCookie("cf_session", { path: "/" });
    return { ok: true };
  });
  app.post("/api/auth/resend", { config: authLimit }, async (req) => {
    if (req.user!.verified_at) return { ok: true };
    const token = secret();
    await db.tx(async (tx) => {
      await tx.q(
        "DELETE FROM email_tokens WHERE user_id=$1 AND purpose='verify'",
        [req.user!.id],
      );
      await tx.q(
        "INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'verify',now()+interval '24 hours')",
        [hash(token), req.user!.id],
      );
      await enqueue(
        tx,
        req.user!.email,
        "Verify your ChatFinity email",
        `Verify your email: ${c.origin}/?verify=${token}`,
      );
    });
    return { ok: true };
  });
}
