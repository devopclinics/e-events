"""Transactional outbox and retry worker for outbound webhook deliveries
(Gatsby gap-backlog item: 'Add outbound webhooks for customer automation').
Same shape as services/festiome_outbox.py (SKIP LOCKED claim, exponential
backoff), kept as its own table/worker rather than generalizing that one,
since its dispatch is hardcoded to FestioMe-specific commands."""
import asyncio
import hashlib
import hmac
import json
import logging
import random
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import AsyncSessionLocal
from ..models import WebhookDelivery, WebhookEndpoint

logger = logging.getLogger("webhook_outbox")
TICK_SECONDS = 5
MAX_ATTEMPTS = 8
DELIVERY_TIMEOUT_SECONDS = 10


def _backoff_seconds(attempts: int, base_cap: int = 1800) -> int:
    """Exponential backoff with equal jitter — same shape as festiome_outbox's,
    tuned for a ~1-day retry ceiling instead of festiome's 15-minute one, since
    a customer's endpoint being down for hours is common and not urgent."""
    base = min(base_cap, 2 ** min(attempts, 10))
    return int(base / 2 + random.uniform(0, base / 2))


def sign_payload(secret: str, raw_body: bytes) -> str:
    return hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()


async def queue_webhook_event(db: AsyncSession, *, org_id: str, event_type: str, payload: dict) -> int:
    """Fan out one event to every active endpoint subscribed to it. Returns
    the number of deliveries queued (0 if the org has no matching endpoint —
    the common case, so this stays cheap to call from any code path)."""
    endpoints = (await db.execute(
        select(WebhookEndpoint).where(WebhookEndpoint.org_id == org_id, WebhookEndpoint.is_active.is_(True))
    )).scalars().all()
    queued = 0
    body = json.dumps({"event_type": event_type, "data": payload}, default=str)
    for endpoint in endpoints:
        if event_type in (endpoint.event_types or []):
            db.add(WebhookDelivery(endpoint_id=endpoint.id, event_type=event_type, payload=body))
            queued += 1
    return queued


async def _deliver(delivery: WebhookDelivery, endpoint: WebhookEndpoint, *, transport=None) -> None:
    body_bytes = delivery.payload.encode()
    signature = sign_payload(endpoint.secret, body_bytes)
    async with httpx.AsyncClient(timeout=DELIVERY_TIMEOUT_SECONDS, transport=transport) as client:
        resp = await client.post(
            endpoint.url,
            content=body_bytes,
            headers={
                "Content-Type": "application/json",
                "X-Festio-Signature": f"sha256={signature}",
                "X-Festio-Event-Type": delivery.event_type,
            },
        )
    resp.raise_for_status()


async def process_due(*, limit: int = 50, transport=None) -> int:
    delivered = 0
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(WebhookDelivery)
            .where(WebhookDelivery.status == "pending", WebhookDelivery.next_attempt_at <= datetime.utcnow())
            .order_by(WebhookDelivery.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )).scalars().all()
        for row in rows:
            endpoint = await db.get(WebhookEndpoint, row.endpoint_id)
            if not endpoint or not endpoint.is_active:
                row.status = "failed"
                row.last_error = "Endpoint deleted or deactivated"
                continue
            try:
                await _deliver(row, endpoint, transport=transport)
            except Exception as exc:
                row.attempt_count += 1
                row.last_error = str(exc)[:2000]
                if row.attempt_count >= MAX_ATTEMPTS:
                    row.status = "failed"
                else:
                    row.next_attempt_at = datetime.utcnow() + timedelta(seconds=_backoff_seconds(row.attempt_count))
                logger.warning("Webhook delivery %s to %s failed (attempt %s): %s", row.id, endpoint.url, row.attempt_count, exc)
            else:
                row.status = "delivered"
                row.delivered_at = datetime.utcnow()
                row.last_error = None
                delivered += 1
        await db.commit()
    return delivered


async def run() -> None:
    logger.info("webhook_outbox started")
    while True:
        try:
            await process_due()
        except Exception:
            logger.exception("webhook_outbox tick crashed")
        await asyncio.sleep(TICK_SECONDS)
