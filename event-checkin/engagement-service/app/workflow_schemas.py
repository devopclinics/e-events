from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

StepType = Literal[
    "hero", "poll", "poll_results", "multi_select", "rating", "word_cloud",
    "video", "quote", "scripture", "diagram", "countdown", "game", "prompt",
    "comparison", "big_number", "ranking", "moderated_quote", "custom_message", "closing",
]


class StepWrite(BaseModel):
    step_type: StepType
    title: str = Field(min_length=1, max_length=255)
    subtitle: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    linked_activity_id: str | None = None
    linked_question_id: str | None = None
    duration_seconds: int | None = Field(default=None, ge=1, le=86_400)
    auto_advance: bool = False
    presenter_notes: str | None = Field(default=None, max_length=10_000)
    status: Literal["active", "hidden"] = "active"

    @model_validator(mode="after")
    def validate_linkage(self):
        interactive = {"poll", "poll_results", "multi_select", "rating", "word_cloud", "ranking"}
        if self.step_type in interactive and not self.linked_activity_id:
            raise ValueError(f"{self.step_type} requires a linked activity")
        if self.auto_advance and not self.duration_seconds:
            raise ValueError("Auto-advance requires a duration")
        return self


class StepCreate(StepWrite):
    sequence: int | None = Field(default=None, ge=0)


class StepUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    subtitle: str | None = None
    config: dict[str, Any] | None = None
    linked_activity_id: str | None = None
    linked_question_id: str | None = None
    duration_seconds: int | None = Field(default=None, ge=1, le=86_400)
    auto_advance: bool | None = None
    presenter_notes: str | None = Field(default=None, max_length=10_000)
    status: Literal["active", "hidden"] | None = None


class StepOut(StepWrite):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workflow_id: str
    revision_id: str | None = None
    sequence: int
    created_at: datetime
    updated_at: datetime


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    theme: dict[str, Any] = Field(default_factory=dict)


class WorkflowUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    theme: dict[str, Any] | None = None
    expected_version: int = Field(ge=1)


class WorkflowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    org_id: str
    event_id: str
    name: str
    description: str | None = None
    status: str
    theme: dict[str, Any]
    current_revision_id: str | None = None
    draft_version: int
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime
    steps: list[StepOut] = Field(default_factory=list)


class ReorderIn(BaseModel):
    step_ids: list[str] = Field(min_length=1)
    expected_version: int = Field(ge=1)


class RunCreate(BaseModel):
    display_id: str | None = None


class RunCommand(BaseModel):
    action: Literal[
        "start", "next", "previous", "jump", "pause", "resume", "complete",
        "timer_start", "timer_pause", "timer_resume", "timer_reset", "timer_add",
        "video_play", "video_pause", "video_restart",
        "reveal_results", "reopen_voting",
    ]
    idempotency_key: str = Field(min_length=8, max_length=100)
    expected_version: int = Field(ge=0)
    step_id: str | None = None
    seconds: int | None = Field(default=None, ge=1, le=3600)


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workflow_id: str
    revision_id: str
    event_id: str
    display_id: str | None = None
    status: str
    current_step_id: str | None = None
    active_activity_id: str | None = None
    active_question_id: str | None = None
    state_version: int
    started_at: datetime | None = None
    paused_at: datetime | None = None
    completed_at: datetime | None = None
    elapsed_seconds: int = 0
    current_step: dict[str, Any] | None = None
    next_step: dict[str, Any] | None = None
    steps: list[dict[str, Any]] = Field(default_factory=list)


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    category: str | None = Field(default=None, max_length=120)
