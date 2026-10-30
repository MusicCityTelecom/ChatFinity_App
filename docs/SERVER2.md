# Server2 deployment

Target: Ubuntu **22.04 or 24.04**, using **the existing Apache installation**, domain **chat.innaware.net**, SMTP2GO for mail. This guide does not replace existing website configuration. The optional Caddy `edge` profile is intended only for a separate clean host.

## 1. Prepare an isolated checkout

Use Docker Engine and Compose v2 from your normal server management process. Run from a dedicated directory such as `/opt/chatfinity`, with sufficient free space for PostgreSQL, uploads and backups. The initial media configuration caps rooms at 30 participants; this is a safety ceiling, not a validated capacity claim. Test CPU, RAM, upload bandwidth and concurrent rooms on server2 before increasing usage.

```bash
git clone https://github.com/MusicCityTelecom/ChatFinity_App.git /opt/chatfinity
cd /opt/chatfinity
python3 scripts/configure-server.py --acme-email YOUR_ADMIN_EMAIL
```

The generator creates `.env.production` and `deploy/livekit.generated.yaml` with unique secrets and mode `0600`. It refuses to overwrite existing configuration. Keep these files private and backed up separately. They must never be committed or placed in a public document root.

Edit `.env.production` on server2. Set SMTP2GO credentials and a verified sending address:

```dotenv
PUBLIC_URL=https://chat.innaware.net
SMTP_HOST=mail.smtp2go.com
SMTP_PORT=2525
SMTP_SECURE=false
SMTP_USER=YOUR_SMTP2GO_SMTP_USERNAME
SMTP_PASSWORD=YOUR_SMTP2GO_SMTP_PASSWORD
MAIL_FROM=ChatFinity <hello@innaware.net>
```

