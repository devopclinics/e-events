ALTER TABLE planner_runsheet ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;
ALTER TABLE planner_runsheet ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;
ALTER TABLE planner_runsheet ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'UTC';
ALTER TABLE planner_runsheet ADD COLUMN IF NOT EXISTS location VARCHAR(200);
ALTER TABLE planner_runsheet ADD COLUMN IF NOT EXISTS dependency_id VARCHAR(36);
ALTER TABLE planner_runsheet ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS ix_planner_runsheet_start_at ON planner_runsheet (start_at);
CREATE INDEX IF NOT EXISTS ix_planner_runsheet_dependency_id ON planner_runsheet (dependency_id);

ALTER TABLE planner_runsheet DROP CONSTRAINT IF EXISTS ck_planner_runsheet_datetime_order;
ALTER TABLE planner_runsheet ADD CONSTRAINT ck_planner_runsheet_datetime_order
  CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at);
ALTER TABLE planner_runsheet DROP CONSTRAINT IF EXISTS ck_planner_runsheet_version;
ALTER TABLE planner_runsheet ADD CONSTRAINT ck_planner_runsheet_version CHECK (version >= 1);
