import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { ZodError } from "zod";
import { existsSync } from "node:fs";
import type { DB } from "./db/index.js";
import type { Config } from "./config.js";
import { RoomServiceClient } from "livekit-server-sdk";
import type { User, Context, MediaService } from "./types.js";
import { hash, fail } from "./security.js";
import { realtime } from "./realtime.js";
import { authRoutes } from "./auth.js";
import { orgRoutes } from "./organizations.js";
import { chatRoutes } from "./chat.js";
import { fileRoutes } from "./files.js";
import { adminRoutes } from "./admin.js";
import { onboardingRoutes } from "./onboarding.js";
import { broadcastRoutes } from "./broadcasts.js";
import { meetingRoutes } from "./meetings.js";
export async function createApp(
  db: DB,
  c: Config,
  {
    logger = true,
    rateLimits = true,
    media,
  }: { logger?: boolean; rateLimits?: boolean; media?: MediaService } = {},
) {
  const app = Fastify({
    logger: logger
      ? {
          serializers: {
            req(request: { method?: string; url?: string }) {
              return {
                method: request.method,
                url: request.url?.split("?")[0],
              };
            },
          },
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "req.body.password",
            "req.body.token",
            "res.headers.set-cookie",
          ],
        }
      : false,
    bodyLimit: 65536,
    trustProxy: c.trustProxy,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: [
          "'self'",
          ...(c.livekitUrl
            ? [c.livekitUrl, c.livekitUrl.replace(/^ws/, "http")]
            : []),
        ],
        mediaSrc: ["'self'", "blob:"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: c.production ? [] : null,
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    hsts: c.production ? { maxAge: 31536000 } : false,
  });
  await app.register(rateLimit, {
    global: rateLimits,
    max: 240,
    timeWindow: "1 minute",
    allowList: rateLimits ? [] : ["127.0.0.1"],
  });
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  await app.register(websocket, { options: { maxPayload: 2048 } });
  app.decorateRequest("user", null);
  app.decorateRequest("sessionHash", null);
  app.decorateRequest("csrf", null);
  const publicPaths = new Set([
    "/api/health",
    "/api/config",
    "/api/auth/signup",
    "/api/auth/login",
    "/api/auth/mobile-login",
    "/api/auth/verify",
    "/api/auth/forgot",
    "/api/auth/reset",
  ]);
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    const writes = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (writes && req.headers.origin !== c.origin)
      fail(403, "Request origin is not allowed.");
    if (publicPaths.has(path)) return;
    const authorization = req.headers.authorization;
    const nativeToken = authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    if (authorization && !nativeToken) fail(401, "Invalid mobile session.");
    const token = nativeToken || req.cookies.cf_session;
    if (!token) fail(401, "Please sign in.");
    const sessionHash = hash(token),
      [u] = await db.q<User>(
        `SELECT u.id,u.email,u.name,u.verified_at,u.status,u.is_system_admin,u.can_create_org,u.must_change_password,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.disabled_at IS NULL AND s.client_type=$2`,
        [sessionHash, nativeToken ? "mobile" : "web"],
      );
    if (!u) fail(401, "Your session has expired. Please sign in.");
    req.user = {
      id: u.id,
      email: u.email,
      name: u.name,
      verified_at: u.verified_at,
      status: u.status,
      is_system_admin: u.is_system_admin,
      can_create_org: u.can_create_org,
      must_change_password: u.must_change_password,
    };
    req.sessionHash = sessionHash;
    req.csrf = u.csrf;
    if (writes && req.headers["x-csrf-token"] !== u.csrf)
      fail(403, "Session security token expired. Reload and try again.");
    if (
      u.must_change_password &&
      !["/api/me", "/api/auth/change-password", "/api/auth/logout"].includes(
        path,
      )
    )
      fail(403, "Change your temporary password before continuing.");
    if (
      !u.verified_at &&
      ![
        "/api/me",
        "/api/auth/logout",
        "/api/auth/resend",
        "/api/invitations/accept",
      ].includes(path)
    )
      fail(403, "Verify your email before continuing.");
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError)
      return reply
        .code(400)
        .send({ error: err.issues.map((i) => i.message).join(" ") });
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.code === "23505")
      return reply
        .code(409)
        .send({ error: "This already exists. Refresh and try again." });
    if (e.code === "22P02")
      return reply.code(400).send({ error: "Invalid identifier." });
    const status =
      e.statusCode && e.statusCode >= 400 && e.statusCode < 500
        ? e.statusCode
        : 500;
    if (status === 500) req.log.error({ err }, "Request failed");
    return reply.code(status).send({
      error:
        status === 500
          ? "Something went wrong. Please try again."
          : e.message || "Request failed.",
    });
  });
  const events = realtime(app, db, c);
  const mediaClient = new RoomServiceClient(
    c.livekitInternalUrl || "http://localhost:7880",
    c.livekitKey || "unused",
    c.livekitSecret || "unused",
  );
  const mediaService: MediaService = media || {
    async ensureRoom(name) {
      if (!(await mediaClient.listRooms([name])).length)
        await mediaClient.createRoom({
          name,
          maxParticipants: 30,
          emptyTimeout: 300,
        });
    },
    async deleteRoom(name) {
      if ((await mediaClient.listRooms([name])).length)
        await mediaClient.deleteRoom(name);
    },
  };
  const ctx: Context = { app, db, c, events, media: mediaService };
  app.get("/api/health", async () => {
    await db.q("SELECT 1");
    return { ok: true, version: "0.1.0" };
  });
  authRoutes(ctx);
  orgRoutes(ctx);
  chatRoutes(ctx);
  fileRoutes(ctx);
  meetingRoutes(ctx);
  adminRoutes(ctx);
  onboardingRoutes(ctx);
  broadcastRoutes(ctx);
  if (existsSync(c.webDir)) {
    await app.register(staticFiles, { root: c.webDir, prefix: "/" });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith("/api/"))
        return reply.code(404).send({ error: "Route not found." });
      if (req.method !== "GET")
        return reply.code(404).send({ error: "Not found." });
      return reply.sendFile("index.html");
    });
  }
  return app;
}
