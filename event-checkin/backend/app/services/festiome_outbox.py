"""Transactional outbox and retry worker for GuestHub -> FestioMe commands."""

import asyncio
import logging
import random
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import AsyncSessionLocal
from ..models import Event, FestioMeOutbox, Guest
from .festiome_client import FestioMeClient, FestioMeUnavailable, get_festiome_client

logger = logging.getLogger("festiome_outbox")
TICK_SECONDS = 5
MAX_ATTEMPTS = 10


def _backoff_seconds(attempts: int, base_cap: int = 900) -> int:
    """Exponential backoff with equal jitter. When FestioMe is down, a whole
    batch of guest-sync rows fails at once; jitter spreads their retries so they
    don't stampede the service in lockstep on recovery."""
    base = min(base_cap, 2 ** min(attempts, 9))
    return int(base / 2 + random.uniform(0, base / 2))


def _guest_payload(guest: Guest) -> dict[str, Any]:
    return {
        "guest_ref": guest.id,
        "name": f"{guest.first_name} {guest.last_name}".strip(),
        "email": guest.email,
        "phone": guest.phone,
        "status": guest.rsvp_status,
    }


def guest_is_festiome_eligible(guest: Guest, event: Event | None = None) -> bool:
    """Return whether a guest should be an event's FestioMe member."""
    return guest.rsvp_status == "confirmed" or bool(
        event and not event.rsvp_enabled and guest.rsvp_status == "invited"
    )


def queue_guest_sync(
    db: AsyncSession, guest: Guest, *, event: Event | None = None,
    revision: str | None = None,
) -> None:
    """Queue an upsert for eligible guests, otherwise a membership removal."""
    command = "member.upsert" if guest_is_festiome_eligible(guest, event) else "member.remove"
    rev = revision or datetime.utcnow().isoformat(timespec="microseconds")
    db.add(FestioMeOutbox(
        event_id=guest.event_id,
        command=command,
        idempotency_key=f"guest:{guest.id}:{command}:{rev}",
        payload=_guest_payload(guest),
    ))


def queue_guest_remove(db: AsyncSession, *, event_id: str, guest_id: str) -> None:
    db.add(FestioMeOutbox(
        event_id=event_id,
        command="member.remove",
        idempotency_key=f"guest:{guest_id}:deleted:{datetime.utcnow().isoformat(timespec='microseconds')}",
        payload={"guest_ref": guest_id},
    ))


async def queue_announcement(
    db: AsyncSession, *, event_id: str, title: str, body: str,
    kind: str = "event", urgent: bool = False, source_ref: str | None = None,
) -> FestioMeOutbox:
    """Queue a FestioMe announcement, idempotently.

    Callers that pass a request-scoped (not time-unique) source_ref — e.g. a
    workflow-publish event that may legitimately be retried by the client
    after a timeout, or double-submitted by a double-click — can otherwise
    race two concurrent inserts into the same idempotency_key and crash with
    an unhandled UniqueViolationError. ON CONFLICT DO NOTHING makes a repeat
    call a safe no-op instead, matching what an idempotency key is for.
    """
    source = source_ref or f"manual:{datetime.utcnow().isoformat(timespec='microseconds')}"
    idempotency_key = f"announcement:{event_id}:{source}"
    row = FestioMeOutbox(
        event_id=event_id,
        command="announcement.publish",
        idempotency_key=idempotency_key,
        payload={"title": title, "body": body, "kind": kind, "urgent": urgent, "source_ref": source},
    )
    stmt = pg_insert(FestioMeOutbox).values(
        event_id=event_id,
        command="announcement.publish",
        idempotency_key=idempotency_key,
        payload=row.payload,
    ).on_conflict_do_nothing(index_elements=["idempotency_key"])
    await db.execute(stmt)
    return row


async def _deliver(row: FestioMeOutbox, client: FestioMeClient) -> None:
    if row.command == "member.upsert":
        await client.upsert_guest(row.event_id, **row.payload)
    elif row.command == "member.remove":
        await client.remove_guest(row.event_id, row.payload["guest_ref"])
    elif row.command == "announcement.publish":
        await client.publish_announcement(
            row.event_id, idempotency_key=row.idempotency_key, **row.payload
        )
    else:
        raise ValueError(f"Unknown FestioMe outbox command: {row.command}")


async def process_due(*, limit: int = 50, client: FestioMeClient | None = None) -> int:
    client = client or get_festiome_client()
    if not client.configured:
        return 0
    delivered = 0
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(FestioMeOutbox)
            .where(
                FestioMeOutbox.status.in_(["pending", "retry"]),
                FestioMeOutbox.next_attempt_at <= datetime.utcnow(),
            )
            .order_by(FestioMeOutbox.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )).scalars().all()
        for row in rows:
            event = await db.get(Event, row.event_id)
            try:
                await _deliver(row, client)
            except (FestioMeUnavailable, ValueError) as exc:
                row.attempts += 1
                row.last_error = str(exc)[:2000]
                row.status = "failed" if row.attempts >= MAX_ATTEMPTS else "retry"
                row.next_attempt_at = datetime.utcnow() + timedelta(seconds=_backoff_seconds(row.attempts))
                if event:
                    event.festiome_last_error = row.last_error
            except Exception as exc:  # contain unexpected integration failures
                row.attempts += 1
                row.last_error = f"Unexpected: {exc}"[:2000]
                row.status = "failed" if row.attempts >= MAX_ATTEMPTS else "retry"
                row.next_attempt_at = datetime.utcnow() + timedelta(seconds=_backoff_seconds(row.attempts, base_cap=120))
                if event:
                    event.festiome_last_error = row.last_error
                logger.exception("FestioMe outbox delivery crashed for %s", row.id)
            else:
                row.status = "delivered"
                row.delivered_at = datetime.utcnow()
                row.last_error = None
                if event:
                    event.festiome_last_sync_at = row.delivered_at
                    event.festiome_last_error = None
                delivered += 1
        await db.commit()
    return delivered


async def run() -> None:
    logger.info("festiome_outbox started")
    while True:
        try:
            await process_due()
        except Exception:
            logger.exception("festiome_outbox tick crashed")
        await asyncio.sleep(TICK_SECONDS)
