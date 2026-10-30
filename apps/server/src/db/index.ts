import pg from "pg";
import { readFile } from "node:fs/promises";
export type Row = Record<string, any>;
export interface DB {
  q<T extends Row = Row>(sql: string, args?: unknown[]): Promise<T[]>;
  tx<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgres(url: string): DB {
  const pool = new pg.Pool({ connectionString: url, max: 15 });
  const wrap = (
    query: (sql: string, args?: unknown[]) => Promise<{ rows: Row[] }>,
    end: () => Promise<void>,
  ): DB => ({
    async q<T extends Row>(sql: string, args: unknown[] = []) {
      return (await query(sql, args)).rows as T[];
    },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const result = await fn(wrap(c.query.bind(c), async () => {}));
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    close: end,
  });
  return wrap(pool.query.bind(pool), () => pool.end());
}
export async function migrate(db: DB) {
  await db.tx(async (tx) => {
    await tx.q("SELECT pg_advisory_xact_lock(812741)");
    await tx.q(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
  });
}
