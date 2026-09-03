"""Token exchange for Festio Live (engagement-service) guest participation.

Mints a scoped JWT the same way /auth/live-token does for staff — this file
exists separately (not in auth.py) because it's guest-facing and rate-limited
like festiome.py's guest-token exchange, not an authenticated-staff endpoint.
Backend never proxies user traffic to engagement-service. This router mints
scoped tokens and owns the stable public join-code mapping/QR; a separate
durable outbox asynchronously replicates published Experience program metadata
without making guest, RSVP, or organizer requests wait for Live.
"""
import secrets
import re
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, _org_role
from ..database import get_db
from ..models import Event, EventUser, ExperienceStep, ExperienceWorkflow, Guest, GuestExperienceProgress, LiveAccessLink, User
from ..ratelimit import rate_limit
from services.qr_service import generate_qr_for_url

router = APIRouter(tags=["engagement"])

# Presenter can drive Live Control (advance questions, change activity status)
# without the full admin surface (editing/deleting questions, deleting
# activities); Moderator can only triage the Q&A wall; Analyst is read-only,
# which every staff-scoped GET endpoint already allows with no extra
# capability needed. See engagement-service/app/auth.py's require_capability.
SHARE_LINK_CAPABILITIES = {"presenter": ["control"], "moderator": ["moderate"], "analyst": []}
LIVE_JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
LIVE_JOIN_CODE_LENGTH = 6


def _new_live_join_code() -> str:
    """Six easy-to-read characters; omit ambiguous I/1 and O/0 glyphs."""
    return "".join(secrets.choice(LIVE_JOIN_CODE_ALPHABET) for _ in range(LIVE_JOIN_CODE_LENGTH))


def _live_join_url(code: str) -> str:
    from ..config import settings
    base_url = settings.public_base_url or "https://festio.events"
    return f"{base_url.rstrip('/')}/l/{code}"


async def _ensure_live_join_code(event_id: str, db: AsyncSession) -> str:
    """Return the event's stable code, creating it safely on first use.

    Locking the event row serializes simultaneous QR/info requests for the
    same event. The unique database index handles the much rarer case where
    two different events happen to draw the same candidate.
    """
    for _ in range(12):
        event = await db.scalar(
            select(Event).where(Event.id == event_id).with_for_update().execution_options(populate_existing=True)
        )
        if not event or not event.engagement_enabled:
            raise HTTPException(404, "Festio Live is not available for this event")
        if event.engagement_join_code:
            return event.engagement_join_code

        candidate = _new_live_join_code()
        if await db.scalar(select(Event.id).where(Event.engagement_join_code == candidate)):
            continue
        event.engagement_join_code = candidate
        try:
            await db.commit()
            return candidate
        except IntegrityError:
            # Either another request assigned this event while we waited, or
            # a different event won the same candidate. Reload and retry.
            await db.rollback()
    raise HTTPException(503, "A Festio Live join code could not be created. Please retry.")


async def _require_live_admin(event: Event, user: User, db: AsyncSession) -> None:
    if user.is_platform_superadmin:
        return
    org_role = await _org_role(user, event.org_id, db)
    if org_role in ("owner", "admin"):
        return
    eu = await db.scalar(select(EventUser).where(EventUser.event_id == event.id, EventUser.user_id == user.id))
    if not eu or eu.event_role != "manager":
        raise HTTPException(403, "You don't have access to Festio Live for this event")


class LiveGuestPassExchange(BaseModel):
    pass_token: str = Field(min_length=8, max_length=200)


class LiveGuestSession(BaseModel):
    token: str
    expires_in: int


