CREATE TABLE IF NOT EXISTS planner_budgets (
    id VARCHAR(36) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL UNIQUE,
    org_id VARCHAR(64) NOT NULL,
    total_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_budgets_org_id ON planner_budgets (org_id);

CREATE TABLE IF NOT EXISTS planner_budget_categories (
    id VARCHAR(36) PRIMARY KEY,
    budget_id VARCHAR(36) NOT NULL REFERENCES planner_budgets(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    allocated NUMERIC(14,2) NOT NULL DEFAULT 0,
    color VARCHAR(7) NOT NULL DEFAULT '#0f766e',
    sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_planner_budget_categories_budget_id ON planner_budget_categories (budget_id);

CREATE TABLE IF NOT EXISTS planner_budget_items (
    id VARCHAR(36) PRIMARY KEY,
    category_id VARCHAR(36) NOT NULL REFERENCES planner_budget_categories(id) ON DELETE CASCADE,
    vendor_id VARCHAR(36),
    name VARCHAR(200) NOT NULL,
    estimated NUMERIC(14,2) NOT NULL DEFAULT 0,
    actual NUMERIC(14,2),
    paid_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_budget_items_category_id ON planner_budget_items (category_id);

CREATE TABLE IF NOT EXISTS planner_vendors (
    id VARCHAR(36) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    org_id VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(80) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'prospect',
    contact_name VARCHAR(120) NOT NULL DEFAULT '',
    contact_email VARCHAR(200) NOT NULL DEFAULT '',
    contact_phone VARCHAR(30) NOT NULL DEFAULT '',
    website TEXT,
    contract_url TEXT,
    contract_expires_at DATE,
    agreed_amount NUMERIC(14,2),
    deposit_amount NUMERIC(14,2),
    deposit_due_at DATE,
    rating SMALLINT,
    notes TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_vendors_event_id ON planner_vendors (event_id);
CREATE INDEX IF NOT EXISTS ix_planner_vendors_org_id ON planner_vendors (org_id);

CREATE TABLE IF NOT EXISTS planner_vendor_payments (
    id VARCHAR(36) PRIMARY KEY,
    vendor_id VARCHAR(36) NOT NULL REFERENCES planner_vendors(id) ON DELETE CASCADE,
    label VARCHAR(120) NOT NULL DEFAULT 'Payment',
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    due_at DATE,
    paid_at TIMESTAMPTZ,
    reference VARCHAR(200),
    method VARCHAR(40)
);
CREATE INDEX IF NOT EXISTS ix_planner_vendor_payments_vendor_id ON planner_vendor_payments (vendor_id);

CREATE TABLE IF NOT EXISTS planner_milestones (
    id VARCHAR(36) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    due_at DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'not_started',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_milestones_event_id ON planner_milestones (event_id);

CREATE TABLE IF NOT EXISTS planner_tasks (
    id VARCHAR(36) PRIMARY KEY,
    milestone_id VARCHAR(36) NOT NULL REFERENCES planner_milestones(id) ON DELETE CASCADE,
    event_id VARCHAR(64) NOT NULL,
    title VARCHAR(300) NOT NULL,
    assigned_to VARCHAR(200),
    due_at DATE,
    priority VARCHAR(10) NOT NULL DEFAULT 'normal',
    status VARCHAR(20) NOT NULL DEFAULT 'todo',
    notes TEXT,
    vendor_id VARCHAR(36),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_tasks_milestone_id ON planner_tasks (milestone_id);
CREATE INDEX IF NOT EXISTS ix_planner_tasks_event_id ON planner_tasks (event_id);

CREATE TABLE IF NOT EXISTS planner_runsheet (
    id VARCHAR(36) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME,
    title VARCHAR(300) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'other',
    owner VARCHAR(200),
    cue TEXT,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_planner_runsheet_event_id ON planner_runsheet (event_id);

CREATE TABLE IF NOT EXISTS planner_documents (
    id VARCHAR(36) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    vendor_id VARCHAR(36),
    type VARCHAR(20) NOT NULL DEFAULT 'other',
    name VARCHAR(200) NOT NULL,
    file_url TEXT NOT NULL,
    file_size_bytes INT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    expires_at DATE,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_planner_documents_event_id ON planner_documents (event_id);
