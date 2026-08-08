CREATE TABLE IF NOT EXISTS planner_quote_selections (
  id VARCHAR(36) PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL,
  comparison_group VARCHAR(120) NOT NULL,
  item_key VARCHAR(320) NOT NULL,
  item_name VARCHAR(200) NOT NULL,
  unit VARCHAR(80) NOT NULL DEFAULT '',
  quote_id VARCHAR(36) NOT NULL REFERENCES planner_vendor_quotes(id) ON DELETE CASCADE,
  vendor_id VARCHAR(36) NOT NULL REFERENCES planner_vendors(id) ON DELETE CASCADE,
  unit_price NUMERIC(14,2) NOT NULL,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
  selected_by VARCHAR(200) NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_planner_selection_item UNIQUE(event_id, comparison_group, item_key)
);
CREATE INDEX IF NOT EXISTS ix_planner_quote_selections_event_id ON planner_quote_selections(event_id);
CREATE INDEX IF NOT EXISTS ix_planner_quote_selections_quote_id ON planner_quote_selections(quote_id);
CREATE INDEX IF NOT EXISTS ix_planner_quote_selections_vendor_id ON planner_quote_selections(vendor_id);
