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
  await t.test(
    "System administrators control accounts while organization owners cannot access system controls",
    async () => {
      await request("/admin/users", "GET", undefined, alice, 403);
      await db.q("UPDATE users SET is_system_admin=true WHERE id=$1", [
        alice.id,
      ]);
      const overview = (
        await request("/admin/overview", "GET", undefined, alice)
      ).json();
      assert.ok(overview.counts.users >= 3);
      const profile = (await request("/me", "GET", undefined, alice)).json()
        .user;
      assert.equal(profile.is_system_admin, true);
      await request(
        `/admin/users/${alice.id}`,
        "PATCH",
        { systemAdmin: false },
        alice,
        409,
      );
      await request(
        `/admin/users/${alice.id}`,
        "PATCH",
        { disabled: true },
        alice,
        409,
      );
      await request(
        `/admin/users/${alice.id}`,
        "PATCH",
        { verified: false },
        alice,
        409,
      );
      const created = (
        await request(
          "/admin/users",
          "POST",
          {
            email: "managed@example.test",
            name: "Managed Account",
            canCreateOrg: false,
            memberships: [
              { orgId: orgA, role: "member" },
              { orgId: orgB, role: "admin" },
            ],
          },
          alice,
        )
      ).json();
      const [row] = await db.q("SELECT * FROM users WHERE id=$1", [created.id]);
      assert.equal(row.can_create_org, false);
      assert.equal(row.must_change_password, true);
      assert.ok(row.verified_at);
      assert.equal(
        (await db.q("SELECT * FROM memberships WHERE user_id=$1", [created.id]))
          .length,
        2,
      );
      const [mail] = await db.q(
        "SELECT payload FROM mail_outbox WHERE payload->>'to'='managed@example.test'",
      );
      const token = mail.payload.text.match(/reset=([A-Za-z0-9_-]+)/)[1];
      await request("/auth/reset", "POST", { token, password });
      const login = await request("/auth/login", "POST", {
        email: row.email,
        password,
      });
      const managed = {
        id: created.id,
        email: row.email,
        csrf: login.json().csrf,
        cookie:
          "cf_session=" +
          login.cookies.find((c) => c.name === "cf_session")!.value,
      };
      await request(
        "/orgs",
        "POST",
        { name: "Unauthorized new organization" },
        managed,
        403,
      );
      await request(
        `/admin/users/${managed.id}`,
        "PATCH",
        { canCreateOrg: true },
        alice,
      );
      await request("/orgs", "POST", { name: "Delegated founder" }, managed);
      await request(
        `/admin/users/${managed.id}`,
        "PATCH",
        { disabled: true },
        alice,
      );
      await request("/me", "GET", undefined, managed, 401);
      await request(
        "/auth/login",
        "POST",
        { email: row.email, password },
        undefined,
        403,
      );
      await request("/admin/audit", "GET", undefined, alice);
    },
  );
  await t.test(
    "Organization ID signup requires verification and approval and never grants access from the ID alone",
    async () => {
      const [org] = await db.q(
        "SELECT join_code FROM organizations WHERE id=$1",
        [orgA],
      );
      assert.match(org.join_code, /^CF-/);
      await request("/auth/signup", "POST", {
        email: "joiner@example.test",
        name: "New Participant",
        password,
        organizationId: org.join_code.toLowerCase(),
      });
      const [u] = await db.q(
        "SELECT id,can_create_org FROM users WHERE email='joiner@example.test'",
      );
      assert.equal(u.can_create_org, false);
      let pending = (
        await request(`/orgs/${orgA}/join-requests`, "GET", undefined, alice)
      ).json().requests;
      assert.ok(!pending.some((j: any) => j.user_id === u.id));
      const [mail] = await db.q(
        "SELECT payload FROM mail_outbox WHERE payload->>'to'='joiner@example.test'",
      );
      await request("/auth/verify", "POST", {
        token: mail.payload.text.match(/verify=([A-Za-z0-9_-]+)/)[1],
      });
      const login = await request("/auth/login", "POST", {
          email: "joiner@example.test",
          password,
        }),
        joiner = {
          id: u.id,
          email: "joiner@example.test",
          csrf: login.json().csrf,
          cookie:
            "cf_session=" +
            login.cookies.find((c) => c.name === "cf_session")!.value,
        };
      assert.equal(
        (await request("/orgs", "GET", undefined, joiner)).json().organizations
          .length,
        0,
      );
      await request(
        `/channels/${channelA}/messages`,
        "GET",
        undefined,
        joiner,
        404,
      );
      pending = (
        await request(`/orgs/${orgA}/join-requests`, "GET", undefined, alice)
      ).json().requests;
      const j = pending.find((j: any) => j.user_id === u.id);
      assert.ok(j);
      await request(
        `/orgs/${orgA}/join-requests/${j.id}`,
        "POST",
        { approve: true },
        joiner,
        403,
      );
      await request(
        `/orgs/${orgA}/join-requests/${j.id}`,
        "POST",
        { approve: true },
        alice,
      );
      assert.equal(
        (await request("/orgs", "GET", undefined, joiner)).json().organizations
          .length,
        1,
      );
      await request(`/channels/${channelA}/messages`, "GET", undefined, joiner);
      await request("/join-requests", "POST", { organizationId: orgB }, joiner);
      const own = (
        await request("/me/join-requests", "GET", undefined, joiner)
      ).json().requests;
      const second = own.find((r: any) => r.org_id === orgB);
      await request(
        `/admin/join-requests/${second.id}`,
        "POST",
        { approve: true },
        alice,
      );
      assert.equal(
        (await request("/orgs", "GET", undefined, joiner)).json().organizations
          .length,
        2,
      );
    },
  );
  await t.test(
    "Broadcasts reach every selected organization, preserve boundaries and roll back unauthorized audiences",
    async () => {
      const sent = (
        await request(
          "/broadcasts",
          "POST",
          {
            organizationIds: [orgA, orgB],
            body: "An organization-wide announcement.",
          },
          alice,
        )
      ).json();
      assert.equal(sent.organizationCount, 2);
      const messages = await db.q(
        "SELECT * FROM messages WHERE broadcast_id=$1",
        [sent.id],
      );
      assert.equal(messages.length, 2);
      assert.notEqual(messages[0].channel_id, messages[1].channel_id);
      for (const m of messages) {
        const [counts] = await db.q(
          "SELECT (SELECT count(*)::int FROM memberships WHERE org_id=$1) AS people,(SELECT count(*)::int FROM channel_members WHERE channel_id=$2) AS audience",
          [m.org_id, m.channel_id],
        );
        assert.equal(counts.people, counts.audience);
      }
      const outsider = await account(
        "broadcast-outsider@example.test",
        "Broadcast Outsider",
      );
      const other = (
        await request("/orgs", "POST", { name: "Other Organization" }, outsider)
      ).json().id;
      const before = (
        await db.q("SELECT count(*)::int AS n FROM broadcasts")
      )[0].n;
      await request(
        "/broadcasts",
        "POST",
        {
          organizationIds: [other, orgA],
          body: "Must not be partially delivered",
        },
        outsider,
        403,
      );
      assert.equal(
        (await db.q("SELECT count(*)::int AS n FROM broadcasts"))[0].n,
        before,
      );
      await request(
        `/channels/${messages[0].channel_id}/messages`,
        "GET",
        undefined,
        outsider,
        404,
      );
      await request(
        "/broadcasts",
        "POST",
        {
          organizationIds: [other],
          body: "A member can broadcast to their organization",
        },
        outsider,
      );
    },
  );
  await t.test(
    "Administrator temporary passwords require replacement and self-service change revokes other sessions",
    async () => {
      const target = await account(
        "temporary@example.test",
        "Temporary Password",
      );
      await request(
        `/admin/users/${target.id}/password-reset`,
        "POST",
        { temporaryPassword: "Temporary-Password-2026!" },
        alice,
      );
      await request("/me", "GET", undefined, target, 401);
      const login = await request("/auth/login", "POST", {
        email: target.email,
        password: "Temporary-Password-2026!",
      });
      assert.equal(login.json().user.must_change_password, true);
      const session = {
        ...target,
        csrf: login.json().csrf,
        cookie:
          "cf_session=" +
          login.cookies.find((c) => c.name === "cf_session")!.value,
      };
      await request("/orgs", "GET", undefined, session, 403);
      await request(
        "/orgs",
        "POST",
        { name: "Blocked until changed" },
        session,
        403,
      );
      const otherLogin = await request("/auth/login", "POST", {
          email: target.email,
          password: "Temporary-Password-2026!",
        }),
        other = {
          ...target,
          csrf: otherLogin.json().csrf,
          cookie:
            "cf_session=" +
            otherLogin.cookies.find((c) => c.name === "cf_session")!.value,
        };
      await request(
        "/auth/change-password",
        "POST",
        {
          currentPassword: "Wrong password",
          password: "Changed-Password-2026!",
        },
        session,
        400,
      );
      await request(
        "/auth/change-password",
        "POST",
        {
          currentPassword: "Temporary-Password-2026!",
          password: "Changed-Password-2026!",
        },
        session,
      );
      assert.equal(
        (await request("/me", "GET", undefined, session)).json().user
          .must_change_password,
        false,
      );
      await request("/orgs", "GET", undefined, session);
      await request("/me", "GET", undefined, other, 401);
    },
  );
});
