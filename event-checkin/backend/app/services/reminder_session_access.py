"""Opt-in, current guest session permissions for personalized reminder emails."""
from html import escape
from sqlalchemy import select
from app.models import GuestSessionAccess, Zone
from app.services.session_access import session_decision

TOKENS = ('session_access_label', 'session_access_description', 'session_access_schedule')

async def reminder_session_context(event, guest, db):
    config = (event.setup_preferences or {}).get('reminder_session_access') or {}
    if not config:
        raise ValueError('Session reminder configuration is missing; review before sending.')
    if guest.rsvp_status == 'declined':
        raise ValueError('Registration declined; do not send a session reminder.')
    decisions = {}
    for key in ('conference', 'dinner'):
        zone_id = config.get(key + '_zone_id')
        zone = await db.get(Zone, zone_id) if zone_id else None
        if not zone or zone.event_id != event.id or not zone.is_active:
            raise ValueError('Session reminder zone is unavailable; review before sending.')
        rule = await db.scalar(select(GuestSessionAccess).where(
            GuestSessionAccess.event_id == event.id,
            GuestSessionAccess.guest_id == guest.id,
            GuestSessionAccess.zone_id == zone_id,
        ))
        decision = rule.decision if rule else 'review'
        if decision == 'allow':
            allowed, _ = await session_decision(event, guest, zone_id, db)
            if not allowed: decision = 'review'  # Parent/group restrictions still win.
        decisions[key] = decision
    if decisions['conference'] != 'allow' or decisions['dinner'] not in ('allow', 'block'):
        raise ValueError('Session access unresolved; review before sending this reminder.')
    both = decisions['dinner'] == 'allow'
    conference_time = escape(config.get('conference_time', ''))
    dinner_time = escape(config.get('dinner_time', ''))
    timezone = escape(config.get('timezone_label', ''))
    if not all((conference_time, dinner_time, timezone)):
        raise ValueError('Session reminder times are missing; review before sending.')
    schedule = f'<strong>Conference</strong> · {conference_time}'
    description = f'Your pass includes Conference at {conference_time}.'
    if both:
        schedule += f'<br><strong>Gala Dinner</strong> · From {dinner_time}'
        description = f'Your pass includes Conference at {conference_time} and Gala Dinner from {dinner_time}.'
    return {
        'session_access_label': 'Conference + Dinner' if both else 'Conference Only',
        'session_access_description': description,
        'session_access_schedule': schedule + f'<br><span style="font-size:13px">All times are {timezone}.</span>',
    }
