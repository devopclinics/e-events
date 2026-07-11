-- FestioMe owns this schema. GuestHub must never read or write these tables.
CREATE TABLE IF NOT EXISTS tenants (
  id varchar(36) PRIMARY KEY, external_org_ref varchar(100) UNIQUE,
  name varchar(255) NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS festiome_groups (
  id varchar(36) PRIMARY KEY, tenant_id varchar(36) NOT NULL REFERENCES tenants(id),
  external_event_ref varchar(100), name varchar(255) NOT NULL,
  description text NOT NULL DEFAULT '', created_by_subject varchar(128) NOT NULL,
  archived boolean NOT NULL DEFAULT false, created_at timestamp NOT NULL,
  CONSTRAINT uq_festiome_group_event UNIQUE (tenant_id, external_event_ref)
);

CREATE TABLE IF NOT EXISTS members (
  id varchar(36) PRIMARY KEY, group_id varchar(36) NOT NULL REFERENCES festiome_groups(id),
  identity_kind varchar(20) NOT NULL, identity_ref varchar(128) NOT NULL,
  display_name varchar(255) NOT NULL, role varchar(20) NOT NULL DEFAULT 'member',
  joined_at timestamp NOT NULL, removed_at timestamp,
  CONSTRAINT uq_member_identity UNIQUE (group_id, identity_kind, identity_ref),
  CONSTRAINT ck_member_identity_kind CHECK (identity_kind IN ('user','guest','service')),
  CONSTRAINT ck_member_role CHECK (role IN ('owner','admin','moderator','member','readonly'))
);

CREATE TABLE IF NOT EXISTS channels (
  id varchar(36) PRIMARY KEY, group_id varchar(36) NOT NULL REFERENCES festiome_groups(id),
  name varchar(100) NOT NULL, slug varchar(100) NOT NULL, description text NOT NULL DEFAULT '',
  kind varchar(20) NOT NULL DEFAULT 'discussion', created_by_member_id varchar(36) NOT NULL REFERENCES members(id),
  archived boolean NOT NULL DEFAULT false, created_at timestamp NOT NULL,
  CONSTRAINT uq_channel_slug UNIQUE (group_id, slug),
  CONSTRAINT ck_channel_kind CHECK (kind IN ('discussion','announcement','staff'))
);

CREATE TABLE IF NOT EXISTS invitations (
  id varchar(36) PRIMARY KEY, group_id varchar(36) NOT NULL REFERENCES festiome_groups(id),
  token_hash varchar(64) NOT NULL UNIQUE, email varchar(320), role varchar(20) NOT NULL DEFAULT 'member',
  created_by_member_id varchar(36) NOT NULL REFERENCES members(id), expires_at timestamp NOT NULL,
  max_uses integer NOT NULL DEFAULT 1, use_count integer NOT NULL DEFAULT 0,
  revoked_at timestamp, created_at timestamp NOT NULL,
  CONSTRAINT ck_invitation_role CHECK (role IN ('admin','moderator','member','readonly'))
);

CREATE TABLE IF NOT EXISTS messages (
  id varchar(36) PRIMARY KEY, group_id varchar(36) NOT NULL REFERENCES festiome_groups(id),
  channel_id varchar(36) NOT NULL REFERENCES channels(id), author_member_id varchar(36) NOT NULL REFERENCES members(id),
  parent_id varchar(36) REFERENCES messages(id), body text NOT NULL,
  edited_at timestamp, deleted_at timestamp, created_at timestamp NOT NULL,
  CONSTRAINT ck_message_body_length CHECK (length(body) <= 10000)
);

CREATE TABLE IF NOT EXISTS reactions (
  id varchar(36) PRIMARY KEY, message_id varchar(36) NOT NULL REFERENCES messages(id),
  member_id varchar(36) NOT NULL REFERENCES members(id), emoji varchar(32) NOT NULL DEFAULT 'like',
  created_at timestamp NOT NULL, CONSTRAINT uq_message_reaction UNIQUE (message_id, member_id, emoji)
);

CREATE TABLE IF NOT EXISTS channel_read_states (
  id varchar(36) PRIMARY KEY, channel_id varchar(36) NOT NULL REFERENCES channels(id),
  member_id varchar(36) NOT NULL REFERENCES members(id), last_read_message_id varchar(36) REFERENCES messages(id),
  read_at timestamp NOT NULL, CONSTRAINT uq_channel_read_state UNIQUE (channel_id, member_id)
);

CREATE TABLE IF NOT EXISTS moderation_reports (
  id varchar(36) PRIMARY KEY, group_id varchar(36) NOT NULL REFERENCES festiome_groups(id),
  message_id varchar(36) NOT NULL REFERENCES messages(id), reporter_member_id varchar(36) NOT NULL REFERENCES members(id),
  reason varchar(500) NOT NULL, details text NOT NULL DEFAULT '', status varchar(20) NOT NULL DEFAULT 'open',
  resolution_note text NOT NULL DEFAULT '', resolved_by_member_id varchar(36) REFERENCES members(id),
  created_at timestamp NOT NULL, resolved_at timestamp,
  CONSTRAINT ck_report_status CHECK (status IN ('open','reviewing','resolved','dismissed'))
);

CREATE INDEX IF NOT EXISTS ix_festiome_groups_tenant_id ON festiome_groups(tenant_id);
CREATE INDEX IF NOT EXISTS ix_members_group_active ON members(group_id, removed_at);
CREATE INDEX IF NOT EXISTS ix_channels_group_id ON channels(group_id);
CREATE INDEX IF NOT EXISTS ix_messages_channel_cursor ON messages(channel_id, created_at, id);
CREATE INDEX IF NOT EXISTS ix_reports_group_status ON moderation_reports(group_id, status, created_at);
