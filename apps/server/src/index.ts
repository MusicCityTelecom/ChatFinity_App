import { createApp } from "./app.js";
import { postgres, migrate } from "./db/index.js";
import { configuration } from "./config.js";
import { startMailer } from "./mail.js";
const config = configuration(),
  db = postgres(config.databaseUrl);
await migrate(db);
const app = await createApp(db, config);
const stopMail = startMailer(db, config, (message) => app.log.warn(message));
app.addHook("onClose", async () => {
  stopMail();
  await db.close();
});
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 3001) });
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
