"""Durable, failure-isolated Experience -> Festio Live program sync."""

import asyncio
import logging
import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..database import AsyncSessionLocal
from ..models import EngagementSyncOutbox, Event, ExperienceStep, ExperienceWorkflow
from ..timeutil import to_event_local

logger = logging.getLogger("engagement_sync_outbox")
TICK_SECONDS = 5
MAX_ATTEMPTS = 12


def _backoff_seconds(attempts: int) -> int:
    ceiling = min(900, 2 ** min(attempts, 9))
    return int(ceiling / 2 + random.uniform(0, ceiling / 2))


def _event_timezone(event: Event):
    try:
        return ZoneInfo(event.timezone or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _session_source(step: ExperienceStep) -> dict:
    config = step.config or {}
    source = config.get("session") or config.get("session_details") or config.get("schedule") or config.get("session_config") or {}
    if (not source or not isinstance(source, dict)) and isinstance(config.get("sessions"), list) and config["sessions"]:
        source = config["sessions"][0]
    if not isinstance(source, dict):
        source = {}
    return source


def _session_details(step: ExperienceStep) -> dict:
    source = _session_source(step)
    config = step.config or {}
    program = config.get("program") if isinstance(config.get("program"), dict) else {}
    return {
        "room": source.get("room") or source.get("location") or source.get("venue") or "",
        "speaker": source.get("speaker") or source.get("host") or source.get("presenter") or "",
        "speaker_id": source.get("speaker_id") or "",
        "capacity": source.get("capacity"),
        "category": program.get("category") or "",
    }


def _snapshot(event: Event, workflow: ExperienceWorkflow, step: ExperienceStep, status: str) -> dict:
    timezone = _event_timezone(event)
    starts_at = None
    ends_at = None
    if step.starts_offset_seconds is not None:
        # Event timestamps are stored as naive UTC throughout core. Convert the
        # anchor before applying the local-program offset; treating the stored
        # value as local shifts every session by the zone's UTC offset (for
        # example, a 13:30 Chicago session appeared as 18:30 on the projector).
        base = to_event_local(event.event_date, timezone)
        start = base + timedelta(seconds=step.starts_offset_seconds)
        starts_at = start.isoformat()
        if step.duration_seconds:
            ends_at = (start + timedelta(seconds=step.duration_seconds)).isoformat()
    else:
        # Imported session-attendance steps historically stored local date/time
        # in config rather than the newer offset columns. Preserve that data in
        # the same event timezone instead of producing an undated Live agenda.
        source = _session_source(step)
        date_value = source.get("date") or source.get("session_date")
        start_value = source.get("start_time") or source.get("startTime") or source.get("start")
        end_value = source.get("end_time") or source.get("endTime") or source.get("end")
        if start_value:
            try:
                if "T" in str(start_value):
                    start = datetime.fromisoformat(str(start_value).replace("Z", "+00:00"))
                else:
                    local_date = str(date_value or event.event_date.date().isoformat())
                    start = datetime.fromisoformat(f"{local_date}T{start_value}")
                start = start.replace(tzinfo=timezone) if start.tzinfo is None else start.astimezone(timezone)
                starts_at = start.isoformat()
                if end_value:
                    if "T" in str(end_value):
                        end = datetime.fromisoformat(str(end_value).replace("Z", "+00:00"))
                    else:
                        end = datetime.fromisoformat(f"{start.date().isoformat()}T{end_value}")
                    end = end.replace(tzinfo=timezone) if end.tzinfo is None else end.astimezone(timezone)
                    if end <= start:
                        end += timedelta(days=1)
                    ends_at = end.isoformat()
                elif step.duration_seconds:
                    ends_at = (start + timedelta(seconds=step.duration_seconds)).isoformat()
            except (TypeError, ValueError):
                logger.warning("Invalid Experience session schedule for step %s", step.id)
    details = _session_details(step)
    return {
        "source_workflow_id": workflow.id,
        "source_step_id": step.id,
        "source_key": step.key,
        "title": step.title,
        "description": step.description,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "timezone": event.timezone or "UTC",
        "sort_order": step.sort_order,
        "status": status if step.enabled else "disabled",
        "event_name": event.name,
        **details,
    }


def queue_workflow_sync(
    db: AsyncSession,
    *,
    event: Event,
    workflow: ExperienceWorkflow,
    status: str | None = None,
) -> int:
    """Queue all program/session steps in the caller's current transaction."""
    source_status = status or workflow.status
    queued_at = datetime.utcnow()
    source_version = int(queued_at.timestamp() * 1_000_000)
    count = 0
    for step in workflow.steps:
        if not (step.is_segment or step.type == "session_attendance"):
            continue
        command = "experience.program_session.upsert"
        key = f"program-session:{step.id}:{source_version}:{source_status}"
        db.add(EngagementSyncOutbox(
            org_id=event.org_id,
            event_id=event.id,
            source_id=step.id,
            source_version=source_version,
            command=command,
            idempotency_key=key,
            payload=_snapshot(event, workflow, step, source_status),
        ))
        count += 1
    return count


async def queue_active_program_sync(db: AsyncSession, event: Event) -> int:
    workflow = await db.scalar(
        select(ExperienceWorkflow)
        .options(selectinload(ExperienceWorkflow.steps))
        .where(
            ExperienceWorkflow.event_id == event.id,
            ExperienceWorkflow.status == "published",
        )
        .limit(1)
    )
    if not workflow:
        return 0
    return queue_workflow_sync(db, event=event, workflow=workflow)


async def _deliver(row: EngagementSyncOutbox, client: httpx.AsyncClient) -> None:
    if not settings.engagement_internal_token:
        raise RuntimeError("ENGAGEMENT_INTERNAL_TOKEN is not configured")
    response = await client.post(
        "/api/engagement/internal/v1/program-events",
        headers={"X-Internal-Token": settings.engagement_internal_token},
        json={
            "delivery_id": row.id,
            "event_type": row.command,
            "occurred_at": row.created_at.isoformat(),
            "org_id": row.org_id,
            "event_id": row.event_id,
            "source_id": row.source_id,
            "source_version": row.source_version,
            "data": row.payload,
        },
    )
    if response.status_code >= 400:
        detail = response.text[:1000]
        raise RuntimeError(f"Festio Live sync returned {response.status_code}: {detail}")


async def process_due(*, limit: int = 50, transport: httpx.AsyncBaseTransport | None = None) -> int:
    if not settings.engagement_service_url or not settings.engagement_internal_token:
        return 0
    delivered = 0
    timeout = httpx.Timeout(settings.engagement_request_timeout_seconds)
    async with httpx.AsyncClient(base_url=settings.engagement_service_url.rstrip("/"), timeout=timeout, transport=transport) as client:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(EngagementSyncOutbox)
                .where(
                    EngagementSyncOutbox.status.in_(("pending", "retry")),
                    EngagementSyncOutbox.next_attempt_at <= datetime.utcnow(),
                )
                .order_by(EngagementSyncOutbox.created_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )).scalars().all()
            for row in rows:
                try:
                    await _deliver(row, client)
                except Exception as exc:  # failure containment is the contract
                    row.attempts += 1
                    row.last_error = str(exc)[:2000]
                    row.status = "failed" if row.attempts >= MAX_ATTEMPTS else "retry"
                    row.next_attempt_at = datetime.utcnow() + timedelta(seconds=_backoff_seconds(row.attempts))
                    logger.warning("Festio Live sync delivery failed for %s: %s", row.id, exc)
                else:
                    row.status = "delivered"
                    row.delivered_at = datetime.utcnow()
                    row.last_error = None
                    delivered += 1
            await db.commit()
    return delivered


async def run() -> None:
    logger.info("engagement_sync_outbox started")
    while True:
        try:
            await process_due()
        except Exception:
            logger.exception("engagement_sync_outbox tick crashed")
        await asyncio.sleep(TICK_SECONDS)
