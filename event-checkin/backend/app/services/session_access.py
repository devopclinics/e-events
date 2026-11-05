"""One session decision shared by manual and gate scanners. Entry only."""
from sqlalchemy import select
from app.models import GuestSessionAccess

def restricted_sessions(event):
    return (event.setup_preferences or {}).get('restricted_session_ids', [])

async def session_decision(event, guest, zone_id, db):
    row = await db.scalar(select(GuestSessionAccess).where(GuestSessionAccess.event_id == event.id, GuestSessionAccess.guest_id == guest.id, GuestSessionAccess.zone_id == zone_id))
    if row and row.decision == 'block':
        return False, 'Blocked from this session by the organiser'
    if zone_id in restricted_sessions(event) and (not row or row.decision != 'allow'):
        return False, 'Session access needs organiser approval'
    return True, None
