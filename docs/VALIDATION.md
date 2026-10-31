# Validation status — 0.1.0 alpha

## Passing checks

- TypeScript checks and production builds for the server and web client; desktop builder schema and setup CSP validation.
- Twenty API checks using Fastify injection and PGlite PostgreSQL: auth/verification, sessions, origin/CSRF, organization boundaries, invitations, private discovery, messages/idempotency, replies/reactions/saves/search, DMs, read markers, multipart uploads, meeting grants, owner delegation, removal, resets, invitation-only signup, system administration, multi-org assignments, ID signup approval, transactional broadcast audiences and mandatory temporary-password replacement and isolated mobile bearer sessions.
- Real Chromium checks cover chat/replies/drafts/search, two-user WebSocket delivery, organization invitation management, short-screen readability, mobile navigation and system administration with multi-org assignment/broadcasts.
- A real local LiveKit 1.13.11 browser check joins two participants, publishes simulated camera/microphone and a synthetic shared screen, verifies received video frames, then ends the meeting for everyone. Physical devices and operating-system sharing permissions still require device testing.
- Native desktop packages built successfully on GitHub Actions for Windows, macOS and Linux (run 41134600292). This is build verification, not an OS installation smoke test or signing/notarization verification.
- Production dependency audit: zero known advisories at the time checked. This is not a full security audit.

## Server2 verification

The standalone application is deployed at https://chat.innaware.net using its own PostgreSQL, API and LiveKit containers. The existing Apache installation serves the new virtual host and automatically renewed Let's Encrypt certificate. Health checks, the real login page and bundled assets load through public HTTPS. SMTP2GO STARTTLS authentication now succeeds.

Disposable production fixtures verified real PostgreSQL persistence, login, conversation replies, protected uploads/downloads, HTTPS WebSocket message delivery, authorized LiveKit admission through `/media`, and ending meetings. Test data and files were removed. Automated tests do not send real email to inboxes.

Public TCP 7881 became reachable after the user updated forwarding. A subsequent two-browser test through https://chat.innaware.net successfully joined two participants, published simulated cameras/microphones, received live shared-screen video frames and ended the meeting for both. Temporary test accounts and organization data were removed. Browser connection statistics confirmed received audio packets, decoded camera video and a selected TCP candidate on the public server address. This proves a functioning public TCP media path for that client environment, not UDP specifically or calls between physical phones on separate networks. Restrictive-network TURN/TLS behavior remains to be validated. Backup recovery, load/performance, monitoring and signed installer/device testing remain before a broad public rollout.

## Mobile

The native application is implemented in apps/mobile. Mobile TypeScript checks, native Android/iOS project generation, Android/iOS Hermes bundle exports, version alignment and a dependency audit with zero known advisories passed. A standalone Android APK compiled successfully (run 41165453230), and an ad hoc signed iPhone simulator application compiled successfully (run 41165811782). These builds use the existing production accounts, organization membership and permissions through HTTPS mobile sessions. Real production checks verified native login, mobile Authorization-header WebSocket delivery, shared web/mobile membership, replies, protected attachments and scoped meeting admission/end. All temporary fixtures were removed; no real emails were sent. [Native UI navigation checks](https://github.com/MusicCityTelecom/ChatFinity_App/actions/runs/41167244043) passed for both the Android APK (320×640 emulator) and iPhone simulator (iPhone 17 Pro, iOS 26.4), covering launch, sign-in fields, optional Organization ID signup and password-recovery navigation. No real email or login credentials were submitted by these UI checks. Physical-device and signed-in native call tests remain separate. See MOBILE.md for downloads and signing/distribution limitations.
