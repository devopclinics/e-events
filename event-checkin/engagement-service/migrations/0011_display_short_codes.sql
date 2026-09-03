ALTER TABLE engagement_live_displays
    ADD COLUMN IF NOT EXISTS short_code VARCHAR(32);

CREATE UNIQUE INDEX IF NOT EXISTS ix_engagement_live_displays_short_code
    ON engagement_live_displays (short_code)
    WHERE short_code IS NOT NULL;
