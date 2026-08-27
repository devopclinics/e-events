from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ActivityType = Literal["quiz", "poll", "survey", "feedback", "rating", "q_and_a", "word_cloud", "voting"]
ActivityStatus = Literal["draft", "scheduled", "live", "paused", "closed", "completed", "archived"]
QuestionStatus = Literal["active", "archived"]
QuestionType = Literal[
    "single_choice", "multiple_choice", "true_false", "yes_no", "short_text",
    "long_text", "rating_5", "rating_10", "nps", "number", "word_cloud", "ranking",
    "quadrant", "image_click",
]


class OptionIn(BaseModel):
    label: str = Field(max_length=500)
    is_correct: bool | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class OptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    label: str
    sequence: int
    is_correct: bool | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class QuestionCreate(BaseModel):
    question_type: QuestionType
    prompt: str = Field(min_length=1, max_length=5000)
    description: str | None = None
    sequence: int = 0
    required: bool = True
    time_limit_seconds: int | None = Field(default=None, ge=1, le=86_400)
    config: dict[str, Any] = Field(default_factory=dict)
    options: list[OptionIn] = Field(default_factory=list)


class QuestionUpdate(BaseModel):
    prompt: str | None = None
    description: str | None = None
    sequence: int | None = None
    required: bool | None = None
    time_limit_seconds: int | None = Field(default=None, ge=1, le=86_400)
    config: dict[str, Any] | None = None
    status: QuestionStatus | None = None
    options: list[OptionIn] | None = None


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    activity_id: str
    question_type: str
    prompt: str
    description: str | None = None
    sequence: int
    required: bool
    time_limit_seconds: int | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    status: str
    live_state: str = "pending"
    options: list[OptionOut] = Field(default_factory=list)


class ActivityCreate(BaseModel):
    type: ActivityType
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    session_id: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class ActivityUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: ActivityStatus | None = None
    config: dict[str, Any] | None = None
    session_id: str | None = None


class ActivityStatusIn(BaseModel):
    status: ActivityStatus


class ActivityAdvanceIn(BaseModel):
    question_id: str | None = None


class ActivityExtendIn(BaseModel):
    minutes: int = Field(default=30, ge=5, le=240)


class GuidedShowTimings(BaseModel):
    """Durations for the server-authoritative Guided Show phase clock."""
    lobby: int = Field(default=10, ge=1, le=3600)
    intro: int = Field(default=8, ge=1, le=3600)
    question_preview: int = Field(default=5, ge=1, le=3600)
    answering: int = Field(default=30, ge=1, le=3600)
    locked: int = Field(default=3, ge=1, le=3600)
    reveal: int = Field(default=6, ge=1, le=3600)
    results: int = Field(default=10, ge=1, le=3600)
    leaderboard: int = Field(default=8, ge=1, le=3600)


class GuidedShowAutomationIn(BaseModel):
    enabled: bool
    timings: GuidedShowTimings = Field(default_factory=GuidedShowTimings)


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    org_id: str
    event_id: str
    session_id: str | None = None
    type: str
    title: str
    description: str | None = None
    status: str
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    questions: list[QuestionOut] = Field(default_factory=list)


class ActivitySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    type: str
    title: str
    status: str
    session_id: str | None = None
    session_title: str | None = None
    created_at: datetime
    response_count: int = 0
    participant_count: int = 0
    # Survey/feedback only — how many of participant_count pressed the final
    # "Submit Feedback" (see ActivityParticipant.completed_at). Always 0 for
    # every other activity type, since nothing else ever sets it.
    completed_count: int = 0
    # Survey/feedback only — average seconds between joining and pressing
    # Submit Feedback, across completed participants. Null when there are no
    # completions yet (or for any other activity type, which never has one).
    avg_completion_seconds: float | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class ProgramSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    org_id: str
    event_id: str
    source_workflow_id: str
    source_step_id: str
    source_key: str
    source_version: int
    title: str
    description: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    timezone: str
    room: str | None = None
    speaker: str | None = None
    speaker_id: str | None = None
    capacity: int | None = None
    category: str | None = None
    sort_order: int
    status: str
    event_name: str | None = None
    synced_at: datetime
    activity_count: int = 0
    live_activity_count: int = 0
    response_count: int = 0


class ProgramEventIn(BaseModel):
    delivery_id: str = Field(min_length=1, max_length=64)
    event_type: Literal["experience.program_session.upsert"]
    occurred_at: datetime
    org_id: str = Field(min_length=1, max_length=64)
    event_id: str = Field(min_length=1, max_length=64)
    source_id: str = Field(min_length=1, max_length=64)
    source_version: int = Field(ge=1)
    data: dict[str, Any]


class BankItemCreate(BaseModel):
    question_type: QuestionType
    prompt: str = Field(min_length=1, max_length=5000)
    description: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    options: list[OptionIn] = Field(default_factory=list)
    category: str | None = None
    tags: list[str] = Field(default_factory=list)


class BankItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    question_type: str
    prompt: str
    description: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    options: list[dict] = Field(default_factory=list)
    category: str | None = None
    tags: list[str] = Field(default_factory=list)
    usage_count: int
    archived: bool = False


class BankItemUpdate(BaseModel):
    prompt: str | None = None
    description: str | None = None
    config: dict[str, Any] | None = None
    options: list[OptionIn] | None = None
    category: str | None = None
    tags: list[str] | None = None
    archived: bool | None = None


class BankImportIn(BaseModel):
    items: list[BankItemCreate] = Field(min_length=1, max_length=200)


class DraftAnswerOut(BaseModel):
    """One question's already-persisted answer, in the same shape `RespondIn`
    accepts — lets a survey/feedback form restore a guest's in-progress
    draft after a refresh without a second endpoint."""
    selected_option_ids: list[str] | None = None
    answer_value: Any = None


class ParticipateStateOut(BaseModel):
    activity: ActivityOut
    already_responded_question_ids: list[str] = Field(default_factory=list)
    participant_id: str
    # Survey/feedback only (see routers/participate.py) — lets the guest form
    # evaluate branching instantly against a draft answer instead of waiting
    # on a round trip, and restore in-progress answers after a refresh.
    draft_answers: dict[str, DraftAnswerOut] = Field(default_factory=dict)
    # The participant's own persisted answers. Used by the post-show review;
    # never contains another participant's response.
    my_answers: dict[str, DraftAnswerOut] = Field(default_factory=dict)
    rules: list[RuleOut] = Field(default_factory=list)
    completed_at: datetime | None = None


class CompleteSurveyOut(BaseModel):
    completed: bool
    completed_at: datetime | None = None
    missing_question_ids: list[str] = Field(default_factory=list)


class RespondIn(BaseModel):
    question_id: str
    idempotency_key: str = Field(max_length=80)
    selected_option_ids: list[str] = Field(default_factory=list)
    answer_value: Any = None
    response_time_ms: int | None = Field(default=None, ge=0, le=86_400_000)


class QuestionLiveStateIn(BaseModel):
    state: Literal["pending", "open", "closed", "results_visible", "answer_revealed"]


class RespondOut(BaseModel):
    response_id: str
    score: int | None = None
    correct: bool | None = None


class QuestionResultOut(BaseModel):
    question_id: str
    question_type: str
    prompt: str
    response_count: int
    option_counts: dict[str, int] = Field(default_factory=dict)  # option_id -> count
    average_rating: float | None = None
    text_samples: list[str] = Field(default_factory=list)
    ranking_scores: dict[str, int] = Field(default_factory=dict)
    # Discrete value -> count, for rating_5/rating_10/nps (a real distribution,
    # not just the average) — keys are stringified because JSON object keys
    # must be strings.
    value_counts: dict[str, int] = Field(default_factory=dict)
    # Raw numeric answers for "number" questions, capped so the payload stays
    # small — enough for the display to bin its own histogram.
    numeric_values: list[float] = Field(default_factory=list)
    # Response count per fixed time bucket since the question opened, for a
    # live participation trend line. Pre-bucketed server-side rather than
    # shipping raw timestamps, which keeps individual submission times private.
    response_timeline: list[int] = Field(default_factory=list)
    # Normalized (0..1, 0..1) points for quadrant and image_click questions —
    # a real scatter/heatmap needs real coordinates, not a synthesized shape.
    points: list[list[float]] = Field(default_factory=list)
    # Moderator-approved words only; raw open text is never exposed here.
    word_cloud: list[dict[str, Any]] = Field(default_factory=list)


class ActivityResultsOut(BaseModel):
    activity_id: str
    participant_count: int
    response_count: int
    questions: list[QuestionResultOut]


class ResponseDetailOut(BaseModel):
    id: str
    question_id: str
    question_prompt: str
    participant: str
    anonymous: bool = False
    answer_value: Any = None
    selected_options: list[str] = Field(default_factory=list)
    score: int | None = None
    response_time_ms: int | None = None
    submitted_at: datetime


class QnaSubmitIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class QnaModerateIn(BaseModel):
    status: Literal["pending", "answered", "dismissed", "featured"]


class QnaQuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    activity_id: str
    text: str
    status: str
    upvote_count: int
    created_at: datetime
    upvoted_by_me: bool = False
    is_mine: bool = False


class ModerationDecisionIn(BaseModel):
    status: Literal["approved", "rejected"]


class ModerationItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    activity_id: str
    question_id: str
    response_id: str
    content_type: str
    content: str
    status: str
    flagged: bool
    flag_reason: str | None = None
    reviewed_by: str | None = None
    created_at: datetime
    updated_at: datetime


class WordCloudEntry(BaseModel):
    word: str
    count: int


class AiAnalysisOut(BaseModel):
    question_id: str
    response_count: int
    summary: str
    themes: list[str] = Field(default_factory=list)
    sentiment: str | None = None


class AnalysisJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    question_id: str
    status: str
    response_count: int
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    created_at: datetime
    completed_at: datetime | None = None


DisplayScene = Literal[
    "welcome", "join", "agenda", "question", "responding", "results",
    "survey_insights",
    "correct_answer", "leaderboard", "team_battle", "rating", "feedback",
    "word_cloud", "q_and_a", "room_pulse", "ai_insight", "idea_galaxy",
    "live_spectrum", "interactive_quadrant", "image_heatmap", "ranking_race",
    "prediction_reveal", "commitment_wall", "photo_mosaic", "location_map",
    "journey_recap", "spotlight_wheel", "announcement", "break", "countdown",
    "celebration", "custom_message",
]
DisplayTheme = Literal["aurora", "citrus", "ocean", "festio", "mono"]


class EventSettings(BaseModel):
    guest_hub_participation: bool = True
    broadcast_join_enabled: bool = True
    allow_answer_changes: bool = False
    moderation_enabled: bool = False
    profanity_filtering: bool = True
    leaderboard_name_style: Literal["first_last_initial", "first_name", "anonymous_alias"] = "first_last_initial"
    response_retention_months: int = Field(default=12, ge=1, le=84)


class EventSettingsOut(EventSettings):
    updated_at: datetime | None = None


class DisplaySettings(BaseModel):
    """Brand and playback settings owned by engagement-service.

    Extra keys are retained so a display can carry event-specific content
    (agenda rows, sponsor names, team labels) without a schema migration.
    """
    model_config = ConfigDict(extra="allow")

    theme: DisplayTheme = "aurora"
    motion: bool = True
    safe_area: bool = False
    follow_activity: bool = False
    show_reactions: bool = True
    title: str | None = Field(default=None, max_length=240)
    subtitle: str | None = Field(default=None, max_length=500)
    kicker: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=1000)
    event_name: str | None = Field(default=None, max_length=240)
    venue: str | None = Field(default=None, max_length=240)
    date_label: str | None = Field(default=None, max_length=120)
    status_label: str | None = Field(default=None, max_length=120)
    join_code: str | None = Field(default=None, max_length=40)
    countdown_seconds: int | None = Field(default=None, ge=0, le=604800)
    agenda: list[dict[str, Any]] = Field(default_factory=list, max_length=12)
    sponsors: list[str] = Field(default_factory=list, max_length=8)
    team_names: list[str] = Field(default_factory=list, max_length=4)
    # Off by default -- see app/worker.py's _display_autofollow_tick. When on,
    # this screen re-points itself to whatever's live for whatever program
    # session is happening right now, so one TV can run the whole day
    # unattended instead of staff manually reassigning it each time.
    auto_follow_program: bool = False


class DisplaySettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="allow")

    theme: DisplayTheme | None = None
    motion: bool | None = None
    safe_area: bool | None = None
    follow_activity: bool | None = None
    show_reactions: bool | None = None
    title: str | None = Field(default=None, max_length=240)
    subtitle: str | None = Field(default=None, max_length=500)
    kicker: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=1000)
    event_name: str | None = Field(default=None, max_length=240)
    venue: str | None = Field(default=None, max_length=240)
    date_label: str | None = Field(default=None, max_length=120)
    status_label: str | None = Field(default=None, max_length=120)
    join_code: str | None = Field(default=None, max_length=40)
    countdown_seconds: int | None = Field(default=None, ge=0, le=604800)
    agenda: list[dict[str, Any]] | None = Field(default=None, max_length=12)
    sponsors: list[str] | None = Field(default=None, max_length=8)
    team_names: list[str] | None = Field(default=None, max_length=4)
    auto_follow_program: bool | None = None


class DisplayCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    assigned_session_id: str | None = None
    assigned_activity_id: str | None = None
    scene: DisplayScene = "welcome"
    settings: DisplaySettings = Field(default_factory=DisplaySettings)


class DisplayUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    assigned_session_id: str | None = None
    assigned_activity_id: str | None = None
    scene: DisplayScene | None = None
    status: Literal["active", "disabled"] | None = None
    settings: DisplaySettingsUpdate | None = None


class DisplayControlUpdate(BaseModel):
    """Fields a capability-scoped presenter may change during a show."""
    assigned_activity_id: str | None = None
    scene: DisplayScene | None = None
    settings: DisplaySettingsUpdate | None = None


class DisplayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    display_code: str
    access_token: str
    assigned_session_id: str | None = None
    assigned_activity_id: str | None = None
    scene: str
    status: str
    settings: dict[str, Any] = Field(default_factory=dict)


class RuleCreate(BaseModel):
    source_question_id: str
    operator: Literal["equals", "not_equals", "greater_than", "less_than", "contains", "answered", "not_answered"]
    comparison_value: Any = None
    target_question_id: str
    action: Literal["show", "hide"] = "show"


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    activity_id: str
    source_question_id: str
    operator: str
    comparison_value: Any = None
    target_question_id: str
    action: str
