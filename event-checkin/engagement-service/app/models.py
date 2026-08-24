"""Festio Live (engagement-service) data model — live quizzes, polls, surveys,
ratings, and feedback for events.

Every table is keyed by event_id/org_id/guest_id (opaque UUID strings owned by
the main backend) with no foreign keys crossing service boundaries — this DB
has zero knowledge of the main backend's schema, and vice versa. See the
architecture doc's §D for why the shape here deviates from the original spec's
suggested entity list (no separate ResponseAnswer table, no ActivityRule table
yet, Question Bank items are copied into activities, not referenced live).
"""
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


# ── Activities ───────────────────────────────────────────────────────────────

class EngagementActivity(Base):
    __tablename__ = "engagement_activities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    type: Mapped[str] = mapped_column(String(20))  # quiz | poll | survey | feedback | rating | q_and_a | word_cloud | voting
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft|scheduled|live|paused|closed|completed|archived
    # anonymous, allow_guest_participation, allow_multiple_submissions,
    # allow_answer_changes, leaderboard_enabled, live_results_enabled,
    # auto_open, auto_close, moderation_enabled — see schemas.ActivityConfig
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # passive_deletes=True: the DB's own ON DELETE CASCADE (see migrations/
    # 0001_init.sql) removes children, so SQLAlchemy never needs to lazy-load
    # this collection to process the cascade -- required in an async session,
    # since an implicit lazy load isn't awaitable outside a greenlet and
    # raises MissingGreenlet.
    questions: Mapped[list["ActivityQuestion"]] = relationship(
        back_populates="activity", cascade="all, delete-orphan", passive_deletes=True, order_by="ActivityQuestion.sequence",
    )


class ProgramSession(Base):
    """Read-only snapshot of an Experience program/session.

    `source_step_id` is an opaque core identifier, not a cross-database foreign
    key. Experience owns these fields; Live only attaches its own activities
    and displays through their existing session_id columns.
    """
    __tablename__ = "engagement_program_sessions"
    __table_args__ = (
        UniqueConstraint("org_id", "event_id", "source_step_id", name="uq_engagement_program_session_source"),
        Index("ix_engagement_program_sessions_event_order", "event_id", "sort_order"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    source_workflow_id: Mapped[str] = mapped_column(String(64), index=True)
    source_step_id: Mapped[str] = mapped_column(String(64), index=True)
    source_key: Mapped[str] = mapped_column(String(120))
    source_version: Mapped[int] = mapped_column(BigInteger)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    timezone: Mapped[str] = mapped_column(String(80), default="UTC")
    room: Mapped[str | None] = mapped_column(String(255), nullable=True)
    speaker: Mapped[str | None] = mapped_column(String(255), nullable=True)
    speaker_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="published", index=True)
    event_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class ProgramSyncInbox(Base):
    """Idempotent destination ledger for core outbox deliveries."""
    __tablename__ = "engagement_program_sync_inbox"
    __table_args__ = (Index("ix_engagement_program_sync_inbox_source", "event_id", "source_id"),)

    delivery_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    source_id: Mapped[str] = mapped_column(String(64), index=True)
    source_version: Mapped[int] = mapped_column(BigInteger)
    event_type: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), default="processed")
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class ActivityQuestion(Base):
    __tablename__ = "engagement_activity_questions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    activity_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activities.id", ondelete="CASCADE"), index=True)
    # single_choice|multiple_choice|true_false|yes_no|short_text|long_text|
    # rating_5|rating_10|nps|number|word_cloud|ranking
    question_type: Mapped[str] = mapped_column(String(20))
    prompt: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sequence: Mapped[int] = mapped_column(Integer, default=0)
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    time_limit_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # correct_answer, points, allow_multiple, show_results, show_correct_answer,
    # anonymous, branching — type-specific, never forced onto rows that don't use them
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="active")
    live_state: Mapped[str] = mapped_column(String(24), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    activity: Mapped["EngagementActivity"] = relationship(back_populates="questions")
    options: Mapped[list["QuestionOption"]] = relationship(
        back_populates="question", cascade="all, delete-orphan", passive_deletes=True, order_by="QuestionOption.sequence",
    )


class QuestionOption(Base):
    __tablename__ = "engagement_question_options"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activity_questions.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(500))
    sequence: Mapped[int] = mapped_column(Integer, default=0)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)

    question: Mapped["ActivityQuestion"] = relationship(back_populates="options")


# ── Question Bank ────────────────────────────────────────────────────────────

