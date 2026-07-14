-- Private channels (visible only to enrolled members, plus group staff for
-- moderation) and direct messages (a private channel of exactly two members
-- with no staff oversight). FestioMe owns this schema.

ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_dm boolean NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS dm_key varchar(80);

-- One DM channel per member pair per group.
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_dm_pair
  ON channels (group_id, dm_key) WHERE is_dm;

CREATE TABLE IF NOT EXISTS channel_members (
  id varchar(36) PRIMARY KEY,
  channel_id varchar(36) NOT NULL REFERENCES channels(id),
  member_id varchar(36) NOT NULL REFERENCES members(id),
  added_by_member_id varchar(36) REFERENCES members(id),
  created_at timestamp NOT NULL,
  CONSTRAINT uq_channel_member UNIQUE (channel_id, member_id)
);

CREATE INDEX IF NOT EXISTS ix_channel_members_channel ON channel_members (channel_id);
CREATE INDEX IF NOT EXISTS ix_channel_members_member ON channel_members (member_id);
