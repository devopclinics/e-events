ALTER TABLE event_configs ADD COLUMN IF NOT EXISTS setup_checks JSON NOT NULL DEFAULT '{}';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_queued_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS email_delivery_status VARCHAR(30) NOT NULL DEFAULT 'unknown';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS email_delivered_at TIMESTAMP;
UPDATE orders SET delivery_queued_at=COALESCE(delivery_queued_at,delivered_at),delivered_at=NULL WHERE delivery_status='queued' AND delivered_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS checkout_rate_buckets(id VARCHAR(64) PRIMARY KEY,count INTEGER NOT NULL DEFAULT 0,expires_at TIMESTAMP NOT NULL);
CREATE INDEX IF NOT EXISTS ix_checkout_rate_buckets_expires_at ON checkout_rate_buckets(expires_at);
CREATE INDEX IF NOT EXISTS ix_orders_promo_reservations ON orders(event_id,promo_code,status);
