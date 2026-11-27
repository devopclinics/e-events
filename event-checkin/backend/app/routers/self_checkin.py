"""Public self check-in (no auth). Guests find an event by its short
`event_code`, search for themselves by name/phone, and admit themselves.

Security model: nothing is guessable. The event_code gates the page; admission
additionally requires the guest's UUID (returned only by a successful search).
Search returns names only — no phone/email — and at most 5 results, so the guest
list can't be browsed. Admission reuses the exact QR/manual admission flow.
"""
from datetime import datetime, timezone
import math
import hashlib
import hmac
import re
import time
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Body
from fastapi.responses import Response
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, Guest
from ..ratelimit import rate_limit
from ..seating_terms import seating_term as _seating_term, seat_term as _seat_term
from ..schemas import (SelfCheckinSearch, SelfCheckinResult, SelfCheckinGuest,
    SelfCheckinRequest, SelfCheckinPartyRequest, SelfCheckinPartyOut, SelfCheckinConfig, SelfCheckinLookupOut)
from .scanner import perform_admission
from services.qr_service import generate_qr_for_url

router = APIRouter()

# Generous ceilings sized for a real crowd self-checking-in at one venue (all
# sharing that venue's public IP), keyed per event_code so one busy event can't
# starve another and a whole venue isn't throttled as a single client.
_search_limit = rate_limit(limit=60, window=60, scope="selfcheckin_search")
_lookup_limit = rate_limit(limit=600, window=60, scope="selfcheckin_lookup")
_party_limit = rate_limit(limit=600, window=60, scope="selfcheckin_party")
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
        lookup_enabled=config.lookup_enabled,
        personal_link_required=config.party_enabled and not config.lookup_enabled, venue_name=ev.venue_name)


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
    if token.startswith("lookup."):
        viewer = await _lookup_viewer(ev, token, db)
    else:
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


@router.post("/{event_code}/party", response_model=SelfCheckinPartyOut, dependencies=[Depends(_party_limit)])
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


def _lookup_signature(event_id, guest, expires):
    # Use the guest's existing private pass as a per-guest signing secret, never
    # return it. The short-lived lookup credential works across all replicas.
    payload = f"self-checkin-lookup:v1:{event_id}:{guest.id}:{expires}"
    return hmac.new(guest.qr_token.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _lookup_token(event_id, guest):
    expires = int(time.time()) + 600
    return f"lookup.{guest.id}.{expires}.{_lookup_signature(event_id, guest, expires)}"


async def _lookup_viewer(event, token, db):
    denied = HTTPException(403, "Your registration selection has expired. Please search again.")
    if not (event.self_checkin_config or {}).get("lookup_enabled"):
        raise denied
    try:
        prefix, guest_id, expiry, signature = token.split(".")
        expires = int(expiry)
        if prefix != "lookup" or expires < int(time.time()):
            raise ValueError()
    except (ValueError, TypeError):
        raise denied
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event.id or not guest.qr_token:
        raise denied
    if not hmac.compare_digest(signature, _lookup_signature(event.id, guest, expires)):
        raise denied
    from ..services.public_event_policy import require_public_invitation
    await require_public_invitation(event, db)
    return guest


@router.post("/{event_code}/lookup", response_model=SelfCheckinLookupOut, dependencies=[Depends(_lookup_limit)])
async def self_checkin_lookup(event_code: str, body: SelfCheckinSearch,
                             response: Response, db: AsyncSession = Depends(get_db)):
    ev = await _event_by_code(event_code, db)
    if not ev or not ev.self_checkin_enabled or not _live(ev) or not (ev.self_checkin_config or {}).get("lookup_enabled"):
        raise HTTPException(403, "Registration search is not available. Please visit the check-in desk.")
    from ..services.public_event_policy import require_public_invitation
    await require_public_invitation(ev, db)
    _require_location(ev, body.location)
    response.headers["Cache-Control"] = "no-store, private"
    query = " ".join((body.query or "").strip().lower().split())
    if len(query) < 3 or len(query) > 200:
        return SelfCheckinLookupOut(message="Enter at least 3 letters of your name, or your full phone number or email.")
    contact_search = False
    if "@" in query:
        contact_search = True
        criterion = func.lower(func.trim(Guest.email)) == query
    elif re.fullmatch(r"[+() .0-9-]+", query):
        contact_search = True
        digits = re.sub(r"\D", "", query)
        if len(digits) < 7:
            return SelfCheckinLookupOut(message="Enter your full phone number, including the area code.")
        phone = func.coalesce(Guest.phone, "")
        for char in ("+", " ", "(", ")", "-", "."):
            phone = func.replace(phone, char, "")
        variants = {digits}
        if len(digits) == 10: variants.add("1" + digits)
        if digits.startswith("00"): variants.add(digits[2:])
        criterion = phone.in_(variants)
    else:
        criterion = or_(func.lower(Guest.first_name).contains(query, autoescape=True),
                        func.lower(Guest.last_name).contains(query, autoescape=True),
                        func.lower(func.trim(Guest.first_name + " " + Guest.last_name)).contains(query, autoescape=True))
    statement = select(Guest).where(Guest.event_id == ev.id, criterion,
        Guest.qr_token.is_not(None), Guest.qr_token != "").order_by(Guest.last_name, Guest.first_name)
    if contact_search:
        # Families can share an email/phone. Offer the registering guest once
        # when their own contact matched; never promote a companion-only match
        # to the registering guest's wider party permissions.
        rows = list((await db.scalars(statement.where(or_(
            Guest.rsvp_submitter_guest_id.is_(None), Guest.rsvp_submitter_guest_id == Guest.id
        )).limit(6))).all())
        primary_ids = [guest.id for guest in rows]
        if len(rows) < 6:
            rows.extend((await db.scalars(statement.where(
                Guest.id.not_in(primary_ids),
                or_(Guest.rsvp_submitter_guest_id.is_(None), Guest.rsvp_submitter_guest_id.not_in(primary_ids))
            ).limit(6 - len(rows)))).all())
    else:
        rows = list((await db.scalars(statement.limit(6))).all())
    if len(rows) > 5:
        return SelfCheckinLookupOut(message="Several registrations match. Enter your full name, phone number or email to narrow the search.")
    return SelfCheckinLookupOut(matches=[{"name": f"{g.first_name} {g.last_name}".strip(),
                                        "lookup_token": _lookup_token(ev.id, g)} for g in rows],
                               message=None if rows else "No matching registration found. Try another name, phone number or email, or visit the check-in desk.")
