-- Normalize legacy rows before enforcing the same invariants now applied by
-- the Pydantic request contracts. These checks protect direct SQL/import paths.
UPDATE planner_budgets SET total_budget = 0 WHERE total_budget < 0;
UPDATE planner_budgets SET currency = 'USD' WHERE currency !~ '^[A-Z]{3}$';
UPDATE planner_budget_categories SET allocated = 0 WHERE allocated < 0;
UPDATE planner_budget_items SET estimated = 0 WHERE estimated < 0;
UPDATE planner_budget_items SET actual = NULL WHERE actual < 0;
UPDATE planner_budget_items SET status = 'pending' WHERE status NOT IN ('pending', 'paid', 'cancelled');
UPDATE planner_vendors SET status = 'prospect' WHERE status NOT IN ('prospect', 'shortlisted', 'contracted', 'paid', 'cancelled');
UPDATE planner_vendors SET agreed_amount = NULL WHERE agreed_amount < 0;
UPDATE planner_vendors SET deposit_amount = NULL WHERE deposit_amount < 0;
UPDATE planner_vendors SET rating = NULL WHERE rating IS NOT NULL AND (rating < 1 OR rating > 5);
UPDATE planner_vendor_payments SET amount = 0 WHERE amount < 0;
UPDATE planner_milestones SET status = 'not_started' WHERE status NOT IN ('not_started', 'in_progress', 'done');
UPDATE planner_tasks SET priority = 'normal' WHERE priority NOT IN ('low', 'normal', 'high');
UPDATE planner_tasks SET status = 'todo' WHERE status NOT IN ('todo', 'in_progress', 'done');
UPDATE planner_runsheet SET type = 'other' WHERE type NOT IN ('setup', 'program', 'break', 'ceremony', 'other');
UPDATE planner_runsheet SET status = 'upcoming' WHERE status NOT IN ('upcoming', 'in_progress', 'done');
UPDATE planner_documents SET type = 'other' WHERE type NOT IN ('contract', 'quote', 'invoice', 'proposal', 'other');
UPDATE planner_documents SET status = 'draft' WHERE status NOT IN ('draft', 'sent', 'signed', 'expired');

ALTER TABLE planner_budgets ADD CONSTRAINT ck_planner_budget_nonnegative CHECK (total_budget >= 0);
ALTER TABLE planner_budgets ADD CONSTRAINT ck_planner_budget_currency CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE planner_budget_categories ADD CONSTRAINT ck_planner_category_allocated_nonnegative CHECK (allocated >= 0);
ALTER TABLE planner_budget_items ADD CONSTRAINT ck_planner_item_estimated_nonnegative CHECK (estimated >= 0);
ALTER TABLE planner_budget_items ADD CONSTRAINT ck_planner_item_actual_nonnegative CHECK (actual IS NULL OR actual >= 0);
ALTER TABLE planner_budget_items ADD CONSTRAINT ck_planner_item_status CHECK (status IN ('pending', 'paid', 'cancelled'));
ALTER TABLE planner_vendors ADD CONSTRAINT ck_planner_vendor_status CHECK (status IN ('prospect', 'shortlisted', 'contracted', 'paid', 'cancelled'));
ALTER TABLE planner_vendors ADD CONSTRAINT ck_planner_vendor_agreed_nonnegative CHECK (agreed_amount IS NULL OR agreed_amount >= 0);
ALTER TABLE planner_vendors ADD CONSTRAINT ck_planner_vendor_deposit_nonnegative CHECK (deposit_amount IS NULL OR deposit_amount >= 0);
ALTER TABLE planner_vendors ADD CONSTRAINT ck_planner_vendor_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
ALTER TABLE planner_vendor_payments ADD CONSTRAINT ck_planner_vendor_payment_nonnegative CHECK (amount >= 0);
ALTER TABLE planner_milestones ADD CONSTRAINT ck_planner_milestone_status CHECK (status IN ('not_started', 'in_progress', 'done'));
ALTER TABLE planner_tasks ADD CONSTRAINT ck_planner_task_priority CHECK (priority IN ('low', 'normal', 'high'));
ALTER TABLE planner_tasks ADD CONSTRAINT ck_planner_task_status CHECK (status IN ('todo', 'in_progress', 'done'));
ALTER TABLE planner_runsheet ADD CONSTRAINT ck_planner_runsheet_type CHECK (type IN ('setup', 'program', 'break', 'ceremony', 'other'));
ALTER TABLE planner_runsheet ADD CONSTRAINT ck_planner_runsheet_status CHECK (status IN ('upcoming', 'in_progress', 'done'));
ALTER TABLE planner_documents ADD CONSTRAINT ck_planner_document_type CHECK (type IN ('contract', 'quote', 'invoice', 'proposal', 'other'));
ALTER TABLE planner_documents ADD CONSTRAINT ck_planner_document_status CHECK (status IN ('draft', 'sent', 'signed', 'expired'));
