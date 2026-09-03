"""Per-guest fan-out for one due EventReminder. Separate from
reminder_outbox.py so this is testable without the tick loop -- mirrors how
post_event_message.py is independent of sync_poller.py."""
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..entitlements import can_use_paid_channels, last_credit_ledger_id, reserve_message_credit
from ..models import Event, EventReminder, EventReminderSend, Guest
from services import messaging
from services.credit_ledger import send_with_credit_ledger
from services.email_service import send_simple_email
from services.templates import build_context, render

logger = logging.getLogger("reminder_send")


async def send_reminder(event: Event, reminder: EventReminder, db: AsyncSession) -> tuple[int, int]:
    """Fan out to the reminder's CURRENT audience (rsvp_status filter
    evaluated now, not at reminder-creation time -- a guest who confirmed
    since an earlier reminder fired naturally drops out of a "non-responders"
    audience with no extra bookkeeping). Skips guests already recorded in
    EventReminderSend for this reminder (crash-resume safety: a process that
    dies mid-fanout can be re-claimed by reminder_outbox.py's stuck-row sweep
    without double-sending). Commits per-guest so a crash mid-loop leaves
    real progress behind, not an all-or-nothing batch."""
    messaging.set_event_context(event.id)
    already_sent = set((await db.scalars(
        select(EventReminderSend.guest_id).where(EventReminderSend.reminder_id == reminder.id)
    )).all())

    q = select(Guest).where(Guest.event_id == event.id)
    statuses = reminder.audience_rsvp_statuses or None
    if statuses:
        q = q.where(Guest.rsvp_status.in_(statuses))
    guests = (await db.execute(q)).scalars().all()

    targeted, sent = 0, 0
    for guest in guests:
        if guest.id in already_sent:
            continue
        targeted += 1
        try:
            fired_channels = await _send_to_guest(event, reminder, guest, db)
        except Exception:
            logger.exception("reminder send crashed guest=%s reminder=%s", guest.id, reminder.id)
            db.add(EventReminderSend(reminder_id=reminder.id, guest_id=guest.id, channels_sent=[], error="send crashed"))
            await db.commit()
            continue
        if fired_channels:
            sent += 1
        db.add(EventReminderSend(reminder_id=reminder.id, guest_id=guest.id, channels_sent=fired_channels))
        await db.commit()
    return targeted, sent


def _reminder_extras(event: Event, guest: Guest) -> dict:
    """Merge-field extras beyond build_context()'s defaults: rsvp_link (the
    guest's personal /r/{token} link -- pre-confirmation this shows the RSVP
    form, post-confirmation it shows FestioHub, same URL either way),
    guest_hub_link (an explicit alias for the same link that deep-links
    straight to the Hub section, for reminders composed for guests who've
    already confirmed -- clearer to write than "rsvp_link" when there's
    nothing left to RSVP for), and ticket_link (the scannable ticket URL,
    only meaningful once a guest is actually confirmed -- qr_token exists on
    every guest row from creation, but isn't a real ticket until then, same
    gating build_context() already applies to festiome_link)."""
    if not guest.invite_token:
        guest.invite_token = str(uuid.uuid4())
    base = event.checkin_base_url.rstrip('/') if event.checkin_base_url else ""
    extras = {
        "rsvp_link": f"{base}/r/{guest.invite_token}" if base else "",
        "guest_hub_link": f"{base}/r/{guest.invite_token}#guest-hub" if base else "",
    }
    if guest.rsvp_status == "confirmed" and guest.qr_token and base:
        extras["ticket_link"] = f"{base}/scan/{guest.qr_token}"
    return extras


