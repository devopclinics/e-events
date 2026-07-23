"""Small, failure-contained client for triggering staff push alerts on
messaging-service — mirrors services/festiome_client.py's shape. Never raises:
a messaging-service outage or FCM being disabled must not affect scanning."""

import logging

import httpx

from ..config import settings

logger = logging.getLogger("messaging_client")


async def notify_staff_push(
    *, event_id: str, title: str, body: str, roles: list[str] | None = None,
) -> None:
    if not settings.messaging_internal_token:
        return
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(
                f"{settings.messaging_service_url.rstrip('/')}/api/messaging/internal/events/{event_id}/staff-push",
                json={"title": title, "body": body, "roles": roles},
                headers={"x-internal-token": settings.messaging_internal_token},
            )
    except Exception:
        logger.info("staff_push_notify_failed event_id=%s", event_id, exc_info=True)
