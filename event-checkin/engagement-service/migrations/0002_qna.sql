CREATE TABLE engagement_qna_questions (
    id varchar(36) PRIMARY KEY,
    activity_id varchar(36) NOT NULL REFERENCES engagement_activities(id) ON DELETE CASCADE,
    participant_id varchar(36) NOT NULL REFERENCES engagement_activity_participants(id) ON DELETE CASCADE,
    text text NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    upvote_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_engagement_qna_questions_activity_id ON engagement_qna_questions (activity_id);
CREATE INDEX ix_engagement_qna_questions_activity_status ON engagement_qna_questions (activity_id, status);

CREATE TABLE engagement_qna_upvotes (
    id varchar(36) PRIMARY KEY,
    qna_question_id varchar(36) NOT NULL REFERENCES engagement_qna_questions(id) ON DELETE CASCADE,
    participant_id varchar(36) NOT NULL REFERENCES engagement_activity_participants(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_engagement_qna_upvote UNIQUE (qna_question_id, participant_id)
);
CREATE INDEX ix_engagement_qna_upvotes_question_id ON engagement_qna_upvotes (qna_question_id);
