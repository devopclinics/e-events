ALTER TABLE event_configs ADD COLUMN IF NOT EXISTS delivery_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
