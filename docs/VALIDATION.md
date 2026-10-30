# Validation status — 0.1.0 alpha

## Passing checks

- TypeScript checks and production builds for the server and web client; desktop builder schema and setup CSP validation.
- Nineteen API checks using Fastify injection and PGlite PostgreSQL: auth/verification, sessions, origin/CSRF, organization boundaries, invitations, private discovery, messages/idempotency, replies/reactions/saves/search, DMs, read markers, multipart uploads, meeting grants, owner delegation, removal, resets, invitation-only signup, system administration, multi-org assignments, ID signup approval, transactional broadcast audiences and mandatory temporary-password replacement.
- Real Chromium checks cover chat/replies/drafts/search, two-user WebSocket delivery, organization invitation management, short-screen readability, mobile navigation and system administration with multi-org assignment/broadcasts.
- A real local LiveKit 1.13.11 browser check joins two participants, publishes simulated camera/microphone and a synthetic shared screen, verifies received video frames, then ends the meeting for everyone. Physical devices and operating-system sharing permissions still require device testing.
- Native desktop packages built successfully on GitHub Actions for Windows, macOS and Linux (run 41134600292). This is build verification, not an OS installation smoke test or signing/notarization verification.
- Production dependency audit: zero known advisories at the time checked. This is not a full security audit.

## Server2 verification

The standalone application is deployed at https://chat.innaware.net using its own PostgreSQL, API and LiveKit containers. The existing Apache installation serves the new virtual host and automatically renewed Let's Encrypt certificate. Health checks, the real login page and bundled assets load through public HTTPS. SMTP2GO STARTTLS authentication now succeeds.

Disposable production fixtures verified real PostgreSQL persistence, login, conversation replies, protected uploads/downloads, HTTPS WebSocket message delivery, authorized LiveKit admission through `/media`, and ending meetings. Test data and files were removed. Automated tests do not send real email to inboxes.

Public TCP 7881 became reachable after the user updated forwarding. A meeting between two actual outside networks, UDP/media forwarding and restrictive-network TURN/TLS behavior remain to be validated. Backup recovery, load/performance, monitoring and signed installer/device testing remain before a broad public rollout.

## Mobile

The web layout supports phone browsers. Android and iOS native clients are planned in MOBILE.md and have not yet been implemented or published.
