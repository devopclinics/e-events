ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference varchar(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_result jsonb NOT NULL DEFAULT '{}'::jsonb;
