"""Opt-in session check-in receipts. Test audiences remain explicit and scoped."""
import html
import logging
from services import messaging
from services.email_service import send_admission_email
from services.credit_ledger import send_with_credit_ledger
from app.channels import channels_for_flow
from app.entitlements import can_use_paid_channels, reserve_message_credit, last_credit_ledger_id
from app.services.session_access import session_seating_mode

logger = logging.getLogger(__name__)


async def _send_email(data):
    try:
        await send_admission_email(data)
    except Exception:
        logger.exception('Session check-in email failed for guest=%s', data['guest_id'])


async def queue_session_receipt(tasks, event, guest, zone, scan, table_name, db):
    config = (event.setup_preferences or {}).get('session_checkin_notifications') or {}
    if not config.get('enabled'):
        return {}
    if config.get('audience') != 'all' and guest.id not in config.get('test_guest_ids', []):
        return {}
    if zone.id not in config.get('zone_ids', []):
        return {}
    channels = channels_for_flow(event, guest, 'session_checkin', paid_ok=can_use_paid_channels(event))
    name = (config.get('session_names') or {}).get(zone.id) or f'{event.name} — {zone.name}'
    seated = session_seating_mode(event, zone.id) in ('event', 'assigned')
    table_name = table_name if seated else None
    seat_number = guest.seat_number if seated else None
    base = (event.checkin_base_url or '').rstrip('/')
    token = guest.invite_token or guest.qr_token
    hub_url = f'{base}/r/{token}#/pass' if base and token else None
    result = {}
    if 'email' in channels:
        subject = f'{zone.name} check-in confirmed · {event.name}'
        intro = (f'<h1 style="margin:0 0 10px">Welcome, {html.escape(guest.first_name)}!</h1>'
                 f'<p style="font-size:18px;margin:0">You are checked in to {html.escape(name)}.</p>')
        if not seated:
            intro += '<p>Please proceed to the conference seating area. No table assignment is required.</p>'
        else:
            intro += '<p>Your table and seat are shown below. An usher can help you find your place.</p>'
        data = dict(session_receipt=True, guest_id=guest.id, event_id=event.id, first_name=guest.first_name,
                    last_name=guest.last_name, email=guest.email, phone=guest.phone,
                    admitted_at=scan.scanned_at, event_timezone=event.timezone,
                    table_name=table_name, seat_number=seat_number, menu_choices=[],
                    menu_enabled=False, seating_term='Table', seat_term='Seat',
                    event_name=name, message_kind=f'session_checkin:{zone.id}',
                    subject_override=subject, intro_block_override=intro, hub_url=hub_url)
        tasks.add_task(_send_email, data)
        result['email'] = 'queued'
    if 'whatsapp' in channels:
        refs = config.get('whatsapp_templates') or {}
        ref = refs.get('table' if seated else 'link')
        if not ref or (not seated and not hub_url):
            result['whatsapp'] = 'template_not_configured'
        elif not messaging._channel_ready('whatsapp', guest.phone):
            result['whatsapp'] = 'channel_unavailable'
        elif await reserve_message_credit(event, 'whatsapp', db=db,
                    reason=f'session_checkin:{zone.id}:{scan.id}', guest_id=guest.id):
            keys = ['firstName', 'eventName', 'tableName', 'seatNumber'] if seated else ['firstName', 'eventName', 'hubLink']
            values = [guest.first_name, name, table_name or '—', seat_number or '—'] if seated else [guest.first_name, name, hub_url]
            tasks.add_task(send_with_credit_ledger, last_credit_ledger_id(event), messaging._bird_whatsapp_send,
                           phone=guest.phone, template=ref, params=values, var_keys=keys)
            result['whatsapp'] = 'queued'
        else:
            result['whatsapp'] = 'insufficient_credits'
    await db.commit()
    return result
