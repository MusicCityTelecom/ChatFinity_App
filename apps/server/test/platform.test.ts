import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../src/app.js";
import { configuration } from "../src/config.js";
import type { DB, Row } from "../src/db/index.js";
const password = "A strong test password 2026!";
test("ChatFinity accounts, organizations and conversation boundaries", async (t) => {
  const pg = new PGlite();
  await pg.exec(
    await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8"),
  );
  const wrap = (client: any): DB => ({
    async q<T extends Row>(sql: string, args: unknown[] = []) {
      return (await client.query(sql, args)).rows as T[];
    },
    async tx(fn) {
      return client.transaction((transaction: any) => fn(wrap(transaction)));
    },
    close: async () => {},
  });
  const db = wrap(pg),
    dir = await mkdtemp(join(tmpdir(), "chatfinity-test-")),
    c = {
      ...configuration(),
      uploadDir: dir,
      webDir: join(dir, "missing"),
      livekitUrl: "wss://meet.example.test",
      livekitInternalUrl: "http://localhost:7999",
      livekitKey: "test-api-key",
      livekitSecret: "test-meeting-secret-minimum-32-characters",
    };
  const app = await createApp(db, c, {
    logger: false,
    rateLimits: false,
    media: { ensureRoom: async () => {}, deleteRoom: async () => {} },
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    await pg.close();
    await rm(dir, { recursive: true, force: true });
  });
  type Account = { id: string; email: string; cookie: string; csrf: string };
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    as?: Account,
    expected = 200,
  ) {
    const res = await app.inject({
      url: "/api" + path,
      method: method as any,
      headers: {
        origin: c.origin,
        ...(as ? { cookie: as.cookie, "x-csrf-token": as.csrf } : {}),
      },
      ...(body !== undefined ? { payload: body as any } : {}),
    });
    assert.equal(res.statusCode, expected, `${method} ${path}: ${res.body}`);
    return res;
  }
  async function account(
    email: string,
    name: string,
    verified = true,
    invite?: string,
  ): Promise<Account> {
    await request("/auth/signup", "POST", {
      email,
      password,
      name,
      ...(invite ? { invite } : {}),
    });
    if (verified) {
      const [mail] = await db.q(
        "SELECT payload FROM mail_outbox WHERE payload->>'to'=$1 ORDER BY created_at DESC LIMIT 1",
        [email],
      );
      assert.ok(mail);
      const token = mail.payload.text.match(/verify=([A-Za-z0-9_-]+)/)[1];
      await request("/auth/verify", "POST", { token });
      await request("/auth/verify", "POST", { token }, undefined, 400);
    }
    const res = await request("/auth/login", "POST", { email, password });
    const data = res.json();
    return {
      id: data.user.id,
      email,
      cookie:
        "cf_session=" + res.cookies.find((c) => c.name === "cf_session")!.value,
      csrf: data.csrf,
    };
  }
  const alice = await account("alice@example.test", "Alice Owner"),
    bob = await account("bob@example.test", "Bob Member"),
    carol = await account("carol@example.test", "Carol Outsider");
  let orgA = "",
    orgB = "",
    channelA = "",
    dm = "",
    message = "",
    attachment = "";
  await t.test(
    "Unauthenticated access, unverified email, request origin and CSRF are enforced",
    async () => {
      await request("/orgs", "GET", undefined, undefined, 401);
      const unverified = await account(
        "unverified@example.test",
        "Unverified",
        false,
      );
      await request("/orgs", "GET", undefined, unverified, 403);
      const bad = await app.inject({
        url: "/api/orgs",
        method: "POST",
        headers: {
          origin: "https://evil.example",
          cookie: alice.cookie,
          "x-csrf-token": alice.csrf,
        },
        payload: { name: "Nope" },
      });
      assert.equal(bad.statusCode, 403);
      const missing = await app.inject({
        url: "/api/orgs",
        method: "POST",
        headers: { origin: c.origin, cookie: alice.cookie },
        payload: { name: "Nope" },
      });
      assert.equal(missing.statusCode, 403);
      const me = await request("/me", "GET", undefined, alice);
      assert.ok(!("password_hash" in me.json().user));
      assert.equal(me.headers["cache-control"], "no-store");
    },
  );
  await t.test("One account can create independent organizations", async () => {
    orgA = (await request("/orgs", "POST", { name: "InnaWare" }, alice)).json()
      .id;
    orgB = (
      await request("/orgs", "POST", { name: "Separate Community" }, alice)
    ).json().id;
    assert.equal(
      (await request("/orgs", "GET", undefined, alice)).json().organizations
        .length,
      2,
    );
    const channels = (
      await request(`/orgs/${orgA}/channels`, "GET", undefined, alice)
    ).json().channels;
    channelA = channels[0].id;
    assert.equal(channels[0].name, "general");
    await request(`/orgs/${orgA}/members`, "GET", undefined, carol, 403);
  });
  await t.test(
    "Invitations are email-bound, expiring and single-use",
    async () => {
      await request(
        `/orgs/${orgA}/invitations`,
        "POST",
        { email: bob.email, role: "member" },
        alice,
      );
      const [mail] = await db.q(
        "SELECT payload FROM mail_outbox WHERE payload->>'to'=$1 AND payload->>'subject' LIKE 'You%' ORDER BY created_at DESC LIMIT 1",
        [bob.email],
      );
      const token = mail.payload.text.match(/invite=([A-Za-z0-9_-]+)/)[1];
      await request("/invitations/accept", "POST", { token }, carol, 400);
      await request("/invitations/accept", "POST", { token }, bob);
      await request("/invitations/accept", "POST", { token }, bob, 400);
      assert.equal(
        (await request("/orgs", "GET", undefined, bob)).json().organizations
          .length,
        1,
      );
      await request(
        `/orgs/${orgA}/invitations`,
        "POST",
        { email: carol.email },
        bob,
        403,
      );
      await request(`/orgs/${orgB}/channels`, "GET", undefined, bob, 403);
    },
  );
  await t.test(
    "Public discovery never leaks messages before joining",
    async () => {
      const created = (
        await request(
          `/orgs/${orgA}/channels`,
          "POST",
          { name: "Design studio", kind: "public" },
          alice,
        )
      ).json().id;
      await request(
        `/channels/${created}/messages`,
        "POST",
        { body: "Private until joined", clientId: randomUUID() },
        alice,
      );
      const discovery = (
        await request(`/orgs/${orgA}/channels`, "GET", undefined, bob)
      )
        .json()
        .channels.find((x: any) => x.id === created);
      assert.equal(discovery.last_message, null);
      assert.equal(discovery.unread, 0);
      await request(
        `/channels/${created}/messages`,
        "GET",
        undefined,
        bob,
        404,
      );
      await request(`/channels/${created}/join`, "POST", {}, bob);
      assert.equal(
        (
          await request(`/channels/${created}/messages`, "GET", undefined, bob)
        ).json().messages.length,
        1,
      );
    },
  );
  await t.test(
    "Messages persist, retries deduplicate, and other organizations cannot read them",
    async () => {
      const clientId = randomUUID(),
        data = { body: "Launch notes: hello everyone 👋", clientId };
      message = (
        await request(`/channels/${channelA}/messages`, "POST", data, alice)
      ).json().id;
      const retry = (
        await request(`/channels/${channelA}/messages`, "POST", data, alice)
      ).json();
      assert.equal(retry.id, message);
      assert.equal(retry.duplicate, true);
      const timeline = (
        await request(`/channels/${channelA}/messages`, "GET", undefined, bob)
      ).json().messages;
      assert.equal(timeline.length, 1);
      assert.equal(timeline[0].body, data.body);
      await request(
        `/channels/${channelA}/messages`,
        "GET",
        undefined,
        carol,
        404,
      );
      const otherChannel = (
        await request(`/orgs/${orgB}/channels`, "GET", undefined, alice)
      ).json().channels[0].id;
      await request(
        `/channels/${otherChannel}/messages`,
        "POST",
        data,
        alice,
        409,
      );
      await request(
        `/channels/${otherChannel}/messages`,
        "POST",
        { body: "Wrong reply", clientId: randomUUID(), replyId: message },
        alice,
        400,
      );
    },
  );
  await t.test(
    "Replies, reactions, saved messages and escaped search work",
    async () => {
      await request(
        `/channels/${channelA}/messages`,
        "POST",
        {
          body: "I have the notes ready.",
          clientId: randomUUID(),
          replyId: message,
        },
        bob,
      );
      await request(
        `/messages/${message}/react`,
        "POST",
        { emoji: "🎉", active: true },
        bob,
      );
      await request(`/messages/${message}/save`, "POST", { active: true }, bob);
      const timeline = (
        await request(`/channels/${channelA}/messages`, "GET", undefined, bob)
      ).json().messages;
      assert.equal(timeline[1].reply_body, "Launch notes: hello everyone 👋");
      assert.equal(timeline[0].reactions[0].count, 1);
      assert.equal(timeline[0].saved, true);
      assert.equal(
        (
          await request(
            `/channels/${channelA}/messages?saved=true`,
            "GET",
            undefined,
            alice,
          )
        ).json().messages.length,
        0,
      );
      assert.equal(
        (
          await request(
            `/channels/${channelA}/messages?search=Launch`,
            "GET",
            undefined,
            bob,
          )
        ).json().messages.length,
        1,
      );
      assert.equal(
        (
          await request(
            `/channels/${channelA}/messages?search=%25`,
            "GET",
            undefined,
            bob,
          )
        ).json().messages.length,
        0,
      );
      await request(
        `/messages/${message}/react`,
        "POST",
        { emoji: "<script>", active: true },
        bob,
        400,
      );
      await request(
        `/messages/${message}`,
        "PATCH",
        { body: "Not mine" },
        bob,
        403,
      );
    },
  );
  await t.test(
    "Direct conversations are deduplicated and membership-bound",
    async () => {
      dm = (
        await request(`/orgs/${orgA}/dm`, "POST", { userId: bob.id }, alice)
      ).json().id;
      assert.equal(
        (
          await request(`/orgs/${orgA}/dm`, "POST", { userId: alice.id }, bob)
        ).json().id,
        dm,
      );
      await request(
        `/orgs/${orgA}/dm`,
        "POST",
        { userId: carol.id },
        alice,
        403,
      );
      await request(`/channels/${dm}/messages`, "GET", undefined, carol, 404);
    },
  );
  await t.test(
    "Read acknowledgements cannot advance another conversation",
    async () => {
      await request(
        `/channels/${channelA}/read`,
        "POST",
        { messageId: message },
        bob,
      );
      await request(
        `/channels/${dm}/read`,
        "POST",
        { messageId: message },
        bob,
        404,
      );
      const [marker] = await db.q(
        "SELECT read_at FROM read_markers WHERE channel_id=$1 AND user_id=$2",
        [channelA, bob.id],
      );
      assert.ok(marker);
    },
  );
  function multipart(name: string, text: string) {
    const boundary = "test-boundary-293001";
    return {
      data: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--${boundary}--\r\n`,
      ),
      type: "multipart/form-data; boundary=" + boundary,
    };
  }
  await t.test(
    "Real multipart attachments require channel access and validated file types",
    async () => {
      const file = multipart(
        "agenda.txt",
        "Meeting agenda: planning and next steps.",
      );
      const res = await app.inject({
        url: `/api/channels/${channelA}/files`,
        method: "POST",
        headers: {
          origin: c.origin,
          cookie: alice.cookie,
          "x-csrf-token": alice.csrf,
          "content-type": file.type,
        },
        payload: file.data,
      });
      assert.equal(res.statusCode, 200, res.body);
      attachment = res.json().id;
      await request(`/files/${attachment}`, "GET", undefined, bob, 404);
      const id = (
        await request(
          `/channels/${channelA}/messages`,
          "POST",
          {
            body: "The agenda",
            clientId: randomUUID(),
            attachments: [attachment],
          },
          alice,
        )
      ).json().id;
      const download = await request(
        `/files/${attachment}`,
        "GET",
        undefined,
        bob,
      );
      assert.equal(download.body, "Meeting agenda: planning and next steps.");
      assert.equal(download.headers["x-content-type-options"], "nosniff");
      await request(`/files/${attachment}`, "GET", undefined, carol, 404);
      const exe = multipart("not-safe.exe", "MZ unsupported");
      const blocked = await app.inject({
        url: `/api/channels/${channelA}/files`,
        method: "POST",
        headers: {
          origin: c.origin,
          cookie: alice.cookie,
          "x-csrf-token": alice.csrf,
          "content-type": exe.type,
        },
        payload: exe.data,
      });
      assert.equal(blocked.statusCode, 400);
      await request(`/messages/${id}`, "DELETE", undefined, alice);
      await request(`/files/${attachment}`, "GET", undefined, bob, 404);
    },
  );
  await t.test(
    "Meeting grants are short-lived and scoped to one authorized room",
    async () => {
      const id = (
        await request(
          `/channels/${channelA}/meetings`,
          "POST",
          { title: "Planning together" },
          alice,
        )
      ).json().id;
      const access = (
        await request(`/meetings/${id}/token`, "POST", {}, bob)
      ).json();
      const payload = JSON.parse(
        Buffer.from(access.token.split(".")[1], "base64url").toString(),
      );
      assert.equal(payload.video.room, "chatfinity-" + id);
      assert.equal(payload.sub, bob.id);
      assert.ok(payload.exp - payload.nbf <= 60);
      await request(`/meetings/${id}/token`, "POST", {}, carol, 404);
      await request(
        `/orgs/${orgA}/members/${bob.id}`,
        "DELETE",
        undefined,
        alice,
        409,
      );
      await db.q("UPDATE meetings SET ended_at=now() WHERE id=$1", [id]);
      await request(`/meetings/${id}/token`, "POST", {}, bob, 404);
      await request(
        `/orgs/${orgA}/members/${bob.id}`,
        "DELETE",
        undefined,
        alice,
        409,
      );
      await db.q(
        "UPDATE meetings SET ended_at=now()-interval '3 minutes' WHERE id=$1",
        [id],
      );
    },
  );
  await t.test(
    "Organization delegation preserves at least one owner",
    async () => {
      await request(
        `/orgs/${orgA}/members/${alice.id}`,
        "PATCH",
        { role: "member" },
        alice,
        409,
      );
      await request(
        `/orgs/${orgA}/members/${bob.id}`,
        "PATCH",
        { role: "owner" },
        alice,
      );
      await request(
        `/orgs/${orgA}/members/${alice.id}`,
        "PATCH",
        { role: "admin" },
        alice,
      );
      await request(
        `/orgs/${orgA}/members/${bob.id}`,
        "PATCH",
        { role: "member" },
        alice,
        403,
      );
      await request(
        `/orgs/${orgA}/members/${alice.id}`,
        "PATCH",
        { role: "owner" },
        bob,
      );
      await request(
        `/orgs/${orgA}/members/${bob.id}`,
        "PATCH",
        { role: "member" },
        alice,
      );
    },
  );
  await t.test(
    "Removing membership revokes conversation access without deleting the account",
    async () => {
      await request(
        `/orgs/${orgA}/members/${bob.id}`,
        "DELETE",
        undefined,
        alice,
      );
      await request(
        `/channels/${channelA}/messages`,
        "GET",
        undefined,
        bob,
        404,
      );
      await request(`/channels/${dm}/messages`, "GET", undefined, bob, 404);
      assert.equal(
        (await request("/me", "GET", undefined, bob)).json().user.id,
        bob.id,
      );
      assert.equal(
        (await request("/orgs", "GET", undefined, bob)).json().organizations
          .length,
        0,
      );
    },
  );
  await t.test(
    "Password reset is single-use and revokes all existing sessions",
    async () => {
      await request("/auth/forgot", "POST", { email: carol.email });
      const [mail] = await db.q(
        "SELECT payload FROM mail_outbox WHERE payload->>'to'=$1 AND payload->>'subject' LIKE 'Reset%' ORDER BY created_at DESC LIMIT 1",
        [carol.email],
      );
      const token = mail.payload.text.match(/reset=([A-Za-z0-9_-]+)/)[1];
      await request("/auth/reset", "POST", {
        token,
        password: "A different strong password!",
      });
      await request("/me", "GET", undefined, carol, 401);
      await request("/auth/reset", "POST", { token, password }, undefined, 400);
    },
  );
  await t.test(
    "Invite-only servers allow signup only with a matching valid invitation",
    async () => {
      await request(
        `/orgs/${orgA}/invitations`,
        "POST",
        { email: "invited@example.test" },
        alice,
      );
      const [mail] = await db.q(
        "SELECT payload FROM mail_outbox WHERE payload->>'to'='invited@example.test' ORDER BY created_at DESC LIMIT 1",
      );
      const token = mail.payload.text.match(/invite=([A-Za-z0-9_-]+)/)[1];
      c.registration = false;
      await request(
        "/auth/signup",
        "POST",
        { email: "stranger@example.test", password, name: "No Invite" },
        undefined,
        403,
      );
      const invited = await account(
        "invited@example.test",
        "Invited Person",
        false,
        token,
      );
      await request("/invitations/accept", "POST", { token }, invited);
      assert.equal(
        (await request("/orgs", "GET", undefined, invited)).json().organizations
          .length,
        1,
      );
      c.registration = true;
    },
  );
});
