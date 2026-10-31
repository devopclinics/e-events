"""Durable, multi-replica-safe email queue for explicitly submitted invitations."""
import asyncio
import logging
from datetime import datetime, timedelta
from sqlalchemy import select, update
from ..database import AsyncSessionLocal
from ..models import QuickInviteRecipient, Event, Organization
from services.email_service import send_simple_email

log = logging.getLogger(__name__)


async def tick(session_factory=AsyncSessionLocal):
    async with session_factory() as db:
        # A process may have died after provider acceptance. Never resend those
        # automatically: an uncertain outcome needs organizer reconciliation.
        await db.execute(update(QuickInviteRecipient).where(QuickInviteRecipient.send_status == 'sending',
            QuickInviteRecipient.claimed_at < datetime.utcnow()-timedelta(minutes=10)).values(send_status='uncertain'))
        person = await db.scalar(select(QuickInviteRecipient).where(QuickInviteRecipient.send_status == 'queued')
            .order_by(QuickInviteRecipient.created_at).with_for_update(skip_locked=True).limit(1))
        if not person:
            await db.commit()
            return False
        event = await db.get(Event, person.event_id)
        org = await db.get(Organization, event.org_id) if event else None
        if not event or not org or not org.is_active or event.cancelled or event.status != 'active' or event.event_date <= datetime.utcnow():
            person.send_status = 'failed'
            await db.commit()
            return True
        person.send_status = 'sending'
        person.claimed_at = datetime.utcnow()
        identity, address, subject, body, event_id = person.id, person.email, person.email_subject, person.email_html, event.id
        await db.commit()
    try:
        # These are pre-RSVP contact emails, not guest notifications. They have
        # their own bounded free allowance and never spend a customer wallet.
        accepted = await asyncio.wait_for(send_simple_email(to_email=address, subject=subject, html_body=body,
            event_id=event_id, message_kind='quick_invitation'), timeout=30)
        status = 'sent' if accepted else 'failed'
    except Exception:
        log.exception('Quick invitation provider outcome uncertain for %s', identity)
        status = 'uncertain'
    async with session_factory() as db:
        person = await db.get(QuickInviteRecipient, identity)
        if person and person.send_status == 'sending':
            person.send_status = status
            if status == 'sent': person.sent_at = datetime.utcnow()
            await db.commit()
    return True


async def run():
    while True:
        try:
            if await tick(): continue
        except Exception:
            log.exception('Quick invitation queue polling failed')
        await asyncio.sleep(10)
