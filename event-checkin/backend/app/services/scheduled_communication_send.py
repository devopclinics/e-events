"""Delivery fan-out for one due unified scheduled communication."""
import logging
from datetime import datetime
from types import SimpleNamespace

from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Event, ExperienceStep, ExperienceWorkflow, Guest, InboundEmailAutomation,
    ScheduledCommunication, ScheduledCommunicationDelivery,
)
from .scheduled_communications import audience_guests

logger = logging.getLogger("scheduled_communication_send")


async def _consent_link(db: AsyncSession, event_id: str) -> str:
    automated_steps = select(InboundEmailAutomation.step_id).where(
        InboundEmailAutomation.event_id == event_id,
        InboundEmailAutomation.status == "active",
    )
    steps = list((await db.scalars(
        select(ExperienceStep)
        .join(ExperienceWorkflow, ExperienceWorkflow.id == ExperienceStep.workflow_id)
        .where(
            ExperienceWorkflow.event_id == event_id,
            ExperienceStep.enabled.is_(True),
            ExperienceStep.required.is_(True),
            (ExperienceStep.type == "consent") | ExperienceStep.id.in_(automated_steps),
        )
        .order_by(ExperienceWorkflow.is_default.desc(), ExperienceWorkflow.version.desc(), ExperienceStep.sort_order)
    )).all())
    for step in steps:
        link = str((step.config or {}).get("external_url") or "").strip()
        if link:
            return link
    return ""


async def _recipient_rows(
    db: AsyncSession,
    communication: ScheduledCommunication,
) -> tuple[list[Guest], dict[str, ScheduledCommunicationDelivery]]:
    logs = list((await db.scalars(select(ScheduledCommunicationDelivery).where(
        ScheduledCommunicationDelivery.communication_id == communication.id,
    ))).all())
    by_guest = {row.guest_id: row for row in logs}
    if communication.audience_mode == "frozen":
        ids = list(by_guest)
        if not ids:
            return [], by_guest
        guests = list((await db.scalars(select(Guest).where(
            Guest.event_id == communication.event_id,
            Guest.id.in_(ids),
        ))).all())
        return guests, by_guest
    return await audience_guests(db, communication.event_id, communication.audience_type), by_guest


async def _send_invitation(
    db: AsyncSession,
    event: Event,
    communication: ScheduledCommunication,
    guest: Guest,
) -> list[str]:
    # Import lazily to avoid a service -> router cycle at application import.
    from ..routers.guests import _dispatch_invite
    from ..template_resolve import load_overrides
    from ..channels import channels_for_flow
    from ..entitlements import can_use_paid_channels

    tasks = BackgroundTasks()
    template_key = "rsvp_reminder" if communication.communication_type == "rsvp_reminder" else "rsvp_invitation"
    flow = "reminder" if communication.communication_type == "rsvp_reminder" else "invite"
    # A schedule owns its channel selection. Temporarily present that selection
    # to the established dispatcher as an explicit all-selected policy, then
    # restore the event policy before committing so ordinary send-now behavior
    # is never changed.
    original_policy = event.channel_policy
    event.channel_policy = {
        **(event.channel_policy or {}),
        flow: {"mode": "all", "channels": list(communication.channels or [])},
    }
    try:
        chosen = channels_for_flow(event, guest, flow, paid_ok=can_use_paid_channels(event))
        dispatched = await _dispatch_invite(
            tasks,
            event,
            guest,
            db,
            await load_overrides(event.id, db),
            template_key,
        )
    finally:
        event.channel_policy = original_policy
    if not guest.qr_generated_at:
        guest.qr_generated_at = datetime.utcnow()
    guest.invite_sent_at = datetime.utcnow()
    guest.invite_status = "sent" if dispatched else "failed"
    # The existing invite dispatch reserves credits in this transaction, while
    # guest-facing email metering uses its own session. Commit before executing
    # Starlette's queued tasks to avoid holding the organization credit lock.
    await db.commit()
    await tasks()
    return sorted(chosen) if dispatched else []


async def _send_custom(
    db: AsyncSession,
    event: Event,
    communication: ScheduledCommunication,
    guest: Guest,
) -> list[str]:
    # The established reminder sender already applies merge fields, consent,
    # blocked channels, paid-channel gates, and credit-ledger accounting.  A
    # small immutable adapter lets the unified scheduler reuse that safety path.
    from .reminder_send import _send_to_guest

    extra_context = None
    if communication.communication_type == "consent_reminder":
        link = await _consent_link(db, event.id)
        if not link:
            raise RuntimeError("No required consent step with an external link is configured")
        extra_context = {"consent_link": link}
    adapter = SimpleNamespace(
        id=f"scheduled:{communication.id}",
        communication_type=communication.communication_type,
        channels=communication.channels or [],
        subject=communication.subject,
        email_body=communication.email_body,
        sms_body=communication.sms_body,
        whatsapp_body=communication.whatsapp_body,
        mms_body=communication.mms_body,
        mms_media_url=communication.mms_media_url,
    )
    return await _send_to_guest(event, adapter, guest, db, extra_context=extra_context)


async def send_scheduled_communication(
    event: Event,
    communication: ScheduledCommunication,
    db: AsyncSession,
) -> tuple[int, int, int]:
    guests, existing = await _recipient_rows(db, communication)
    targeted = len(guests)
    sent = failed = 0
    for guest in guests:
        row = existing.get(guest.id)
        if row and row.status == "sent":
            sent += 1
            continue
        if row is None:
            row = ScheduledCommunicationDelivery(
                communication_id=communication.id,
                guest_id=guest.id,
                status="pending",
            )
            db.add(row)
            existing[guest.id] = row
            await db.flush()
        try:
            if communication.communication_type in {"invitation", "rsvp_reminder"}:
                channels = await _send_invitation(db, event, communication, guest)
            else:
                channels = await _send_custom(db, event, communication, guest)
            row.channels_sent = channels
            row.status = "sent" if channels else "failed"
            row.error = None if channels else "No configured channel was deliverable"
            row.sent_at = datetime.utcnow()
            if channels:
                sent += 1
            else:
                failed += 1
        except Exception as exc:
            logger.exception("scheduled communication failed communication=%s guest=%s", communication.id, guest.id)
            row.status = "failed"
            row.error = str(exc)[:2000]
            failed += 1
        await db.commit()
    return targeted, sent, failed