`SMTP_SECURE=false` on port 2525 means STARTTLS, not unencrypted delivery: the production worker requires TLS. Port 465 uses `SMTP_SECURE=true`. Use the SMTP username/password, not an API key. SMTP2GO documents the host and supported ports in its [setup instructions](https://www.smtp2go.com/setup/). Choose a From address/domain verified in your SMTP2GO account. Quote any dotenv value that contains a literal `#` or leading/trailing spaces.

Set `ALLOW_REGISTRATION=false` for invitation-only signup. Bootstrap the initial verified owner while registration is enabled, then disable it and recreate the API container. Owners can invite others; a valid email-bound invitation allows signup even when public registration is disabled.

## 2. Start the private application

```bash
docker compose --env-file .env.production -f deploy/compose.yml up -d --build db api
curl --fail http://127.0.0.1:3080/api/health
```

PostgreSQL is reachable only on the private Docker network. ChatFinity listens on **127.0.0.1:3080**. Uploads live in the `chatfinity_attachments` named volume; PostgreSQL uses `chatfinity_postgres_data`. Startup runs an idempotent initial schema transaction before accepting traffic.

The private Docker subnet defaults to `172.30.48.0/24`. Check existing server networks before starting. If it conflicts, choose an unused subnet and change both the Compose network and `TRUST_PROXY` to its gateway. Only the loopback host port is published. `TRUST_PROXY` must represent the actual existing reverse-proxy path; do not set it to `true` for arbitrary clients.

## 3. Add the new Apache host

Point `chat.innaware.net` to server2’s public IP, provision a trusted certificate with your existing certificate process, and add a **new** vhost from `deploy/apache-chatfinity.conf`. The supplied file includes a second meeting vhost; enable that section only after the meeting hostname/certificate exist. Preserve the existing HTTP-to-HTTPS and ACME challenge handling. Do not replace default sites.

Enable any missing modules (`proxy`, `proxy_http`, `proxy_wstunnel`, `headers`, `ssl`) through the host's normal management process. Validate with `apache2ctl configtest` before a graceful reload. Both ordinary HTTP and `/api/events` WebSockets must reach the same ChatFinity instance. Forwarded-client-address headers must be overwritten by the proxy so clients cannot forge rate-limit identities.

External checks:

```bash
curl --fail https://chat.innaware.net/api/health
```

Open the site, sign up with a real email address, verify the email, create the first organization, and send an invitation to a second test account. Confirm the browser shows **Connected**.

### Single-host signaling option used on server2

`deploy/apache-chatfinity-single-host.conf` serves the web client and meeting signaling under one certificate. Set `LIVEKIT_URL=wss://chat.innaware.net/media` in the private environment and use that template instead of the two-host template. This avoids an extra DNS record for signaling; it does not remove the requirement for reachable media ports and TURN/TLS on restricted networks. The internal LiveKit URL remains private. Apache 2.4.47+ handles HTTP and WebSocket upgrades through the same route.

## 4. Enable audio, video and screen sharing

The API integrates with LiveKit; it does not implement a media transport itself. The configuration uses **meet.chat.innaware.net** for secure signaling. Its DNS record should point directly to server2; standard HTTP-only CDN proxies cannot carry the required media traffic.

For the supplied single-host media profile:

```bash
docker compose --env-file .env.production -f deploy/compose.yml --profile meetings up -d livekit
```

Enable the meeting Apache vhost with a trusted certificate. The API accesses LiveKit internally through `host.docker.internal:7880`; browsers use `wss://meet.chat.innaware.net`. The generated server disables automatic room creation. ChatFinity explicitly creates authorized rooms, and deleting a room prevents an old join token from recreating an ended meeting.

Allow public **TCP 7881** and **UDP 7882** through both the provider firewall and host firewall. Keep the LiveKit administrative/signaling port **7880** private: permit only loopback and the API’s private Docker subnet. Do not expose PostgreSQL 5432 or application port 3080 publicly. The existing web server handles public 80/443. LiveKit runs with host networking so media candidates advertise the host's external IP; verify STUN/public-IP discovery or configure `rtc.node_ip` explicitly if required by your network.

### Restricted networks and TURN/TLS

A public website is not enough to guarantee media connectivity on every corporate firewall or VPN. The basic profile uses direct UDP/TCP media. For broad network compatibility, add TURN/TLS on **443** before general public launch.

Because server2 already uses 443 for existing websites, do not start a second process on that port. Use either a separate media/TURN public IP/host, an existing Layer 4 TLS/SNI load balancer configured to route TURN separately, or a managed LiveKit endpoint. LiveKit’s [VM deployment generator](https://docs.livekit.io/transport/self-hosting/vm/) provides an official Caddy/TURN deployment for a dedicated media host. Use `meet.chat.innaware.net` and a TURN hostname such as `turn.chat.innaware.net`, then point the application’s `LIVEKIT_URL`, `LIVEKIT_INTERNAL_URL`, API key and secret at that service. Preserve `room.auto_create: false` on the media server.

If using your own TURN service, LiveKit supports external TURN endpoints in its RTC configuration; see [the versioned sample](https://github.com/livekit/livekit/blob/v1.13.11/config-sample.yaml). Certificate issuance/renewal, L4 routing and public media/TURN reachability must be tested in the actual server2 network. The [official firewall reference](https://docs.livekit.io/transport/self-hosting/ports-firewall/) explains the distinction between signaling, ICE and TURN ports.

Before announcing meetings, test two real devices on different networks, camera/microphone prompts, screen sharing, headset changes, host end-for-everyone, reconnection, a mobile network and a restrictive corporate network. The local automated suite tests room authorization and signed grants, not the internet media path.

## 5. Operations

```bash
# Status and logs
docker compose --env-file .env.production -f deploy/compose.yml ps
docker compose --env-file .env.production -f deploy/compose.yml logs --tail=100 api

# Rebuild the API after pulling an approved update
git pull --ff-only
docker compose --env-file .env.production -f deploy/compose.yml up -d --build --no-deps api

# Daily cleanup: expired sessions/tokens, old unclaimed uploads and sent mail metadata
docker compose --env-file .env.production -f deploy/compose.yml exec -T api node apps/server/dist/cleanup.js
```

Schedule cleanup daily using the host's normal scheduler. Email is queued transactionally and attempted every five seconds, with retries every five minutes for up to ten attempts. Logs report delivery failures without SMTP credentials or message tokens. Inspect SMTP2GO activity if mail fails; queued invitations do not imply successful inbox delivery. Monitor the count of unsent/exhausted outbox records, health endpoint, disk space, database backups, CPU and bandwidth.

The first release uses one API instance: realtime fan-out, presence and rate limits are process-local. Do not scale API replicas without adding a shared event bus/rate-limit store. HTTP fallback refreshes conversations if WebSockets are unavailable, but that is not a substitute for operating the WebSocket proxy correctly.

### Backup and recovery

`bash scripts/backup.sh` makes a maintenance backup. It briefly stops the API, dumps PostgreSQL and archives attachments, then restarts the API if it was running. Store the output encrypted, away from the public website. Preserve production environment/media secrets separately. Run a test restore before relying on a backup.

For recovery, use an isolated instance with matching code and PostgreSQL major version. Stop its API; restore `database.dump` with `pg_restore -U chatfinity -d chatfinity --clean --if-exists`, restore `attachments.tar.gz` into its attachment volume and set ownership to UID/GID 1000. These operations replace data, so verify the target and backup first. Restart and verify account, organization, message and attachment access with two test accounts before changing DNS.

### Data and access behavior

Removing a member deletes their channel memberships in that organization while preserving history and their global account. The last organization owner cannot be removed or demoted. Active meetings must be ended, followed by a two-minute token-expiry grace period, before removing a member. Message removal is soft deletion; historical records remain in the database and files remain on disk until an explicit retention process is introduced. They are denied by the download API immediately after removal.

Attachment storage is private but not malware-scanned or encrypted by this application. Use the host’s disk encryption, backup encryption and document-scanning policies as needed. Organization and server administrators do not receive an arbitrary private-conversation-reading API; server/database operators inherently control stored records. This application does not implement end-to-end encryption.