@router.post("/{event_id}/live/guest-token", response_model=LiveGuestSession)
async def live_guest_token(
    event_id: str,
    data: LiveGuestPassExchange,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit(limit=120, window=60, scope="engagement_guest_token", key="event_id")),
):
    """Exchange a guest's own invite/pass token for a scoped Festio Live
    session. Same eligibility shape as the Guest Hub itself: if this event
    uses RSVP, the guest must be confirmed; if it doesn't, any resolved guest
    is eligible (mirrors InvitePage.jsx's isConfirmed logic)."""
    from ..config import settings
    if not settings.engagement_internal_token:
        raise HTTPException(503, "Festio Live is not configured")
    event = await db.get(Event, event_id)
    if not event or not event.engagement_enabled:
        raise HTTPException(404, "Festio Live is not available for this event")
    guest = await db.scalar(
        select(Guest).where(
            Guest.event_id == event_id,
            or_(Guest.invite_token == data.pass_token, Guest.qr_token == data.pass_token),
        ).limit(1)
    )
    if not guest:
        raise HTTPException(404, "Eligible guest pass not found")
    has_rsvp = event.rsvp_enabled is not False
    if has_rsvp and guest.rsvp_status != "confirmed":
        raise HTTPException(404, "Eligible guest pass not found")
    name = f"{guest.first_name} {guest.last_name}".strip()
    allowed_session_ids = (await db.execute(
        select(ExperienceStep.id)
        .join(ExperienceWorkflow, ExperienceWorkflow.id == ExperienceStep.workflow_id)
        .outerjoin(GuestExperienceProgress, (
            (GuestExperienceProgress.step_id == ExperienceStep.id)
            & (GuestExperienceProgress.guest_id == guest.id)
        ))
        .where(
            ExperienceWorkflow.event_id == event.id,
            ExperienceWorkflow.status == "published",
            ExperienceStep.enabled.is_(True),
            or_(ExperienceStep.is_segment.is_(True), ExperienceStep.type == "session_attendance"),
            or_(GuestExperienceProgress.id.is_(None), GuestExperienceProgress.status != "skipped"),
        )
    )).scalars().all()
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": guest.id,
        "name": name,
        "event_id": event.id,
        "org_id": event.org_id,
        "role": "guest",
        "identity_kind": "guest",
        "guest_admitted": bool(guest.admitted),
        "allowed_session_ids": list(allowed_session_ids),
        "session_scope_enforced": True,
        "iss": "guesthub",
        "aud": "engagement",
        "iat": now,
        "exp": now + timedelta(hours=6),
    }, settings.engagement_internal_token, algorithm="HS256")
    return LiveGuestSession(token=token, expires_in=21600)


class LiveAnonJoinIn(BaseModel):
    display_name: str = Field(default="", max_length=80)
    # Client-persisted device id (e.g. localStorage), so reopening the page
    # resumes the same participant instead of minting a new one every time.
    # A fresh one is generated and returned if the client doesn't have one yet.
    anon_id: str = Field(default="", max_length=64)


class LiveAnonJoinOut(BaseModel):
    token: str
    expires_in: int
    anon_id: str


class LiveJoinInfo(BaseModel):
    code: str
    url: str


class LiveJoinResolution(BaseModel):
    event_id: str


@router.get("/live/join/{join_code}", response_model=LiveJoinResolution)
async def resolve_live_join_code(
    join_code: str,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit(limit=600, window=60, scope="engagement_join_resolve", key="client_ip")),
):
    """Resolve the short public room code without exposing event metadata."""
    code = join_code.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{6}", code):
        raise HTTPException(404, "Festio Live event not found")
    event_id = await db.scalar(
        select(Event.id).where(Event.engagement_join_code == code, Event.engagement_enabled.is_(True)).limit(1)
    )
    if not event_id:
        raise HTTPException(404, "Festio Live event not found")
    return LiveJoinResolution(event_id=event_id)


@router.get("/{event_id}/live/join-info", response_model=LiveJoinInfo)
async def live_join_info(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return (and on first use mint) the stable short join code."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if not event.engagement_enabled:
        raise HTTPException(402, "Festio Live needs the Festio Live add-on. Buy it for this event to unlock it.", headers={"X-Required-Addon": "addon_engagement"})
    await _require_live_admin(event, user, db)
    code = await _ensure_live_join_code(event_id, db)
    return LiveJoinInfo(code=code, url=_live_join_url(code))


@router.get("/{event_id}/live/public-join-info", response_model=LiveJoinInfo)
async def public_live_join_info(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit(limit=120, window=60, scope="engagement_public_join_info", key="event_id")),
):
    """Public display-safe join data (the same information encoded in QR)."""
    code = await _ensure_live_join_code(event_id, db)
    return LiveJoinInfo(code=code, url=_live_join_url(code))


@router.post("/{event_id}/live/anon-token", response_model=LiveAnonJoinOut)
async def live_anon_token(
    event_id: str,
    data: LiveAnonJoinIn,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit(limit=120, window=60, scope="engagement_anon_token", key="event_id")),
):
    """Broadcast/QR join — no Guest record required, for a keynote-style
    audience where distributing per-guest Hub links isn't practical. Anyone
    with the join link or QR code gets a scoped session; the resulting
    ActivityParticipant is tracked by anon_id, never guest_id (see
    engagement-service's Identity.is_anonymous)."""
    from ..config import settings
    if not settings.engagement_internal_token:
        raise HTTPException(503, "Festio Live is not configured")
    event = await db.get(Event, event_id)
    if not event or not event.engagement_enabled:
        raise HTTPException(404, "Festio Live is not available for this event")
    anon_id = data.anon_id.strip() or secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": anon_id,
        "name": data.display_name.strip() or "Guest",
        "event_id": event.id,
        "org_id": event.org_id,
        "role": "guest",
        "identity_kind": "guest",
        "anon": True,
        "iss": "guesthub",
        "aud": "engagement",
        "iat": now,
        "exp": now + timedelta(hours=12),
    }, settings.engagement_internal_token, algorithm="HS256")
    return LiveAnonJoinOut(token=token, expires_in=43200, anon_id=anon_id)


