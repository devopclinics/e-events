"""Public self check-in (no auth). Guests find an event by its short
`event_code`, search for themselves by name/phone, and admit themselves.

Security model: nothing is guessable. The event_code gates the page; admission
additionally requires the guest's UUID (returned only by a successful search).
Search returns names only — no phone/email — and at most 5 results, so the guest
list can't be browsed. Admission reuses the exact QR/manual admission flow.
"""
from fastapi import APIRouter, Depends, BackgroundTasks
from fastapi.responses import Response
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, Guest
from ..ratelimit import rate_limit
from ..schemas import SelfCheckinSearch, SelfCheckinResult, SelfCheckinGuest
from .scanner import perform_admission
from services.qr_service import generate_qr_for_url

router = APIRouter()

# Generous ceilings sized for a real crowd self-checking-in at one venue (all
# sharing that venue's public IP), keyed per event_code so one busy event can't
# starve another and a whole venue isn't throttled as a single client.
_search_limit = rate_limit(limit=60, window=60, scope="selfcheckin_search")
_admit_limit = rate_limit(limit=120, window=60, scope="selfcheckin_admit")


async def _event_by_code(code: str, db: AsyncSession) -> Event | None:
    if not code:
        return None
    return await db.scalar(select(Event).where(func.lower(Event.event_code) == code.strip().lower()))


def _live(ev: Event) -> bool:
    return ev.status == "active" and ev.is_paid


@router.get("/{event_code}", response_model=SelfCheckinResult)
async def self_checkin_info(event_code: str, db: AsyncSession = Depends(get_db)):
    """Page bootstrap: event name + whether check-in is open. Invalid/disabled
    codes return 'invalid' without leaking whether the code exists."""
    ev = await _event_by_code(event_code, db)
    if not ev or not ev.self_checkin_enabled:
        return SelfCheckinResult(status="invalid", message="This check-in link isn’t valid.")
    if not _live(ev):
        return SelfCheckinResult(status="not_active", name=ev.name,
                                 message="Check-in isn’t open yet — please see the organizer.")
    return SelfCheckinResult(status="ok", name=ev.name)


@router.post("/{event_code}/search", response_model=SelfCheckinResult, dependencies=[Depends(_search_limit)])
async def self_checkin_search(event_code: str, body: SelfCheckinSearch, db: AsyncSession = Depends(get_db)):
    ev = await _event_by_code(event_code, db)
    if not ev or not ev.self_checkin_enabled:
        return SelfCheckinResult(status="invalid", message="This check-in link isn’t valid.")
    if not _live(ev):
        return SelfCheckinResult(status="not_active", name=ev.name)

    term = (body.query or "").strip().lower()
    if len(term) < 2:
        return SelfCheckinResult(status="ok", guests=[])
    p = f"%{term}%"
    rows = (await db.execute(
        select(Guest).where(
            Guest.event_id == ev.id,
            or_(
                func.lower(Guest.first_name).like(p),
                func.lower(Guest.last_name).like(p),
                func.lower(Guest.first_name + " " + Guest.last_name).like(p),
                func.lower(func.coalesce(Guest.phone, "")).like(p),
            ),
        ).order_by(Guest.last_name, Guest.first_name).limit(5)
    )).scalars().all()

    guests = [SelfCheckinGuest(id=g.id, name=f"{g.first_name} {g.last_name}".strip()) for g in rows]
    return SelfCheckinResult(status="ok", guests=guests)


@router.post("/{event_code}/checkin/{guest_id}", response_model=SelfCheckinResult, dependencies=[Depends(_admit_limit)])
async def self_checkin_admit(
    event_code: str,
    guest_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    ev = await _event_by_code(event_code, db)
    if not ev or not ev.self_checkin_enabled:
        return SelfCheckinResult(status="invalid", message="This check-in link isn’t valid.")
    if not _live(ev):
        return SelfCheckinResult(status="not_active", name=ev.name,
                                 message="Check-in isn’t open yet — please see the organizer.")
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != ev.id:
        return SelfCheckinResult(status="invalid", message="Not on the list — please speak to the organizer.")

    res = await perform_admission(guest, ev, background_tasks, db)
    # Map to a privacy-safe public response (never expose the full guest / qr_token).
    name = f"{guest.first_name} {guest.last_name}".strip()
    return SelfCheckinResult(
        status=res.status,
        message=res.message,
        admitted_guest=name if res.status in ("admitted", "already_admitted") else None,
        table_name=res.table_name,
        seat_number=res.seat_number,
        admitted_at=guest.admitted_at,
    )


@router.get("/{event_code}/qr.png")
async def self_checkin_qr(event_code: str, db: AsyncSession = Depends(get_db)):
    """Public QR PNG that links to this event's self check-in page (for display
    on a screen / print). Encodes {checkin_base_url}/e/{event_code}."""
    ev = await _event_by_code(event_code, db)
    if not ev or not ev.event_code or not ev.self_checkin_enabled:
        return Response(status_code=404)
    base = (ev.checkin_base_url or "https://festio.events").rstrip("/")
    return Response(content=generate_qr_for_url(f"{base}/e/{ev.event_code}"), media_type="image/png")
