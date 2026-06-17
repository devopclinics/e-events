from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from ..database import get_db
from ..models import Event, EventUser, User, Guest, SeatingTable, TableGroup, TableGroupTable, MenuCategory, MenuItem, MenuCombination, MenuCombinationItem, GuestMenuChoice, MessageTemplate
from ..schemas import EventCreate, EventUpdate, EventOut, EventMemberOut, AssignUserRequest, UserOut, EventSourceUpdate, EventResetRequest, EventResetResult
from ..auth import require_admin, get_current_user
from .guests import import_from_source_url, _normalize_phone
from services import messaging

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
    if user.role not in ("admin", "super_admin"):
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
    if current_user.role in ("admin", "super_admin"):
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


@router.post("/{event_id}/reset-data", response_model=EventResetResult)
async def reset_event_data(
    event_id: str,
    body: EventResetRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Dangerous operation: clear event data in-place while keeping the event record."""
    if (body.confirm_text or "").strip().upper() != "RESET":
        raise HTTPException(400, "confirm_text must be RESET")

    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    guests_deleted = 0
    assignments_cleared = 0
    tables_deleted = 0
    groups_deleted = 0
    menu_rows_deleted = 0
    templates_deleted = 0

    if body.clear_assignments:
        res = await db.execute(
            update(Guest)
            .where(Guest.event_id == event_id)
            .values(
                admitted=False,
                admitted_at=None,
                admit_notified=False,
                table_id=None,
                seat_number=None,
                held_seat=None,
                partner_guest_id=None,
                meal_served=False,
            )
        )
        assignments_cleared = int(res.rowcount or 0)

    if body.clear_guests:
        guest_ids_subq = select(Guest.id).where(Guest.event_id == event_id)
        await db.execute(delete(GuestMenuChoice).where(GuestMenuChoice.guest_id.in_(guest_ids_subq)))
        res = await db.execute(delete(Guest).where(Guest.event_id == event_id))
        guests_deleted = int(res.rowcount or 0)

    if body.clear_table_groups:
        group_ids_subq = select(TableGroup.id).where(TableGroup.event_id == event_id)
        await db.execute(update(Guest).where(Guest.event_id == event_id).values(table_group_id=None))
        await db.execute(delete(TableGroupTable).where(TableGroupTable.table_group_id.in_(group_ids_subq)))
        res = await db.execute(delete(TableGroup).where(TableGroup.event_id == event_id))
        groups_deleted = int(res.rowcount or 0)

    if body.clear_tables:
        table_ids_subq = select(SeatingTable.id).where(SeatingTable.event_id == event_id)
        await db.execute(update(Guest).where(Guest.event_id == event_id).values(table_id=None, seat_number=None, held_seat=None))
        await db.execute(delete(TableGroupTable).where(TableGroupTable.table_id.in_(table_ids_subq)))
        res = await db.execute(delete(SeatingTable).where(SeatingTable.event_id == event_id))
        tables_deleted = int(res.rowcount or 0)

    if body.clear_menu:
        cat_ids_subq = select(MenuCategory.id).where(MenuCategory.event_id == event_id)
        combo_ids_subq = select(MenuCombination.id).where(MenuCombination.event_id == event_id)
        c1 = await db.execute(delete(GuestMenuChoice).where(GuestMenuChoice.category_id.in_(cat_ids_subq)))
        c2 = await db.execute(delete(MenuCombinationItem).where(MenuCombinationItem.combination_id.in_(combo_ids_subq)))
        c3 = await db.execute(delete(MenuCombination).where(MenuCombination.event_id == event_id))
        c4 = await db.execute(delete(MenuItem).where(MenuItem.event_id == event_id))
        c5 = await db.execute(delete(MenuCategory).where(MenuCategory.event_id == event_id))
        menu_rows_deleted = sum(int(c.rowcount or 0) for c in (c1, c2, c3, c4, c5))

    if body.clear_templates:
        res = await db.execute(
            delete(MessageTemplate).where(
                MessageTemplate.event_id == event_id,
                MessageTemplate.scope == "event",
            )
        )
        templates_deleted = int(res.rowcount or 0)

    if body.reset_status_to_draft:
        event.status = "draft"

    await db.commit()

    return EventResetResult(
        event_id=event_id,
        guests_deleted=guests_deleted,
        assignments_cleared=assignments_cleared,
        tables_deleted=tables_deleted,
        table_groups_deleted=groups_deleted,
        menu_rows_deleted=menu_rows_deleted,
        templates_deleted=templates_deleted,
    )


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
        EventMemberOut(id=eu.id, user=UserOut.model_validate(u), assigned_at=eu.assigned_at, can_reassign_seats=eu.can_reassign_seats, can_manage_menu=eu.can_manage_menu)
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
    return EventMemberOut(id=eu.id, user=UserOut.model_validate(user), assigned_at=eu.assigned_at, can_reassign_seats=eu.can_reassign_seats, can_manage_menu=eu.can_manage_menu)


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


# ── Feature toggles ───────────────────────────────────────────────────────────

@router.post("/{event_id}/messaging/test")
async def send_test_message(
    event_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Fire a single test message to verify provider creds + delivery.
    Body: {channel: 'sms'|'whatsapp', phone: '<E.164 or US 10-digit>'}"""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    channel = (body.get("channel") or "").lower()
    if channel not in ("sms", "whatsapp"):
        raise HTTPException(400, "channel must be 'sms' or 'whatsapp'")
    phone = _normalize_phone(body.get("phone") or "")
    if not phone:
        raise HTTPException(400, "Phone format not recognised. Use E.164 or US 10-digit.")
    ticket_url = f"{event.checkin_base_url.rstrip('/')}/scan/test"
    try:
        if channel == "sms":
            await messaging.send_invite_sms(
                phone=phone, first_name="EventQR",
                event_name=f"{event.name} (TEST)",
                ticket_url=ticket_url, event_date=event.event_date,
            )
        else:
            await messaging.send_invite_whatsapp(
                phone=phone, first_name="EventQR",
                event_name=f"{event.name} (TEST)",
                ticket_url=ticket_url, event_date=event.event_date,
            )
    except Exception as e:
        raise HTTPException(500, f"Send failed: {e}")
    return {"ok": True, "channel": channel, "to": phone}


@router.patch("/{event_id}/features", response_model=EventOut)
async def toggle_features(
    event_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if "seating_enabled" in body:
        event.seating_enabled = bool(body["seating_enabled"])
    if "menu_enabled" in body:
        event.menu_enabled = bool(body["menu_enabled"])
    for k in ("notify_email", "notify_sms", "notify_whatsapp"):
        if k in body:
            setattr(event, k, bool(body[k]))
    await db.commit()
    await db.refresh(event)
    return event
