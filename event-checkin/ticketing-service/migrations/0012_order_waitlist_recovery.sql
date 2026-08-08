ALTER TABLE orders ADD COLUMN IF NOT EXISTS waitlist_entry_id VARCHAR(36);
CREATE INDEX IF NOT EXISTS ix_order_waitlist_entry ON orders(waitlist_entry_id);
