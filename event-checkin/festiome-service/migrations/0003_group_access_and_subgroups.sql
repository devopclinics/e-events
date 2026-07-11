-- Configurable group access: sub-groups per event, open/request/closed join
-- policies, discoverability, and an acceptable-use "rules" gate.
-- FestioMe owns this schema. GuestHub must never read or write these tables.

ALTER TABLE festiome_groups ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT true;
ALTER TABLE festiome_groups ADD COLUMN IF NOT EXISTS join_policy varchar(20) NOT NULL DEFAULT 'closed';
ALTER TABLE festiome_groups ADD COLUMN IF NOT EXISTS visibility varchar(20) NOT NULL DEFAULT 'listed';
ALTER TABLE festiome_groups ADD COLUMN IF NOT EXISTS rules text NOT NULL DEFAULT '';
ALTER TABLE festiome_groups ADD COLUMN IF NOT EXISTS rules_version integer NOT NULL DEFAULT 0;

ALTER TABLE festiome_groups DROP CONSTRAINT IF EXISTS ck_group_visibility;
ALTER TABLE festiome_groups ADD CONSTRAINT ck_group_visibility CHECK (visibility IN ('listed','unlisted'));
ALTER TABLE festiome_groups DROP CONSTRAINT IF EXISTS ck_group_join_policy;
ALTER TABLE festiome_groups ADD CONSTRAINT ck_group_join_policy CHECK (join_policy IN ('closed','request','open'));

-- Replace the 1-group-per-event unique constraint with a partial unique index
-- that only binds the primary group, so sub-groups can share the event ref.
ALTER TABLE festiome_groups DROP CONSTRAINT IF EXISTS uq_festiome_group_event;
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_primary_event
  ON festiome_groups (tenant_id, external_event_ref) WHERE is_primary;

ALTER TABLE members ADD COLUMN IF NOT EXISTS rules_accepted_version integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS join_requests (
  id varchar(36) PRIMARY KEY,
  group_id varchar(36) NOT NULL REFERENCES festiome_groups(id),
  identity_kind varchar(20) NOT NULL,
  identity_ref varchar(128) NOT NULL,
  display_name varchar(255) NOT NULL,
  message text NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'pending',
  decided_by_member_id varchar(36) REFERENCES members(id),
  created_at timestamp NOT NULL,
  decided_at timestamp,
  CONSTRAINT ck_joinreq_identity_kind CHECK (identity_kind IN ('user','guest')),
  CONSTRAINT ck_joinreq_status CHECK (status IN ('pending','approved','denied'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_joinreq_pending
  ON join_requests (group_id, identity_kind, identity_ref) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_joinreq_group_status ON join_requests (group_id, status, created_at);
