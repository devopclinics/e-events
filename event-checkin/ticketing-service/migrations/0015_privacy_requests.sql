CREATE TABLE IF NOT EXISTS privacy_requests (
  id VARCHAR(36) PRIMARY KEY, order_id VARCHAR(36) NOT NULL REFERENCES orders(id), event_id VARCHAR(36) NOT NULL,
  kind VARCHAR(20) NOT NULL, reason TEXT, status VARCHAR(30) NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(), decided_at TIMESTAMP, decided_by VARCHAR(255), decision_note TEXT,
  CONSTRAINT uq_privacy_order_kind UNIQUE(order_id,kind)
);
CREATE INDEX IF NOT EXISTS ix_privacy_order ON privacy_requests(order_id);
CREATE INDEX IF NOT EXISTS ix_privacy_event ON privacy_requests(event_id);
CREATE INDEX IF NOT EXISTS ix_privacy_status ON privacy_requests(status);
