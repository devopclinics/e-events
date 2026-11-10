"""Automated Reminders add-on -- organizer-configured reminder series for an
event (e.g. "7 days before", "1 day before"), each with its own timing,
channel mix, audience filter, and content. Admin-only CRUD; unlike Speakers/
Partners/Registry there's no public token router here -- reminders are
outbound-only automation with nothing for a guest to view.

Delivery itself is handled by services/reminder_outbox.py (scheduler) and
services/reminder_send.py (per-guest fan-out), not this router -- this file
only manages the EventReminder rows an organizer authors.
"""
import re
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, EventReminder, User
from ..schemas import (
    EventReminderCreate, EventReminderUpdate, EventReminderOut,
    ReminderPreviewRequest, ReminderPreviewOut, ReminderTestSendRequest, ReminderSendNowRequest,
)
from ..auth import require_paid_event_admin, require_paid_event_member
from ..services.reminders import compute_fire_at
from services import messaging
from services.email_service import send_simple_email
from services.outbound_safety import recipient_allowed
from services.templates import render, sample_context

router = APIRouter()
logger = logging.getLogger(__name__)


async def _reminder_event(event_id: str, db: AsyncSession) -> Event:
    ev = await db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    if not ev.reminders_enabled:
        raise HTTPException(400, "Reminders is not enabled for this event")
    return ev


def _preview_context(event, sample_access, body='', subject=''):
    from ..services.reminder_session_access import TOKENS, session_reminder_wording
    ctx = {**sample_context(event), 'guest_hub_link': 'https://events.example/r/sample#guest-hub'}
    ctx['first_name'] = ctx.get('guest_first_name') or 'Ada'
    if any('{{' + token + '}}' in (body + (subject or '')) for token in TOKENS):
        try:
            ctx.update(session_reminder_wording((event.setup_preferences or {}).get('reminder_session_access') or {}, sample_access == 'conference_dinner'))
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
    return ctx


def _out(reminder: EventReminder) -> EventReminderOut:
    return EventReminderOut(
        id=reminder.id, event_id=reminder.event_id, label=reminder.label,
        offset_days=reminder.offset_days, send_time_local=reminder.send_time_local,
        fire_at_utc=reminder.fire_at_utc, channels=reminder.channels or [],
        audience_rsvp_statuses=reminder.audience_rsvp_statuses,
        subject=reminder.subject, email_body=reminder.email_body,
        sms_body=reminder.sms_body, whatsapp_body=reminder.whatsapp_body,
        whatsapp_template_ref=reminder.whatsapp_template_ref,
        whatsapp_template_vars=reminder.whatsapp_template_vars,
        enabled=reminder.enabled, status=reminder.status, fired_at=reminder.fired_at,
        guests_targeted=reminder.guests_targeted, guests_sent=reminder.guests_sent,
        last_error=reminder.last_error, sort_order=reminder.sort_order,
    )


async def _get_reminder(event_id: str, reminder_id: str, db: AsyncSession) -> EventReminder:
    reminder = await db.get(EventReminder, reminder_id)
    if not reminder or reminder.event_id != event_id:
        raise HTTPException(404, "Reminder not found")
    return reminder


# ── Admin: reminders CRUD ───────────────────────────────────────────────────

@router.get("/{event_id}/reminders", response_model=list[EventReminderOut])
async def list_reminders(event_id: str, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_member)):
    await _reminder_event(event_id, db)
    rows = (await db.execute(
        select(EventReminder).where(EventReminder.event_id == event_id)
        .order_by(EventReminder.sort_order, EventReminder.created_at)
    )).scalars().all()
    return [_out(r) for r in rows]


@router.post("/{event_id}/reminders", response_model=EventReminderOut, status_code=201)
async def create_reminder(event_id: str, data: EventReminderCreate, db: AsyncSession = Depends(get_db),
                          user: User = Depends(require_paid_event_admin)):
    event = await _reminder_event(event_id, db)
    fire_at = compute_fire_at(event, offset_days=data.offset_days, send_time_local=data.send_time_local)
    reminder = EventReminder(
        event_id=event_id, label=data.label, offset_days=data.offset_days,
        send_time_local=data.send_time_local, fire_at_utc=fire_at, channels=data.channels,
        audience_rsvp_statuses=data.audience_rsvp_statuses, subject=data.subject,
        email_body=data.email_body, sms_body=data.sms_body, whatsapp_body=data.whatsapp_body,
        whatsapp_template_ref=data.whatsapp_template_ref, whatsapp_template_vars=data.whatsapp_template_vars,
        enabled=data.enabled, sort_order=data.sort_order, updated_by=user.id,
    )
    db.add(reminder)
    await db.commit()
    await db.refresh(reminder)
    return _out(reminder)


