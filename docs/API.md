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
