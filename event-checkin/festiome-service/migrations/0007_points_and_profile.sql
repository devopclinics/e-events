CREATE TABLE IF NOT EXISTS points_entries (
    id VARCHAR(36) PRIMARY KEY,
    group_id VARCHAR(36) NOT NULL REFERENCES festiome_groups(id),
    member_id VARCHAR(36) NOT NULL REFERENCES members(id),
    points INTEGER NOT NULL,
    reason VARCHAR(30) NOT NULL,
    source_ref VARCHAR(120),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_points_entries_group_id ON points_entries(group_id);
CREATE INDEX IF NOT EXISTS ix_points_entries_member_id ON points_entries(member_id);
CREATE INDEX IF NOT EXISTS ix_points_group_member ON points_entries(group_id, member_id);

ALTER TABLE members ADD COLUMN IF NOT EXISTS bio VARCHAR(280);
ALTER TABLE members ADD COLUMN IF NOT EXISTS interest_tags JSON NOT NULL DEFAULT '[]';
