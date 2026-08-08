ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS ix_payment_events_processed_created ON payment_events(processed, created_at);

ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP;
ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS offer_attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ix_waitlist_offer_expiry ON waitlist_entries(status, offer_expires_at);
