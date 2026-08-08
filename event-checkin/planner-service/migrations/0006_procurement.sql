CREATE TABLE IF NOT EXISTS planner_vendor_quotes (
  id VARCHAR(36) PRIMARY KEY, event_id VARCHAR(64) NOT NULL,
  vendor_id VARCHAR(36) NOT NULL REFERENCES planner_vendors(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL, amount NUMERIC(14,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD', scope TEXT, valid_until DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'draft', submitted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ, decided_by VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_vendor_quotes_event_id ON planner_vendor_quotes(event_id);
CREATE INDEX IF NOT EXISTS ix_planner_vendor_quotes_vendor_id ON planner_vendor_quotes(vendor_id);

CREATE TABLE IF NOT EXISTS planner_change_orders (
  id VARCHAR(36) PRIMARY KEY, event_id VARCHAR(64) NOT NULL,
  vendor_id VARCHAR(36) NOT NULL REFERENCES planner_vendors(id) ON DELETE CASCADE,
  quote_id VARCHAR(36), title VARCHAR(200) NOT NULL, description TEXT,
  amount_delta NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'proposed', requested_by VARCHAR(200) NOT NULL,
  decided_by VARCHAR(200), decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_change_orders_event_id ON planner_change_orders(event_id);
CREATE INDEX IF NOT EXISTS ix_planner_change_orders_vendor_id ON planner_change_orders(vendor_id);

CREATE TABLE IF NOT EXISTS planner_vendor_portal_tokens (
  id VARCHAR(36) PRIMARY KEY, event_id VARCHAR(64) NOT NULL,
  vendor_id VARCHAR(36) NOT NULL REFERENCES planner_vendors(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ, created_by VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_vendor_portal_tokens_event_id ON planner_vendor_portal_tokens(event_id);
CREATE INDEX IF NOT EXISTS ix_planner_vendor_portal_tokens_vendor_id ON planner_vendor_portal_tokens(vendor_id);

ALTER TABLE planner_vendor_quotes ADD CONSTRAINT ck_planner_quote_amount CHECK (amount >= 0);
ALTER TABLE planner_vendor_quotes ADD CONSTRAINT ck_planner_quote_status CHECK (status IN ('draft','submitted','approved','rejected'));
ALTER TABLE planner_change_orders ADD CONSTRAINT ck_planner_change_status CHECK (status IN ('proposed','approved','rejected','acknowledged'));
