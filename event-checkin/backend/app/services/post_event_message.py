"""Automatic post-event thank-you + feedback message.

Sent once per event, `post_event_thankyou_delay_hours` after the event ends
(event_end_date, or event_date for single-day events), via whichever channels
the event has enabled — same notify_email/sms/whatsapp + consent + paid-
channel gates every other automatic guest message (invite, admission) already
uses. Off by default; organizer opt-in via post_event_thankyou_enabled.

The message links to the guest's personal Guest Hub (?focus=feedback), not
directly to whatever feedback mechanism (external form / in-app questions)
the event has configured — Guest Hub is the one place that already applies
the right audience/timing gating for feedback visibility, so the link stays
correct regardless of what's configured or when this fires.

Does NOT require Experience/a Feedback step to be enabled — the toggle works
standalone. But the default wording promises "share your feedback", so the
feedback_cta_* placeholders below only render when this guest actually has a
feedback form available right now (same gating GET .../experience/me/feedback
uses for the Guest Hub itself); otherwise they're blank and it's a plain
thank-you, so the message never promises something the guest won't find.
"""
import html as _html
import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..entitlements import can_use_paid_channels, last_credit_ledger_id, take_message_credit
from ..models import Event, Guest
from ..template_resolve import channel_text_or_default, email_or_default, load_overrides
from services import messaging
from services.credit_ledger import send_with_credit_ledger
from services.email_service import send_simple_email
from services.templates import build_context

logger = logging.getLogger("post_event_message")

TEMPLATE_KEY = "post_event_thankyou"


def _guest_hub_link(event: Event, guest: Guest) -> str | None:
    if not event.checkin_base_url:
        return None
    if not guest.invite_token:
        guest.invite_token = str(uuid.uuid4())
    base = event.checkin_base_url.rstrip("/")
    return f"{base}/r/{guest.invite_token}?focus=feedback#guest-hub"


async def _guest_has_feedback_available(event: Event, guest: Guest, db: AsyncSession) -> bool:
    """Same "does at least one feedback form show up" check GET
    .../experience/me/feedback uses, so this message's feedback CTA never
    promises something the guest's Guest Hub won't actually have."""
    if not event.experience_enabled:
        return False
    from ..routers.experience import _feedback_audience_allows, _feedback_questions
    from .experience import active_workflow, load_workflow
    from .program import feedback_availability

    workflow = await active_workflow(event.id, db)
    if not workflow:
        return False
    loaded = await load_workflow(workflow.id, db)
    for step in (loaded.steps if loaded else []):
        questions = _feedback_questions(step)
        feedback = (step.config or {}).get("feedback") or {}
        external_url = str(feedback.get("external_url") or "").strip()
        if step.type != "feedback" or not step.enabled or (not questions and not external_url):
            continue
        if not await _feedback_audience_allows(step, guest, db):
            continue
        program_window = await feedback_availability(event, loaded, db, step.id)
        if program_window["controlled"] and not program_window["open"]:
            continue
        return True
    return False


async def _feedback_cta(event: Event, guest: Guest, db: AsyncSession, link: str) -> dict:
    if not await _guest_has_feedback_available(event, guest, db):
        return {"feedback_cta_html": "", "feedback_cta_text": ""}
    return {
        "feedback_cta_html": f'<p>We\'d love to hear how it went — <a href="{_html.escape(link)}">share your feedback</a>.</p>',
        "feedback_cta_text": f" We'd love your feedback: {link}",
    }


async def _due_events(db: AsyncSession, *, now: datetime) -> list[Event]:
    candidates = (await db.scalars(select(Event).where(
        Event.post_event_thankyou_enabled.is_(True),
        Event.post_event_thankyou_sent_at.is_(None),
    ))).all()
    due = []
    for event in candidates:
        end = event.event_end_date or event.event_date
        if not end:
            continue
        if now >= end + timedelta(hours=event.post_event_thankyou_delay_hours):
            due.append(event)
    return due


