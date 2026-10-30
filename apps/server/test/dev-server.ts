// Disposable integration/visual-test server. Never included in the production build.
import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { configuration } from "../src/config.js";
import { passwordHash } from "../src/security.js";
import type { DB, Row } from "../src/db/index.js";
if (process.env.NODE_ENV === "production")
  throw new Error("Test server cannot run in production.");
const pg = new PGlite();
await pg.exec(
  await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8"),
);
const wrap = (client: any): DB => ({
    async q<T extends Row>(sql: string, args: unknown[] = []) {
      return (await client.query(sql, args)).rows as T[];
    },
    async tx(fn) {
      return client.transaction((tx: any) => fn(wrap(tx)));
    },
    close: async () => {},
  }),
  db = wrap(pg);
const alex = randomUUID(),
  tara = randomUUID(),
  sam = randomUUID(),
  org = randomUUID(),
  community = randomUUID(),
  general = randomUUID(),
  design = randomUUID(),
  dm = randomUUID();
const encoded = await passwordHash("ChatFinity-Demo-2026!");
for (const [id, email, name, status] of [
  [alex, "alex@chatfinity.test", "Alex Morgan", "online"],
  [tara, "tara@chatfinity.test", "Tara Williams", "online"],
  [sam, "sam@chatfinity.test", "Sam Rivera", "away"],
])
  await db.q(
    "INSERT INTO users(id,email,name,password_hash,verified_at,status) VALUES($1,$2,$3,$4,now(),$5)",
    [id, email, name, encoded, status],
  );
await db.q("UPDATE users SET is_system_admin=true WHERE id=$1", [alex]);
await db.q(
  "INSERT INTO organizations(id,name,created_by) VALUES($1,$2,$3),($4,$5,$3)",
  [org, "InnaWare", alex, community, "Weekend Collective"],
);
for (const id of [alex, tara, sam])
  await db.q("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,$3)", [
    org,
    id,
    id === alex ? "owner" : "member",
  ]);
await db.q(
  "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')",
  [community, alex],
);
for (const [id, orgId, name, kind, topic] of [
  [
    general,
    org,
    "general",
    "public",
    "The little updates. The big ideas. The everyday hellos.",
  ],
  [design, org, "design-studio", "public", "A place for things that could be."],
  [dm, org, "Direct message", "dm", ""],
  [randomUUID(), org, "product-ideas", "public", "What should we build next?"],
  [
    randomUUID(),
    community,
    "general",
    "public",
    "Good company, great conversations.",
  ],
]) {
  await db.q(
    "INSERT INTO channels(id,org_id,name,kind,topic,created_by) VALUES($1,$2,$3,$4,$5,$6)",
    [id, orgId, name, kind, topic, alex],
  );
  for (const u of orgId === community
    ? [alex]
    : kind === "dm"
      ? [alex, tara]
      : [alex, tara, sam])
    await db.q(
      "INSERT INTO channel_members(org_id,channel_id,user_id) VALUES($1,$2,$3)",
      [orgId, id, u],
    );
}
const notes = [
  [
    tara,
    "Morning, everyone! ☀️ A small win to kick things off: the new onboarding flow is ready for a first look.",
  ],
  [
    sam,
    "Love a good Monday win. The little details in this one make such a difference.",
  ],
  [
    alex,
    "It’s looking great. A huge thank-you to everyone who helped bring this together. 👏",
  ],
  [
    tara,
    "I’ve put together a few notes for our afternoon catch-up. Nothing formal — just a chance to share what’s working and what could be better.",
  ],
  [sam, "Count me in! I have a couple of ideas for the welcome screen. ☕"],
  [
    alex,
    "Perfect. Let’s keep it simple, make it useful, and make it feel like us.",
  ],
  [
    tara,
    "Exactly this. Good tools should make people feel closer, not busier. 💚",
  ],
];
let parent = "";
for (let i = 0; i < notes.length; i++) {
  const [sender, body] = notes[i],
    id = randomUUID();
  await db.q(
    "INSERT INTO messages(id,org_id,channel_id,sender_id,body,client_id,created_at,reply_id) VALUES($1,$2,$3,$4,$5,$6,now()-($7*interval '1 minute'),$8)",
    [
      id,
      org,
      general,
      sender,
      body,
      randomUUID(),
      40 - i * 4,
      i === 5 ? parent || null : null,
    ],
  );
  if (i === 3) parent = id;
  if (i === 0 || i === 2)
    await db.q(
      "INSERT INTO reactions(message_id,user_id,emoji) VALUES($1,$2,$3)",
      [id, alex, i === 0 ? "🎉" : "❤️"],
    );
}
await db.q(
  "INSERT INTO messages(id,org_id,channel_id,sender_id,body,client_id) VALUES($1,$2,$3,$4,$5,$6)",
  [
    randomUUID(),
    org,
    dm,
    tara,
    "Hey Alex! Got a minute to look at the new concepts together?",
    randomUUID(),
  ],
);
const dir = await mkdtemp(join(tmpdir(), "chatfinity-e2e-"));
const c = {
  ...configuration(),
  origin: "http://127.0.0.1:4173",
  uploadDir: dir,
  webDir: resolve("apps/web/dist"),
  livekitUrl: "ws://127.0.0.1:7880",
  livekitInternalUrl: "http://127.0.0.1:7880",
  livekitKey: "devkey",
  livekitSecret: "secret",
};
const app = await createApp(db, c, { logger: false, rateLimits: false });
await app.listen({ host: "127.0.0.1", port: 4173 });
console.log("Disposable ChatFinity test server: http://127.0.0.1:4173");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(
    signal,
    () =>
      void app
        .close()
        .then(() => pg.close())
        .then(() => rm(dir, { recursive: true, force: true }))
        .then(() => process.exit(0)),
  );
