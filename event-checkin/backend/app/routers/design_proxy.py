"""Core-backend → design-service bridge.

The Firebase-authed admin UI can't (and shouldn't) hold the design-service
internal token. So the admin calls THESE endpoints; we verify the user owns the
event (require_event_admin), then forward to the decoupled design-service with
the internal token + org context. If the design-service is down, we degrade
gracefully (503 with a friendly message) — never a hard crash, and no core flow
is affected.

Mounted at /api/events, so paths are /api/events/{event_id}/design/...
Template gallery + public-theme are read directly from the design-service by the
browser (they need no auth), so they're not proxied here.
"""
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Body
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, User
from ..auth import require_event_admin

router = APIRouter()

DESIGN_URL = os.getenv("DESIGN_SERVICE_URL", "http://design-service:8010").rstrip("/")
DESIGN_TOKEN = os.getenv("DESIGN_INTERNAL_TOKEN", "")
_TIMEOUT = httpx.Timeout(45.0, connect=5.0)
_UNAVAILABLE = "Design Studio is temporarily unavailable. Your event settings and guest data are safe."


async def _org_id(event_id: str, db: AsyncSession) -> str | None:
    ev = await db.get(Event, event_id)
    return ev.org_id if ev else None


def _headers(org_id: str | None = None) -> dict:
    h = {"X-Internal-Token": DESIGN_TOKEN}
    if org_id:
        h["X-Org-Id"] = org_id
    return h


def _passthrough(r: httpx.Response) -> Response:
    return Response(content=r.content, status_code=r.status_code,
                    media_type=r.headers.get("content-type", "application/json"))


@router.get("/{event_id}/design")
async def get_design(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{DESIGN_URL}/api/v1/design/events/{event_id}", headers=_headers())
        return _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.put("/{event_id}/design")
async def put_design(event_id: str, body: dict = Body(...), db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    org = await _org_id(event_id, db)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.put(f"{DESIGN_URL}/api/v1/design/events/{event_id}", json=body, headers=_headers(org))
        return _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.post("/{event_id}/design/publish")
async def publish_design(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.post(f"{DESIGN_URL}/api/v1/design/events/{event_id}/publish", headers=_headers())
        return _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.get("/{event_id}/design/outputs")
async def list_outputs(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{DESIGN_URL}/api/v1/design/events/{event_id}/outputs", headers=_headers())
        return _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.post("/{event_id}/design/assets")
async def upload_asset(event_id: str, file: UploadFile = File(...),
                       db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    org = await _org_id(event_id, db)
    data = await file.read()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.post(
                f"{DESIGN_URL}/api/v1/design/events/{event_id}/assets",
                files={"file": (file.filename or "upload", data, file.content_type or "application/octet-stream")},
                headers=_headers(org),
            )
        return _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.post("/{event_id}/design/render/flyer")
async def render_flyer(event_id: str, body: dict = Body(default={}),
                       db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.post(f"{DESIGN_URL}/api/v1/design/events/{event_id}/render/flyer", json=body, headers=_headers())
        # Stream the rendered PNG/PDF straight back to the browser for download.
        return Response(content=r.content, status_code=r.status_code,
                        media_type=r.headers.get("content-type", "application/octet-stream"),
                        headers={"Content-Disposition": r.headers.get("content-disposition", "inline")})
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)
