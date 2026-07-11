"""The event <-> FestioMe bridge — the ONLY place FestioMe touches event models.
Everything crossing the boundary goes through here so the rest of the module stays
event-agnostic and extractable.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

# The one sanctioned import of event business models.
from ..models import Guest, Event
from ..auth import _org_role
from .models import FestiomeGroup, FestiomeMember


async def user_is_event_admin(user_id: str, event_id: str, db: AsyncSession) -> bool:
    """True if the Festio user is an owner/admin of the event's org. Used to gate
    creating an event-linked group and reading event integration status."""
    event = await db.get(Event, event_id)
    if not event:
        return False
    from ..models import User
    user = await db.get(User, user_id)
    if not user:
        return False
    if user.is_platform_superadmin:
        return True
    return (await _org_role(user, event.org_id, db)) in ("owner", "admin")


def guest_eligible(guest: Guest, event: Event) -> bool:
    """Explicit eligibility to join an event's community group. Admitted or
    confirmed guests are always eligible; in closed (invitation-only) events an
    invited guest is the intended audience, so they're eligible too. Open-event
    guests who haven't confirmed are NOT eligible until they RSVP."""
    if getattr(guest, "admitted", False):
        return True
    status = (guest.rsvp_status or "").lower()
    if status == "confirmed":
        return True
    if event.invite_mode == "closed" and status in ("invited", "confirmed"):
        return True
    return False


async def resolve_guest_token(token: str, db: AsyncSession) -> Optional[dict]:
    """Resolve a guest's pass token (invite_token or qr_token) → identity dict."""
    guest = (await db.execute(select(Guest).where(
        or_(Guest.invite_token == token, Guest.qr_token == token)))).scalar_one_or_none()
    if not guest:
        return None
    name = f"{guest.first_name or ''} {guest.last_name or ''}".strip() or "Guest"
    return {"guest_id": guest.id, "name": name, "event_id": guest.event_id}


async def ensure_event_group(event_id: str, db: AsyncSession, *, name: str | None = None) -> Optional[FestiomeGroup]:
    """Get or create the community group for an event."""
    grp = (await db.execute(select(FestiomeGroup).where(
        FestiomeGroup.event_id == event_id))).scalar_one_or_none()
    if grp:
        return grp
    event = await db.get(Event, event_id)
    if not event:
        return None
    grp = FestiomeGroup(event_id=event_id, org_id=getattr(event, "org_id", None),
                        name=name or f"{event.name} — Community", created_by="")
    db.add(grp)
    await db.commit()
    await db.refresh(grp)
    return grp


async def ensure_guest_member(event_id: str, guest_id: str, name: str,
                              db: AsyncSession) -> tuple[Optional[FestiomeGroup], Optional[FestiomeMember]]:
    """Ensure the event group exists and — if the guest is eligible and not
    previously removed — that they're a member. Idempotent.

    Returns (group, member). A None member means "not joined": either the guest
    isn't eligible yet, or an admin removed them (removals are NOT auto-undone —
    only ``restore_member`` brings a removed guest back)."""
    grp = await ensure_event_group(event_id, db)
    if not grp:
        return None, None
    member = (await db.execute(select(FestiomeMember).where(
        FestiomeMember.group_id == grp.id, FestiomeMember.guest_ref == guest_id))).scalar_one_or_none()
    if member is not None:
        # A removed guest stays out until an admin restores them.
        return grp, (member if member.removed_at is None else None)
    guest = await db.get(Guest, guest_id)
    event = await db.get(Event, event_id)
    if not guest or not event or not guest_eligible(guest, event):
        return grp, None
    member = FestiomeMember(group_id=grp.id, guest_ref=guest_id, display_name=name, role="member")
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return grp, member


async def restore_member(member: FestiomeMember, db: AsyncSession) -> None:
    """Admin action: bring a previously removed member back."""
    member.removed_at = None
    member.joined_at = datetime.utcnow()
    await db.commit()


async def event_group_status(event_id: str, db: AsyncSession) -> dict:
    """Admin-facing status for an event, without exposing FestioMe internals."""
    grp = (await db.execute(select(FestiomeGroup).where(
        FestiomeGroup.event_id == event_id))).scalar_one_or_none()
    if not grp:
        return {"linked": False, "group_id": None, "member_count": 0}
    from sqlalchemy import func
    mc = (await db.scalar(select(func.count()).select_from(FestiomeMember).where(
        FestiomeMember.group_id == grp.id, FestiomeMember.removed_at.is_(None)))) or 0
    return {"linked": True, "group_id": grp.id, "member_count": mc, "name": grp.name}
