"""Public self check-in (no auth). Guests find an event by its short
`event_code`, search for themselves by name/phone, and admit themselves.

Security model: nothing is guessable. The event_code gates the page; admission
additionally requires the guest's UUID (returned only by a successful search).
Search returns names only — no phone/email — and at most 5 results, so the guest
list can't be browsed. Admission reuses the exact QR/manual admission flow.
"""
from datetime import datetime, timezone
import math
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Body
from fastapi.responses import Response
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, Guest
from ..ratelimit import rate_limit
from ..seating_terms import seating_term as _seating_term, seat_term as _seat_term
from ..schemas import (SelfCheckinSearch, SelfCheckinResult, SelfCheckinGuest,
    SelfCheckinRequest, SelfCheckinPartyRequest, SelfCheckinPartyOut, SelfCheckinConfig)
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
    config = SelfCheckinConfig.model_validate(ev.self_checkin_config or {})
    return SelfCheckinResult(status="ok", name=ev.name,
        location_required=config.geofence_enabled, party_enabled=config.party_enabled,
        personal_link_required=config.party_enabled, venue_name=ev.venue_name)


@router.post("/{event_code}/search", response_model=SelfCheckinResult, dependencies=[Depends(_search_limit)])
async def self_checkin_search(event_code: str, body: SelfCheckinSearch, db: AsyncSession = Depends(get_db)):
    ev = await _event_by_code(event_code, db)
    if not ev or not ev.self_checkin_enabled:
        return SelfCheckinResult(status="invalid", message="This check-in link isn’t valid.")
    if not _live(ev):
        return SelfCheckinResult(status="not_active", name=ev.name)

    if (ev.self_checkin_config or {}).get("party_enabled"):
        raise HTTPException(403, "Open your personal invitation link to check in your RSVP party.")
    _require_location(ev, body.location)
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
    body: SelfCheckinRequest | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
):
    ev = await _event_by_code(event_code, db)
    if not ev or not ev.self_checkin_enabled:
        return SelfCheckinResult(status="invalid", message="This check-in link isn’t valid.")
    if not _live(ev):
        return SelfCheckinResult(status="not_active", name=ev.name,
                                 message="Check-in isn’t open yet — please see the organizer.")
    if (ev.self_checkin_config or {}).get("party_enabled"):
        raise HTTPException(403, "Open your personal invitation link to check in your RSVP party.")
    _require_location(ev, body.location if body else None)
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != ev.id:
        return SelfCheckinResult(status="invalid", message="Not on the list — please speak to the organizer.")

    return await _admit(guest, ev, background_tasks, db)


async def _admit(guest, ev, background_tasks, db):
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
        seating_term=_seating_term(ev),
        seat_term=_seat_term(ev),
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


# Coordinates are transient input: never persist them or send them in notifications.
def _require_location(ev, location):
    config = SelfCheckinConfig.model_validate(ev.self_checkin_config or {})
    if not config.geofence_enabled:
        return
    if location is None:
        raise HTTPException(403, "Allow location access at the venue to check in, or visit the check-in desk.")
    captured = location.captured_at
    if captured.tzinfo is None:
        captured = captured.replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - captured).total_seconds()
    if age < -15 or age > 90:
        raise HTTPException(403, "Your location has expired. Please check your location again.")
    # Do not enlarge the venue boundary using an inaccurate location reading.
    if location.accuracy_m > min(100, config.radius_m):
        raise HTTPException(403, "Your location is not accurate enough. Move near the entrance and try again, or visit the check-in desk.")
    lat1, lat2 = math.radians(config.latitude), math.radians(location.latitude)
    dlat = lat2 - lat1
    dlon = math.radians(location.longitude - config.longitude)
    hav = math.sin(dlat / 2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2)**2
    distance = 6371000 * 2 * math.asin(math.sqrt(min(1, max(0, hav))))
    if distance > config.radius_m:
        raise HTTPException(403, "You need to be at the venue to check in. Please try again when you arrive.")


async def _party_context(event_code, token, db):
    ev = await _event_by_code(event_code, db)
    if not ev or not ev.self_checkin_enabled or not _live(ev):
        raise HTTPException(403, "Self check-in is not open. Please visit the check-in desk.")
    from .invite import _get_guest_by_token
    viewer, token_event = await _get_guest_by_token(token, db)
    if token_event.id != ev.id:
        raise HTTPException(404, "This invitation does not belong to this event.")
    scopes = [Guest.id == viewer.id]
    config = SelfCheckinConfig.model_validate(ev.self_checkin_config or {})
    # Only the person who registered companions can check them in. A dependant's
    # personal credential cannot authorize admission of their parent or siblings.
    if config.party_enabled and viewer.id not in (ev.guardian_authorizations or {}):
        scopes.append(Guest.rsvp_submitter_guest_id == viewer.id)
    members = (await db.execute(select(Guest).where(
        Guest.event_id == ev.id, or_(*scopes)
    ).order_by(Guest.id))).scalars().all()
    return ev, viewer, members


@router.post("/{event_code}/party", response_model=SelfCheckinPartyOut, dependencies=[Depends(_search_limit)])
async def self_checkin_party(event_code: str, body: SelfCheckinPartyRequest,
                            response: Response, db: AsyncSession = Depends(get_db)):
    ev, viewer, members = await _party_context(event_code, body.token, db)
    response.headers["Cache-Control"] = "no-store, private"
    return {"viewer_id": viewer.id, "members": [
        {"id": g.id, "name": f"{g.first_name} {g.last_name}".strip(), "admitted": bool(g.admitted)}
        for g in members
    ]}


@router.post("/{event_code}/party/checkin", response_model=list[SelfCheckinResult], dependencies=[Depends(_admit_limit)])
async def self_checkin_party_admit(event_code: str, body: SelfCheckinPartyRequest,
                                  background_tasks: BackgroundTasks, response: Response,
                                  db: AsyncSession = Depends(get_db)):
    ev, viewer, members = await _party_context(event_code, body.token, db)
    response.headers["Cache-Control"] = "no-store, private"
    _require_location(ev, body.location)
    selected = set(body.guest_ids)
    if not selected or not body.confirm_arrived:
        raise HTTPException(422, "Select the guests who have arrived and confirm they are present.")
    by_id = {g.id: g for g in members}
    # Validate the entire selection before admitting anyone. Never permit IDs
    # from another RSVP, including a different party in this same event.
    if not selected.issubset(by_id):
        raise HTTPException(403, "You can only check in yourself and guests you registered.")
    # Shared admission locks each row, preserves per-person seating/denials and
    # records normal notifications. Return each result, including partial success.
    results = []
    for guest_id in sorted(selected):
        guest = by_id[guest_id]
        result = await _admit(guest, ev, background_tasks, db)
        result.admitted_guest = f"{guest.first_name} {guest.last_name}".strip()
        results.append(result)
    return results
