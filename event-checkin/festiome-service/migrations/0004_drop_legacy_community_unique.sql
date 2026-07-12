-- Sub-groups per event were blocked on already-deployed databases whose group
-- table descends from an earlier "communities" schema: it still carried a FULL
-- unique constraint uq_community_event (tenant_id, external_event_ref), so a
-- second group for the same event raised UniqueViolationError.
--
-- 0003 replaced the one-group-per-event rule with the partial index
-- uq_group_primary_event (... WHERE is_primary), but only dropped this repo's
-- constraint name (uq_festiome_group_event). Drop the legacy names too. All
-- guards are IF EXISTS, so this is a no-op on fresh/repo-native databases.

ALTER TABLE festiome_groups DROP CONSTRAINT IF EXISTS uq_community_event;
ALTER TABLE festiome_groups DROP CONSTRAINT IF EXISTS uq_festiome_group_event;
DROP INDEX IF EXISTS uq_community_event;
