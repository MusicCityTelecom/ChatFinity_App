import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { DB } from "./db/index.js";
import type { Config } from "./config.js";
import type { Events } from "./types.js";
import { channelMember } from "./access.js";
export function realtime(app: FastifyInstance, db: DB, c: Config): Events {
  const clients = new Map<
    WebSocket,
    {
      userId: string;
      sessionHash: string;
      lastTyping: number;
      count: number;
      window: number;
      lastActivity: number;
      alive: boolean;
    }
  >();
  const send = (socket: WebSocket, event: Record<string, unknown>) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(event));
  };
  const events: Events = {
    async publish(orgId, channelId, event) {
      // Never trust a remembered socket subscription after membership changes.
      const rows = await db.q(
        channelId
          ? "SELECT user_id FROM channel_members WHERE org_id=$1 AND channel_id=$2"
          : "SELECT user_id FROM memberships WHERE org_id=$1",
        channelId ? [orgId, channelId] : [orgId],
      );
      const allowed = new Set(rows.map((r) => r.user_id));
      for (const [ws, client] of clients)
        if (allowed.has(client.userId))
          send(ws, { ...event, orgId, channelId });
    },
    disconnectUser(userId) {
      for (const [ws, client] of clients)
        if (client.userId === userId)
          ws.close(4001, "Session or access changed");
    },
    presence(userId) {
      const peers = [...clients.values()].filter((c) => c.userId === userId);
      return !peers.length
        ? "offline"
        : peers.some((c) => Date.now() - c.lastActivity < 120000)
          ? "online"
          : "away";
    },
  };
  app.get("/api/events", { websocket: true }, (socket, req) => {
    if (
      req.headers.origin !== c.origin ||
      !req.user?.verified_at ||
      !req.sessionHash
    ) {
      socket.close(1008, "Unauthorized");
      return;
    }
    clients.set(socket, {
      userId: req.user.id,
      sessionHash: req.sessionHash,
      lastTyping: 0,
      count: 0,
      window: Date.now(),
      lastActivity: Date.now(),
      alive: true,
    });
    socket.on("pong", () => {
      const client = clients.get(socket);
      if (client) client.alive = true;
    });
    send(socket, { type: "connected" });
    socket.on("message", async (raw) => {
      const client = clients.get(socket);
      if (!client) return;
      const now = Date.now();
      if (now - client.window > 10000) {
        client.count = 0;
        client.window = now;
      }
      if (++client.count > 30) {
        socket.close(1008, "Too many events");
        return;
      }
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === "activity" && event.active === true)
          client.lastActivity = now;
        if (
          event.type === "typing" &&
          typeof event.channelId === "string" &&
          now - client.lastTyping > 2000
        ) {
          client.lastTyping = now;
          const ch = await channelMember(db, client.userId, event.channelId);
          const [u] = await db.q("SELECT name,status FROM users WHERE id=$1", [
            client.userId,
          ]);
          if (u && u.status !== "invisible")
            await events.publish(ch.org_id, ch.id, {
              type: "typing",
              userId: client.userId,
              name: u.name,
            });
        }
      } catch {
        /* Ignore malformed or unauthorized ephemeral events. */
      }
    });
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });
  const timer = setInterval(async () => {
    for (const [ws, client] of clients) {
      try {
        const [s] = await db.q(
          "SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.disabled_at IS NULL",
          [client.sessionHash],
        );
        if (!s) ws.close(4001, "Session expired");
        else if (!client.alive) ws.terminate();
        else if (ws.readyState === 1) {
          client.alive = false;
          ws.ping();
        }
      } catch {
        ws.close(1011, "Authentication unavailable");
      }
    }
  }, 30000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    for (const ws of clients.keys()) ws.close(1001, "Server restarting");
    clients.clear();
  });
  return events;
}
