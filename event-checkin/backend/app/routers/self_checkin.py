import random
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from ..database import get_db
from ..models import Event, Guest, SeatingTable
from ..schemas import SelfCheckinEventInfo, SelfCheckinMatch, SelfCheckinResult
from ..timeutil import local_hhmm
from . import broadcast
from .seating import assign_next_seat
from .scanner import _dispatch_admission_message

router = APIRouter()

_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def gen_event_code() -> str:
    return "".join(random.choices(_CODE_CHARS, k=8))


async def _get_active_event(event_code: str, db: AsyncSession) -> Event:
    event = (await db.execute(
        select(Event).where(Event.event_code == event_code.upper())
    )).scalar_one_or_none()
    if not event:
        raise HTTPException(404, "Event not found. Check the code and try again.")
    if not event.self_checkin_enabled:
        raise HTTPException(403, "Self check-in is not enabled for this event.")
    return event


@router.get("/{event_code}", response_model=SelfCheckinEventInfo)
async def get_event_info(event_code: str, db: AsyncSession = Depends(get_db)):
    event = await _get_active_event(event_code, db)
    return SelfCheckinEventInfo(
        name=event.name,
        couples_name=event.couples_name,
        event_date=event.event_date,
        status=event.status,
    )


@router.post("/{event_code}/search", response_model=list[SelfCheckinMatch])
async def search_for_self(event_code: str, body: dict, db: AsyncSession = Depends(get_db)):
    event = await _get_active_event(event_code, db)

    if event.status != "active":
        raise HTTPException(400, "This event is not currently active.")

    term = (body.get("query") or "").strip()
    if not term or len(term) < 2:
        return []

    guests = (await db.execute(
        select(Guest).where(
            Guest.event_id == event.id,
            or_(
                Guest.first_name.ilike(f"%{term}%"),
                Guest.last_name.ilike(f"%{term}%"),
                Guest.phone.ilike(f"%{term}%"),
            )
        ).order_by(Guest.last_name, Guest.first_name).limit(5)
    )).scalars().all()

    return [
        SelfCheckinMatch(
            id=g.id,
            first_name=g.first_name,
            last_name=g.last_name,
            admitted=g.admitted,
            admitted_at=g.admitted_at,
        )
        for g in guests
    ]


@router.post("/{event_code}/checkin/{guest_id}", response_model=SelfCheckinResult)
async def self_checkin(
    event_code: str,
    guest_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    event = await _get_active_event(event_code, db)

    if event.status != "active":
        label = "has not started yet" if event.status == "draft" else "has ended"
        return SelfCheckinResult(
            status="not_active",
            message=f"'{event.name}' {label}. Check-in is disabled.",
            recipient=None,
        )

    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event.id:
        raise HTTPException(404, "Guest not found.")

    recipient = guest.email or guest.phone

    if guest.admitted:
        table_name = None
        if guest.table_id:
            tbl = await db.get(SeatingTable, guest.table_id)
            if tbl:
                table_name = tbl.name
        time_str = local_hhmm(guest.admitted_at) or ""
        return SelfCheckinResult(
            status="already_admitted",
            message=(
                f"{guest.first_name} {guest.last_name} was already admitted at {time_str}."
                if time_str
                else f"{guest.first_name} {guest.last_name} was already admitted."
            ),
            table_name=table_name,
            seat_number=guest.seat_number,
            recipient=recipient,
        )

    if event.seating_enabled and not guest.table_id:
        seat_error = await assign_next_seat(guest, db)
        if seat_error:
            return SelfCheckinResult(
                status="no_seat_available",
                message=seat_error,
                recipient=recipient,
            )

    table_name = None
    if guest.table_id:
        tbl = await db.get(SeatingTable, guest.table_id)
        if tbl:
            table_name = tbl.name

    guest.admitted = True
    guest.admitted_at = datetime.utcnow()
    guest.admit_notified = True
    await db.commit()
    await db.refresh(guest)

    await _dispatch_admission_message(background_tasks, event, guest, table_name, db)
    broadcast(event.id, {
        "type": "admitted",
        "guest_id": guest.id,
        "name": f"{guest.first_name} {guest.last_name}",
        "email": guest.email,
        "admitted_at": guest.admitted_at.isoformat(),
    })

    msg = f"Welcome, {guest.first_name} {guest.last_name}! You are admitted."
    if table_name:
        msg += f" Head to {table_name}"
        msg += f", Seat {guest.seat_number}." if guest.seat_number else "."

    return SelfCheckinResult(
        status="admitted",
        message=msg,
        table_name=table_name,
        seat_number=guest.seat_number,
        recipient=recipient,
    )
