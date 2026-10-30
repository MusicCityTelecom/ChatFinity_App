import type { DB } from "./db/index.js";
import { fail } from "./security.js";
export async function member(
  db: DB,
  userId: string,
  orgId: string,
  roles?: string[],
) {
  const [m] = await db.q(
    "SELECT * FROM memberships WHERE org_id=$1 AND user_id=$2",
    [orgId, userId],
  );
  if (!m || (roles && !roles.includes(m.role)))
    fail(403, "You do not have access to this organization or action.");
  return m;
}
export async function channelMember(db: DB, userId: string, channelId: string) {
  const [row] = await db.q(
    `SELECT c.*,m.role FROM channels c JOIN channel_members cm ON cm.channel_id=c.id AND cm.org_id=c.org_id JOIN memberships m ON m.org_id=c.org_id AND m.user_id=cm.user_id WHERE c.id=$1 AND cm.user_id=$2`,
    [channelId, userId],
  );
  if (!row) fail(404, "Conversation not found.");
  return row;
}
export async function accessibleMessage(
  db: DB,
  userId: string,
  messageId: string,
) {
  const [m] = await db.q(
    "SELECT * FROM messages WHERE id=$1 AND deleted_at IS NULL",
    [messageId],
  );
  if (!m) fail(404, "Message not found.");
  await channelMember(db, userId, m.channel_id);
  return m;
}
