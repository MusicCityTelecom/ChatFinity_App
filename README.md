# ChatFinity

**A little closer, wherever you are.**

A standalone communication platform for teams, businesses, clubs and communities. One email account can belong to multiple independent organizations. ChatFinity has its own server, database and authentication; it is not a Perfex module and shares no Perfex data or login.

Initial deployment target: **https://chat.innaware.net**, behind server2’s existing Apache web server, on Ubuntu 22.04 or 24.04. Email delivery is configured for **SMTP2GO**. Meetings use a separately configured LiveKit service, normally **meet.chat.innaware.net**.

## What’s implemented

- Email signup, email verification, login, logout, password reset and revocable database-backed sessions.
- Organizations with multiple owners, administrators and members; accounts can join many organizations.
- Email-bound invitations that expire, can be revoked and can be accepted only once. Optional invitation-only signup.
- Public organization channels, private group channels and direct messages. Channel membership is checked for message, attachment and meeting access.
- Real-time WebSocket messaging, typing, approximate online/away presence and Do Not Disturb.
- Replies, emoji reactions, message editing/removal, conversation search, saved messages, paged history, unread counts and direct-message read receipts.
- Private image/PDF/text/CSV attachments, up to 20 MB per file and five files per message. Per-organization storage limits default to 1 GB.
- Browser-local drafts, optional sound and desktop notifications. The interface fits short laptop and mobile screens without shrinking conversation text.
- LiveKit audio/video meetings, a pre-join screen, participant controls, screen sharing and host/admin end-for-everyone. Only members of the conversation can join.
- An Electron desktop application with a configurable HTTPS server address, session isolation and permission prompts. Packaging workflows target Windows installers, macOS DMG/ZIP for Apple Silicon and Intel, and Linux AppImage/DEB.
- Containerized server deployment, Apache/Nginx proxy examples, private configuration generation, backups, cleanup, tests and CI.

This is an **initial alpha**, not a claim of production certification or feature parity with Slack/Zoom. See [validation](docs/VALIDATION.md) and [scope](docs/ARCHITECTURE.md#initial-release-boundaries).

## Repository

```text
apps/server/      Fastify API, PostgreSQL schema, authorization and meeting grants
apps/web/         React web application and LiveKit meeting interface
apps/desktop/     Electron application and desktop packaging configuration
deploy/           Server2 containers and reverse-proxy examples
scripts/          Private configuration, backup and maintenance tools
tests/e2e/        Browser integration tests against the real API
.github/workflows Application checks and desktop installer builds
```

## Local development

Requires Node.js 24, npm and Docker Compose v2. These commands are run from the repository root:

```bash
cp .env.example .env
npm ci
docker compose -f compose.dev.yml up -d
npm run migrate -w @chatfinity/server
npm run dev
```

Open **http://localhost:5173**. Development email arrives in Mailpit at **http://localhost:8025**; it is not sent to real email addresses. Sign up, open the verification email, then sign in and create an organization. Development LiveKit uses `devkey`/`secret`, on local port 7880; those credentials must never be deployed publicly. Camera and microphone permissions require a secure origin or localhost.

```bash
npm run check       # type checks, API/security integration tests, production builds
npm run test:e2e    # real-browser tests; first run: npx playwright install chromium
npm run desktop    # desktop server chooser; connect to your HTTPS deployment
```

The API tests use PGlite, an embedded PostgreSQL engine, with actual SQL and multipart uploads. Browser tests use a disposable server and fictional users; test accounts and messages are never loaded by the production server.

## Deploy on server2

Follow **[docs/SERVER2.md](docs/SERVER2.md)**. The application binds only to **127.0.0.1:3080**. Use the existing Apache host; do not start the optional `edge` container on a machine already using ports 80/443. SMTP credentials, generated database credentials, media secrets and attachments are excluded from Git.

## Desktop installers

Use the **Desktop installers** GitHub Actions workflow, manually or with a `v*` tag. Download the per-platform artifacts from the completed run. See **[docs/DESKTOP.md](docs/DESKTOP.md)** for local packaging, signing, notarization and platform testing. Source/build configuration is included; a packaged file should only be called a tested installer after its platform build and smoke test pass.

## Operations and API

- [Architecture, trust boundaries and release scope](docs/ARCHITECTURE.md)
- [Server2 installation, mail, meetings, backup and recovery](docs/SERVER2.md)
- [HTTP and WebSocket API](docs/API.md)
- [Desktop builds and distribution](docs/DESKTOP.md)
- [Validation status](docs/VALIDATION.md)
- [Contribution workflow](CONTRIBUTING.md)
