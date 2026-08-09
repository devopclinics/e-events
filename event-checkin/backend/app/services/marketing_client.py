"""Best-effort lifecycle bridge to the isolated Marketing service."""
from datetime import datetime, timedelta, timezone

import httpx
import jwt

from ..config import settings


def _service_token() -> str:
    timestamp = datetime.now(timezone.utc)
    return jwt.encode({
        "sub": "festio-backend", "email": "system@festio.events", "name": "Festio",
        "is_platform_superadmin": True, "iss": "guesthub", "aud": "marketing",
        "iat": timestamp, "exp": timestamp + timedelta(minutes=2),
    }, settings.planner_internal_token, algorithm="HS256")


async def ingest_marketing_lead(user, **fields) -> None:
    if not settings.planner_internal_token or not settings.marketing_service_url:
        return
    token = _service_token()
    payload = {"festio_user_id": user.firebase_uid or user.id, "email": user.email, "name": user.name, **fields}
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(f"{settings.marketing_service_url.rstrip('/')}/api/marketing/internal/ingest", json=payload, headers={"Authorization": f"Bearer {token}"})
    except Exception:
        # Marketing must never block authentication or event creation.
        return


async def ingest_marketing_delivery(email: str | None, event: str, provider_id: str | None = None) -> None:
    """Mirror Resend outcomes into the lead timeline without coupling databases."""
    if not email or not settings.planner_internal_token or not settings.marketing_service_url:
        return
    token = _service_token()
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(f"{settings.marketing_service_url.rstrip('/')}/api/marketing/internal/delivery", json={"email": email, "event": event, "provider_id": provider_id}, headers={"Authorization": f"Bearer {token}"})
    except Exception:
        return


async def ingest_org_lifecycle(db, org_id: str, *, stage: str, **fields) -> None:
    """Attribute organization revenue and ticket milestones to its owner."""
    from sqlalchemy import select
    from ..models import Membership, User
    membership = await db.scalar(select(Membership).where(Membership.org_id == org_id).order_by(
        (Membership.role == "owner").desc(), Membership.created_at.asc()
    ).limit(1))
    if not membership:
        return
    user = await db.get(User, membership.user_id)
    if user:
        await ingest_marketing_lead(user, stage=stage, **fields)


async def marketing_preferences(email: str, body: dict | None = None) -> dict:
    if not settings.planner_internal_token or not settings.marketing_service_url:
        raise RuntimeError("Marketing is not configured")
    url = f"{settings.marketing_service_url.rstrip('/')}/api/marketing/internal/preferences/{email.lower()}"
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.request("PUT" if body is not None else "GET", url, json=body, headers={"Authorization": f"Bearer {_service_token()}"})
    response.raise_for_status()
    return response.json()
