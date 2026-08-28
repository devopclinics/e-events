"""Replica-safe outbox worker for unified scheduled communications."""
import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import and_, or_, select

from ..database import AsyncSessionLocal
from ..models import Event, ScheduledCommunication
from .scheduled_communication_send import send_scheduled_communication

logger = logging.getLogger("scheduled_communication_outbox")
TICK_SECONDS = 15
RECLAIM_AFTER = timedelta(minutes=15)


async def claim_due(*, limit: int = 20) -> list[str]:
    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        rows = list((await db.scalars(
            select(ScheduledCommunication)
            .where(
                ScheduledCommunication.scheduled_for_utc <= now,
                or_(
                    ScheduledCommunication.status == "scheduled",
                    and_(
                        ScheduledCommunication.status == "sending",
                        ScheduledCommunication.claimed_at <= now - RECLAIM_AFTER,
                    ),
                ),
            )
            .order_by(ScheduledCommunication.scheduled_for_utc)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )).all())
        ids = [row.id for row in rows]
        for row in rows:
            row.status = "sending"
            row.claimed_at = now
        await db.commit()
    return ids


async def process_claimed(communication_id: str) -> None:
    async with AsyncSessionLocal() as db:
        communication = await db.get(ScheduledCommunication, communication_id)
        if not communication or communication.status != "sending":
            return
        event = await db.get(Event, communication.event_id)
        if not event:
            communication.status = "failed"
            communication.last_error = "Parent event no longer exists"
            await db.commit()
            return
        try:
            targeted, sent, failed = await send_scheduled_communication(event, communication, db)
        except Exception as exc:
            logger.exception("scheduled communication crashed communication=%s", communication_id)
            communication.status = "scheduled"
            communication.last_error = str(exc)[:2000]
            await db.commit()
            return
        communication.recipients_targeted = targeted
        communication.recipients_sent = sent
        communication.recipients_failed = failed
        communication.status = "sent" if failed == 0 else ("partial" if sent else "failed")
        communication.sent_at = datetime.utcnow()
        communication.last_error = None if failed == 0 else f"{failed} recipient(s) could not be reached"
        await db.commit()


async def process_due(*, limit: int = 20) -> int:
    ids = await claim_due(limit=limit)
    for communication_id in ids:
        await process_claimed(communication_id)
    return len(ids)


async def run() -> None:
    logger.info("scheduled_communication_outbox started")
    while True:
        try:
            await process_due()
        except Exception:
            logger.exception("scheduled_communication_outbox tick crashed")
        await asyncio.sleep(TICK_SECONDS)
