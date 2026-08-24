ALTER TABLE engagement_response_option_selections
    ADD COLUMN IF NOT EXISTS sequence integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS engagement_moderation_items (
    id varchar(36) PRIMARY KEY,
    activity_id varchar(36) NOT NULL REFERENCES engagement_activities(id) ON DELETE CASCADE,
    question_id varchar(36) NOT NULL REFERENCES engagement_activity_questions(id) ON DELETE CASCADE,
    response_id varchar(36) NOT NULL REFERENCES engagement_participant_responses(id) ON DELETE CASCADE,
    content_type varchar(24) NOT NULL DEFAULT 'open_text',
    content text NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    flagged boolean NOT NULL DEFAULT false,
    flag_reason varchar(120),
    reviewed_by varchar(64),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_engagement_moderation_response UNIQUE (response_id),
    CONSTRAINT ck_engagement_moderation_status CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS ix_engagement_moderation_activity_status
    ON engagement_moderation_items(activity_id, status);
CREATE INDEX IF NOT EXISTS ix_engagement_moderation_question
    ON engagement_moderation_items(question_id);

-- Preserve every existing text response and place it into the safe review
-- queue. Nothing is deleted or rewritten by this migration.
INSERT INTO engagement_moderation_items (
    id, activity_id, question_id, response_id, content_type, content, status
)
SELECT
    md5(response.id || ':moderation'),
    response.activity_id,
    response.question_id,
    response.id,
    CASE WHEN question.question_type = 'word_cloud' THEN 'word_cloud' ELSE 'open_text' END,
    response.answer_value #>> '{}',
    'pending'
FROM engagement_participant_responses response
JOIN engagement_activity_questions question ON question.id = response.question_id
WHERE question.question_type IN ('short_text', 'long_text', 'word_cloud')
  AND jsonb_typeof(response.answer_value) = 'string'
ON CONFLICT (response_id) DO NOTHING;
