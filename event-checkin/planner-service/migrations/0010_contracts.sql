CREATE TABLE IF NOT EXISTS planner_contracts (
  id VARCHAR(36) PRIMARY KEY, event_id VARCHAR(64) NOT NULL,
  vendor_id VARCHAR(36) NOT NULL REFERENCES planner_vendors(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL, terms TEXT NOT NULL, terms_html TEXT NOT NULL,
  pdf_url TEXT, status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(200) NOT NULL, sent_at TIMESTAMPTZ, signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_contracts_event_id ON planner_contracts(event_id);
CREATE INDEX IF NOT EXISTS ix_planner_contracts_vendor_id ON planner_contracts(vendor_id);
ALTER TABLE planner_contracts ADD CONSTRAINT ck_planner_contract_status CHECK (status IN ('draft','sent','signed'));

CREATE TABLE IF NOT EXISTS planner_contract_signatures (
  id VARCHAR(36) PRIMARY KEY,
  contract_id VARCHAR(36) NOT NULL UNIQUE REFERENCES planner_contracts(id) ON DELETE CASCADE,
  signer_name VARCHAR(200) NOT NULL, ip_address VARCHAR(64), user_agent TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_contract_signatures_contract_id ON planner_contract_signatures(contract_id);
