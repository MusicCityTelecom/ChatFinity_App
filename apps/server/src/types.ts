import type { DB, Row } from "./db/index.js";
import type { Config } from "./config.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
export interface User extends Row {
  id: string;
  email: string;
  name: string;
  verified_at: string | null;
  status: string;
}
declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
    sessionHash: string | null;
    csrf: string | null;
  }
}
export type Events = {
  publish: (
    orgId: string,
    channelId: string | null,
    event: Record<string, unknown>,
  ) => Promise<void>;
  disconnectUser: (userId: string) => void;
  presence: (userId: string) => "online" | "away" | "offline";
};
export interface MediaService {
  ensureRoom: (name: string) => Promise<void>;
  deleteRoom: (name: string) => Promise<void>;
}
export interface Context {
  app: FastifyInstance;
  db: DB;
  c: Config;
  events: Events;
  media: MediaService;
}
export const uid = (req: FastifyRequest) => req.user!.id;
