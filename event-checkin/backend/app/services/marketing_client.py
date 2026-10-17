"""Durable lifecycle bridge to the isolated Marketing service.

Capture is part of the source transaction. Only the opt-in worker performs
HTTP, so an unavailable Marketing service cannot delay auth or business work.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx
import jwt
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import MarketingOutbox


ENDPOINTS = frozenset({"ingest", "delivery", "conversations", "demo-requests"})


def lifecycle_event_id(*parts: str) -> str:
    """Stable event identity for repeatable source operations, not HTTP attempts."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, json.dumps(parts)))


def _service_token() -> str:
    timestamp = datetime.now(timezone.utc)
    return jwt.encode({
        "sub": "festio-backend", "email": "system@festio.events", "name": "Festio",
        "is_platform_superadmin": True, "iss": "guesthub", "aud": "marketing",
        "iat": timestamp, "exp": timestamp + timedelta(minutes=2),
    }, settings.planner_internal_token, algorithm="HS256")


async def enqueue_marketing_payload(
    db: AsyncSession, payload: dict, *, endpoint: str = "ingest", event_id: str | None = None,
) -> str:
    """Persist an immutable payload in the caller's transaction; never commit or send.

    Repeated source operations must pass the same event_id. Concurrent/repeated
    captures then safely retain the first payload, including its consent evidence.
    """
    if endpoint not in ENDPOINTS:
        raise ValueError("Unknown Marketing endpoint")
    identity = event_id or payload.get("event_id") or str(uuid.uuid4())
    if not isinstance(identity, str) or not identity.strip() or len(identity) > 128:
        raise ValueError("Marketing event_id must be a nonempty string of at most 128 characters")
    snapshot = {
        **payload,
        "event_id": identity,
        "occurred_at": payload.get("occurred_at") or datetime.now(timezone.utc).isoformat(),
    }
    if endpoint == "ingest":
        snapshot.setdefault("lifecycle_event", snapshot.get("stage") or "lead_updated")
    await db.execute(insert(MarketingOutbox).values(
        id=identity, endpoint=endpoint, payload=snapshot,
    ).on_conflict_do_nothing(index_elements=["id"]))
    return identity


async def ingest_marketing_lead(
    db: AsyncSession, user, *, event_id: str | None = None,
    email_verified: bool = False, **fields,
) -> str:
    """Capture an account claim, not inferred ownership of its email address.

    Only an authentication adapter with a matching, explicitly verified email
    claim may pass True. A loaded User, including an organization owner in a
    background job, does not prove mailbox ownership. Never let arbitrary
    lifecycle fields replace the identity selected by the caller.
    """
    payload = {
        **fields, "festio_user_id": user.firebase_uid or user.id,
        "email": user.email, "name": user.name,
        "email_verified": email_verified is True,
    }
    return await enqueue_marketing_payload(db, payload, event_id=event_id)


async def ingest_marketing_delivery(
    db: AsyncSession, email: str | None, event: str, provider_id: str | None = None,
    *, event_id: str | None = None, occurred_at: str | None = None, bounce_type: str | None = None,
) -> str | None:
    """Mirror receipt outcomes atomically with the verified source webhook."""
    if not email:
        return None
    return await enqueue_marketing_payload(db, {
        "email": email, "event": event, "provider_id": provider_id,
        "occurred_at": occurred_at, "bounce_type": bounce_type,
    }, endpoint="delivery", event_id=event_id)


async def ingest_org_lifecycle(db: AsyncSession, org_id: str, *, stage: str, **fields) -> None:
    """Attribute organization revenue and ticket milestones to its owner."""
    from ..models import Membership, User
    membership = await db.scalar(select(Membership).where(Membership.org_id == org_id).order_by(
        (Membership.role == "owner").desc(), Membership.created_at.asc()
    ).limit(1))
    if not membership:
        return
    user = await db.get(User, membership.user_id)
    if user:
        # Background ownership lookup supplies a subject, never a current
        # authentication claim. Do not forward verification from loose fields.
        fields.pop("email_verified", None)
        await ingest_marketing_lead(db, user, stage=stage, **fields)


async def marketing_preferences(email: str, body: dict | None = None) -> dict:
    if not settings.planner_internal_token or not settings.marketing_service_url:
        raise RuntimeError("Marketing is not configured")
    url = f"{settings.marketing_service_url.rstrip('/')}/api/marketing/internal/preferences/{quote(email.lower(), safe='')}"
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.request("PUT" if body is not None else "GET", url, json=body, headers={"Authorization": f"Bearer {_service_token()}"})
    response.raise_for_status()
    return response.json()
