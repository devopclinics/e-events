from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Event, EventUser, User
from ..schemas import EventCreate, EventUpdate, EventOut, EventMemberOut, AssignUserRequest, UserOut, EventSourceUpdate
from ..auth import require_admin, get_current_user
from .guests import import_from_source_url

router = APIRouter()

VALID_STATUSES = {"draft", "active", "ended"}
STATUS_TRANSITIONS = {
    "draft":  {"active"},
    "active": {"ended"},
    "ended":  {"active"},   # allow reopen
}


async def _get_accessible_event(event_id: str, user: User, db: AsyncSession) -> Event:
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.role != "admin":
        assigned = await db.scalar(
            select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == user.id)
        )
        if not assigned:
            raise HTTPException(403, "You are not assigned to this event")
    return event


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.post("", response_model=EventOut, status_code=201)
async def create_event(
    data: EventCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    event = Event(**data.model_dump())
    db.add(event)
    await db.flush()
    # Auto-assign creator so they appear in their own event member list
    db.add(EventUser(event_id=event.id, user_id=current_user.id))
    await db.commit()
    await db.refresh(event)
    return event


@router.get("", response_model=list[EventOut])
async def list_events(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == "admin":
        result = await db.execute(select(Event).order_by(Event.created_at.desc()))
    else:
        result = await db.execute(
            select(Event)
            .join(EventUser, EventUser.event_id == Event.id)
            .where(EventUser.user_id == current_user.id)
            .order_by(Event.created_at.desc())
        )
    return result.scalars().all()


@router.get("/{event_id}", response_model=EventOut)
async def get_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _get_accessible_event(event_id, current_user, db)


@router.put("/{event_id}", response_model=EventOut)
async def update_event(
    event_id: str,
    data: EventUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(event, field, value)
    await db.commit()
    await db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
async def delete_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    await db.delete(event)
    await db.commit()


# ── Status ────────────────────────────────────────────────────────────────────

@router.patch("/{event_id}/status", response_model=EventOut)
async def change_status(
    event_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    new_status = body.get("status", "")
    if new_status not in VALID_STATUSES:
        raise HTTPException(400, f"status must be one of: {', '.join(VALID_STATUSES)}")

    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    allowed = STATUS_TRANSITIONS.get(event.status, set())
    if new_status not in allowed:
        raise HTTPException(400, f"Cannot move from '{event.status}' to '{new_status}'")

    event.status = new_status
    await db.commit()
    await db.refresh(event)
    return event


# ── Team (user assignment) ─────────────────────────────────────────────────────

@router.get("/{event_id}/members", response_model=list[EventMemberOut])
async def list_members(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(
        select(EventUser, User)
        .join(User, EventUser.user_id == User.id)
        .where(EventUser.event_id == event_id)
        .order_by(EventUser.assigned_at)
    )
    rows = result.all()
    return [
        EventMemberOut(id=eu.id, user=UserOut.model_validate(u), assigned_at=eu.assigned_at)
        for eu, u in rows
    ]


@router.post("/{event_id}/members", response_model=EventMemberOut, status_code=201)
async def assign_member(
    event_id: str,
    body: AssignUserRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    user = await db.get(User, body.user_id)
    if not user:
        raise HTTPException(404, "User not found")

    existing = await db.scalar(
        select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == body.user_id)
    )
    if existing:
        raise HTTPException(409, "User is already assigned to this event")

    eu = EventUser(event_id=event_id, user_id=body.user_id)
    db.add(eu)
    await db.commit()
    await db.refresh(eu)
    return EventMemberOut(id=eu.id, user=UserOut.model_validate(user), assigned_at=eu.assigned_at)


@router.put("/{event_id}/source", response_model=EventOut)
async def update_event_source(
    event_id: str,
    body: EventSourceUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if body.source_url is not None:
        event.source_url = body.source_url.strip() or None
        # Clear last error on URL change so the UI doesn't show a stale message.
        event.source_last_error = None
    if body.source_sync_interval_seconds is not None:
        # Clamp to a sane range; OneDrive is happy at 60s but reject sub-15s.
        event.source_sync_interval_seconds = max(15, min(body.source_sync_interval_seconds, 3600))
    await db.commit()
    await db.refresh(event)
    return event


@router.post("/{event_id}/sync-now")
async def sync_event_now(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if not event.source_url:
        raise HTTPException(400, "No source URL configured for this event")
    try:
        result = await import_from_source_url(event.source_url, event_id, db)
        event.source_last_sync_at = datetime.utcnow()
        event.source_last_error = None
        await db.commit()
        return {
            **result,
            "source_last_sync_at": event.source_last_sync_at.isoformat() + "Z",
        }
    except HTTPException as e:
        event.source_last_error = e.detail
        event.source_last_sync_at = datetime.utcnow()
        await db.commit()
        raise


@router.delete("/{event_id}/members/{user_id}", status_code=204)
async def remove_member(
    event_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    eu = await db.scalar(
        select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == user_id)
    )
    if not eu:
        raise HTTPException(404, "Assignment not found")
    await db.delete(eu)
    await db.commit()