@router.put("/{event_id}/reminders/{reminder_id}", response_model=EventReminderOut)
async def update_reminder(event_id: str, reminder_id: str, data: EventReminderUpdate,
                          db: AsyncSession = Depends(get_db), user: User = Depends(require_paid_event_admin)):
    event = await _reminder_event(event_id, db)
    reminder = await _locked_reminder(event_id, reminder_id, db)
    _assert_editable(reminder)
    # A fired reminder already sent to its audience -- everything except
    # `enabled` (a no-op here since it already fired) is immutable. An admin
    # who wants to resend duplicates the reminder instead, so this stays a
    # plain "edit a draft" path with no reset-and-refire branch to keep safe
    # against EventReminderSend's per-reminder dedup.
    if reminder.fired_at is not None:
        raise HTTPException(400, "This reminder has already fired and can't be edited. Duplicate it to send again.")
    changed = data.model_dump(exclude_unset=True)
    retime = "offset_days" in changed or "send_time_local" in changed
    for field, value in changed.items():
        setattr(reminder, field, value)
    if retime:
        reminder.fire_at_utc = compute_fire_at(
            event, offset_days=reminder.offset_days, send_time_local=reminder.send_time_local
        )
    reminder.updated_by = user.id
    await db.commit()
    await db.refresh(reminder)
    return _out(reminder)


@router.delete("/{event_id}/reminders/{reminder_id}", status_code=204)
async def delete_reminder(event_id: str, reminder_id: str, db: AsyncSession = Depends(get_db),
                          _: User = Depends(require_paid_event_admin)):
    await _reminder_event(event_id, db)
    reminder = await _locked_reminder(event_id, reminder_id, db)
    _assert_editable(reminder)
    await db.delete(reminder)
    await db.commit()


