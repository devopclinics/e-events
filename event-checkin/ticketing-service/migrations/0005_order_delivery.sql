ALTER TABLE orders ADD COLUMN IF NOT EXISTS access_token VARCHAR(64);
UPDATE orders SET access_token = md5(random()::text || clock_timestamp()::text || id) WHERE access_token IS NULL;
ALTER TABLE orders ALTER COLUMN access_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_access_token ON orders (access_token);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(30) NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;
