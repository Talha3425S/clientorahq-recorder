CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'starter',
  email_verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'starter';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_plan_allowed') THEN
    ALTER TABLE users ADD CONSTRAINT users_plan_allowed
      CHECK (plan IN ('starter', 'business', 'business-ai'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS otp_challenges (
  email text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  sent_in_window integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL DEFAULT 'My workspace',
  allow_public_links boolean NOT NULL DEFAULT true,
  allow_meeting_recordings boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS allow_public_links boolean NOT NULL DEFAULT true;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS allow_meeting_recordings boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS workspace_verified_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  domain varchar(253) NOT NULL,
  verification_token varchar(80) NOT NULL,
  verified_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, domain)
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_verified_domain_claim_idx
  ON workspace_verified_domains(domain) WHERE verified_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_integrations (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('slack')),
  encrypted_secret text NOT NULL,
  connected_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS workspace_slack_oauth_states (
  state_hash text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_slack_oauth_states_expiry_idx
  ON workspace_slack_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS workspace_calendar_oauth_states (
  state_hash text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'outlook')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_calendar_oauth_states_expiry_idx
  ON workspace_calendar_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS workspace_calendar_connections (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'outlook')),
  account_email varchar(254) NOT NULL,
  encrypted_refresh_token text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, provider)
);

CREATE TABLE IF NOT EXISTS workspace_slack_connections (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  encrypted_user_token text NOT NULL,
  slack_team_id text NOT NULL,
  slack_team_name varchar(120) NOT NULL,
  connected_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_slack_contacts (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_user_id text NOT NULL,
  email text NOT NULL,
  display_name varchar(120) NOT NULL,
  avatar_url text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, slack_user_id)
);
CREATE INDEX IF NOT EXISTS workspace_slack_contacts_email_idx
  ON workspace_slack_contacts(workspace_id, email);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_pending_email_idx
  ON workspace_invites(workspace_id, email) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS workspace_invites_pending_idx
  ON workspace_invites(workspace_id, expires_at) WHERE accepted_at IS NULL;

CREATE TABLE IF NOT EXISTS workspace_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name varchar(20) NOT NULL,
  privacy text NOT NULL DEFAULT 'open' CHECK (privacy IN ('open', 'closed')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE TABLE IF NOT EXISTS workspace_space_members (
  space_id uuid NOT NULL REFERENCES workspace_spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_space_members_user_idx ON workspace_space_members(user_id);

CREATE TABLE IF NOT EXISTS workspace_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES workspace_folders(id) ON DELETE SET NULL,
  title varchar(120) NOT NULL,
  object_key text NOT NULL UNIQUE,
  thumbnail_key text,
  thumbnail_size_bytes bigint CHECK (thumbnail_size_bytes IS NULL OR thumbnail_size_bytes BETWEEN 1 AND 524288),
  mime_type varchar(127) NOT NULL,
  source text NOT NULL DEFAULT 'uploaded',
  access text NOT NULL DEFAULT 'private',
  archived boolean NOT NULL DEFAULT false,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  status text NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'processing', 'ready', 'failed', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES workspace_folders(id) ON DELETE SET NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS thumbnail_size_bytes bigint CHECK (thumbnail_size_bytes IS NULL OR thumbnail_size_bytes BETWEEN 1 AND 524288);
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS access text NOT NULL DEFAULT 'private';
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'uploaded';
INSERT INTO workspaces(owner_id)
SELECT DISTINCT owner_id FROM recordings WHERE workspace_id IS NULL
ON CONFLICT (owner_id) DO NOTHING;
INSERT INTO workspace_members(workspace_id, user_id, role)
SELECT w.id, w.owner_id, 'owner' FROM workspaces w
JOIN recordings r ON r.owner_id = w.owner_id AND r.workspace_id IS NULL
ON CONFLICT (workspace_id, user_id) DO NOTHING;
UPDATE recordings r SET workspace_id = w.id
FROM workspaces w WHERE r.workspace_id IS NULL AND w.owner_id = r.owner_id;
ALTER TABLE recordings ALTER COLUMN workspace_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recordings_access_allowed') THEN
    ALTER TABLE recordings ADD CONSTRAINT recordings_access_allowed
      CHECK (access IN ('private', 'workspace'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recordings_source_allowed') THEN
    ALTER TABLE recordings ADD CONSTRAINT recordings_source_allowed
      CHECK (source IN ('recorded', 'meeting', 'uploaded'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS recordings_owner_created_idx
  ON recordings(owner_id, created_at DESC)
  WHERE status <> 'deleted';
CREATE INDEX IF NOT EXISTS recordings_workspace_access_idx
  ON recordings(workspace_id, created_at DESC)
  WHERE access = 'workspace' AND status = 'ready';

CREATE TABLE IF NOT EXISTS recording_spaces (
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES workspace_spaces(id) ON DELETE CASCADE,
  added_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recording_id, space_id)
);
CREATE INDEX IF NOT EXISTS recording_spaces_space_idx ON recording_spaces(space_id, recording_id);

CREATE TABLE IF NOT EXISTS recording_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body varchar(1000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recording_comments_recording_idx
  ON recording_comments(recording_id, created_at);

CREATE TABLE IF NOT EXISTS recording_reactions (
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji varchar(16) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recording_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS recording_reactions_recording_idx
  ON recording_reactions(recording_id, emoji);

CREATE TABLE IF NOT EXISTS recording_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  body varchar(1000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recording_transcripts_recording_idx
  ON recording_transcripts(recording_id, start_ms);

CREATE TABLE IF NOT EXISTS recording_views (
  id bigserial PRIMARY KEY,
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE recording_views ALTER COLUMN viewer_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS recording_views_recording_time_idx
  ON recording_views(recording_id, viewed_at DESC);

CREATE TABLE IF NOT EXISTS recording_screenshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  title varchar(120) NOT NULL,
  preview text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE recording_screenshots ALTER COLUMN preview SET DEFAULT '';
CREATE INDEX IF NOT EXISTS recording_screenshots_creator_idx
  ON recording_screenshots(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recording_screenshots_feed_idx
  ON recording_screenshots(created_at DESC, id DESC) WHERE status = 'ready';

CREATE TABLE IF NOT EXISTS user_watch_later (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recording_id)
);
CREATE INDEX IF NOT EXISTS user_watch_later_user_date_idx
  ON user_watch_later(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recording_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS recording_share_links_active_idx
  ON recording_share_links(recording_id, created_at DESC) WHERE revoked_at IS NULL;
