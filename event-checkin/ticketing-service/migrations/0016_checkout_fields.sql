ALTER TABLE event_configs ADD COLUMN IF NOT EXISTS checkout_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_answers JSONB NOT NULL DEFAULT '{}'::jsonb;
