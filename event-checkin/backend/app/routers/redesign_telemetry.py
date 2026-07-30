import json
import logging
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from ..auth import get_current_user
from ..models import User

router = APIRouter()
logger = logging.getLogger("redesign.telemetry")


class RedesignTelemetryEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: Literal[
        "render_error",
        "api_error",
        "validation_error",
        "mutation_duration",
        "abandoned_workflow",
        "feature_flag_cohort",
        "sse_or_poll_mode",
        "edit_conflict",
        "fallback_to_legacy",
    ]
    route: str = Field(max_length=240)
    module: str | None = Field(default=None, max_length=80)
    event_id: str | None = Field(default=None, max_length=80)
    org_id: str | None = Field(default=None, max_length=80)
    release_version: str | None = Field(default=None, max_length=40)
    feature_flag_cohort: str | None = Field(default=None, max_length=40)
    endpoint: str | None = Field(default=None, max_length=240)
    status: int | None = Field(default=None, ge=100, le=599)
    action: str | None = Field(default=None, max_length=80)
    duration_ms: int | None = Field(default=None, ge=0, le=3_600_000)
    success: bool | None = None
    reason: str | None = Field(default=None, max_length=120)
    mode: str | None = Field(default=None, max_length=40)


@router.post("", status_code=202)
async def record_redesign_telemetry(
    data: RedesignTelemetryEvent,
    user: User = Depends(get_current_user),
):
    # Deliberately log only the allowlisted operational fields above. Message
    # bodies, guest data, tokens, email addresses and arbitrary error strings
    # are not accepted by this endpoint.
    record = data.model_dump(exclude_none=True)
    record["user_id"] = user.id
    record["user_role"] = user.role
    record["ui"] = "redesign"
    logger.info(json.dumps(record, separators=(",", ":"), sort_keys=True))
    return {"accepted": True}
