import { postgres, migrate } from "./db/index.js";
import { configuration } from "./config.js";
const db = postgres(configuration().databaseUrl);
try {
  await migrate(db);
  console.log("Database schema is ready.");
} finally {
  await db.close();
}