@router.get("/{event_id}/live/registered-count")
async def live_registered_count(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit(limit=120, window=60, scope="engagement_registered_count", key="event_id")),
):
    """Public, display-safe -- just a headcount, no guest-identifying data --
    so a Display can show "N of TOTAL responded" as social proof. Same
    confirmed/registered definition InvitePage.jsx and the guest-pass
    exchange above use: RSVP-confirmed if the event uses RSVP, otherwise
    every resolved guest counts."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    query = select(func.count(Guest.id)).where(Guest.event_id == event_id)
    if event.rsvp_enabled is not False:
        query = query.where(Guest.rsvp_status == "confirmed")
    count = await db.scalar(query)
    return {"count": count or 0}


@router.get("/{event_id}/live/join-qr.png")
async def live_join_qr(event_id: str, db: AsyncSession = Depends(get_db)):
    """Public — QR code for the broadcast join link, meant to be put on a
    screen/slide so anyone in the room can scan in without a personal Hub link."""
    event = await db.get(Event, event_id)
    if not event or not event.engagement_enabled:
        return Response(status_code=404)
    code = await _ensure_live_join_code(event_id, db)
    join_url = _live_join_url(code)
    return Response(content=generate_qr_for_url(join_url), media_type="image/png")


class LiveShareLinkIn(BaseModel):
    role: Literal["presenter", "moderator", "analyst"]
    hours: int = Field(default=12, ge=1, le=48)


class LiveShareLinkOut(BaseModel):
    token: str
    code: str
    url: str
    expires_in: int
    role: str


@router.post("/{event_id}/live/share-link", response_model=LiveShareLinkOut)
async def live_share_link(event_id: str, body: LiveShareLinkIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Admin-minted, capability-scoped staff token for handing Live Control or
    Q&A moderation to someone without a Festio login — a co-presenter's phone,
    a volunteer at the mic. Same admin-resolution rule as /auth/live-token."""
    from ..config import settings
    if not settings.engagement_internal_token:
        raise HTTPException(503, "Festio Live is not configured")
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if not event.engagement_enabled:
        raise HTTPException(402, "Festio Live needs the Festio Live add-on. Buy it for this event to unlock it.", headers={"X-Required-Addon": "addon_engagement"})
    await _require_live_admin(event, user, db)
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": f"share:{body.role}:{secrets.token_hex(6)}",
        "name": f"{body.role.title()} link",
        "event_id": event.id,
        "org_id": event.org_id,
        "role": body.role,
        "capabilities": SHARE_LINK_CAPABILITIES[body.role],
        "identity_kind": "staff",
        "iss": "guesthub",
        "aud": "engagement",
        "iat": now,
        "exp": now + timedelta(hours=body.hours),
    }, settings.engagement_internal_token, algorithm="HS256")
    code = secrets.token_urlsafe(12)[:16]
    while await db.get(LiveAccessLink, code):
        code = secrets.token_urlsafe(12)[:16]
    db.add(LiveAccessLink(
        code=code, event_id=event.id, role=body.role, access_token=token,
        expires_at=now + timedelta(hours=body.hours), created_by=user.id,
    ))
    await db.commit()
    url = f"{(settings.public_base_url or 'https://festio.events').rstrip('/')}/p/{code}"
    return LiveShareLinkOut(token=token, code=code, url=url, expires_in=body.hours * 3600, role=body.role)


@router.get("/live/share/{code}", response_model=LiveShareLinkOut)
async def resolve_live_share_link(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit(limit=60, window=60, scope="engagement_share_resolve", key="client_ip")),
):
    """Exchange a short opaque presenter/moderator link for its scoped JWT."""
    link = await db.get(LiveAccessLink, code)
    now = datetime.now(timezone.utc)
    if not link:
        raise HTTPException(404, "Festio Live link not found")
    expires_at = link.expires_at if link.expires_at.tzinfo else link.expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise HTTPException(410, "This Festio Live link has expired")
    from ..config import settings
    url = f"{(settings.public_base_url or 'https://festio.events').rstrip('/')}/p/{link.code}"
    return LiveShareLinkOut(token=link.access_token, code=link.code, url=url, expires_in=max(0, int((expires_at - now).total_seconds())), role=link.role)
