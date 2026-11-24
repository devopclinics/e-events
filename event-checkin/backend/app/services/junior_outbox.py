"""Durable guardian notices. Uncertain sends require review, never blind retry."""
import logging
import asyncio
from datetime import datetime, timedelta
from html import escape
from sqlalchemy import select
from ..database import AsyncSessionLocal
from ..config import settings
from ..models import Event, EmailDeliveryEvent, MessageCreditLedger
from ..junior_models import JuniorConfig, JuniorContact, JuniorNotification
from ..entitlements import reserve_message_credit, last_credit_ledger_id, can_use_paid_channels
from .public_event_policy import event_communications_blocked
from services import messaging
from services.email_service import send_simple_email
from services.outbound_safety import recipient_allowed

logger=logging.getLogger(__name__)


async def transport(row):
    if row.channel=='email':
        ok=await send_simple_email(row.recipient,'Junior Platform update',f'<p>{escape(row.body)}</p>',
            event_id=row.event_id,message_kind='junior:'+row.id)
        return {'accepted':bool(ok)}
    context=messaging._event_context.set(row.event_id)
    try:
        result=await messaging.send_custom_sms(phone=row.recipient,body=row.body)
    finally:
        messaging._event_context.reset(context)
    if not isinstance(result,dict):return {'accepted':False}
    status=str(result.get('status') or '').lower()
    return {'accepted':bool(result.get('provider_message_id')) and status not in ('failed','undelivered','error','rejected'),
        'provider_id':result.get('provider_message_id'),'provider':result.get('provider')}


async def deliver(notification_id, sessions=None, sender=None):
    sessions=sessions or AsyncSessionLocal
    sender=sender or transport
    async with sessions() as db:
        row=await db.scalar(select(JuniorNotification).where(JuniorNotification.id==notification_id).with_for_update(skip_locked=True))
        if not row or row.status!='queued':return
        event=await db.scalar(select(Event).where(Event.id==row.event_id).with_for_update())
        earlier=await db.scalar(select(JuniorNotification.id).where(
            JuniorNotification.event_id==row.event_id,JuniorNotification.contact_id==row.contact_id,
            JuniorNotification.channel==row.channel,JuniorNotification.status.in_(['queued','sending']),
            JuniorNotification.created_at<row.created_at).limit(1))
        if earlier:return
        config=await db.get(JuniorConfig,row.event_id)
        contact=await db.get(JuniorContact,row.contact_id) if row.contact_id else None
        reason=None
        if not event or not event.junior_program_enabled or not config or not config.notifications_enabled:
            reason='Junior Programme sending is paused'
        elif await event_communications_blocked(event,db):reason='Event communications are blocked'
        elif row.created_at < datetime.utcnow()-timedelta(hours=24):reason='Historical update expired; review instead of sending'
        elif not contact or not contact.notify:reason='Guardian notifications no longer authorized'
        elif row.recipient!=getattr(contact,'email' if row.channel=='email' else 'phone'):reason='Guardian contact changed; review recipient'
        elif not row.recipient:reason='Missing guardian contact'
        elif row.channel in (event.blocked_messaging_channels or []):reason='Channel blocked'
        elif not recipient_allowed(row.channel,row.recipient):reason='Recipient blocked by outbound policy'
        elif row.channel=='email' and sender is transport and not (settings.resend_api_key or settings.smtp_host or (settings.bird_email_api_base and settings.bird_access_key and settings.bird_workspace_id)):
            reason='Email provider setup required'
        elif row.channel=='sms' and not contact.sms_consent:reason='Guardian SMS permission not recorded'
        elif row.channel=='sms' and not messaging._channel_ready('sms',row.recipient):reason='SMS provider setup required'
        elif row.channel=='sms' and not can_use_paid_channels(event):reason='Paid messaging is not available'
        if reason:
            row.status='setup_required';row.error=reason
            await db.commit();return
        if not await reserve_message_credit(event,row.channel,db=db,reason='junior_update',provider_message_id='junior:'+row.id):
            row.status='setup_required';row.error='Message credits required'
            await db.commit();return
        row.ledger_id=last_credit_ledger_id(event)
        row.status='sending';row.attempted_at=datetime.utcnow()
        await db.commit()
    # A crash or timeout may mean provider acceptance: retain uncertainty.
    try:
        result=await sender(row)
        status='accepted' if result.get('accepted') else 'review_required'
        error=None if status=='accepted' else 'Provider outcome unconfirmed; reconcile before resending'
    except Exception:
        logger.exception('Junior notification outcome uncertain id=%s',notification_id)
        result={};status='review_required';error='Provider outcome unconfirmed; reconcile before resending'
    async with sessions() as db:
        saved=await db.get(JuniorNotification,notification_id)
        saved.status=status;saved.error=error;saved.provider_id=result.get('provider_id')
        if saved.ledger_id:
            ledger=await db.get(MessageCreditLedger,saved.ledger_id)
            if ledger and saved.provider_id:
                ledger.provider=result.get('provider');ledger.provider_message_id=saved.provider_id;ledger.status='queued'
        await db.commit()


async def receipts(db):
    rows=(await db.scalars(select(JuniorNotification).where(JuniorNotification.status.in_(['accepted','sending'])).order_by(JuniorNotification.receipt_checked_at.asc().nullsfirst(),JuniorNotification.created_at).limit(200))).all()
    for row in rows:
        row.receipt_checked_at=datetime.utcnow()
        if row.status=='sending':
            if row.attempted_at and row.attempted_at<datetime.utcnow()-timedelta(minutes=5):
                row.status='review_required';row.error='Interrupted send; reconcile provider outcome before resending'
            continue
        if row.channel=='email':
            receipt=await db.scalar(select(EmailDeliveryEvent).where(EmailDeliveryEvent.event_id==row.event_id,
                EmailDeliveryEvent.message_kind=='junior:'+row.id).order_by(EmailDeliveryEvent.occurred_at.desc()).limit(1))
            if receipt and receipt.provider_email_id:row.provider_id=receipt.provider_email_id
            if receipt and receipt.status in ('delivered','bounced','failed','complained'):
                row.status='delivered' if receipt.status=='delivered' else 'failed'
                row.error=None if row.status=='delivered' else 'Provider reported '+receipt.status
        elif row.ledger_id:
            ledger=await db.get(MessageCreditLedger,row.ledger_id)
            if ledger and ledger.status=='delivered':row.status='delivered'
            elif ledger and ledger.status in ('refunded','failed','undelivered','rejected'):
                row.status='failed';row.error='Provider reported delivery failure; review before retrying'
    await db.commit()


async def tick():
    async with AsyncSessionLocal() as db:
        await receipts(db)
        ids=(await db.scalars(select(JuniorNotification.id).where(JuniorNotification.status=='queued').order_by(JuniorNotification.created_at).limit(20))).all()
    semaphore=asyncio.Semaphore(4)
    async def one(row_id):
        async with semaphore:
            try:await deliver(row_id)
            except Exception:logger.exception('Junior notification claim failed id=%s',row_id)
    await asyncio.gather(*(one(row_id) for row_id in ids))


async def run():
    while True:
        try:
            await tick()
        except Exception:
            logger.exception('Junior notification worker tick failed')
        await asyncio.sleep(10)
