"""Experience program synchronization and program-aware staff reads."""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Identity, current_identity, require_guest, require_staff
from ..config import settings
from ..database import get_db
from ..models import ActivityParticipant, EngagementActivity, ParticipantResponse, ProgramSession, ProgramSyncInbox
from ..schemas import ProgramEventIn, ProgramSessionOut

internal_router = APIRouter(prefix="/api/engagement/internal/v1", tags=["engagement-program-internal"])
router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-program"])


def _authorized(token: str | None) -> None:
    expected = settings.internal_service_token
    if not expected or not token or not secrets.compare_digest(token, expected):
        raise HTTPException(401, "Invalid internal token")


def _optional_datetime(value) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(422, f"Invalid program timestamp: {value}") from exc
    return parsed


@internal_router.post("/program-events")
async def receive_program_event(
    body: ProgramEventIn,
    x_internal_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _authorized(x_internal_token)
    data = body.data
    if data.get("source_step_id") != body.source_id:
        raise HTTPException(422, "source_step_id does not match the event envelope")
    for field in ("source_workflow_id", "source_key", "title", "status"):
        if not str(data.get(field) or "").strip():
            raise HTTPException(422, f"Program session is missing {field}")
    if data["status"] not in {"published", "draft", "archived", "disabled"}:
        raise HTTPException(422, "Invalid program session status")

    inbox_values = dict(
        delivery_id=body.delivery_id,
        org_id=body.org_id,
        event_id=body.event_id,
        source_id=body.source_id,
        source_version=body.source_version,
        event_type=body.event_type,
        payload=data,
        status="received",
    )
    claimed = await db.scalar(
        pg_insert(ProgramSyncInbox)
        .values(**inbox_values)
        .on_conflict_do_nothing(index_elements=[ProgramSyncInbox.delivery_id])
        .returning(ProgramSyncInbox.delivery_id)
    )
    if not claimed:
        await db.rollback()
        return {"status": "duplicate", "delivery_id": body.delivery_id}
    inbox = await db.get(ProgramSyncInbox, body.delivery_id)
    session = await db.scalar(
        select(ProgramSession)
        .where(
            ProgramSession.org_id == body.org_id,
            ProgramSession.event_id == body.event_id,
            ProgramSession.source_step_id == body.source_id,
        )
        .with_for_update()
    )
    if session and session.source_version >= body.source_version:
        inbox.status = "stale"
        inbox.processed_at = datetime.now(timezone.utc)
        await db.commit()
        return {"status": "stale", "delivery_id": body.delivery_id, "source_version": session.source_version}

    values = {
        "source_workflow_id": data["source_workflow_id"],
        "source_step_id": body.source_id,
        "source_key": data["source_key"],
        "source_version": body.source_version,
        "title": data["title"],
        "description": data.get("description"),
        "starts_at": _optional_datetime(data.get("starts_at")),
        "ends_at": _optional_datetime(data.get("ends_at")),
        "timezone": data.get("timezone") or "UTC",
        "room": data.get("room") or None,
        "speaker": data.get("speaker") or None,
        "speaker_id": data.get("speaker_id") or None,
        "capacity": data.get("capacity"),
        "category": data.get("category") or None,
        "sort_order": int(data.get("sort_order") or 0),
        "status": data["status"],
        "event_name": data.get("event_name") or None,
        "synced_at": datetime.now(timezone.utc),
    }
    if session is None:
        session = ProgramSession(org_id=body.org_id, event_id=body.event_id, **values)
        db.add(session)
        outcome = "created"
    else:
        for field, value in values.items():
            setattr(session, field, value)
        outcome = "updated"
    inbox.status = "processed"
    inbox.processed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": outcome, "delivery_id": body.delivery_id, "session_id": body.source_id}


@router.get("/program-sessions", response_model=list[ProgramSessionOut])
async def list_program_sessions(
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
):
    require_staff(identity)
    sessions = (await db.execute(
        select(ProgramSession)
        .where(ProgramSession.org_id == identity.org_id, ProgramSession.event_id == identity.event_id)
        .order_by(ProgramSession.sort_order, ProgramSession.starts_at, ProgramSession.title)
    )).scalars().all()
    output: list[ProgramSessionOut] = []
    for session in sessions:
        activity_count = await db.scalar(
            select(func.count()).select_from(EngagementActivity).where(
                EngagementActivity.org_id == identity.org_id,
                EngagementActivity.event_id == identity.event_id,
                EngagementActivity.session_id == session.source_step_id,
            )
        ) or 0
        live_count = await db.scalar(
            select(func.count()).select_from(EngagementActivity).where(
                EngagementActivity.org_id == identity.org_id,
                EngagementActivity.event_id == identity.event_id,
                EngagementActivity.session_id == session.source_step_id,
                EngagementActivity.status.in_(("live", "paused")),
            )
        ) or 0
        response_count = await db.scalar(
            select(func.count()).select_from(ParticipantResponse)
            .join(EngagementActivity, EngagementActivity.id == ParticipantResponse.activity_id)
            .where(
                EngagementActivity.org_id == identity.org_id,
                EngagementActivity.event_id == identity.event_id,
                EngagementActivity.session_id == session.source_step_id,
            )
        ) or 0
        item = ProgramSessionOut.model_validate(session)
        item.activity_count = int(activity_count)
        item.live_activity_count = int(live_count)
        item.response_count = int(response_count)
        output.append(item)
    return output


@router.get("/my-program-participation")
async def my_program_participation(
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
):
    """Privacy-safe Guest Hub summary; raw answers never leave Live."""
    require_guest(identity)
    statement = (
        select(
            ProgramSession.source_step_id,
            func.count(func.distinct(EngagementActivity.id)).label("activity_count"),
            func.count(func.distinct(ActivityParticipant.activity_id)).label("joined_activity_count"),
            func.count(func.distinct(ParticipantResponse.id)).label("response_count"),
        )
        .outerjoin(EngagementActivity, and_(
            EngagementActivity.org_id == ProgramSession.org_id,
            EngagementActivity.event_id == ProgramSession.event_id,
            EngagementActivity.session_id == ProgramSession.source_step_id,
        ))
        .outerjoin(ActivityParticipant, and_(
            ActivityParticipant.activity_id == EngagementActivity.id,
            ActivityParticipant.guest_id == identity.subject,
        ))
        .outerjoin(ParticipantResponse, ParticipantResponse.participant_id == ActivityParticipant.id)
        .where(
            ProgramSession.org_id == identity.org_id,
            ProgramSession.event_id == identity.event_id,
            ProgramSession.status == "published",
        )
        .group_by(ProgramSession.source_step_id)
        .order_by(ProgramSession.source_step_id)
    )
    if identity.session_scope_enforced:
        statement = statement.where(ProgramSession.source_step_id.in_(identity.allowed_session_ids))
    rows = (await db.execute(statement)).all()
    return [
        {
            "session_id": session_id,
            "activity_count": int(activity_count),
            "joined_activity_count": int(joined_activity_count),
            "response_count": int(response_count),
            "participated": bool(joined_activity_count or response_count),
        }
        for session_id, activity_count, joined_activity_count, response_count in rows
    ]
