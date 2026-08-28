"""Small, failure-contained client for the internal messaging-service push API.

FestioMe has no notification delivery of its own — real Web Push/FCM
delivery lives in messaging-service. This client is best-effort only: a
messaging-service outage must never block posting a message, joining a
group, or any other FestioMe action.
"""

from typing import Any

import httpx

from .config import settings


class MessagingUnavailable(RuntimeError):
    """The messaging-service push API could not complete a request."""


class MessagingClient:
    def __init__(
        self,
        base_url: str,
        internal_token: str,
        timeout_seconds: float = 3.0,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.internal_token = internal_token
        self.timeout = httpx.Timeout(timeout_seconds)
        self.transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.internal_token)

    def _headers(self) -> dict[str, str]:
        return {
            "X-Internal-Token": self.internal_token,
            "Accept": "application/json",
        }

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        if not self.configured:
            raise MessagingUnavailable("Messaging push integration is not configured")
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                transport=self.transport,
            ) as client:
                response = await client.request(method, path, headers=self._headers(), **kwargs)
        except httpx.RequestError as exc:
            raise MessagingUnavailable("Messaging push is temporarily unavailable") from exc
        if response.status_code >= 500:
            raise MessagingUnavailable("Messaging push is temporarily unavailable")
        return response

    async def send_push(self, event_id: str, *, guest_ids: list[str], title: str, body: str) -> None:
        response = await self._request(
            "POST",
            f"/api/messaging/internal/events/{event_id}/festiome-push",
            json={"guest_ids": guest_ids, "title": title, "body": body},
        )
        if response.status_code >= 400:
            raise MessagingUnavailable("Push notification could not be queued")


def get_messaging_client() -> MessagingClient:
    return MessagingClient(
        settings.messaging_service_url,
        settings.messaging_internal_token,
        settings.messaging_request_timeout_seconds,
    )
