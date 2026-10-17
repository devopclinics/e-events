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
    # A 2xx alone is not proof of durable capture. Each endpoint has a distinct
    # receipt contract; reject malformed acknowledgements before the caller
    # marks delivery and scrubs the only recoverable copy of the payload.
    result = response.json()
    if not isinstance(result, dict):
        raise ValueError("Marketing did not record the event")
    # Previously queued public demos used ingest. Keep its lifecycle precedence
    # in sync with the service's legacy adapter, without weakening normal ingest.
    legacy_demo = (
        row.endpoint == "ingest" and row.payload.get("source") == "website_demo"
        and (row.payload.get("lifecycle_event") or row.payload.get("stage")) == "demo_requested"
    )
    lead_id = result.get("id")
    has_lead_id = isinstance(lead_id, str) and bool(lead_id.strip())
    if row.endpoint == "demo-requests" or legacy_demo:
        prospect_id = result.get("prospect_id")
        recorded = (
            result.get("recorded") is True and result.get("unmatched") is True
            and "lead_id" in result and result["lead_id"] is None
            and isinstance(prospect_id, str) and bool(prospect_id.strip())
        )
        # Old demo events may have committed before this trust boundary existed,
        # but lost their ACK. Accept only the service's explicit receipt replay,
        # including a retained deleted-lead ID, never a fresh lead response.
        if legacy_demo and not recorded:
            recorded = (
                result.get("recorded") is True and result.get("legacy_demo_receipt") is True
                and result.get("ingest_duplicate") is True and has_lead_id
            )
    elif row.endpoint == "ingest":
        if any(key in result for key in ("pending_identity", "prospect_id", "unmatched", "lead_id")):
            # Unverified account claims have their own durable receipt, not a
            # lead. Require the complete, event-bound contract before scrubbing
            # the source payload; a generic prospect or HTTP 200 is insufficient.
            prospect_id = result.get("prospect_id")
            recorded = (
                result.get("pending_identity") is True
                and result.get("recorded") is True and result.get("unmatched") is True
                and "lead_id" in result and result["lead_id"] is None
                and "id" not in result
                and isinstance(prospect_id, str) and bool(prospect_id.strip())
                and isinstance(result.get("duplicate"), bool)
                and result.get("ingest_duplicate") is result["duplicate"]
                and isinstance(result.get("event_id"), str)
                and bool(result["event_id"].strip())
                and result["event_id"] == row.payload.get("event_id")
            )
        else:
            # Normal ingest returns a lead. A replay after deletion returns
            # the retained ID with removed=True, also a valid acknowledgement.
            lifecycle = row.payload.get("lifecycle_event") or row.payload.get("stage") or "registered"
            subject = row.payload.get("festio_user_id")
            subject_milestone = (
                isinstance(subject, str) and bool(subject.strip())
                and lifecycle in {"event_created", "event_updated", "activated", "paid", "customer"}
                and not any(field in row.payload for field in ("consent_email", "consent_sms", "consent_whatsapp"))
            )
            recorded = (
                has_lead_id
                and ("recorded" not in result or result["recorded"] is True)
                and (
                    row.payload.get("email_verified") is True or subject_milestone
                    or result.get("ingest_duplicate") is True
                )
            )
    else:
        # A persisted unmatched prospect is a valid conversation receipt. Only
        # the literal boolean true proves recording, not 1, "true", or null.
        recorded = result.get("recorded") is True
    if not recorded:
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
