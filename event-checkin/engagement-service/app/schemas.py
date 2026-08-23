from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ActivityType = Literal["quiz", "poll", "survey", "feedback", "rating", "q_and_a", "word_cloud", "voting"]
ActivityStatus = Literal["draft", "scheduled", "live", "paused", "closed", "completed", "archived"]
QuestionType = Literal[
    "single_choice", "multiple_choice", "true_false", "yes_no", "short_text",
    "long_text", "rating_5", "rating_10", "nps", "number", "word_cloud", "ranking",
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


class QuestionCreate(BaseModel):
    question_type: QuestionType
    prompt: str
    description: str | None = None
    sequence: int = 0
    required: bool = True
    time_limit_seconds: int | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    options: list[OptionIn] = Field(default_factory=list)


class QuestionUpdate(BaseModel):
    prompt: str | None = None
    description: str | None = None
    sequence: int | None = None
    required: bool | None = None
    time_limit_seconds: int | None = None
    config: dict[str, Any] | None = None
    status: str | None = None
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
    options: list[OptionOut] = Field(default_factory=list)


class ActivityCreate(BaseModel):
    type: ActivityType
    title: str = Field(max_length=255)
    description: str | None = None
    session_id: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class ActivityUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: ActivityStatus | None = None
    config: dict[str, Any] | None = None


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
    created_at: datetime
    response_count: int = 0
    participant_count: int = 0


class BankItemCreate(BaseModel):
    question_type: QuestionType
    prompt: str
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


class ParticipateStateOut(BaseModel):
    activity: ActivityOut
    already_responded_question_ids: list[str] = Field(default_factory=list)
    participant_id: str


class RespondIn(BaseModel):
    question_id: str
    idempotency_key: str = Field(max_length=80)
    selected_option_ids: list[str] = Field(default_factory=list)
    answer_value: Any = None
    response_time_ms: int | None = None


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


class ActivityResultsOut(BaseModel):
    activity_id: str
    participant_count: int
    response_count: int
    questions: list[QuestionResultOut]
