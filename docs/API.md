# API

All paths are under `/api`. Requests/responses are JSON except multipart uploads, attachment downloads and the WebSocket endpoint. Validation failures return `{ "error": "..." }` and an appropriate non-2xx status. IDs are UUIDs. Dates are UTC ISO timestamps.

Clients use the HttpOnly `cf_session` cookie. `/auth/login` and `/me` return the CSRF token; send it in `X-CSRF-Token` on authenticated writes. All write requests must have `Origin` equal to `PUBLIC_URL`. WebSocket upgrades also require the session cookie and allowed origin. Protected organization/chat endpoints require email verification.

## Accounts

| Method | Path | Input / behavior |
| --- | --- | --- |
| GET | `/health` | Database health and server version |
| GET | `/config` | Registration and meeting availability |
| POST | `/auth/signup` | `{email,name,password,invite?}`; minimum 12-character password; verification mail |
| POST | `/auth/login` | `{email,password}`; cookie, user and CSRF token |
| POST | `/auth/verify` | `{token}`; consume verification token |
| POST | `/auth/forgot` | `{email}`; generic response and queued reset email |
| POST | `/auth/reset` | `{token,password}`; consume token and revoke sessions |
| POST | `/auth/resend` | Resend verification for current account |
| POST | `/auth/logout` | Revoke current session; clear cookie |
| GET | `/me` | Current public user profile and CSRF token |
| PATCH | `/me` | `{name?,status?}`; online/away/busy/invisible |

## Organizations

| Method | Path | Behavior |
| --- | --- | --- |
| GET/POST | `/orgs` | List memberships / create `{name}` |
| PATCH | `/orgs/:orgId` | Admin/owner rename `{name}` |
| GET | `/orgs/:orgId/members` | Profiles, scoped roles and approximate presence |
| PATCH | `/orgs/:orgId/members/:userId` | Owner role delegation `{role}` |
| DELETE | `/orgs/:orgId/members/:userId` | Authorized member removal or self-leave |
| GET/POST | `/orgs/:orgId/invitations` | Admin/owner list / send `{email,role}` |
| DELETE | `/orgs/:orgId/invitations/:id` | Revoke unaccepted invite |
| POST | `/invitations/accept` | `{token}`; exact signed-in email required |
| GET | `/orgs/:orgId/audit` | Admin/owner membership/invitation audit events |

## Chat

| Method | Path | Behavior |
| --- | --- | --- |
| GET/POST | `/orgs/:orgId/channels` | Discover accessible/public channels / create `{name,topic?,kind,members?}` |
| POST | `/orgs/:orgId/dm` | `{userId}`; get/create scoped direct conversation |
| POST | `/channels/:channelId/join` | Join a public channel in own organization |
| GET/POST | `/channels/:channelId/members` | List members/read markers / add `{userId}` with channel creator/admin rights |
| GET | `/channels/:channelId/messages` | Up to 50 messages, `{messages,more}`; query `before`, `search`, `saved=true` |
| POST | `/channels/:channelId/messages` | `{body,clientId,replyId?,attachments?}`; deduplicated UUID `clientId` |
| PATCH/DELETE | `/messages/:id` | Author edit `{body}` / author or scoped admin soft removal |
| POST | `/messages/:id/react` | `{emoji,active}`; six allowlisted emoji |
| POST | `/messages/:id/save` | `{active}`; private saved-message state |
| POST | `/channels/:channelId/read` | `{messageId}`; monotonic read marker |
| POST | `/channels/:channelId/files` | One multipart `file`, at most 20 MB; returns attachment ID |
| GET | `/files/:id` | Authorized streamed attachment download |

Upload first, then include the resulting attachment IDs when sending. Unclaimed uploads are private to their uploader and are removed by maintenance after 24 hours. A message may include up to five attachments owned by its sender in the same channel.

## Meetings

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/channels/:channelId/meetings` | `{title?}`; create/get active authorized meeting |
| GET | `/meetings/:id` | Authorized meeting details |
| POST | `/meetings/:id/token` | Current channel member gets a 60-second scoped LiveKit token |
| POST | `/meetings/:id/end` | Host or scoped admin deletes media room and ends meeting |

## WebSocket

Connect to `/api/events`. Server events include `connected`, `message.created`, `message.updated`, `typing`, `conversation.read`, `channel.created`, `channel.updated`, `organization.updated`, `meeting.started`, and `meeting.ended`. Scoped events carry `orgId` and `channelId`. Message events carry identifiers; clients fetch authorized persisted state through HTTP. They are not a second storage path.

Clients may send `{type:"typing",channelId:"UUID"}` (throttled) and `{type:"activity",active:true}` (periodic heartbeat). They cannot select recipients or assert identity. Reconnect with bounded backoff and refetch conversations after connection loss; events are not a durable replay log.

## System administration and onboarding

- `GET /api/admin/{overview,users,orgs,audit,join-requests}` requires a verified system administrator.
- `POST /api/admin/users`: create an account, queue a password setup email and optionally assign `memberships: [{orgId,role}]`.
- `PATCH /api/admin/users/:id`: name, `canCreateOrg`, `systemAdmin`, `disabled`, `verified`. The last enabled verified system administrator is protected.
- `POST /api/admin/users/:id/password-reset`: queue a reset link, or pass `temporaryPassword` to require a password change at next sign-in. Sessions are revoked.
- `POST /api/admin/users/:id/memberships`: add/update one or more organization roles; `DELETE /api/admin/users/:id/memberships/:orgId` revokes access.
- `PATCH /api/admin/orgs/:id`: name and/or `allowJoinRequests`. `POST /api/admin/orgs/:id/join` records explicit administrative owner membership.
- `PATCH /api/admin/settings`: `registrationOpen`, `defaultOrgCreation`.
- Signup accepts optional `organizationId` (shareable join code or organization UUID); it creates a pending request, never membership.
- `GET /api/me/join-requests`; `POST /api/join-requests` with `organizationId` requests access for an existing verified account.
- Organization owners/admins use `GET /api/orgs/:orgId/join-requests` and `POST /api/orgs/:orgId/join-requests/:id` with `approve` and optional `role`. System administrators use `POST /api/admin/join-requests/:id`.
- `POST /api/auth/change-password`: `currentPassword`, `password` (12+ characters). Other sessions are revoked.
- `POST /api/broadcasts`: `organizationIds` (1–20), `body`. Members may target their organizations; system administrators may target all. All audiences are authorized atomically before delivery.

These endpoints use the existing session, email verification, Origin and CSRF protections. See ADMINISTRATION.md for workflows and limitations.
