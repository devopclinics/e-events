CREATE TABLE IF NOT EXISTS payout_accounts (
  id VARCHAR(36) PRIMARY KEY,
  org_id VARCHAR(36) NOT NULL,
  provider VARCHAR(20) NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  business_name VARCHAR(200) NOT NULL,
  account_name VARCHAR(200),
  account_last4 VARCHAR(4),
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payout_provider_account UNIQUE (provider, provider_account_id)
);
CREATE INDEX IF NOT EXISTS ix_payout_accounts_org_id ON payout_accounts (org_id);
CREATE INDEX IF NOT EXISTS ix_payout_accounts_provider ON payout_accounts (provider);
