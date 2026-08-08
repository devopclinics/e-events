CREATE TABLE IF NOT EXISTS fee_policies (
  id VARCHAR(36) PRIMARY KEY,
  scope_type VARCHAR(20) NOT NULL,
  scope_id VARCHAR(36) NOT NULL,
  fee_bps INTEGER NOT NULL CHECK (fee_bps >= 0 AND fee_bps <= 5000),
  fees_paid_by VARCHAR(20) NOT NULL DEFAULT 'buyer',
  updated_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_fee_policy_scope UNIQUE (scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS ix_fee_policies_scope_type ON fee_policies (scope_type);
CREATE INDEX IF NOT EXISTS ix_fee_policies_scope_id ON fee_policies (scope_id);
