CREATE TABLE IF NOT EXISTS engagement_event_settings (
    id varchar(36) PRIMARY KEY,
    org_id varchar(64) NOT NULL,
    event_id varchar(64) NOT NULL,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_engagement_event_settings_event UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS ix_engagement_event_settings_org_id ON engagement_event_settings(org_id);
CREATE INDEX IF NOT EXISTS ix_engagement_event_settings_event_id ON engagement_event_settings(event_id);
