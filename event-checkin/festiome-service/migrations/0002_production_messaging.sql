-- FestioMe production messaging extensions. Apply after 0001_initial.sql.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS scheduled_for timestamp;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS published_at timestamp;
UPDATE messages SET published_at = created_at WHERE scheduled_for IS NULL AND published_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_messages_scheduled_for ON messages(scheduled_for);
CREATE INDEX IF NOT EXISTS ix_messages_published_at ON messages(published_at);

CREATE TABLE IF NOT EXISTS attachments (
 id varchar(36) PRIMARY KEY, message_id varchar(36) NOT NULL REFERENCES messages(id), url varchar(2048) NOT NULL,
 filename varchar(255) NOT NULL, mime_type varchar(150) NOT NULL, size_bytes integer NOT NULL, created_at timestamp NOT NULL,
 CONSTRAINT ck_attachment_size CHECK (size_bytes > 0 AND size_bytes <= 26214400)
);
CREATE INDEX IF NOT EXISTS ix_attachments_message_id ON attachments(message_id);
CREATE TABLE IF NOT EXISTS mentions (
 id varchar(36) PRIMARY KEY, message_id varchar(36) NOT NULL REFERENCES messages(id), member_id varchar(36) NOT NULL REFERENCES members(id),
 CONSTRAINT uq_message_mention UNIQUE(message_id, member_id)
);
CREATE TABLE IF NOT EXISTS polls (
 id varchar(36) PRIMARY KEY, message_id varchar(36) NOT NULL UNIQUE REFERENCES messages(id), question varchar(500) NOT NULL,
 multiple_choice boolean NOT NULL DEFAULT false, closes_at timestamp
);
CREATE TABLE IF NOT EXISTS poll_options (
 id varchar(36) PRIMARY KEY, poll_id varchar(36) NOT NULL REFERENCES polls(id), label varchar(255) NOT NULL, position integer NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_votes (
 id varchar(36) PRIMARY KEY, poll_id varchar(36) NOT NULL REFERENCES polls(id), option_id varchar(36) NOT NULL REFERENCES poll_options(id),
 member_id varchar(36) NOT NULL REFERENCES members(id), created_at timestamp NOT NULL,
 CONSTRAINT uq_poll_vote UNIQUE(option_id, member_id)
);
CREATE TABLE IF NOT EXISTS notification_preferences (
 id varchar(36) PRIMARY KEY, member_id varchar(36) NOT NULL UNIQUE REFERENCES members(id), in_app boolean NOT NULL DEFAULT true,
 email boolean NOT NULL DEFAULT true, digest varchar(20) NOT NULL DEFAULT 'daily', muted_channel_ids json NOT NULL DEFAULT '[]', updated_at timestamp NOT NULL,
 CONSTRAINT ck_notification_digest CHECK (digest IN ('immediate','daily','weekly','none'))
);
CREATE TABLE IF NOT EXISTS notification_jobs (
 id varchar(36) PRIMARY KEY, member_id varchar(36) NOT NULL REFERENCES members(id), message_id varchar(36) NOT NULL REFERENCES messages(id),
 kind varchar(20) NOT NULL, status varchar(20) NOT NULL DEFAULT 'queued', available_at timestamp NOT NULL, created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notification_jobs_queue ON notification_jobs(status, available_at);
CREATE TABLE IF NOT EXISTS audit_logs (
 id varchar(36) PRIMARY KEY, group_id varchar(36) NOT NULL REFERENCES festiome_groups(id), actor_member_id varchar(36) REFERENCES members(id),
 action varchar(100) NOT NULL, target_type varchar(50) NOT NULL, target_id varchar(36) NOT NULL, details json NOT NULL DEFAULT '{}', created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_logs_group_id ON audit_logs(group_id);
CREATE TABLE IF NOT EXISTS integration_commands (
 id varchar(36) PRIMARY KEY, source varchar(50) NOT NULL DEFAULT 'guesthub', idempotency_key varchar(128) NOT NULL UNIQUE,
 resource_id varchar(36) NOT NULL, created_at timestamp NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_uploads (
 id varchar(36) PRIMARY KEY, member_id varchar(36) NOT NULL REFERENCES members(id), path varchar(1024) NOT NULL,
 filename varchar(255) NOT NULL, mime_type varchar(150) NOT NULL, size_bytes integer NOT NULL,
 message_id varchar(36) REFERENCES messages(id), expires_at timestamp NOT NULL, created_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pending_uploads_member_id ON pending_uploads(member_id);
CREATE INDEX IF NOT EXISTS ix_pending_uploads_message_id ON pending_uploads(message_id);
