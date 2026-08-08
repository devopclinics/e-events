CREATE TABLE IF NOT EXISTS payment_refunds (
  id VARCHAR(36) PRIMARY KEY, order_id VARCHAR(36) NOT NULL REFERENCES orders(id), event_id VARCHAR(36) NOT NULL,
  provider VARCHAR(20) NOT NULL, provider_refund_id VARCHAR(255) UNIQUE, amount INTEGER NOT NULL,
  reason VARCHAR(200) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'processing', requested_by VARCHAR(255) NOT NULL,
  failure_reason TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), completed_at TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_refund_order ON payment_refunds(order_id);
CREATE INDEX IF NOT EXISTS ix_refund_event ON payment_refunds(event_id);
CREATE INDEX IF NOT EXISTS ix_refund_status ON payment_refunds(status);
