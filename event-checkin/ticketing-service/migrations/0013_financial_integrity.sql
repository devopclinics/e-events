ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS guest_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS item_quantities JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS request_key VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_refund_request_key ON payment_refunds(request_key) WHERE request_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS journal_lines (
  id VARCHAR(36) PRIMARY KEY,
  transaction_id VARCHAR(36) NOT NULL,
  order_id VARCHAR(36) NOT NULL REFERENCES orders(id),
  event_id VARCHAR(36) NOT NULL,
  account VARCHAR(40) NOT NULL,
  debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency VARCHAR(3) NOT NULL,
  reference VARCHAR(255),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_journal_one_side CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX IF NOT EXISTS ix_journal_transaction ON journal_lines(transaction_id);
CREATE INDEX IF NOT EXISTS ix_journal_order ON journal_lines(order_id);
CREATE INDEX IF NOT EXISTS ix_journal_event ON journal_lines(event_id);
CREATE INDEX IF NOT EXISTS ix_journal_account ON journal_lines(account);

-- Financial history is append-only, including for privileged database users.
CREATE OR REPLACE FUNCTION reject_journal_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'journal_lines are immutable; post a reversal transaction';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS journal_lines_immutable ON journal_lines;
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION reject_journal_mutation();
