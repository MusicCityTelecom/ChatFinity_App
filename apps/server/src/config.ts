import { resolve } from "node:path";
export interface Config {
  production: boolean;
  trustProxy: string | false;
  origin: string;
  orgStorageMb: number;
  databaseUrl: string;
  uploadDir: string;
  webDir: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpSecure: boolean;
  mailFrom: string;
  registration: boolean;
  livekitUrl: string;
  livekitInternalUrl: string;
  livekitKey: string;
  livekitSecret: string;
}
export function configuration(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production",
    origin = (env.PUBLIC_URL || "http://localhost:5173").replace(/\/$/, "");
  if (production && !origin.startsWith("https://"))
    throw new Error("PUBLIC_URL must use HTTPS in production");
  if (production && !env.SMTP_HOST)
    throw new Error("SMTP_HOST is required in production");
  return {
    production,
    trustProxy: production ? env.TRUST_PROXY || "127.0.0.1" : false,
    origin,
    orgStorageMb: Number(env.ORG_STORAGE_LIMIT_MB || 1024),
    databaseUrl:
      env.DATABASE_URL ||
      "postgres://chatfinity:chatfinity@localhost:5432/chatfinity",
    uploadDir: resolve(env.UPLOAD_DIR || "../../.data/uploads"),
    webDir: resolve(env.WEB_DIR || "../web/dist"),
    smtpHost: env.SMTP_HOST || "localhost",
    smtpPort: Number(env.SMTP_PORT || 1025),
    smtpUser: env.SMTP_USER || "",
    smtpPass: env.SMTP_PASSWORD || "",
    smtpSecure: env.SMTP_SECURE === "true",
    mailFrom: env.MAIL_FROM || "ChatFinity <hello@localhost>",
    registration: env.ALLOW_REGISTRATION !== "false",
    livekitUrl: env.LIVEKIT_URL || "",
    livekitInternalUrl:
      env.LIVEKIT_INTERNAL_URL || env.LIVEKIT_URL?.replace(/^ws/, "http") || "",
    livekitKey: env.LIVEKIT_API_KEY || "",
    livekitSecret: env.LIVEKIT_API_SECRET || "",
  };
}
