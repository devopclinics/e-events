CREATE TABLE IF NOT EXISTS planner_audit_events (
    id VARCHAR(36) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    org_id VARCHAR(64) NOT NULL,
    actor_subject VARCHAR(200) NOT NULL,
    actor_email VARCHAR(255) NOT NULL DEFAULT '',
    method VARCHAR(10) NOT NULL,
    path TEXT NOT NULL,
    outcome VARCHAR(20) NOT NULL,
    status_code INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_audit_event_id ON planner_audit_events (event_id);
CREATE INDEX IF NOT EXISTS ix_planner_audit_org_id ON planner_audit_events (org_id);
CREATE INDEX IF NOT EXISTS ix_planner_audit_actor ON planner_audit_events (actor_subject);
CREATE INDEX IF NOT EXISTS ix_planner_audit_created_at ON planner_audit_events (created_at DESC);
