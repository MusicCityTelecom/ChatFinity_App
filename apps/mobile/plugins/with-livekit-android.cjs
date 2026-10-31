const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");
// WebRTC android-prefixed 150.7871.04 retains JniZero.setJniClassLoader(),
// but does not ship the generated JniZeroJni bridge it references. Its bundled
// Java classes never call this optional loader-override method; JNI init uses
// JniZero.init() instead. Scope the R8 exception to that one absent bridge.
// Recheck this rule when upgrading WebRTC; keep the SDK's native consumer rules.
module.exports = (config) =>
  withDangerousMod(config, [
    "android",
    async (mod) => {
      const file = path.join(
        mod.modRequest.platformProjectRoot,
        "app",
        "proguard-rules.pro",
      );
      const rule = "-dontwarn livekit.org.jni_zero.JniZeroJni";
      const current = await fs.readFile(file, "utf8");
      if (!current.includes(rule))
        await fs.writeFile(
          file,
          current +
            "\n# Optional WebRTC JNI loader override bridge (150.7871.04).\n" +
            rule +
            "\n",
        );
      return mod;
    },
  ]);
