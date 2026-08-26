-- Survey/feedback final-submission marker. Null for every other activity
-- type and for a survey/feedback participant who never reached the end.
ALTER TABLE engagement_activity_participants ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
