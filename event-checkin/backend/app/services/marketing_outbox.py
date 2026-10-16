"""Retry CRM capture without coupling business requests to Marketing uptime."""
import asyncio
import logging
import random
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select

from ..config import settings
from ..engagement_config import engagement_settings
from ..database import AsyncSessionLocal
from ..models import MarketingOutbox
from .marketing_client import ENDPOINTS, _service_token

logger = logging.getLogger(__name__)
TICK_SECONDS = 5
MAX_ATTEMPTS = 12


def _backoff_seconds(attempts: int) -> int:
    ceiling = min(900, 5 * (2 ** min(attempts - 1, 8)))
    return max(1, int(random.uniform(ceiling / 2, ceiling)))


async def _deliver(row: MarketingOutbox, client: httpx.AsyncClient) -> None:
    if row.endpoint not in ENDPOINTS:
        raise ValueError("Unknown Marketing outbox endpoint")
    response = await client.post(
        f"/api/marketing/internal/{row.endpoint}", json=row.payload,
        headers={"Authorization": f"Bearer {_service_token()}"},
    )
    response.raise_for_status()
    # A 2xx that says no lead was matched is not a successful capture. The
    # registration/lead event may be in another replica's batch; retry later.
    result = response.json()
    if not isinstance(result, dict) or result.get("recorded") is False:
        raise ValueError("Marketing did not record the event")


async def process_due(*, limit: int = 20, transport: httpx.AsyncBaseTransport | None = None) -> int:
    # Capture always runs. Dispatch is deliberately OFF until an operator has
    # reviewed the new service-side automation and explicitly enables it.
    if not (engagement_settings.marketing_outbox_enabled and settings.marketing_service_url and settings.planner_internal_token):
        return 0
    delivered = 0
    async with httpx.AsyncClient(
        base_url=settings.marketing_service_url.rstrip("/"), timeout=5.0, transport=transport,
    ) as client:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(MarketingOutbox).where(
                MarketingOutbox.status.in_(("pending", "retry")),
                MarketingOutbox.next_attempt_at <= datetime.utcnow(),
            ).order_by(MarketingOutbox.created_at, MarketingOutbox.id).limit(limit)
              .with_for_update(skip_locked=True))).scalars().all()
            for row in rows:
                row.attempts += 1
                try:
                    await _deliver(row, client)
                except Exception as exc:
                    # Never retain response bodies, tokens, URLs or lead PII in
                    # operational logs. The event itself remains inspectable.
                    reason = f"HTTP {exc.response.status_code}" if isinstance(exc, httpx.HTTPStatusError) else type(exc).__name__
                    row.status = "failed" if row.attempts >= MAX_ATTEMPTS else "retry"
                    row.last_error = reason
                    row.next_attempt_at = datetime.utcnow() + timedelta(seconds=_backoff_seconds(row.attempts))
                    logger.warning("Marketing capture %s %s (attempt %s)", row.id, reason, row.attempts)
                else:
                    row.status = "delivered"
                    row.delivered_at = datetime.utcnow()
                    row.last_error = None
                    # Keep an idempotency tombstone, not an indefinite second
                    # copy of prospect contact details or conversation content.
                    row.payload = {
                        key: row.payload[key] for key in ("event_id", "occurred_at", "lifecycle_event")
                        if key in row.payload
                    }
                    delivered += 1
            await db.commit()
    return delivered


async def run() -> None:
    while True:
        try:
            await process_due()
        except Exception:
            logger.exception("Marketing outbox tick failed")
        await asyncio.sleep(TICK_SECONDS)
