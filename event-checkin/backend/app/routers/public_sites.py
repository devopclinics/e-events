import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_event_admin
from ..config import settings
from ..database import get_db
from ..models import Event, User

router = APIRouter()


async def _call(method: str, path: str, *, json=None):
    if not settings.public_site_management_enabled:
        raise HTTPException(404, "Event websites are not enabled")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.request(method, f"{settings.public_site_service_url.rstrip('/')}{path}", json=json, headers={"X-Internal-Token": settings.public_site_internal_token})
    except httpx.RequestError:
        raise HTTPException(503, "Website service is temporarily unavailable")
    if response.status_code >= 400:
        detail = "Website service request failed"
        try:
            detail = response.json().get("detail", detail)
        except ValueError:
            pass
        raise HTTPException(response.status_code, detail)
    return response.json()


@router.get("/{event_id}/website")
async def get_website(event_id: str, _: User = Depends(require_event_admin)):
    return await _call("GET", f"/internal/sites/{event_id}")


@router.put("/{event_id}/website")
async def save_website(event_id: str, request: Request, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    event = await db.get(Event, event_id)
    body = await request.json()
    body["org_id"] = event.org_id
    return await _call("PUT", f"/internal/sites/{event_id}", json=body)


@router.post("/{event_id}/website/preview")
async def preview_website(event_id: str, _: User = Depends(require_event_admin)):
    return await _call("POST", f"/internal/sites/{event_id}/preview")


@router.post("/{event_id}/website/publish")
async def publish_website(event_id: str, user: User = Depends(require_event_admin)):
    return await _call("POST", f"/internal/sites/{event_id}/publish", json={"published_by": user.email})


@router.get("/{event_id}/website/releases")
async def website_releases(event_id: str, _: User = Depends(require_event_admin)):
    return await _call("GET", f"/internal/sites/{event_id}/releases")


@router.post("/{event_id}/website/rollback/{release_id}")
async def rollback_website(event_id: str, release_id: str, _: User = Depends(require_event_admin)):
    return await _call("POST", f"/internal/sites/{event_id}/rollback/{release_id}")
