"""Replica-safe scheduler for the Reminders add-on. Mirrors
festiome_outbox.py's SKIP-LOCKED claim shape, but as a two-phase
claim-then-process instead of one transaction: fan-out here can mean
hundreds of slow third-party HTTP sends per reminder (see reminder_send.py),
not one small payload, so holding a row lock for the whole send would block
a concurrent admin edit of the same reminder and let ticks back up. The
claim step itself is still a DB-visible SKIP LOCKED row lock, not an
in-memory guard, so two backend replicas ticking at once never claim the
same reminder -- this codebase paid for getting that distinction wrong once
already this session (see entitlements.run_cache_refresher's docstring)."""
import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import and_, or_, select

from ..database import AsyncSessionLocal
from ..models import Event, EventReminder
from .reminder_send import send_reminder

logger = logging.getLogger("reminder_outbox")
TICK_SECONDS = 15
# A "sending" row stuck longer than this is assumed to have crashed
# mid-fanout (process died, replica restarted) and is safe to reclaim.
RECLAIM_AFTER = timedelta(minutes=15)


async def claim_due(*, limit: int = 20) -> list[str]:
    """Phase 1: claim due reminder rows and commit immediately, so the
    (potentially slow) per-guest fan-out in phase 2 doesn't hold the row
    lock. Returns claimed reminder ids."""
    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(EventReminder)
            .where(
                EventReminder.enabled.is_(True),
                EventReminder.fired_at.is_(None),
                EventReminder.fire_at_utc <= now,
                or_(
                    EventReminder.status == "pending",
                    and_(EventReminder.status == "sending", EventReminder.claimed_at <= now - RECLAIM_AFTER),
                ),
            )
            .order_by(EventReminder.fire_at_utc)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )).scalars().all()
        ids = [row.id for row in rows]
        for row in rows:
            row.status = "sending"
            row.claimed_at = now
        await db.commit()
    return ids


async def process_claimed(reminder_id: str) -> None:
    """Phase 2: fan out to guests, then record the result in a fresh
    transaction. If another replica's earlier tick already finished this
    reminder (status no longer "sending"), this is a no-op."""
    async with AsyncSessionLocal() as db:
        reminder = await db.get(EventReminder, reminder_id)
        if not reminder or reminder.status != "sending":
            return
        event = await db.get(Event, reminder.event_id)
        if not event:
            reminder.status = "failed"
            reminder.last_error = "Parent event no longer exists"
            await db.commit()
            return
        # Re-check the add-on gate at fire time, not just at creation -- same
        # discipline the public Speaker/Registry read paths already apply
        # (re-checking *_enabled rather than trusting it stayed true since
        # creation). Terminal state, not a retry: an organizer who disables
        # Reminders shouldn't have it silently keep firing in the background,
        # nor should a disabled reminder tick forever waiting to be re-enabled.
        if not event.reminders_enabled:
            reminder.status = "failed"
            reminder.last_error = "Reminders add-on was disabled before this reminder fired"
            await db.commit()
            return
        try:
            targeted, sent = await send_reminder(event, reminder, db)
        except Exception as exc:
            logger.exception("reminder send crashed reminder=%s", reminder_id)
            reminder.status = "pending"  # retry next tick
            reminder.last_error = str(exc)[:2000]
            await db.commit()
            return
        reminder.guests_targeted = targeted
        reminder.guests_sent = sent
        reminder.status = "sent"
        reminder.fired_at = datetime.utcnow()
        await db.commit()


async def process_due(*, limit: int = 20) -> int:
    ids = await claim_due(limit=limit)
    for reminder_id in ids:
        await process_claimed(reminder_id)
    return len(ids)


async def run() -> None:
    logger.info("reminder_outbox started")
    while True:
        try:
            await process_due()
        except Exception:
            logger.exception("reminder_outbox tick crashed")
        await asyncio.sleep(TICK_SECONDS)
