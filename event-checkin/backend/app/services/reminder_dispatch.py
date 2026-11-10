"""Read-only preflight for a saved reminder; no provider calls or reservations."""
import hashlib
import json
from sqlalchemy import select
from ..models import Guest, WhatsAppTemplateSubmission, Organization
from ..config import settings
from ..organization_entitlements import channel_credit_units
from ..entitlements import can_use_paid_channels, channel_weight
from .reminder_session_access import TOKENS, reminder_session_context

async def dispatch_summary(event, reminder, db):
    guests = (await db.scalars(select(Guest).where(Guest.event_id == event.id).order_by(Guest.id))).all()
    audience = [g for g in guests if not g.is_test and (not reminder.audience_rsvp_statuses or g.rsvp_status in reminder.audience_rsvp_statuses)]
    counts = {c: 0 for c in reminder.channels}
    blockers = []
    blocked = set(event.blocked_messaging_channels or [])
    if not counts or any(c not in ('email', 'sms', 'whatsapp') for c in counts):
        blockers.append('Choose Email, SMS or WhatsApp before sending.')
    if 'email' in counts and not (reminder.email_body or '').strip(): blockers.append('Email content is empty.')
    if 'sms' in counts and not (reminder.sms_body or '').strip(): blockers.append('SMS content is empty.')
    if 'whatsapp' in counts:
        ref = reminder.whatsapp_template_ref or ''
        project, _, version = ref.partition(':')
        template = await db.scalar(select(WhatsAppTemplateSubmission).where(WhatsAppTemplateSubmission.bird_project_id == project, WhatsAppTemplateSubmission.bird_channel_template_id == version, WhatsAppTemplateSubmission.status == 'approved', (WhatsAppTemplateSubmission.org_id == event.org_id) | WhatsAppTemplateSubmission.is_shared.is_(True)))
        if not template: blockers.append('Select an approved WhatsApp template before sending.')
        elif any(not (reminder.whatsapp_template_vars or {}).get(k) for k in template.variables): blockers.append('Fill in the WhatsApp template variables.')
    session_tokens = any('{{' + token + '}}' in (reminder.email_body or '') for token in TOKENS)
    reachable = 0
    snapshot = []
    for guest in audience:
        access = {}
        if session_tokens:
            try: access = await reminder_session_context(event, guest, db)
            except ValueError: blockers.append('Some guests have unresolved session access. Review their Conference/Dinner permissions.'); continue
        destinations = {
            'email': bool(event.notify_email and guest.email),
            'sms': bool(event.notify_sms and guest.phone and guest.sms_consent and can_use_paid_channels(event)),
            'whatsapp': bool(event.notify_whatsapp and guest.phone and guest.whatsapp_consent and can_use_paid_channels(event)),
        }
        available = [c for c in counts if c not in blocked and destinations.get(c)]
        for c in available: counts[c] += 1
        reachable += bool(available)
        snapshot.append([guest.id, guest.first_name, guest.last_name, guest.email, guest.phone, guest.rsvp_status, guest.qr_token, guest.invite_token, available, access])
    for c in counts:
        if c in blocked or not getattr(event, 'notify_' + c, False): blockers.append(c.title() + ' notifications are disabled for this event.')
        elif c in ('sms', 'whatsapp') and not can_use_paid_channels(event): blockers.append('Paid messaging is unavailable for this event.')
    if settings.organization_entitlements_v2:
        org = await db.get(Organization, event.org_id)
        needed = sum(count * channel_credit_units(channel, channel_weight(channel, org_id=event.org_id)) for channel, count in counts.items())
        if not org or needed > int(org.message_credit_units or 0):
            blockers.append('Insufficient messaging credits for the selected audience and channels.')
    fields = {key: getattr(reminder, key) for key in ('id', 'updated_at', 'subject', 'email_body', 'sms_body', 'whatsapp_body', 'whatsapp_template_ref', 'whatsapp_template_vars', 'channels', 'audience_rsvp_statuses')}
    token = hashlib.sha256(json.dumps([fields, snapshot, counts, sorted(set(blockers))], sort_keys=True, default=str).encode()).hexdigest()
    return {'audience': len(audience), 'reachable_guests': reachable, 'unreachable_guests': len(audience) - reachable, 'excluded_test_guests': sum(bool(g.is_test) for g in guests), 'channels': counts, 'blockers': sorted(set(blockers)), 'confirmation_token': token}