@router.post("/{event_id}/reminders/{reminder_id}/preview", response_model=ReminderPreviewOut)
async def preview_reminder(event_id: str, reminder_id: str, data: ReminderPreviewRequest,
                           db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    """Renders draft content against sample_context(event) -- same mechanism
    templates.py's preview_template uses, not a second preview implementation."""
    event = await _reminder_event(event_id, db)
    await _get_reminder(event_id, reminder_id, db)
    # guest_hub_link isn't one of templates.py's standard PLACEHOLDERS (it's
    # reminder-specific, see services/reminder_send.py::_reminder_extras),
    # so sample_context() doesn't know about it -- add a sample value here
    # rather than growing the shared placeholder list for every template.
    ctx = _preview_context(event, data.sample_session_access, data.body, data.subject)
    return ReminderPreviewOut(
        subject=render(data.subject, ctx) if data.subject else None,
        body=render(data.body, ctx),
    )


@router.post("/{event_id}/reminders/{reminder_id}/test-send")
async def test_send_reminder(event_id: str, reminder_id: str, data: ReminderTestSendRequest,
                             db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    """Sends the draft content to an admin-supplied address, not a guest --
    unlike the real per-guest fan-out, this must call recipient_allowed()
    itself (mirrors templates.py's test_send_template). Does not reserve
    credit or write EventReminderSend -- it's a test, same as the template
    editor's test-send."""
    event = await _reminder_event(event_id, db)
    reminder = await _get_reminder(event_id, reminder_id, db)
    if not (data.to or "").strip():
        raise HTTPException(400, "A destination address/number is required")
    destination = data.to.strip()
    valid = re.fullmatch(r"[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+", destination) if data.channel == 'email' else re.fullmatch(r"\+[1-9]\d{7,14}", destination)
    if not valid:
        raise HTTPException(422, 'Enter one email address or one phone number with its country code for the selected channel.')
    if data.channel not in ('email', 'sms', 'whatsapp'):
        raise HTTPException(422, 'This channel does not support reminder tests.')
    if not recipient_allowed(data.channel, destination):
        raise HTTPException(403, "Recipient blocked by the environment outbound-safety policy")
    messaging.set_event_context(event.id)
    ctx = _preview_context(event, data.sample_session_access, data.body, data.subject)
    body = render(data.body, ctx)
    result = None
    logger.info("Reminder test requested event=%s reminder=%s channel=%s", event_id, reminder_id, data.channel)
    if data.channel == "email":
        if not body.strip():
            raise HTTPException(422, "Add an email body before sending a test.")
        subject = render(data.subject, ctx) if data.subject else f"Test reminder — {event.name}"
        result = await send_simple_email(destination, subject, body, event_id=event.id, message_kind="reminder_test")
        if not result:
            raise HTTPException(502, "Email test was not accepted. Check email delivery records for the failure reason.")
    elif data.channel == "sms":
        if not body.strip():
            raise HTTPException(422, "Add an SMS body before sending a test.")
        result = await messaging.send_custom_sms(phone=destination, body=body)
    elif data.channel == "whatsapp":
        wa_ref = data.whatsapp_template_ref if "whatsapp_template_ref" in data.model_fields_set else reminder.whatsapp_template_ref
        wa_vars = data.whatsapp_template_vars if data.whatsapp_template_vars is not None else reminder.whatsapp_template_vars
        if wa_ref and wa_vars:
            var_keys = list(wa_vars.keys())
            params = [render(wa_vars[k], ctx) for k in var_keys]
            if any(not value.strip() for value in params):
                raise HTTPException(422, "Fill in all WhatsApp template variables before sending a test.")
            result = await messaging.send_custom_template_whatsapp(phone=destination, template_ref=wa_ref, params=params, var_keys=var_keys)
        else:
            if not body.strip():
                raise HTTPException(422, "Select an approved WhatsApp template before sending a test.")
            result = await messaging.send_custom_whatsapp(phone=destination, body=body)
    if data.channel != 'email' and (not result or result.get('status') in ('failed', 'rejected', 'blocked', 'skipped', 'undeliverable') or not result.get('provider_message_id')):
        raise HTTPException(502, "The messaging provider did not accept this test. Check the channel configuration and approved template.")
    reference = result.get('provider_message_id') if isinstance(result, dict) else None
    logger.info("Reminder test accepted event=%s reminder=%s channel=%s provider_message_id=%s", event_id, reminder_id, data.channel, reference)
    return {"ok": True, "status": "accepted", "channel": data.channel, "to": destination, "provider_message_id": reference}


async def _locked_reminder(event_id, reminder_id, db):
    row = await db.scalar(select(EventReminder).where(EventReminder.id == reminder_id, EventReminder.event_id == event_id).with_for_update().execution_options(populate_existing=True))
    if not row:
        raise HTTPException(404, 'Reminder not found')
    return row


def _assert_editable(row):
    if row.fired_at or row.status != 'pending' or (row.enabled and row.fire_at_utc <= datetime.utcnow()):
        raise HTTPException(409, 'This reminder is queued, sending or completed. It cannot be edited or sent again.')


@router.get('/{event_id}/reminders/{reminder_id}/send-summary')
async def reminder_send_summary(event_id: str, reminder_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    event = await _reminder_event(event_id, db)
    row = await _get_reminder(event_id, reminder_id, db)
    from ..services.reminder_dispatch import dispatch_summary
    return await dispatch_summary(event, row, db)


@router.post('/{event_id}/reminders/{reminder_id}/send-now', status_code=202)
async def send_reminder_now(event_id: str, reminder_id: str, data: ReminderSendNowRequest, db: AsyncSession = Depends(get_db), user: User = Depends(require_paid_event_admin)):
    event = await _reminder_event(event_id, db)
    row = await _locked_reminder(event_id, reminder_id, db)
    _assert_editable(row)
    from ..services.reminder_dispatch import dispatch_summary
    summary = await dispatch_summary(event, row, db)
    if summary['confirmation_token'] != data.confirmation_token:
        raise HTTPException(409, 'The saved reminder or audience changed. Review the updated send summary before confirming.')
    if summary['blockers'] or not summary['reachable_guests']:
        raise HTTPException(422, '; '.join(summary['blockers']) or 'No guests can receive this reminder.')
    # Durable queue: the existing replica-safe scheduler claims this row once.
    row.enabled = True
    row.fire_at_utc = datetime.utcnow()
    row.updated_by = user.id
    row.last_error = None
    await db.commit()
    return {'status': 'queued', 'reminder_id': row.id, 'audience': summary['audience'], 'reachable_guests': summary['reachable_guests']}


@router.get('/{event_id}/reminders/{reminder_id}/send-progress')
async def reminder_send_progress(event_id: str, reminder_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_member)):
    await _reminder_event(event_id, db)
    row = await _get_reminder(event_id, reminder_id, db)
    from ..models import EventReminderSend, Guest
    results = (await db.execute(select(EventReminderSend, Guest.first_name, Guest.last_name).join(Guest, Guest.id == EventReminderSend.guest_id).where(EventReminderSend.reminder_id == row.id))).all()
    channels = {channel: sum(channel in (result.channels_sent or []) for result, _, _ in results) for channel in row.channels}
    failures = [{'name': first + ' ' + last, 'error': result.error or 'No channel accepted this reminder'} for result, first, last in results if result.error or not result.channels_sent]
    return {'status': row.status, 'processed': len(results), 'accepted_guests': sum(bool(result.channels_sent) for result, _, _ in results), 'channels_accepted': channels, 'failures': failures, 'last_error': row.last_error, 'complete': row.fired_at is not None}
