"""Shared scope checks. Assignments grant operations, not event-wide admin rights."""
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import select
from ..models import EventUser, GuestServiceAssignment
from ..auth import _org_role


def active_assignment(row, now=None):
    now = now or datetime.utcnow()
    return (row.starts_at is None or row.starts_at <= now) and (row.ends_at is None or now < row.ends_at)


async def supervisor(event, actor, db, *, write=False):
    if actor.is_platform_superadmin:
        return True
    role = await _org_role(actor, event.org_id, db)
    if role in ('owner', 'admin'):
        return True
    eu = await db.scalar(select(EventUser).where(EventUser.event_id == event.id, EventUser.user_id == actor.id))
    return bool(role and eu and eu.event_role == 'manager' and (not write or eu.access_level != 'view'))


async def member(event, actor, db):
    if not event or await _org_role(actor, event.org_id, db) is None:
        if not (event and actor.is_platform_superadmin):
            raise HTTPException(404, 'Event not found')
    return await db.scalar(select(EventUser).where(EventUser.event_id == event.id, EventUser.user_id == actor.id))


async def assignments_for(event, actor, db):
    eu = await member(event, actor, db)
    if not eu or (eu.event_role == "manager" and eu.access_level == "view"):
        return []
    rows = (await db.scalars(select(GuestServiceAssignment).where(GuestServiceAssignment.event_user_id == eu.id))).all()
    return [row for row in rows if active_assignment(row)]


async def guest_scope(event, actor, guest, db, *, permission=None):
    await member(event, actor, db)
    if await supervisor(event, actor, db, write=bool(permission)):
        return
    rows = await assignments_for(event, actor, db)
    if not any(row.table_id and row.table_id == guest.table_id and (not permission or getattr(row, permission)) for row in rows):
        raise HTTPException(403, 'This guest or action is outside your active table assignments')


async def enforce_scoped_scan(event, actor, db, *, guest=None, operation='checkin', zone_id=None):
    if not event or await supervisor(event, actor, db, write=True):
        return
    eu = await db.scalar(select(EventUser).where(EventUser.event_id == event.id, EventUser.user_id == actor.id))
    if await _org_role(actor, event.org_id, db) is None:
        return  # Preserve the legacy scanner's own tenant-denial response contract.
    if not eu or not eu.guest_service_scoped:
        return  # Existing scanner staff keep their established access.
    rows = await assignments_for(event, actor, db)
    if operation == 'zone' and any(r.zone_id == zone_id and r.can_scan_zone for r in rows):
        return
    if operation == 'checkin' and guest and any(r.table_id == guest.table_id and r.table_id and r.can_checkin for r in rows):
        return
    raise HTTPException(403, 'Use your active Guest Services assignments; this scan is not permitted')
