ALTER TABLE event_configs ADD COLUMN IF NOT EXISTS public_listing BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pre_dispute_status VARCHAR(30);
CREATE TABLE IF NOT EXISTS cancellation_requests (
  id VARCHAR(36) PRIMARY KEY,
  order_id VARCHAR(36) NOT NULL REFERENCES orders(id),
  event_id VARCHAR(36) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMP,
  decided_by VARCHAR(255),
  decision_note TEXT,
  CONSTRAINT uq_cancellation_order UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS ix_cancellation_requests_order_id ON cancellation_requests(order_id);
CREATE INDEX IF NOT EXISTS ix_cancellation_requests_event_id ON cancellation_requests(event_id);
CREATE INDEX IF NOT EXISTS ix_cancellation_requests_status ON cancellation_requests(status);
