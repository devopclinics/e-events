"""Safe, time-driven Live Program helpers.

The program is stored on timed Experience steps but is deliberately read-only
until an event opts in with ``live_program_enabled``.  It never changes staff
admission, RSVP, seating, or regular Experience progress.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Event, EventAnnouncement, EventMessage, ExperienceEvent, ExperienceStep, ExperienceWorkflow
from ..timeutil import event_tz, to_event_local
from .experience import active_workflow
from .festiome_outbox import queue_announcement


def now_local() -> datetime:
    # Program timing compares absolute instants, so the display zone here is
    # immaterial; keep it UTC-aware.
    return datetime.now(timezone.utc)


def segment_steps(workflow: ExperienceWorkflow) -> list[ExperienceStep]:
    return sorted(
        [s for s in workflow.steps if s.enabled and s.is_segment and s.starts_offset_seconds is not None and s.duration_seconds],
        key=lambda s: (s.starts_offset_seconds or 0, s.sort_order, s.title),
    )


def segment_window(event: Event, step: ExperienceStep) -> tuple[datetime, datetime]:
    anchor = to_event_local(event.event_date, event_tz(event))
    if not anchor or step.starts_offset_seconds is None or not step.duration_seconds:
        raise ValueError("Timed program segment requires event date, start offset, and duration")
    start = anchor + timedelta(seconds=step.starts_offset_seconds)
    return start, start + timedelta(seconds=step.duration_seconds)


def _segment_out(event: Event, step: ExperienceStep, *, now: datetime, active: bool) -> dict:
    start, end = segment_window(event, step)
    config = step.config or {}
    program = config.get("program") if isinstance(config.get("program"), dict) else {}
    return {
        "step_id": step.id,
        "key": step.key,
        "title": step.title,
        "description": step.description,
        "starts_at": start,
        "ends_at": end,
        "category": program.get("category"),
        "active": active,
    }


def _feedback_reference(step: ExperienceStep, workflow: ExperienceWorkflow) -> ExperienceStep | None:
    config = step.config or {}
    feedback = config.get("feedback") if isinstance(config.get("feedback"), dict) else {}
    key = str(feedback.get("step_key") or "")
    return next((candidate for candidate in workflow.steps if candidate.key == key and candidate.type == "feedback"), None)


async def _feedback_windows(event: Event, workflow: ExperienceWorkflow, db: AsyncSession, *, now: datetime) -> list[dict]:
    rows = (await db.scalars(select(ExperienceEvent).where(
        ExperienceEvent.event_id == event.id,
        ExperienceEvent.workflow_id == workflow.id,
        ExperienceEvent.event_type.in_(["feedback.opened", "feedback.closed"]),
    ).order_by(ExperienceEvent.occurred_at.asc()))).all()
    windows: dict[str, dict] = {}
    for row in rows:
        payload = row.payload or {}
        feedback_step_id = str(payload.get("feedback_step_id") or "")
        if not feedback_step_id:
            continue
        if row.event_type == "feedback.opened":
            closes_at = payload.get("closes_at")
            try:
                closes = datetime.fromisoformat(str(closes_at)) if closes_at else None
            except ValueError:
                closes = None
            windows[feedback_step_id] = {
                "segment_step_id": row.step_id,
                "feedback_step_id": feedback_step_id,
                "title": payload.get("title") or "Feedback",
                "closes_at": closes,
                "open": bool(closes and now < closes),
            }
        elif feedback_step_id in windows:
            windows[feedback_step_id]["open"] = False
    return [window for window in windows.values() if window.get("open")]


async def feedback_availability(event: Event, workflow: ExperienceWorkflow, db: AsyncSession, feedback_step_id: str, *, now: datetime | None = None) -> dict:
    """Return whether a Feedback step is controlled by a program segment and open."""
    controlled = any(
        (ref := _feedback_reference(segment, workflow)) is not None and ref.id == feedback_step_id
        for segment in segment_steps(workflow)
    )
    if not controlled:
        return {"controlled": False, "open": True, "window": None}
    moment = now or now_local()
    windows = await _feedback_windows(event, workflow, db, now=moment)
    window = next((item for item in windows if item["feedback_step_id"] == feedback_step_id), None)
    return {"controlled": True, "open": bool(window), "window": window}


async def program_state(event: Event, workflow: ExperienceWorkflow | None, db: AsyncSession, *, now: datetime | None = None) -> dict:
    if not event.live_program_enabled or not workflow:
        return {"enabled": False, "current_segments": [], "next_segments": [], "days": [], "feedback_open": None}
    moment = now or now_local()
    current, future = [], []
    days: dict[str, dict] = {}
    for step in segment_steps(workflow):
        start, end = segment_window(event, step)
        active = start <= moment < end
        segment = _segment_out(event, step, now=moment, active=active)
        day_key = start.date().isoformat()
        if day_key not in days:
            days[day_key] = {
                "date": day_key,
                "label": f"{start.strftime('%A, %B')} {start.day}",
                "segments": [],
            }
        days[day_key]["segments"].append(segment)
        if active:
            current.append(segment)
        elif start > moment:
            future.append(segment)
    feedback_windows = await _feedback_windows(event, workflow, db, now=moment)
    return {
        "enabled": True,
        "current_segments": current,
        "next_segments": future[:3],
        "days": list(days.values()),
        "feedback_open": feedback_windows[0] if feedback_windows else None,
    }


async def _already_logged(db: AsyncSession, *, event_id: str, workflow_id: str, step_id: str, event_type: str) -> bool:
    return bool(await db.scalar(select(ExperienceEvent.id).where(
        ExperienceEvent.event_id == event_id,
        ExperienceEvent.workflow_id == workflow_id,
        ExperienceEvent.step_id == step_id,
        ExperienceEvent.event_type == event_type,
    ).limit(1)))


def _program_announcement(step: ExperienceStep) -> tuple[str, str] | None:
    config = step.config or {}
    announce = config.get("announce") if isinstance(config.get("announce"), dict) else {}
    if not announce.get("enabled"):
        return None
    body = str(announce.get("body") or step.description or f"Now: {step.title}")[:5000]
    title = str(announce.get("title") or f"Now: {step.title}")[:255]
    return title, body


async def _write_in_hub_announcement(event: Event, step: ExperienceStep, title: str, body: str, db: AsyncSession) -> None:
    ann = EventAnnouncement(
        event_id=event.id, title=title, body=body, audience_type="attending_only",
        send_in_app=True, sent_at=datetime.utcnow(),
        created_by=None,
    )
    db.add(ann)
    await db.flush()
    db.add(EventMessage(
        event_id=event.id, sender_type="system", sender_id=None, guest_id=None,
        message_type="announcement", body=body,
        message_metadata={"announcement_id": ann.id, "title": title, "program_step_id": step.id},
    ))


async def tick(db: AsyncSession, *, now: datetime | None = None) -> dict[str, int]:
    """Fire eligible segment starts once. Safe to call repeatedly or after restarts."""
    moment = now or now_local()
    events = (await db.scalars(select(Event).where(
        Event.status == "active", Event.live_program_enabled.is_(True), Event.experience_enabled.is_(True),
    ))).all()
    fired = 0
    feedback_opened = 0
    feedback_closed = 0
    for event in events:
        workflow = await active_workflow(event.id, db)
        if not workflow:
            continue
        enabled_at = to_event_local(event.live_program_enabled_at) if event.live_program_enabled_at else moment
        for step in segment_steps(workflow):
            start, end = segment_window(event, step)
            if start > moment or start < enabled_at:
                continue
            if not await _already_logged(db, event_id=event.id, workflow_id=workflow.id, step_id=step.id, event_type="segment.started"):
                db.add(ExperienceEvent(
                    event_id=event.id, workflow_id=workflow.id, step_id=step.id,
                    event_type="segment.started", source="program_clock",
                    payload={"starts_at": start.isoformat()},
                ))
                notice = _program_announcement(step)
                if notice:
                    title, body = notice
                    await _write_in_hub_announcement(event, step, title, body, db)
                    if event.festiome_addon_enabled and event.festiome_enabled:
                        await queue_announcement(
                            db, event_id=event.id, title=title, body=body, kind="program",
                            source_ref=f"program-segment:{step.id}",
                        )
                fired += 1
            feedback_step = _feedback_reference(step, workflow)
            config = step.config or {}
            feedback_config = config.get("feedback") if isinstance(config.get("feedback"), dict) else {}
            if feedback_step and feedback_config.get("opens_on", "segment_end") == "segment_end" and end <= moment:
                if not await _already_logged(db, event_id=event.id, workflow_id=workflow.id, step_id=step.id, event_type="feedback.opened"):
                    window_seconds = max(60, int(feedback_config.get("window_seconds") or 1800))
                    closes_at = moment + timedelta(seconds=window_seconds)
                    db.add(ExperienceEvent(
                        event_id=event.id, workflow_id=workflow.id, step_id=step.id,
                        event_type="feedback.opened", source="program_clock",
                        payload={"feedback_step_id": feedback_step.id, "title": f"How was {step.title}?", "closes_at": closes_at.isoformat()},
                    ))
                    feedback_title = f"How was {step.title}?"
                    feedback_body = "Your feedback is now open in FestioHub. It only takes a moment."
                    await _write_in_hub_announcement(event, step, feedback_title, feedback_body, db)
                    if event.festiome_addon_enabled and event.festiome_enabled:
                        await queue_announcement(
                            db, event_id=event.id, title=feedback_title, body=feedback_body,
                            kind="program_feedback", source_ref=f"program-feedback:{step.id}",
                        )
                    feedback_opened += 1
        # Close any program-managed feedback whose recorded window has elapsed.
        open_rows = (await db.scalars(select(ExperienceEvent).where(
            ExperienceEvent.event_id == event.id, ExperienceEvent.workflow_id == workflow.id,
            ExperienceEvent.event_type == "feedback.opened",
        ))).all()
        for opened in open_rows:
            payload = opened.payload or {}
            try:
                closes_at = datetime.fromisoformat(str(payload.get("closes_at")))
            except (TypeError, ValueError):
                continue
            if closes_at > moment or await _already_logged(db, event_id=event.id, workflow_id=workflow.id, step_id=opened.step_id, event_type="feedback.closed"):
                continue
            db.add(ExperienceEvent(
                event_id=event.id, workflow_id=workflow.id, step_id=opened.step_id,
                event_type="feedback.closed", source="program_clock", payload=payload,
            ))
            feedback_closed += 1
    if fired or feedback_opened or feedback_closed:
        await db.commit()
    return {"segments_started": fired, "feedback_opened": feedback_opened, "feedback_closed": feedback_closed}