async def _send_to_guest(
    event: Event, reminder: EventReminder, guest: Guest, db: AsyncSession,
    *, extra_context: dict | None = None,
) -> list[str]:
    """One guest, all of this reminder's enabled channels. Gates mirror
    post_event_message.py's shape: event.blocked_messaging_channels,
    event.notify_email/sms/whatsapp, guest.sms_consent/whatsapp_consent (no
    email-consent field exists anywhere in this codebase -- matches every
    other automatic email). Outbound-safety allowlist is not re-checked here
    -- it's already enforced one layer down inside messaging._channel_ready()
    and email_service's own send path, same as every other automatic send."""
    blocked = set(event.blocked_messaging_channels or [])
    extras = {**_reminder_extras(event, guest), **(extra_context or {})}
    ctx = build_context(event, guest, extras=extras)
    fired: list[str] = []

    if (
        "email" in reminder.channels and "email" not in blocked
        and event.notify_email and guest.email
    ):
        subject = render(reminder.subject, ctx) or f"Reminder — {event.name}"
        body = render(reminder.email_body, ctx)
        if body:
            # No explicit reserve_message_credit() call here: send_simple_email
            # already meters every guest-facing email through its own
            # _charge_email_credit() (email_service.py:329), keyed off the
            # event_id/guest_id passed below -- same as post_event_message.py's
            # email branch. Calling reserve_message_credit() ourselves on top
            # of that isn't just redundant double-charging, it deadlocks: our
            # own db session would hold the Organization row's FOR UPDATE lock
            # (uncommitted, since we haven't returned from send_simple_email
            # yet) while _charge_email_credit's own fresh session blocks
            # forever trying to acquire that same lock. Confirmed live via
            # pg_stat_activity during staging verification -- one session
            # "idle in transaction" holding the lock, the other stuck on
            # wait_event_type=Lock for the same row.
            await send_simple_email(guest.email, subject, body, event.id, None, guest.id, f"reminder:{reminder.id}")
            fired.append("email")

    if not (guest.phone and can_use_paid_channels(event)):
        return fired

    if (
        "sms" in reminder.channels and "sms" not in blocked
        and event.notify_sms and guest.sms_consent
    ):
        body = render(reminder.sms_body, ctx)
        if body and await reserve_message_credit(event, "sms", db=db, reason=f"reminder:{reminder.id}", guest_id=guest.id):
            await send_with_credit_ledger(
                last_credit_ledger_id(event), messaging.send_custom_sms,
                phone=guest.phone, body=body,
            )
            fired.append("sms")

    if (
        "mms" in reminder.channels and "mms" not in blocked
        and event.notify_mms and guest.sms_consent and messaging.mms_ready()
    ):
        body = render(getattr(reminder, "mms_body", None), ctx)
        media_url = render(getattr(reminder, "mms_media_url", None), ctx)
        if body and media_url and await reserve_message_credit(event, "mms", db=db, reason=f"reminder:{reminder.id}", guest_id=guest.id):
            await send_with_credit_ledger(
                last_credit_ledger_id(event), messaging.send_mms,
                phone=guest.phone, body=body, media_url=media_url,
            )
            fired.append("mms")

    if (
        "whatsapp" in reminder.channels and "whatsapp" not in blocked
        and event.notify_whatsapp and guest.whatsapp_consent
        and (
            getattr(reminder, "communication_type", None) != "consent_reminder"
            or messaging.settings.bird_whatsapp_consent_reminder_template
        )
    ):
        body = render(reminder.whatsapp_body, ctx)
        if body and await reserve_message_credit(event, "whatsapp", db=db, reason=f"reminder:{reminder.id}", guest_id=guest.id):
            if getattr(reminder, "communication_type", None) == "consent_reminder":
                await send_with_credit_ledger(
                    last_credit_ledger_id(event), messaging.send_consent_reminder_whatsapp,
                    phone=guest.phone, first_name=guest.first_name or "Guest", event_name=event.name,
                    consent_link=ctx.get("consent_link", ""), event_date=event.event_date,
                    event_timezone=event.timezone,
                )
            else:
                await send_with_credit_ledger(
                    last_credit_ledger_id(event), messaging.send_custom_whatsapp,
                    phone=guest.phone, body=body,
                )
            fired.append("whatsapp")

    return fired