class QuestionBankItem(Base):
    """Org-scoped reusable question template. Importing into an activity COPIES
    these fields into a new ActivityQuestion row rather than referencing this
    row live — editing a bank template must never silently change a question
    inside an activity that already ran or is currently live."""
    __tablename__ = "engagement_question_bank_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    question_type: Mapped[str] = mapped_column(String(20))
    prompt: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    options: Mapped[list] = mapped_column(JSONB, default=list)  # [{label, is_correct, sequence}]
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    tags: Mapped[list] = mapped_column(JSONB, default=list)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Participation ────────────────────────────────────────────────────────────

class ActivityParticipant(Base):
    """Identified (guest_id, an opaque external reference) or anonymous
    (anon_id, a device-persisted token) — never both required."""
    __tablename__ = "engagement_activity_participants"
    __table_args__ = (
        UniqueConstraint("activity_id", "guest_id", name="uq_engagement_participant_guest"),
        UniqueConstraint("activity_id", "anon_id", name="uq_engagement_participant_anon"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    activity_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activities.id", ondelete="CASCADE"), index=True)
    guest_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    anon_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class ParticipantResponse(Base):
    """One row per participant per question. idempotency_key is unique per
    (activity_id, question_id, participant_id) so a retried submission (weak
    venue Wi-Fi) never creates a second vote."""
    __tablename__ = "engagement_participant_responses"
    __table_args__ = (
        UniqueConstraint("activity_id", "question_id", "participant_id", name="uq_engagement_response_participant_question"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    activity_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activities.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activity_questions.id", ondelete="CASCADE"), index=True)
    participant_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activity_participants.id", ondelete="CASCADE"), index=True)
    answer_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # text/number/rating — null for pure choice questions
    response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(80))
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    selections: Mapped[list["ResponseOptionSelection"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)


class ResponseOptionSelection(Base):
    """Join row, populated only for choice-type questions."""
    __tablename__ = "engagement_response_option_selections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    response_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_participant_responses.id", ondelete="CASCADE"), index=True)
    option_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_question_options.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer, default=0)


class ModerationItem(Base):
    """Durable review record for guest-authored text.

    The original response remains the source of truth. This record controls
    whether that text may be reused on public displays, word clouds, or AI
    summaries. Retaining both records lets organizers reject unsafe public
    content without deleting the guest's private response.
    """
    __tablename__ = "engagement_moderation_items"
    __table_args__ = (
        UniqueConstraint("response_id", name="uq_engagement_moderation_response"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    activity_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activities.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activity_questions.id", ondelete="CASCADE"), index=True)
    response_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_participant_responses.id", ondelete="CASCADE"), unique=True)
    content_type: Mapped[str] = mapped_column(String(24), default="open_text")
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|approved|rejected
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    flag_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Q&A ──────────────────────────────────────────────────────────────────────

class EngagementQnaQuestion(Base):
    """A guest-submitted question on a type="q_and_a" activity — separate from
    ActivityQuestion, which is staff-authored. Upvote count is denormalized
    onto the row (kept in sync in the upvote endpoint's own transaction) so
    ranking the feed never needs a join+count on every read."""
    __tablename__ = "engagement_qna_questions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    activity_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activities.id", ondelete="CASCADE"), index=True)
    participant_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activity_participants.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|answered|dismissed|featured
    upvote_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class EngagementQnaUpvote(Base):
    __tablename__ = "engagement_qna_upvotes"
    __table_args__ = (
        UniqueConstraint("qna_question_id", "participant_id", name="uq_engagement_qna_upvote"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    qna_question_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_qna_questions.id", ondelete="CASCADE"), index=True)
    participant_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activity_participants.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


# ── Displays, branching, and asynchronous analysis ──────────────────────────

class EngagementEventSettings(Base):
    """Event-wide defaults for newly created activities and public content."""
    __tablename__ = "engagement_event_settings"
    __table_args__ = (UniqueConstraint("event_id", name="uq_engagement_event_settings_event"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

class LiveDisplay(Base):
    __tablename__ = "engagement_live_displays"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(120))
    display_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    access_token: Mapped[str] = mapped_column(String(128), unique=True)
    assigned_session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    assigned_activity_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("engagement_activities.id", ondelete="SET NULL"), nullable=True)
    scene: Mapped[str] = mapped_column(String(32), default="welcome")
    status: Mapped[str] = mapped_column(String(20), default="active")
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class ActivityRule(Base):
    __tablename__ = "engagement_activity_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    activity_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activities.id", ondelete="CASCADE"), index=True)
    source_question_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activity_questions.id", ondelete="CASCADE"))
    operator: Mapped[str] = mapped_column(String(24))
    comparison_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    target_question_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activity_questions.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(20), default="show")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class FeedbackAnalysis(Base):
    __tablename__ = "engagement_feedback_analyses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("engagement_activity_questions.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    response_count: Mapped[int] = mapped_column(Integer, default=0)
    result: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
