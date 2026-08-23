CREATE TABLE engagement_activities (
    id varchar(36) PRIMARY KEY,
    org_id varchar(64) NOT NULL,
    event_id varchar(64) NOT NULL,
    session_id varchar(64),
    type varchar(20) NOT NULL,
    title varchar(255) NOT NULL,
    description text,
    status varchar(20) NOT NULL DEFAULT 'draft',
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by varchar(64),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_engagement_activities_org_id ON engagement_activities (org_id);
CREATE INDEX ix_engagement_activities_event_id ON engagement_activities (event_id);
CREATE INDEX ix_engagement_activities_event_status ON engagement_activities (event_id, status);

CREATE TABLE engagement_activity_questions (
    id varchar(36) PRIMARY KEY,
    activity_id varchar(36) NOT NULL REFERENCES engagement_activities(id) ON DELETE CASCADE,
    question_type varchar(20) NOT NULL,
    prompt text NOT NULL,
    description text,
    sequence integer NOT NULL DEFAULT 0,
    required boolean NOT NULL DEFAULT true,
    time_limit_seconds integer,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(20) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_engagement_activity_questions_activity_id ON engagement_activity_questions (activity_id);

CREATE TABLE engagement_question_options (
    id varchar(36) PRIMARY KEY,
    question_id varchar(36) NOT NULL REFERENCES engagement_activity_questions(id) ON DELETE CASCADE,
    label varchar(500) NOT NULL,
    sequence integer NOT NULL DEFAULT 0,
    is_correct boolean,
    config jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_engagement_question_options_question_id ON engagement_question_options (question_id);

CREATE TABLE engagement_question_bank_items (
    id varchar(36) PRIMARY KEY,
    org_id varchar(64) NOT NULL,
    question_type varchar(20) NOT NULL,
    prompt text NOT NULL,
    description text,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    options jsonb NOT NULL DEFAULT '[]'::jsonb,
    category varchar(120),
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by varchar(64),
    usage_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_engagement_question_bank_items_org_id ON engagement_question_bank_items (org_id);

CREATE TABLE engagement_activity_participants (
    id varchar(36) PRIMARY KEY,
    activity_id varchar(36) NOT NULL REFERENCES engagement_activities(id) ON DELETE CASCADE,
    guest_id varchar(64),
    anon_id varchar(64),
    display_name varchar(120),
    joined_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_engagement_participant_guest UNIQUE (activity_id, guest_id),
    CONSTRAINT uq_engagement_participant_anon UNIQUE (activity_id, anon_id)
);
CREATE INDEX ix_engagement_activity_participants_activity_id ON engagement_activity_participants (activity_id);

CREATE TABLE engagement_participant_responses (
    id varchar(36) PRIMARY KEY,
    activity_id varchar(36) NOT NULL REFERENCES engagement_activities(id) ON DELETE CASCADE,
    question_id varchar(36) NOT NULL REFERENCES engagement_activity_questions(id) ON DELETE CASCADE,
    participant_id varchar(36) NOT NULL REFERENCES engagement_activity_participants(id) ON DELETE CASCADE,
    answer_value jsonb,
    response_time_ms integer,
    score integer,
    idempotency_key varchar(80) NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_engagement_response_idem UNIQUE (activity_id, question_id, participant_id, idempotency_key)
);
CREATE INDEX ix_engagement_participant_responses_activity_id ON engagement_participant_responses (activity_id);
CREATE INDEX ix_engagement_participant_responses_question_id ON engagement_participant_responses (question_id);
CREATE INDEX ix_engagement_participant_responses_participant_id ON engagement_participant_responses (participant_id);

CREATE TABLE engagement_response_option_selections (
    id varchar(36) PRIMARY KEY,
    response_id varchar(36) NOT NULL REFERENCES engagement_participant_responses(id) ON DELETE CASCADE,
    option_id varchar(36) NOT NULL REFERENCES engagement_question_options(id) ON DELETE CASCADE
);
CREATE INDEX ix_engagement_response_option_selections_response_id ON engagement_response_option_selections (response_id);
CREATE INDEX ix_engagement_response_option_selections_option_id ON engagement_response_option_selections (option_id);
