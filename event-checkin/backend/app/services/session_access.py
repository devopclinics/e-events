"""One session decision shared by manual and gate scanners. Entry only."""
from sqlalchemy import select
from app.models import Event, Zone, GuestSessionAccess

def restricted_sessions(event):
    return (event.setup_preferences or {}).get('restricted_session_ids', [])

async def session_decision(event, guest, zone_id, db):
    row = await db.scalar(select(GuestSessionAccess).where(GuestSessionAccess.event_id == event.id, GuestSessionAccess.guest_id == guest.id, GuestSessionAccess.zone_id == zone_id))
    if row and row.decision == 'block':
        return False, 'Blocked from this session by the organiser'
    if zone_id in restricted_sessions(event) and (not row or row.decision != 'allow'):
        return False, 'Session access needs organiser approval'
    return True, None


async def attach_session_access(guests, event_id, db):
    """Batch-decorate guest directory rows; never imply unrestricted is allowed."""
    event = await db.get(Event, event_id)
    restricted = set(restricted_sessions(event)) if event else set()
    zones = (await db.scalars(select(Zone).where(
        Zone.event_id == event_id, Zone.is_active.is_(True)
    ).order_by(Zone.sort_order, Zone.name))).all()
    decisions = (await db.scalars(select(GuestSessionAccess).where(
        GuestSessionAccess.event_id == event_id
    ))).all()
    by_guest_zone = {(d.guest_id, d.zone_id): d.decision for d in decisions}
    relevant = restricted | {d.zone_id for d in decisions if d.decision != 'review'}
    for guest in guests:
        guest.session_access = [dict(
            zone_id=z.id, name=z.name, restricted=z.id in restricted,
            decision=by_guest_zone.get((guest.id, z.id), 'review')
        ) for z in zones if z.id in relevant]
