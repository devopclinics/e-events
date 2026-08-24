CREATE TABLE engagement_program_sessions (
    id varchar(36) PRIMARY KEY,
    org_id varchar(64) NOT NULL,
    event_id varchar(64) NOT NULL,
    source_workflow_id varchar(64) NOT NULL,
    source_step_id varchar(64) NOT NULL,
    source_key varchar(120) NOT NULL,
    source_version bigint NOT NULL,
    title varchar(255) NOT NULL,
    description text,
    starts_at timestamptz,
    ends_at timestamptz,
    timezone varchar(80) NOT NULL DEFAULT 'UTC',
    room varchar(255),
    speaker varchar(255),
    speaker_id varchar(64),
    capacity integer,
    category varchar(120),
    sort_order integer NOT NULL DEFAULT 0,
    status varchar(20) NOT NULL DEFAULT 'published',
    event_name varchar(255),
    synced_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_engagement_program_session_source UNIQUE(org_id, event_id, source_step_id)
);
CREATE INDEX ix_engagement_program_sessions_org_id ON engagement_program_sessions(org_id);
CREATE INDEX ix_engagement_program_sessions_event_id ON engagement_program_sessions(event_id);
CREATE INDEX ix_engagement_program_sessions_source_workflow_id ON engagement_program_sessions(source_workflow_id);
CREATE INDEX ix_engagement_program_sessions_source_step_id ON engagement_program_sessions(source_step_id);
CREATE INDEX ix_engagement_program_sessions_status ON engagement_program_sessions(status);
CREATE INDEX ix_engagement_program_sessions_event_order ON engagement_program_sessions(event_id, sort_order);

CREATE TABLE engagement_program_sync_inbox (
    delivery_id varchar(64) PRIMARY KEY,
    org_id varchar(64) NOT NULL,
    event_id varchar(64) NOT NULL,
    source_id varchar(64) NOT NULL,
    source_version bigint NOT NULL,
    event_type varchar(80) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'processed',
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    error text
);
CREATE INDEX ix_engagement_program_sync_inbox_org_id ON engagement_program_sync_inbox(org_id);
CREATE INDEX ix_engagement_program_sync_inbox_event_id ON engagement_program_sync_inbox(event_id);
CREATE INDEX ix_engagement_program_sync_inbox_source_id ON engagement_program_sync_inbox(source_id);
CREATE INDEX ix_engagement_program_sync_inbox_source ON engagement_program_sync_inbox(event_id, source_id);
