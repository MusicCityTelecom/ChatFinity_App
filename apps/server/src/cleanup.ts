// Removes expired sessions/tokens and unclaimed uploads older than 24 hours.
// Production: node apps/server/dist/cleanup.js
import { postgres } from "./db/index.js";
import { configuration } from "./config.js";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
const c = configuration(),
  db = postgres(c.databaseUrl);
try {
  await db.q("DELETE FROM sessions WHERE expires_at<now()");
  await db.q("DELETE FROM email_tokens WHERE expires_at<now()");
  const files = await db.q(
    "DELETE FROM attachments WHERE message_id IS NULL AND created_at<now()-interval '24 hours' RETURNING id",
  );
  for (const file of files)
    await unlink(join(c.uploadDir, file.id)).catch(() => {});
  await db.q("DELETE FROM mail_outbox WHERE sent_at<now()-interval '7 days'");
  console.log(`Removed ${files.length} unclaimed attachment records.`);
} finally {
  await db.close();
}
