ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS retry_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS operations_subscriptions (
  event_id VARCHAR(36) PRIMARY KEY,
  recipient VARCHAR(255) NOT NULL,
  frequency VARCHAR(20) NOT NULL DEFAULT 'daily',
  enabled BOOLEAN NOT NULL DEFAULT true,
  include_alerts BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMP NOT NULL,
  last_sent_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_operations_subscriptions_next_run
  ON operations_subscriptions(enabled, next_run_at);
