ALTER TABLE planner_vendor_quotes
  ADD COLUMN IF NOT EXISTS comparison_group VARCHAR(120) NOT NULL DEFAULT 'General';
ALTER TABLE planner_vendor_quotes
  ADD COLUMN IF NOT EXISTS line_items JSONB;
CREATE INDEX IF NOT EXISTS ix_planner_vendor_quotes_comparison_group
  ON planner_vendor_quotes(event_id, comparison_group);
