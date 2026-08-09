"""Best-effort lifecycle bridge to the isolated Marketing service."""
from datetime import datetime, timedelta, timezone

import httpx
import jwt

from ..config import settings


async def ingest_marketing_lead(user, **fields) -> None:
    if not settings.planner_internal_token or not settings.marketing_service_url:
        return
    timestamp = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": "festio-backend", "email": "system@festio.events", "name": "Festio",
        "is_platform_superadmin": True, "iss": "guesthub", "aud": "marketing",
        "iat": timestamp, "exp": timestamp + timedelta(minutes=2),
    }, settings.planner_internal_token, algorithm="HS256")
    payload = {"festio_user_id": user.firebase_uid or user.id, "email": user.email, "name": user.name, **fields}
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(f"{settings.marketing_service_url.rstrip('/')}/api/marketing/internal/ingest", json=payload, headers={"Authorization": f"Bearer {token}"})
    except Exception:
        # Marketing must never block authentication or event creation.
        return
