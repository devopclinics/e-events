-- Durable per-step timer and media command state. This keeps projector and
-- presenter state consistent across reloads and SSE reconnects.
SET LOCAL lock_timeout = '5s';
ALTER TABLE engagement_workflow_runs
    ADD COLUMN IF NOT EXISTS step_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS timer_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS timer_ends_at timestamptz,
    ADD COLUMN IF NOT EXISTS timer_paused_remaining_seconds integer,
    ADD COLUMN IF NOT EXISTS runtime_state jsonb NOT NULL DEFAULT '{}'::jsonb;
