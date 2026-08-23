"""Token exchange for Festio Live (engagement-service) guest participation.

Mints a scoped JWT the same way /auth/live-token does for staff — this file
exists separately (not in auth.py) because it's guest-facing and rate-limited
like festiome.py's guest-token exchange, not an authenticated-staff endpoint.
Backend never calls engagement-service itself; this is the only place backend
touches Festio Live at all, and it's a pure token mint, not a proxied call.
"""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, _org_role
from ..database import get_db
from ..models import Event, EventUser, Guest, User
from ..ratelimit import rate_limit

router = APIRouter(tags=["engagement"])

# Presenter can drive Live Control (advance questions, change activity status)
# without the full admin surface (editing/deleting questions, deleting
# activities); Moderator can only triage the Q&A wall; Analyst is read-only,
# which every staff-scoped GET endpoint already allows with no extra
# capability needed. See engagement-service/app/auth.py's require_capability.
SHARE_LINK_CAPABILITIES = {"presenter": ["control"], "moderator": ["moderate"], "analyst": []}


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
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": guest.id,
        "name": name,
        "event_id": event.id,
        "org_id": event.org_id,
        "role": "guest",
        "identity_kind": "guest",
        "guest_admitted": bool(guest.admitted),
        "iss": "guesthub",
        "aud": "engagement",
        "iat": now,
        "exp": now + timedelta(hours=6),
    }, settings.engagement_internal_token, algorithm="HS256")
    return LiveGuestSession(token=token, expires_in=21600)


class LiveShareLinkIn(BaseModel):
    role: Literal["presenter", "moderator", "analyst"]
    hours: int = Field(default=12, ge=1, le=48)


class LiveShareLinkOut(BaseModel):
    token: str
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
    is_admin = user.is_platform_superadmin
    if not is_admin:
        org_role = await _org_role(user, event.org_id, db)
        is_admin = org_role in ("owner", "admin")
    if not is_admin:
        eu = await db.scalar(select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == user.id))
        is_admin = bool(eu and eu.event_role == "manager")
    if not is_admin:
        raise HTTPException(403, "You don't have access to Festio Live for this event")
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
    return LiveShareLinkOut(token=token, expires_in=body.hours * 3600, role=body.role)
