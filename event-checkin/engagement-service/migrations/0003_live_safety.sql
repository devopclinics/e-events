ALTER TABLE engagement_activity_questions
    ADD COLUMN IF NOT EXISTS live_state varchar(24) NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS ix_engagement_questions_activity_live_state
    ON engagement_activity_questions (activity_id, live_state);

-- One durable answer per participant/question. Idempotency keys still make
-- transport retries return the original response; answer changes replace it.
DELETE FROM engagement_participant_responses a
USING engagement_participant_responses b
WHERE a.activity_id = b.activity_id
  AND a.question_id = b.question_id
  AND a.participant_id = b.participant_id
  AND (a.submitted_at, a.id) < (b.submitted_at, b.id);

ALTER TABLE engagement_participant_responses
    DROP CONSTRAINT IF EXISTS uq_engagement_response_idem;
ALTER TABLE engagement_participant_responses
    ADD CONSTRAINT uq_engagement_response_participant_question
    UNIQUE (activity_id, question_id, participant_id);
