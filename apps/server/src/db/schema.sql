CREATE TABLE IF NOT EXISTS schema_versions(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
 password_hash text NOT NULL, verified_at timestamptz,
 status text NOT NULL DEFAULT 'online' CHECK(status IN ('online','away','busy','invisible')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_tokens (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('verify','reset')), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS organizations (
 id uuid PRIMARY KEY, name text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','admin','member')),
 joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(org_id,user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 email text NOT NULL, role text NOT NULL CHECK(role IN ('admin','member')),
 token_hash text NOT NULL UNIQUE, invited_by uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS channels (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name text NOT NULL, topic text NOT NULL DEFAULT '', kind text NOT NULL CHECK(kind IN ('public','private','dm')),
 dm_key text, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,id), UNIQUE(org_id,dm_key)
);
CREATE TABLE IF NOT EXISTS channel_members (
 org_id uuid NOT NULL, channel_id uuid NOT NULL, user_id uuid NOT NULL,
 PRIMARY KEY(channel_id,user_id),
 FOREIGN KEY(org_id,channel_id) REFERENCES channels(org_id,id) ON DELETE CASCADE,
 FOREIGN KEY(org_id,user_id) REFERENCES memberships(org_id,user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS messages (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, channel_id uuid NOT NULL, sender_id uuid NOT NULL REFERENCES users(id),
 body text NOT NULL, reply_id uuid, client_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 edited_at timestamptz, deleted_at timestamptz,
 FOREIGN KEY(org_id,channel_id) REFERENCES channels(org_id,id) ON DELETE CASCADE,
 UNIQUE(sender_id,client_id), UNIQUE(channel_id,id),
 FOREIGN KEY(channel_id,reply_id) REFERENCES messages(channel_id,id)
);
CREATE INDEX IF NOT EXISTS messages_timeline ON messages(channel_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS messages_search ON messages USING gin(to_tsvector('simple',body));
CREATE TABLE IF NOT EXISTS attachments (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, channel_id uuid NOT NULL, uploader_id uuid NOT NULL REFERENCES users(id),
 message_id uuid, name text NOT NULL, mime text NOT NULL, size integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,channel_id) REFERENCES channels(org_id,id) ON DELETE CASCADE,
 FOREIGN KEY(channel_id,message_id) REFERENCES messages(channel_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reactions (
 message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 emoji text NOT NULL CHECK(emoji IN ('👍','❤️','😂','🎉','👀','✅')), PRIMARY KEY(message_id,user_id,emoji)
);
CREATE TABLE IF NOT EXISTS saved_messages (
 message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(message_id,user_id)
);
CREATE TABLE IF NOT EXISTS read_markers (
 channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(channel_id,user_id)
);
CREATE TABLE IF NOT EXISTS meetings (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, channel_id uuid NOT NULL, host_id uuid NOT NULL REFERENCES users(id),
 title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
 FOREIGN KEY(org_id,channel_id) REFERENCES channels(org_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_meeting_per_channel ON meetings(channel_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS audit_events (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES users(id), action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mail_outbox (
 id uuid PRIMARY KEY, payload jsonb, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;

-- Version 2: platform administration, organization onboarding and broadcasts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_org boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS join_code text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS allow_join_requests boolean NOT NULL DEFAULT true;
UPDATE organizations SET join_code='CF-'||upper(substr(replace(id::text,'-',''),1,16)) WHERE join_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organization_join_code ON organizations(join_code);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS system_key text;
CREATE UNIQUE INDEX IF NOT EXISTS channel_system_key ON channels(org_id,system_key) WHERE system_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS platform_settings (id integer PRIMARY KEY CHECK(id=1), registration_open boolean NOT NULL DEFAULT true, default_org_creation boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS platform_audit_events (id uuid PRIMARY KEY, actor_id uuid REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS join_requests (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
 reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL, UNIQUE(org_id,user_id)
);
CREATE TABLE IF NOT EXISTS broadcasts (id uuid PRIMARY KEY, sender_id uuid NOT NULL REFERENCES users(id), body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS broadcast_organizations (broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, PRIMARY KEY(broadcast_id,org_id));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS broadcast_id uuid REFERENCES broadcasts(id) ON DELETE SET NULL;
INSERT INTO schema_versions(version) VALUES(2) ON CONFLICT DO NOTHING;
