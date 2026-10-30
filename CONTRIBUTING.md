# Working on ChatFinity

Use Node.js 24 and the committed npm lockfile. Work in this repository independently of the Perfex module. Never commit production environment files, media/signing/SMTP credentials, uploads, database dumps, test traces with real customer data or private keys.

Run `npm run check` and `npm run test:e2e` before a proposed release. API tests execute real PostgreSQL-compatible queries in PGlite; browser tests start a disposable API with fictional data. Add meaningful permission/regression coverage when changing tenant access, membership revocation, email tokens or meeting grants.

The initial production schema is in `apps/server/src/db/schema.sql`. Future schema changes must become ordered migrations rather than depending on `CREATE TABLE IF NOT EXISTS` to modify existing tables. Keep backup/restore compatibility explicit.

Use the formatter on source files, excluding generated output. After formatting the desktop setup HTML, regenerate its inline-script CSP hash. The server is single-instance until a shared realtime/presence/rate-limit layer is introduced.
