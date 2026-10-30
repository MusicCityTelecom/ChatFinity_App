import { test, expect, type Page } from "@playwright/test";
async function signIn(page: Page, email = "alex@chatfinity.test") {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("ChatFinity-Demo-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "general", exact: true }),
  ).toBeVisible();
}
test("sign-in, conversation rendering, replies, drafts, reactions and search", async ({
  page,
}) => {
  await signIn(page);
  await expect(
    page.getByText(
      "Exactly this. Good tools should make people feel closer, not busier. 💚",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Draft that follows this conversation");
  await page
    .getByRole("button", { name: "design-studio", exact: true })
    .click();
  await page.getByRole("button", { name: "general", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Draft that follows this conversation",
  );
  await page
    .getByLabel("Message", { exact: true })
    .fill("Browser test: a real saved message");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Browser test: a real saved message", { exact: true }),
  ).toBeVisible();
  const article = page.locator("article.message").filter({
    has: page.locator(".message-text", {
      hasText: "Browser test: a real saved message",
    }),
  });
  await article.hover();
  await article.getByRole("button", { name: "Reply to message" }).click();
  await page.getByLabel("Message", { exact: true }).fill("A thoughtful reply");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const reply = page
    .locator("article.message")
    .filter({ hasText: "A thoughtful reply" });
  await expect(reply.locator("blockquote")).toContainText(
    "Browser test: a real saved message",
  );
  await article.hover();
  await article
    .getByRole("button", { name: "Save message", exact: true })
    .click();
  await expect(article.getByText("Saved for you")).toBeVisible();
  await page
    .getByRole("button", { name: "Search conversation", exact: true })
    .click();
  await page
    .getByPlaceholder("Find something in this conversation…")
    .fill("Browser test");
  await expect(page.locator("article.message")).toHaveCount(1);
});
test("two signed-in browsers receive realtime messages", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const alice = await a.newPage(),
    tara = await b.newPage();
  await signIn(alice);
  await signIn(tara, "tara@chatfinity.test");
  await alice
    .getByLabel("Message", { exact: true })
    .fill("Live message between two browsers");
  await alice
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    tara.getByText("Live message between two browsers", { exact: true }),
  ).toBeVisible({ timeout: 5000 });
  await a.close();
  await b.close();
});
test("organization creation and invitation administration", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  await page.getByLabel("Organization name").fill("Browser test organization");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create organization" })
    .click();
  await expect(page.locator(".workspace-heading")).toContainText(
    "Browser test organization",
  );
  await page.locator(".workspace-heading").getByRole("button").first().click();
  await page.getByRole("button", { name: "Invitations", exact: true }).click();
  await page.getByLabel("Email address").fill("friend@example.test");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(
    page.getByText("friend@example.test", { exact: true }),
  ).toBeVisible();
});
test("short screens preserve readable history and large reply text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 558 });
  await signIn(page);
  const box = await page.locator(".message-list").boundingBox();
  expect(box!.height).toBeGreaterThan(250);
  await expect(
    page.locator("article.message blockquote").first(),
  ).toBeVisible();
  expect(
    await page
      .locator("article.message blockquote span")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(13);
  await page.screenshot({ path: "test-results/chatfinity-laptop.png" });
});
test("mobile navigation and desktop-sized preferences remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await signIn(page);
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".workspace-sidebar")).toBeVisible();
  await page
    .getByRole("button", { name: "design-studio", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "design-studio", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Your preferences" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "test-results/chatfinity-mobile.png" });
});

test("actual LiveKit meeting joins two participants, shares a synthetic screen and ends for everyone", async ({
  browser,
}) => {
  test.setTimeout(60000);
  test.skip(
    process.env.TEST_MEDIA !== "true",
    "Set TEST_MEDIA=true with LiveKit running locally.",
  );
  const a = await browser.newContext({ permissions: ["camera", "microphone"] }),
    b = await browser.newContext({ permissions: ["camera", "microphone"] });
  await a.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#166d61";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "white";
        ctx.font = "28px sans-serif";
        ctx.fillText("ChatFinity screen sharing test", 30, 170);
        setInterval(() => {
          ctx.fillStyle = "#166d61";
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = "white";
          ctx.fillText("ChatFinity screen sharing test " + Date.now(), 30, 170);
        }, 200);
        return canvas.captureStream(5);
      },
    });
  });
  const alice = await a.newPage(),
    tara = await b.newPage();
  await signIn(alice);
  await signIn(tara, "tara@chatfinity.test");
  await alice.getByRole("button", { name: "Meet", exact: true }).click();
  await expect(
    alice.getByRole("heading", { name: "Ready when you are." }),
  ).toBeVisible();
  await alice.getByLabel("Camera", { exact: true }).check();
  await alice
    .getByRole("dialog")
    .getByRole("button", { name: "Join meeting", exact: true })
    .click();
  await tara
    .getByRole("button", { name: "Join meeting", exact: true })
    .first()
    .click();
  await tara.getByLabel("Camera", { exact: true }).check();
  await tara
    .getByRole("dialog")
    .getByRole("button", { name: "Join meeting", exact: true })
    .click();
  await expect(alice.locator(".lk-participant-tile")).toHaveCount(2, {
    timeout: 15000,
  });
  await expect(tara.locator(".lk-participant-tile")).toHaveCount(2, {
    timeout: 15000,
  });
  await alice.getByRole("button", { name: /share screen/i }).click();
  await expect(
    tara.locator('[data-lk-source="screen_share"]').first(),
  ).toBeVisible({ timeout: 10000 });
  await expect
    .poll(
      () =>
        tara
          .locator('.lk-participant-tile[data-lk-source="screen_share"] video')
          .first()
          .evaluate(
            (v: HTMLVideoElement) =>
              v.getVideoPlaybackQuality().totalVideoFrames,
          ),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  await alice.screenshot({ path: "test-results/chatfinity-meeting.png" });
  await alice.getByRole("button", { name: "End for everyone" }).click();
  await expect(alice.locator(".meeting-overlay")).toHaveCount(0);
  await expect(tara.locator(".meeting-overlay")).toHaveCount(0, {
    timeout: 10000,
  });
  await a.close();
  await b.close();
});
