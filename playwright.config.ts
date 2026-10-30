import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.CHROME_EXECUTABLE
      ? {
          executablePath: process.env.CHROME_EXECUTABLE,
          args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        }
      : {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
  },
  webServer: {
    command: "node --import tsx apps/server/test/dev-server.ts",
    url: "http://127.0.0.1:4173/api/health",
    timeout: 90000,
    reuseExistingServer: !process.env.CI,
  },
});
