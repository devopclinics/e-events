CREATE TABLE IF NOT EXISTS waitlist_entries (
  id VARCHAR(36) PRIMARY KEY, event_id VARCHAR(36) NOT NULL, product_id VARCHAR(36) NOT NULL REFERENCES ticket_products(id),
  name VARCHAR(200) NOT NULL, email VARCHAR(255) NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'waiting', created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_waitlist_product_email UNIQUE(product_id,email)
);
CREATE INDEX IF NOT EXISTS ix_waitlist_event ON waitlist_entries(event_id);
CREATE INDEX IF NOT EXISTS ix_waitlist_product ON waitlist_entries(product_id);
CREATE INDEX IF NOT EXISTS ix_waitlist_status ON waitlist_entries(status);
CREATE TABLE IF NOT EXISTS audit_events (
  id VARCHAR(36) PRIMARY KEY, event_id VARCHAR(36) NOT NULL, actor VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL, subject_id VARCHAR(80), details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_audit_event ON audit_events(event_id);
CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_events(created_at);
