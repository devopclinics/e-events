"""One session decision shared by manual and gate scanners. Entry only."""
from sqlalchemy import select
from app.models import Event, Zone, GuestSessionAccess

def restricted_sessions(event):
    return (event.setup_preferences or {}).get('restricted_session_ids', [])

async def session_decision(event, guest, zone_id, db):
    row = await db.scalar(select(GuestSessionAccess).where(GuestSessionAccess.event_id == event.id, GuestSessionAccess.guest_id == guest.id, GuestSessionAccess.zone_id == zone_id))
    if row and row.decision == 'block':
        zone = await db.get(Zone, zone_id)
        name = zone.name if zone else 'this session'
        return False, f'Blocked from {name}. This does not cancel event registration. Please visit the event help desk to review session access.'
    if zone_id in restricted_sessions(event) and (not row or row.decision != 'allow'):
        zone = await db.get(Zone, zone_id)
        name = zone.name if zone else 'This session'
        return False, f'{name} access needs organiser approval. Event registration is unchanged. Please visit the event help desk.'
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


def session_seating_mode(event, zone_id):
    return (event.setup_preferences or {}).get('session_seating_modes', {}).get(zone_id, 'default')


def seating_at_admission(event):
    """An explicit session plan moves seat allocation out of general admission."""
    return not (event.setup_preferences or {}).get('session_seating_modes')


async def prepare_session_seating(event, guest, zone_id, db):
    """Reserve a Dinner seat only after session authorization. Caller commits entry."""
    mode = session_seating_mode(event, zone_id)
    if mode in ('default', 'none'):
        return None
    from sqlalchemy.exc import IntegrityError
    from app.models import SeatingTable, TableGroup
    from app.routers.seating import assign_next_seat
    if not event.seating_enabled:
        return 'Seating is not enabled. Ask the seating desk to review this session.'
    table = await db.get(SeatingTable, guest.table_id) if guest.table_id else None
    if guest.table_id and (not table or table.event_id != event.id):
        return 'Assigned table is unavailable. Please visit the seating desk.'
    if mode == 'assigned' and not table:
        return 'No table assigned. Please visit the seating desk before entering.'
    if table and guest.seat_number:
        if not guest.seat_number.isdigit() or not 1 <= int(guest.seat_number) <= table.capacity:
            return 'Assigned seat is outside the table capacity. Please visit the seating desk.'
        return None
    class SeatingDenied(Exception):
        pass
    try:
        async with db.begin_nested():
            if not guest.table_id and not guest.assigned_table_group_id and event.default_guest_table_group_id:
                group = await db.get(TableGroup, event.default_guest_table_group_id)
                if group and group.event_id == event.id:
                    guest.assigned_table_group_id = group.id
            error = await assign_next_seat(guest, db)
            if error or not guest.table_id or not guest.seat_number:
                raise SeatingDenied(error or 'No Dinner table or seat is available. Please visit the seating desk.')
            await db.flush()
    except SeatingDenied as error:
        await db.refresh(guest)
        return str(error)
    except IntegrityError:
        await db.refresh(guest)
        return 'That seat was just taken. Please scan again or visit the seating desk.'
    return None
