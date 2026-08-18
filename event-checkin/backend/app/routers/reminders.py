"""Automated Reminders add-on -- organizer-configured reminder series for an
event (e.g. "7 days before", "1 day before"), each with its own timing,
channel mix, audience filter, and content. Admin-only CRUD; unlike Speakers/
Partners/Registry there's no public token router here -- reminders are
outbound-only automation with nothing for a guest to view.

Delivery itself is handled by services/reminder_outbox.py (scheduler) and
services/reminder_send.py (per-guest fan-out), not this router -- this file
only manages the EventReminder rows an organizer authors.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, EventReminder, User
from ..schemas import (
    EventReminderCreate, EventReminderUpdate, EventReminderOut,
    ReminderPreviewRequest, ReminderPreviewOut, ReminderTestSendRequest,
)
from ..auth import require_paid_event_admin, require_paid_event_member
from ..services.reminders import compute_fire_at
from services import messaging
from services.email_service import send_simple_email
from services.outbound_safety import recipient_allowed
from services.templates import render, sample_context

router = APIRouter()


async def _reminder_event(event_id: str, db: AsyncSession) -> Event:
    ev = await db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    if not ev.reminders_enabled:
        raise HTTPException(400, "Reminders is not enabled for this event")
    return ev


def _out(reminder: EventReminder) -> EventReminderOut:
    return EventReminderOut(
        id=reminder.id, event_id=reminder.event_id, label=reminder.label,
        offset_days=reminder.offset_days, send_time_local=reminder.send_time_local,
        fire_at_utc=reminder.fire_at_utc, channels=reminder.channels or [],
        audience_rsvp_statuses=reminder.audience_rsvp_statuses,
        subject=reminder.subject, email_body=reminder.email_body,
        sms_body=reminder.sms_body, whatsapp_body=reminder.whatsapp_body,
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
    reminder = await _get_reminder(event_id, reminder_id, db)
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
    reminder = await _get_reminder(event_id, reminder_id, db)
    await db.delete(reminder)
    await db.commit()


@router.post("/{event_id}/reminders/{reminder_id}/preview", response_model=ReminderPreviewOut)
async def preview_reminder(event_id: str, reminder_id: str, data: ReminderPreviewRequest,
                           db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    """Renders draft content against sample_context(event) -- same mechanism
    templates.py's preview_template uses, not a second preview implementation."""
    event = await _reminder_event(event_id, db)
    await _get_reminder(event_id, reminder_id, db)
    ctx = sample_context(event)
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
    await _get_reminder(event_id, reminder_id, db)
    if not (data.to or "").strip():
        raise HTTPException(400, "A destination address/number is required")
    if not recipient_allowed(data.channel, data.to):
        raise HTTPException(403, "Recipient blocked by the environment outbound-safety policy")
    messaging.set_event_context(event.id)
    ctx = sample_context(event)
    body = render(data.body, ctx)
    if data.channel == "email":
        subject = render(data.subject, ctx) if data.subject else f"Test reminder — {event.name}"
        await send_simple_email(data.to, subject, body)
    elif data.channel == "sms":
        await messaging.send_custom_sms(phone=data.to, body=body)
    elif data.channel == "whatsapp":
        await messaging.send_custom_whatsapp(phone=data.to, body=body)
    return {"ok": True, "channel": data.channel, "to": data.to}
