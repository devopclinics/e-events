-- Reusable Festio Live experience workflows. Additive and disabled by
-- default at the application layer so this can be proven on staging first.
SET LOCAL lock_timeout = '5s';
CREATE TABLE engagement_experience_workflows (
    id varchar(36) PRIMARY KEY, org_id varchar(64) NOT NULL, event_id varchar(64) NOT NULL,
    name varchar(255) NOT NULL, description text, status varchar(20) NOT NULL DEFAULT 'draft',
    theme jsonb NOT NULL DEFAULT '{}'::jsonb, current_revision_id varchar(36),
    draft_version integer NOT NULL DEFAULT 1, created_by varchar(64),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_engagement_experience_workflows_org_id ON engagement_experience_workflows(org_id);
CREATE INDEX ix_engagement_experience_workflows_event_id ON engagement_experience_workflows(event_id);
CREATE INDEX ix_engagement_workflows_event_status ON engagement_experience_workflows(event_id, status);

CREATE TABLE engagement_workflow_revisions (
    id varchar(36) PRIMARY KEY,
    workflow_id varchar(36) NOT NULL REFERENCES engagement_experience_workflows(id) ON DELETE CASCADE,
    revision_number integer NOT NULL, name varchar(255) NOT NULL, description text,
    theme jsonb NOT NULL DEFAULT '{}'::jsonb, published_by varchar(64),
    published_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_engagement_workflow_revision UNIQUE(workflow_id, revision_number)
);
CREATE INDEX ix_engagement_workflow_revisions_workflow_id ON engagement_workflow_revisions(workflow_id);

CREATE TABLE engagement_workflow_steps (
    id varchar(36) PRIMARY KEY,
    workflow_id varchar(36) NOT NULL REFERENCES engagement_experience_workflows(id) ON DELETE CASCADE,
    revision_id varchar(36) REFERENCES engagement_workflow_revisions(id) ON DELETE CASCADE,
    sequence integer NOT NULL, step_type varchar(32) NOT NULL, title varchar(255) NOT NULL,
    subtitle text, config jsonb NOT NULL DEFAULT '{}'::jsonb,
    linked_activity_id varchar(36) REFERENCES engagement_activities(id) ON DELETE SET NULL,
    linked_question_id varchar(36) REFERENCES engagement_activity_questions(id) ON DELETE SET NULL,
    duration_seconds integer, auto_advance boolean NOT NULL DEFAULT false,
    presenter_notes text, status varchar(20) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- Draft and revision snapshots each have their own sequence namespace.
CREATE UNIQUE INDEX uq_engagement_workflow_draft_step_sequence
    ON engagement_workflow_steps(workflow_id, sequence) WHERE revision_id IS NULL;
CREATE UNIQUE INDEX uq_engagement_workflow_revision_step_sequence
    ON engagement_workflow_steps(revision_id, sequence) WHERE revision_id IS NOT NULL;
CREATE INDEX ix_engagement_workflow_steps_workflow_id ON engagement_workflow_steps(workflow_id);
CREATE INDEX ix_engagement_workflow_steps_revision_id ON engagement_workflow_steps(revision_id);
CREATE INDEX ix_engagement_workflow_steps_revision_order ON engagement_workflow_steps(revision_id, sequence);

CREATE TABLE engagement_workflow_comparisons (
    id varchar(36) PRIMARY KEY,
    workflow_id varchar(36) NOT NULL REFERENCES engagement_experience_workflows(id) ON DELETE CASCADE,
    question_a_id varchar(36) NOT NULL REFERENCES engagement_activity_questions(id) ON DELETE CASCADE,
    question_b_id varchar(36) NOT NULL REFERENCES engagement_activity_questions(id) ON DELETE CASCADE,
    comparison_type varchar(32) NOT NULL DEFAULT 'option_distribution',
    config jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_engagement_workflow_comparisons_workflow_id ON engagement_workflow_comparisons(workflow_id);

CREATE TABLE engagement_workflow_runs (
    id varchar(36) PRIMARY KEY,
    workflow_id varchar(36) NOT NULL REFERENCES engagement_experience_workflows(id) ON DELETE RESTRICT,
    revision_id varchar(36) NOT NULL REFERENCES engagement_workflow_revisions(id) ON DELETE RESTRICT,
    org_id varchar(64) NOT NULL, event_id varchar(64) NOT NULL,
    display_id varchar(36) REFERENCES engagement_live_displays(id) ON DELETE SET NULL,
    status varchar(20) NOT NULL DEFAULT 'ready',
    current_step_id varchar(36) REFERENCES engagement_workflow_steps(id) ON DELETE SET NULL,
    active_activity_id varchar(36) REFERENCES engagement_activities(id) ON DELETE SET NULL,
    active_question_id varchar(36) REFERENCES engagement_activity_questions(id) ON DELETE SET NULL,
    state_version integer NOT NULL DEFAULT 0, public_token varchar(128) NOT NULL UNIQUE,
    started_by varchar(64), started_at timestamptz, paused_at timestamptz, completed_at timestamptz,
    elapsed_before_pause_seconds integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_engagement_workflow_runs_workflow_id ON engagement_workflow_runs(workflow_id);
CREATE INDEX ix_engagement_workflow_runs_revision_id ON engagement_workflow_runs(revision_id);
CREATE INDEX ix_engagement_workflow_runs_org_id ON engagement_workflow_runs(org_id);
CREATE INDEX ix_engagement_workflow_runs_event_id ON engagement_workflow_runs(event_id);
CREATE INDEX ix_engagement_workflow_runs_event_status ON engagement_workflow_runs(event_id, status);

CREATE TABLE engagement_workflow_run_events (
    id varchar(36) PRIMARY KEY,
    run_id varchar(36) NOT NULL REFERENCES engagement_workflow_runs(id) ON DELETE CASCADE,
    event_type varchar(64) NOT NULL, actor_id varchar(64), from_step_id varchar(36), to_step_id varchar(36),
    idempotency_key varchar(100) NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_engagement_workflow_run_command UNIQUE(run_id, idempotency_key)
);
CREATE INDEX ix_engagement_workflow_run_events_run_id ON engagement_workflow_run_events(run_id);
CREATE INDEX ix_engagement_workflow_run_events_order ON engagement_workflow_run_events(run_id, created_at);

CREATE TABLE engagement_experience_templates (
    id varchar(36) PRIMARY KEY, org_id varchar(64), name varchar(255) NOT NULL,
    description text, category varchar(120), definition jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(20) NOT NULL DEFAULT 'active', created_by varchar(64), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_engagement_experience_templates_org_id ON engagement_experience_templates(org_id);

ALTER TABLE engagement_live_displays ADD COLUMN assigned_workflow_run_id varchar(36);
CREATE INDEX ix_engagement_live_displays_assigned_workflow_run_id ON engagement_live_displays(assigned_workflow_run_id);
