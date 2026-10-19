-- No historical classification or consent/enrollment backfill.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_test BOOLEAN;
