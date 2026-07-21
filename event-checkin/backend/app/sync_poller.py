"""Background poller that re-imports guest lists from each active event's
source URL on a configurable interval.

Runs as a single asyncio task started in main.py's lifespan.
"""
import asyncio
import logging
from datetime import datetime
from sqlalchemy import select
from fastapi import HTTPException
from .database import AsyncSessionLocal
from .models import Event
from .routers.guests import import_from_source_url, import_warning_summary
from .services import post_event_message, program

logger = logging.getLogger("sync_poller")

# How often the poller wakes up to check what's due. The actual per-event
# cadence is event.source_sync_interval_seconds (defaults to 60).
TICK_SECONDS = 15

# Avoid running two syncs for the same event in parallel if one is slow.
_in_flight: set[str] = set()


async def _sync_one(event_id: str) -> None:
    if event_id in _in_flight:
        return
    _in_flight.add(event_id)
    try:
        async with AsyncSessionLocal() as db:
            event = await db.get(Event, event_id)
            if not event or not event.source_url or event.status != "active" or not event.source_sync_enabled:
                return
            try:
                result = await import_from_source_url(event.source_url, event_id, db)
                event.source_last_sync_at = datetime.utcnow()
                event.source_last_error = None
                event.source_last_warning = import_warning_summary(result)
            except HTTPException as e:
                event.source_last_sync_at = datetime.utcnow()
                event.source_last_error = str(e.detail)
                logger.warning("sync %s failed: %s", event_id, e.detail)
            except Exception as e:
                event.source_last_sync_at = datetime.utcnow()
                event.source_last_error = f"Unexpected error: {e}"
                logger.exception("sync %s crashed", event_id)
            await db.commit()
    finally:
        _in_flight.discard(event_id)


async def _tick() -> None:
    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Event).where(
                Event.status == "active",
                Event.source_url.is_not(None),
                Event.source_sync_enabled.is_(True),
            )
        )
        events = result.scalars().all()

    due_ids = []
    for ev in events:
        interval = max(15, ev.source_sync_interval_seconds or 60)
        if ev.source_last_sync_at is None:
            due_ids.append(ev.id)
            continue
        elapsed = (now - ev.source_last_sync_at).total_seconds()
        if elapsed >= interval:
            due_ids.append(ev.id)

    if due_ids:
        await asyncio.gather(*(_sync_one(eid) for eid in due_ids), return_exceptions=True)

    # Live Program is independently gated per event. Its transition ledger makes
    # this safe to run on every poller wake-up and prevents duplicate notices.
    async with AsyncSessionLocal() as db:
        await program.tick(db)

    # Post-event thank-you/feedback message. post_event_thankyou_sent_at makes
    # this safe to run on every poller wake-up — each event fires at most once.
    async with AsyncSessionLocal() as db:
        await post_event_message.tick(db)


async def run() -> None:
    logger.info("sync_poller started")
    while True:
        try:
            await _tick()
        except Exception:
            logger.exception("sync_poller tick crashed")
        await asyncio.sleep(TICK_SECONDS)


# Standalone entrypoint so the poller can run as its own process/container
# (`python -m app.sync_poller`). Under horizontal scaling exactly ONE such
# process should run — the web pods set RUN_IN_APP_POLLER=false and a single
# dedicated Deployment (replicas: 1) runs this. In-app single-host deploys keep
# the default (poller started from main.py's lifespan).
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run())
