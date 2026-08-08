ALTER TABLE planner_quote_selections DROP CONSTRAINT IF EXISTS uq_planner_selection_item;
ALTER TABLE planner_quote_selections DROP CONSTRAINT IF EXISTS uq_planner_selection_quote_item;
ALTER TABLE planner_quote_selections ADD CONSTRAINT uq_planner_selection_quote_item
  UNIQUE(event_id, comparison_group, item_key, quote_id);

CREATE TABLE IF NOT EXISTS planner_procurement_requirements (
  id VARCHAR(36) PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL,
  comparison_group VARCHAR(120) NOT NULL,
  item_key VARCHAR(320) NOT NULL,
  required_quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
  updated_by VARCHAR(200) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_planner_requirement_item UNIQUE(event_id, comparison_group, item_key),
  CONSTRAINT ck_planner_requirement_quantity CHECK(required_quantity > 0)
);
CREATE INDEX IF NOT EXISTS ix_planner_procurement_requirements_event_id
  ON planner_procurement_requirements(event_id);
