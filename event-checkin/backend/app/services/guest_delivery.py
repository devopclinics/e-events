"""Read-only, event-scoped delivery evidence. Never infer delivery from a timestamp."""
from sqlalchemy import select
from ..models import EmailDeliveryEvent, MessageCreditLedger, EventMessageDeliveryLog
CHANNELS = ('email', 'whatsapp', 'sms', 'mms')

def state(value):
    value = (value or '').lower()
    if value == 'read': return 'read'
    if value in ('delivered','opened','clicked'): return 'delivered'
    if value in ('failed', 'rejected', 'undelivered', 'expired', 'bounced', 'complained', 'suppressed'): return 'failed'
    if value in ('queued', 'pending', 'reserved', 'requested', 'delayed', 'deferred'): return 'pending'
    if value in ('sent', 'submitted', 'accepted'): return 'accepted'
    if value == 'not_selected': return 'not_selected'
    if value == 'skipped': return 'skipped'
    return 'unknown'

def contact_reason(event, guest, channel):
    if channel in (getattr(event, 'blocked_messaging_channels', None) or []): return 'Blocked by platform policy'
    if not getattr(event, 'notify_' + channel, False): return 'Channel disabled in event settings'
    if not (guest.email if channel == 'email' else guest.phone):
        return 'Missing email address' if channel == 'email' else 'Missing phone number'
    if channel != 'email' and not getattr(guest, 'whatsapp_consent' if channel == 'whatsapp' else 'sms_consent', False):
        return 'Messaging consent not recorded'
    return None

async def evidence(db, event_id, guest_ids):
    if not guest_ids: return []
    output = []
    for r in (await db.scalars(select(EmailDeliveryEvent).where(EmailDeliveryEvent.event_id == event_id, EmailDeliveryEvent.guest_id.in_(guest_ids)))).all():
        output.append(dict(id=r.id,guest_id=r.guest_id,channel='email',status=state(r.status),raw_status=r.status,kind=r.message_kind or 'Email',at=r.occurred_at,recipient=r.recipient,provider=r.provider,reference=r.provider_email_id,reason=r.error_message,source='email_provider'))
    for r in (await db.scalars(select(MessageCreditLedger).where(MessageCreditLedger.event_id == event_id, MessageCreditLedger.guest_id.in_(guest_ids), MessageCreditLedger.channel.in_(CHANNELS), MessageCreditLedger.action.in_(('spend','reserve','refund'))))).all():
        # A refund proves a credit reversal, not necessarily provider rejection.
        value = 'failed' if r.status == 'failed' else ('unknown' if r.action == 'refund' else state(r.status))
        output.append(dict(id=r.id,guest_id=r.guest_id,channel=r.channel,status=value,raw_status=r.status,kind=r.reason or 'Message',at=r.updated_at or r.created_at,recipient=None,provider=r.provider,reference=r.provider_message_id,reason='Credits refunded; inspect provider outcome' if r.action == 'refund' else None,source='credit_ledger'))
    for r in (await db.scalars(select(EventMessageDeliveryLog).where(EventMessageDeliveryLog.event_id == event_id, EventMessageDeliveryLog.guest_id.in_(guest_ids), EventMessageDeliveryLog.channel.in_(CHANNELS)))).all():
        output.append(dict(id=r.id,guest_id=r.guest_id,channel=r.channel,status=state(r.status),raw_status=r.status,kind='Guest message' if r.message_id else 'Announcement' if r.announcement_id else 'Invitation dispatch',at=r.updated_at or r.created_at,recipient=r.recipient,provider=r.provider,reference=r.provider_message_id,reason=r.error_message,source='dispatch_log'))
    return sorted(output, key=lambda item: item['at'], reverse=True)

def guest_summary(event, guest, records):
    channels = {}
    for channel in CHANNELS:
        history = [r for r in records if r['guest_id'] == guest.id and r['channel'] == channel]
        latest = history[0] if history else None
        delivered = next((r for r in history if r['status'] in ('read','delivered')), None)
        channels[channel] = dict(status=latest['status'] if latest else 'not_attempted', at=latest['at'] if latest else None, reason=latest['reason'] if latest else None, contact_issue=contact_reason(event,guest,channel), prior_delivery_at=delivered['at'] if delivered else None)
    return dict(id=guest.id,name=' '.join(filter(None,(guest.first_name,guest.last_name))),email=guest.email,phone=guest.phone,channels=channels)