async def send_to_guest(event: Event, guest: Guest, db: AsyncSession, *, overrides=None) -> int:
    """Send the thank-you/feedback message to one guest, on whichever channels
    are enabled + consented + deliverable. Returns how many channels fired.
    Used both by the bulk per-event send below and the admin's single-guest
    test-send (routers/events.py) — a manual test-send is a REAL send to a
    real guest's real contact info, so it goes through the same credit/
    entitlement gates as the automatic one; it does not touch
    post_event_thankyou_sent_at, since that's the automatic trigger's own
    once-per-event idempotency guard, not a per-guest record.
    """
    if overrides is None:
        overrides = await load_overrides(event.id, db)
    email_blocked = "email" in (event.blocked_messaging_channels or [])
    paid_ok = can_use_paid_channels(event)
    sent = 0

    link = _guest_hub_link(event, guest)
    if not link:
        return 0
    ctx = build_context(event, guest, extras={"feedback_link": link, **(await _feedback_cta(event, guest, db, link))})

    if guest.email and event.notify_email and not email_blocked:
        subj, body = email_or_default(overrides, TEMPLATE_KEY, ctx)
        if body:
            await send_simple_email(
                guest.email, subj or f"Thank you — {event.name}", body,
                event.id, None, guest.id, TEMPLATE_KEY,
            )
            sent += 1

    if not (guest.phone and paid_ok):
        return sent

    if event.notify_sms and guest.sms_consent and take_message_credit(event, "sms", reason=TEMPLATE_KEY, guest_id=guest.id):
        sms_text = channel_text_or_default(overrides, TEMPLATE_KEY, "sms", ctx)
        if sms_text:
            await send_with_credit_ledger(
                last_credit_ledger_id(event), messaging.send_custom_sms,
                phone=guest.phone, body=sms_text,
            )
            sent += 1

    if event.notify_whatsapp and guest.whatsapp_consent and take_message_credit(event, "whatsapp", reason=TEMPLATE_KEY, guest_id=guest.id):
        wa_text = channel_text_or_default(overrides, TEMPLATE_KEY, "whatsapp", ctx)
        if wa_text:
            await send_with_credit_ledger(
                last_credit_ledger_id(event), messaging.send_announcement_whatsapp,
                phone=guest.phone, first_name=guest.first_name, event_name=event.name,
                message=wa_text, ticket_url=link,
            )
            sent += 1

    return sent


async def _send_for_event(event: Event, db: AsyncSession) -> int:
    q = select(Guest).where(Guest.event_id == event.id)
    if event.post_event_thankyou_audience == "admitted":
        q = q.where(Guest.admitted == True)  # noqa: E712
    elif event.post_event_thankyou_audience == "confirmed":
        q = q.where(Guest.rsvp_status == "confirmed")
    guests = (await db.execute(q)).scalars().all()

    overrides = await load_overrides(event.id, db)
    sent = 0
    for guest in guests:
        try:
            sent += await send_to_guest(event, guest, db, overrides=overrides)
        except Exception:
            # Isolate one guest's failure so it can't undo progress already made
            # on the rest, or force a full resend on the next tick's retry.
            logger.exception("post_event_thankyou send crashed for guest=%s event=%s", guest.id, event.id)
            continue
    return sent


async def tick(db: AsyncSession, *, now: datetime | None = None) -> dict[str, int]:
    """Send the post-event thank-you/feedback message once per due event."""
    moment = now or datetime.utcnow()
    due = await _due_events(db, now=moment)
    sent_events = 0
    sent_messages = 0
    for event in due:
        try:
            sent_messages += await _send_for_event(event, db)
        except Exception:
            logger.exception("post_event_thankyou send crashed for event=%s", event.id)
            continue
        event.post_event_thankyou_sent_at = moment
        sent_events += 1
    if sent_events:
        await db.commit()
    return {"events": sent_events, "messages": sent_messages}
