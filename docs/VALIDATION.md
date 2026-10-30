# Validation status — 0.1.0 alpha

This file records actual local checks and distinguishes them from deployment verification. It is not a claim that a live service is already running.

## Local checks

- TypeScript checks and production builds for the API and web client.
- API tests using Fastify HTTP injection and PGlite (an embedded PostgreSQL engine), exercising signup/verification, sessions, origin/CSRF enforcement, independent organizations, email-bound invitations, discovery privacy, message retry deduplication, cross-channel replies, search, reactions/saves, direct conversations, read markers, real multipart uploads and protected downloads, owner delegation, membership removal, meeting grants and password-reset revocation.
- Five passing real Chromium chat tests against a disposable running API for chat flows, two-user delivery, organization invitations, short-screen layout and narrow-screen navigation.
- Desktop main/preload JavaScript syntax and setup-screen CSP hash verification.

The API permission tests use a media-room service double. A separate passing browser test runs two participants against a real local LiveKit v1.13.11 server, publishes simulated camera/microphone tracks and a synthetic shared screen, verifies that the second participant receives video frames, and ends the meeting for everyone. This does not validate physical devices, OS-native sharing permissions, public TURN or the server2 internet media path. No production email is sent by automated tests.

The production dependency audit reported zero known vulnerabilities at the time of the local check. This is a point-in-time dependency check, not a security audit.

## Still required before public rollout

- Deploy the built service with PostgreSQL on server2; verify actual DNS, certificates, existing Apache routing, WebSocket upgrades and trusted client-address forwarding.
- Add the supplied SMTP2GO credentials privately, verify the From domain and test verification/invitation/reset delivery to real inboxes.
- Deploy LiveKit and a TURN/TLS-compatible media network path; test actual meetings between different internet networks, cameras/microphones and screen sharing.
- Build and smoke-test native installers on Windows, macOS and Linux, then sign/notarize before public distribution.
- Test backup recovery, restart/reconnection, simultaneous sends/membership changes, storage limits, performance under expected concurrency and operational monitoring.
- Review the initial-release limitations in ARCHITECTURE.md and adopt a data-retention/privacy policy before collecting public users.
