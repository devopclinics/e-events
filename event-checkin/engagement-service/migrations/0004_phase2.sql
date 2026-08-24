CREATE TABLE engagement_live_displays (
    id varchar(36) PRIMARY KEY, org_id varchar(64) NOT NULL, event_id varchar(64) NOT NULL,
    name varchar(120) NOT NULL, display_code varchar(64) NOT NULL UNIQUE,
    access_token varchar(128) NOT NULL UNIQUE, assigned_session_id varchar(64),
    assigned_activity_id varchar(36) REFERENCES engagement_activities(id) ON DELETE SET NULL,
    scene varchar(32) NOT NULL DEFAULT 'welcome', status varchar(20) NOT NULL DEFAULT 'active',
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_engagement_displays_event ON engagement_live_displays(event_id);
CREATE INDEX ix_engagement_displays_org ON engagement_live_displays(org_id);
CREATE INDEX ix_engagement_displays_code ON engagement_live_displays(display_code);

CREATE TABLE engagement_activity_rules (
    id varchar(36) PRIMARY KEY, activity_id varchar(36) NOT NULL REFERENCES engagement_activities(id) ON DELETE CASCADE,
    source_question_id varchar(36) NOT NULL REFERENCES engagement_activity_questions(id) ON DELETE CASCADE,
    operator varchar(24) NOT NULL, comparison_value jsonb,
    target_question_id varchar(36) NOT NULL REFERENCES engagement_activity_questions(id) ON DELETE CASCADE,
    action varchar(20) NOT NULL DEFAULT 'show', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_engagement_rules_activity ON engagement_activity_rules(activity_id);

CREATE TABLE engagement_feedback_analyses (
    id varchar(36) PRIMARY KEY, org_id varchar(64) NOT NULL, event_id varchar(64) NOT NULL,
    question_id varchar(36) NOT NULL REFERENCES engagement_activity_questions(id) ON DELETE CASCADE,
    status varchar(20) NOT NULL DEFAULT 'queued', response_count integer NOT NULL DEFAULT 0,
    result jsonb NOT NULL DEFAULT '{}'::jsonb, error text, attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz
);
CREATE INDEX ix_engagement_analysis_event ON engagement_feedback_analyses(event_id);
CREATE INDEX ix_engagement_analysis_question ON engagement_feedback_analyses(question_id);
CREATE INDEX ix_engagement_analysis_status ON engagement_feedback_analyses(status);

ALTER TABLE engagement_question_bank_items ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
