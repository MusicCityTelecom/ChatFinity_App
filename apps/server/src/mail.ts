import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import type { DB } from "./db/index.js";
import type { Config } from "./config.js";
export async function enqueue(
  db: DB,
  to: string,
  subject: string,
  text: string,
) {
  await db.q("INSERT INTO mail_outbox(id,payload) VALUES($1,$2::jsonb)", [
    randomUUID(),
    JSON.stringify({ to, subject, text }),
  ]);
}
export function startMailer(db: DB, c: Config, onError: (s: string) => void) {
  const transport = nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPort,
    secure: c.smtpSecure,
    requireTLS: c.production,
    connectionTimeout: 10000,
    socketTimeout: 15000,
    ...(c.smtpUser ? { auth: { user: c.smtpUser, pass: c.smtpPass } } : {}),
  });
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await db.tx(async (tx) => {
        const rows = await tx.q(
          "SELECT * FROM mail_outbox WHERE sent_at IS NULL AND attempts<10 AND next_attempt_at<=now() ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED",
        );
        for (const row of rows) {
          try {
            await transport.sendMail({ from: c.mailFrom, ...row.payload });
            await tx.q(
              "UPDATE mail_outbox SET sent_at=now(),payload=NULL WHERE id=$1",
              [row.id],
            );
          } catch {
            await tx.q(
              "UPDATE mail_outbox SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE id=$1",
              [row.id],
            );
            onError("Email delivery failed; queued for retry.");
          }
        }
      });
    } catch {
      onError("Email worker could not reach the database.");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  void tick();
  return () => {
    clearInterval(timer);
    transport.close();
  };
}
