const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const {
  validateConfiguration,
} = require("app-builder-lib/out/util/config/config.js");
async function check() {
  const config = require("../apps/desktop/package.json").build;
  await validateConfiguration(config);
  const html = fs.readFileSync(
      path.resolve(__dirname, "../apps/desktop/setup.html"),
      "utf8",
    ),
    script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("Missing desktop setup script");
  const hash = crypto.createHash("sha256").update(script).digest("base64");
  if (!html.includes("sha256-" + hash))
    throw new Error(
      "Desktop setup CSP does not match; run node scripts/update-desktop-csp.cjs.",
    );
  console.log("Desktop builder schema and setup CSP passed.");
}
check().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
