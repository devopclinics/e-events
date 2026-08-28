"""Shared scheduling primitives for Guest Communication automation."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Event, ExperienceStep, ExperienceWorkflow, Guest, ScheduledCommunication, ScheduledCommunicationDelivery
from ..timeutil import event_local_to_utc, to_event_local


def compute_scheduled_for(
    event: Event,
    *,
    trigger_type: str,
    scheduled_at_local: str | None = None,
    anchor: str | None = None,
    anchor_offset_seconds: int | None = None,
    offset_minutes: int | None = None,
) -> datetime:
    """Resolve an organizer schedule to the codebase's naive-UTC convention."""
    if trigger_type == "absolute":
        if not scheduled_at_local:
            raise HTTPException(422, "Choose the local date and time to send this communication")
        try:
            local = datetime.fromisoformat(scheduled_at_local)
        except ValueError as exc:
            raise HTTPException(422, "scheduled_at_local must be a valid date and time") from exc
        if local.tzinfo is not None:
            return local.astimezone(timezone.utc).replace(tzinfo=None)
        return event_local_to_utc(local.date(), local.strftime("%H:%M"), event.timezone)

    if trigger_type != "relative":
        raise HTTPException(422, "trigger_type must be absolute or relative")
    anchors = {
        "event_start": event.event_date,
        "event_end": event.event_end_date or event.event_date,
        "rsvp_deadline": event.rsvp_deadline,
        "experience_step": (
            event.event_date + timedelta(seconds=anchor_offset_seconds)
            if anchor_offset_seconds is not None else None
        ),
    }
    if anchor not in anchors:
        raise HTTPException(422, "Choose an event, RSVP deadline, or Experience session anchor")
    base = anchors[anchor]
    if base is None:
        raise HTTPException(422, f"This event does not have an {anchor.replace('_', ' ')}")
    return base + timedelta(minutes=offset_minutes or 0)


def scheduled_local_iso(communication: ScheduledCommunication) -> str:
    local = to_event_local(communication.scheduled_for_utc, communication.timezone)
    return local.strftime("%Y-%m-%dT%H:%M") if local else ""


def audience_query(event_id: str, audience_type: str):
    query = select(Guest).where(Guest.event_id == event_id)
    if audience_type == "not_invited":
        return query.where(Guest.invite_sent_at.is_(None))
    if audience_type == "not_responded":
        return query.where(or_(Guest.rsvp_responded_at.is_(None), Guest.rsvp_status.in_(["invited", "pending"])))
    if audience_type in {"confirmed", "declined", "waitlisted"}:
        return query.where(Guest.rsvp_status == audience_type)
    if audience_type == "checked_in":
        return query.where(Guest.admitted.is_(True))
    if audience_type == "not_checked_in":
        return query.where(and_(Guest.admitted.is_(False), Guest.rsvp_status == "confirmed"))
    return query


async def audience_guests(db: AsyncSession, event_id: str, audience_type: str) -> list[Guest]:
    return list((await db.scalars(audience_query(event_id, audience_type))).all())


async def replace_frozen_audience(
    db: AsyncSession,
    communication: ScheduledCommunication,
) -> int:
    """Refresh the recipient snapshot for an editable, not-yet-run schedule."""
    existing = list((await db.scalars(select(ScheduledCommunicationDelivery).where(
        ScheduledCommunicationDelivery.communication_id == communication.id,
    ))).all())
    for row in existing:
        await db.delete(row)
    if communication.audience_mode != "frozen":
        return 0
    guests = await audience_guests(db, communication.event_id, communication.audience_type)
    for guest in guests:
        db.add(ScheduledCommunicationDelivery(
            communication_id=communication.id,
            guest_id=guest.id,
            status="pending",
        ))
    return len(guests)


async def estimated_recipients(db: AsyncSession, communication: ScheduledCommunication) -> int:
    if communication.audience_mode == "frozen":
        return int(await db.scalar(select(func.count()).select_from(ScheduledCommunicationDelivery).where(
            ScheduledCommunicationDelivery.communication_id == communication.id,
        )) or 0)
    subquery = audience_query(communication.event_id, communication.audience_type).subquery()
    return int(await db.scalar(select(func.count()).select_from(subquery)) or 0)


async def recompute_relative_schedules(event: Event, db: AsyncSession) -> None:
    """Keep pending relative schedules aligned when an event's timing changes."""
    rows = list((await db.scalars(select(ScheduledCommunication).where(
        ScheduledCommunication.event_id == event.id,
        ScheduledCommunication.trigger_type == "relative",
        ScheduledCommunication.status.in_(["draft", "scheduled", "paused"]),
    ))).all())
    for row in rows:
        step_offset = None
        if row.anchor == "experience_step" and row.anchor_step_id:
            step_offset = await db.scalar(
                select(ExperienceStep.starts_offset_seconds)
                .join(ExperienceWorkflow, ExperienceWorkflow.id == ExperienceStep.workflow_id)
                .where(
                    ExperienceStep.id == row.anchor_step_id,
                    ExperienceWorkflow.event_id == event.id,
                )
            )
        row.scheduled_for_utc = compute_scheduled_for(
            event,
            trigger_type="relative",
            anchor=row.anchor,
            anchor_offset_seconds=step_offset,
            offset_minutes=row.offset_minutes,
        )
        row.timezone = event.timezone or "UTC"
