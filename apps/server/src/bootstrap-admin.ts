// Run inside the server container. Sensitive settings arrive through stdin, never command arguments.
import { createInterface } from "node:readline";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { postgres, migrate } from "./db/index.js";
import { configuration } from "./config.js";
import { passwordHash } from "./security.js";
const rl = createInterface({ input: process.stdin, terminal: false });
const [line] = await once(rl, "line");
rl.close();
const input = JSON.parse(line);
if (
  typeof input.email !== "string" ||
  !input.email.includes("@") ||
  typeof input.password !== "string" ||
  input.password.length < 8
)
  throw new Error(
    "Provide an admin email and password of at least eight characters.",
  );
const db = postgres(configuration().databaseUrl);
try {
  await migrate(db);
  const encoded = await passwordHash(input.password);
  await db.tx(async (tx) => {
    const [existing] = await tx.q("SELECT id FROM users WHERE email=$1", [
      input.email.toLowerCase(),
    ]);
    if (existing) {
      await tx.q(
        "UPDATE users SET is_system_admin=true,can_create_org=true,verified_at=coalesce(verified_at,now()),disabled_at=NULL,password_hash=$1,must_change_password=false WHERE id=$2",
        [encoded, existing.id],
      );
      await tx.q("DELETE FROM sessions WHERE user_id=$1", [existing.id]);
    } else
      await tx.q(
        "INSERT INTO users(id,email,name,password_hash,verified_at,is_system_admin,can_create_org) VALUES($1,$2,$3,$4,now(),true,true)",
        [
          randomUUID(),
          input.email.toLowerCase(),
          input.name || "System Administrator",
          encoded,
        ],
      );
  });
  console.log(
    "Primary system administrator configured. The password was hashed and is not displayed.",
  );
} finally {
  await db.close();
}
