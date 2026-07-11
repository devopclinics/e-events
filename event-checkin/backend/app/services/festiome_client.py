"""Small, failure-contained client for the internal FestioMe service.

GuestHub must not depend on FestioMe for invitations, RSVP, tickets, or check-in.
Only explicit FestioMe endpoints call this client, using async I/O and bounded
timeouts. No GuestHub code reads the FestioMe database.
"""

from dataclasses import dataclass
from typing import Any

import httpx

from ..config import settings


class FestioMeUnavailable(RuntimeError):
    """The optional FestioMe service could not complete a request."""


@dataclass(frozen=True)
class FestioMeEventLink:
    enabled: bool
    festiome_id: str | None = None
    name: str | None = None
    open_url: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "FestioMeEventLink":
        if not isinstance(payload, dict):
            raise ValueError("FestioMe response must be an object")
        # Accept both `id` and `festiome_id` during the early contract rollout.
        return cls(
            enabled=bool(payload.get("enabled", True)),
            festiome_id=payload.get("festiome_id") or payload.get("id"),
            name=payload.get("name"),
            open_url=payload.get("open_url"),
        )


class FestioMeClient:
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
            "Authorization": f"Bearer {self.internal_token}",
            "Accept": "application/json",
        }

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        if not self.configured:
            raise FestioMeUnavailable("FestioMe integration is not configured")
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                transport=self.transport,
            ) as client:
                response = await client.request(method, path, headers=self._headers(), **kwargs)
        except httpx.RequestError as exc:
            raise FestioMeUnavailable("FestioMe is temporarily unavailable") from exc
        if response.status_code >= 500:
            raise FestioMeUnavailable("FestioMe is temporarily unavailable")
        return response

    async def event_status(self, external_event_ref: str) -> FestioMeEventLink:
        response = await self._request(
            "GET", f"/internal/v1/guesthub/event-links/{external_event_ref}"
        )
        if response.status_code == 404:
            return FestioMeEventLink(enabled=False)
        if response.status_code >= 400:
            raise FestioMeUnavailable("FestioMe status could not be read")
        try:
            return FestioMeEventLink.from_payload(response.json())
        except (TypeError, ValueError) as exc:
            raise FestioMeUnavailable("FestioMe returned an invalid response") from exc

    async def enable_for_event(
        self,
        *,
        external_event_ref: str,
        external_org_ref: str,
        name: str,
        owner_subject: str,
        owner_name: str,
        owner_email: str,
    ) -> FestioMeEventLink:
        response = await self._request(
            "POST",
            "/internal/v1/guesthub/event-links",
            json={
                "external_event_ref": external_event_ref,
                "external_org_ref": external_org_ref,
                "name": name,
                "owner": {
                    "subject": owner_subject,
                    "name": owner_name,
                    "email": owner_email,
                },
            },
        )
        if response.status_code >= 400:
            raise FestioMeUnavailable("FestioMe could not be enabled for this event")
        try:
            return FestioMeEventLink.from_payload(response.json())
        except (TypeError, ValueError) as exc:
            raise FestioMeUnavailable("FestioMe returned an invalid response") from exc

    async def upsert_guest(
        self, external_event_ref: str, *, guest_ref: str, name: str,
        email: str | None, phone: str | None, status: str,
    ) -> dict[str, Any]:
        response = await self._request(
            "PUT",
            f"/internal/v1/guesthub/event-links/{external_event_ref}/members/{guest_ref}",
            json={"name": name, "email": email, "phone": phone, "status": status},
        )
        # Most GuestHub events do not enable FestioMe. Treat an absent event link
        # as a delivered no-op; enabling later performs a full initial sync.
        if response.status_code == 404:
            return {"ignored": True}
        if response.status_code >= 400:
            raise FestioMeUnavailable("FestioMe guest synchronization failed")
        return response.json()

    async def remove_guest(self, external_event_ref: str, guest_ref: str) -> None:
        response = await self._request(
            "DELETE",
            f"/internal/v1/guesthub/event-links/{external_event_ref}/members/{guest_ref}",
        )
        if response.status_code not in (200, 204, 404):
            raise FestioMeUnavailable("FestioMe guest removal failed")

    async def guest_token(
        self, external_event_ref: str, *, guest_ref: str, name: str,
        email: str | None,
    ) -> dict[str, Any]:
        response = await self._request(
            "POST",
            f"/internal/v1/guesthub/event-links/{external_event_ref}/guest-token",
            json={"guest_ref": guest_ref, "name": name, "email": email},
        )
        if response.status_code >= 400:
            raise FestioMeUnavailable("FestioMe guest access is temporarily unavailable")
        return response.json()

    # ── Organizer group management (sub-groups + join-request moderation) ────
    # These proxy GuestHub organizer actions to FestioMe's internal admin API,
    # acting as the Festio service identity so any event admin can manage groups
    # without holding a personal FestioMe membership.

    async def list_subgroups(self, external_event_ref: str) -> list[dict[str, Any]]:
        response = await self._request(
            "GET", f"/internal/v1/guesthub/event-links/{external_event_ref}/subgroups"
        )
        if response.status_code == 404:
            return []
        if response.status_code >= 400:
            raise FestioMeUnavailable("FestioMe groups could not be listed")
        return response.json()

    async def create_subgroup(
        self, external_event_ref: str, *, name: str, description: str = "",
        join_policy: str = "request", visibility: str = "listed", rules: str = "",
    ) -> dict[str, Any]:
        response = await self._request(
            "POST", f"/internal/v1/guesthub/event-links/{external_event_ref}/subgroups",
            json={"name": name, "description": description, "join_policy": join_policy,
                  "visibility": visibility, "rules": rules},
        )
        if response.status_code >= 400:
            raise FestioMeUnavailable("FestioMe group could not be created")
        return response.json()

    async def update_subgroup(self, external_event_ref: str, group_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        response = await self._request(
            "PATCH", f"/internal/v1/guesthub/event-links/{external_event_ref}/subgroups/{group_id}",
            json=patch,
        )
        if response.status_code == 404:
            raise FestioMeUnavailable("FestioMe group not found")
        if response.status_code >= 400:
            raise FestioMeUnavailable("FestioMe group could not be updated")
        return response.json()

    async def list_join_requests(self, external_event_ref: str, group_id: str, *, status: str = "pending") -> list[dict[str, Any]]:
        response = await self._request(
            "GET", f"/internal/v1/guesthub/event-links/{external_event_ref}/subgroups/{group_id}/join-requests",
            params={"status": status},
        )
        if response.status_code == 404:
            return []
        if response.status_code >= 400:
            raise FestioMeUnavailable("FestioMe join requests could not be listed")
        return response.json()

    async def approve_join_request(self, external_event_ref: str, group_id: str, request_id: str, *, role: str = "member") -> dict[str, Any]:
        response = await self._request(
            "POST", f"/internal/v1/guesthub/event-links/{external_event_ref}/subgroups/{group_id}/join-requests/{request_id}/approve",
            json={"role": role},
        )
        if response.status_code in (404, 409):
            raise FestioMeUnavailable("This FestioMe join request could not be approved")
        if response.status_code >= 400:
            raise FestioMeUnavailable("FestioMe join request could not be approved")
        return response.json()

    async def deny_join_request(self, external_event_ref: str, group_id: str, request_id: str) -> None:
        response = await self._request(
            "POST", f"/internal/v1/guesthub/event-links/{external_event_ref}/subgroups/{group_id}/join-requests/{request_id}/deny",
        )
        if response.status_code not in (200, 204, 404):
            raise FestioMeUnavailable("FestioMe join request could not be denied")

    async def publish_announcement(
        self, external_event_ref: str, *, idempotency_key: str, title: str,
        body: str, kind: str, urgent: bool, source_ref: str | None = None,
    ) -> dict[str, Any]:
        response = await self._request(
            "POST",
            f"/internal/v1/guesthub/event-links/{external_event_ref}/announcements",
            json={
                "idempotency_key": idempotency_key, "title": title, "body": body,
                "kind": kind, "urgent": urgent, "source_ref": source_ref,
            },
        )
        if response.status_code == 404:
            return {"ignored": True}
        if response.status_code >= 400:
            raise FestioMeUnavailable("FestioMe announcement could not be published")
        return response.json()


def get_festiome_client() -> FestioMeClient:
    return FestioMeClient(
        settings.festiome_service_url,
        settings.festiome_internal_token,
        settings.festiome_request_timeout_seconds,
    )
