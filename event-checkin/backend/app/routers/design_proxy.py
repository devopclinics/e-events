"""Core-backend → design-service bridge.

The Firebase-authed admin UI can't (and shouldn't) hold the design-service
internal token. So the admin calls THESE endpoints; we verify the user owns the
event (require_paid_event_admin — Design Studio is a paid feature), then forward to the decoupled design-service with
the internal token + org context. If the design-service is down, we degrade
gracefully (503 with a friendly message) — never a hard crash, and no core flow
is affected.

Mounted at /api/events, so paths are /api/events/{event_id}/design/...
Template gallery + public-theme are read directly from the design-service by the
browser (they need no auth), so they're not proxied here.
"""
import os
from typing import Literal
from pydantic import BaseModel, ConfigDict

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Body
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, User
from ..auth import require_paid_event_admin, require_event_admin
from ..entitlements import assert_feature_allowed

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


class InvitationOpeningUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    frequency: Literal["once", "always"] = "once"
    use_default: bool = True
    continue_mode: Literal["auto", "manual"] | None = None


async def _opening_request(event_id: str, payload: dict | None = None, org_id: str | None = None) -> dict | Response:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            url = f"{DESIGN_URL}/api/v1/design/events/{event_id}"
            response = await client.get(url, headers=_headers()) if payload is None else await client.put(
                url, json={"envelope_config": payload}, headers=_headers(org_id))
        if response.status_code != 200:
            return _passthrough(response)
        # Invitation administrators receive only opening settings, never Studio drafts.
        return {"envelope_config": response.json().get("envelope_config") or {}}
    except httpx.RequestError:
        raise HTTPException(503, "Invitation opening settings are temporarily unavailable. Try again.")


@router.get("/{event_id}/invitation-opening")
async def get_invitation_opening(event_id: str, _: User = Depends(require_event_admin)):
    return await _opening_request(event_id)


@router.put("/{event_id}/invitation-opening")
async def put_invitation_opening(event_id: str, body: InvitationOpeningUpdate,
                                 db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    return await _opening_request(event_id, body.model_dump(exclude_none=True), await _org_id(event_id, db))


def invitation_design(event, record):
    """Import the public invitation into a virtual draft; reading never writes."""
    from .quick_invites import preferences, public_data, PALETTES
    prefs = preferences(event)
    if not prefs:
        return record
    source = (record.get("theme_config") or {}).get("quickInvitation")
    if source:
        if source.get("source_revision", 0) != prefs.get("invitation_revision", 0):
            current = invitation_design(event, {**record, "theme_config": {}, "wording_config": {}, "asset_config": {}})
            return {**record, "invitation_source_changed": True, "current_invitation_design": current}
        return record
    ink, paper, accent = PALETTES.get(prefs.get("colour"), PALETTES["mint"])
    colors = prefs.get("custom_colors") or {"primary": ink, "text": ink, "background": paper, "surface": paper, "accent": accent}
    return {**record, "selected_template_id": record.get("selected_template_id") or "modern",
            "theme_config": {"colors": colors, "fontPairing": "classic-serif", **(record.get("theme_config") or {}), "quickInvitation": public_data(event)},
            "wording_config": {"eventTitle": event.name, "customMessage": event.invite_message or "", **(record.get("wording_config") or {})},
            "asset_config": {"cover_image_url": prefs.get("cover", ""), **(record.get("asset_config") or {})}}


def published_invitation(event, record):
    """Only a published snapshot may change the simple invitation."""
    from .quick_invites import InviteDraft, preferences
    snapshot = record.get("published_snapshot") or {}
    source = (snapshot.get("theme_config") or {}).get("quickInvitation")
    if not preferences(event) or not source:
        return
    import uuid
    from datetime import timezone
    wording = snapshot.get("wording_config") or {}
    assets = snapshot.get("asset_config") or {}
    data = InviteDraft(name=wording.get("eventTitle", event.name), event_date=event.event_date.replace(tzinfo=timezone.utc), timezone=event.timezone or "UTC",
                       style=source.get("style", "editorial"), colour=source.get("colour", "mint"),
                       host_name=source.get("host_name", ""), envelope=source.get("envelope", False),
                       cover=assets.get("cover_image_url") or "", message=wording.get("customMessage", event.invite_message or ""), request_id=uuid.uuid4())
    colors = (snapshot.get("theme_config") or {}).get("colors") or {}
    import re
    colors = {k:v for k,v in colors.items() if k in {"primary", "text", "background", "surface", "accent"} and isinstance(v,str) and re.fullmatch(r"#[0-9a-fA-F]{6}",v)}
    event.name = data.name
    event.invite_message = data.message
    event.description = data.message
    event.invite_cover_image = data.cover or None
    event.setup_preferences = {**(event.setup_preferences or {}), "quick_invite": {**preferences(event), "style": data.style, "colour": data.colour, "host_name": data.host_name, "envelope": data.envelope, "cover": data.cover, "custom_colors": colors}}


@router.get("/{event_id}/design")
async def get_design(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{DESIGN_URL}/api/v1/design/events/{event_id}", headers=_headers())
        event = await db.get(Event, event_id)
        return invitation_design(event, r.json()) if r.status_code == 200 and event else _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.put("/{event_id}/design")
async def put_design(event_id: str, body: dict = Body(...), db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    org = await _org_id(event_id, db)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.put(f"{DESIGN_URL}/api/v1/design/events/{event_id}", json=body, headers=_headers(org))
        return _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.post("/{event_id}/design/publish")
async def publish_design(event_id: str, body: dict = Body(default={}), db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    event = await db.scalar(select(Event).where(Event.id == event_id).with_for_update())
    if not event:
        raise HTTPException(404, "Event not found")
    assert_feature_allowed(event, "design_publish")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            # Validate invitation fields before committing a Studio publication.
            from .quick_invites import preferences
            if preferences(event):
                draft = await c.get(f"{DESIGN_URL}/api/v1/design/events/{event_id}", headers=_headers())
                if draft.status_code != 200:
                    return _passthrough(draft)
                source = draft.json()
                imported = invitation_design(event, source)
                if imported.get("invitation_source_changed"):
                    raise HTTPException(409, "The invitation changed outside Studio. Import the current invitation before publishing so those changes are preserved.")
                if body.get("expected_revision") is None:
                    body = {**body, "expected_revision": int(source.get("revision") or 0)}
                from copy import deepcopy
                candidate = deepcopy(event)
                try:
                    published_invitation(candidate, {"published_snapshot": imported})
                except ValueError as exc:
                    raise HTTPException(422, "Check the invitation title, message and HTTPS cover image before publishing.") from exc
                if not (source.get("theme_config") or {}).get("quickInvitation"):
                    if body.get("expected_revision") is not None and body["expected_revision"] != int(source.get("revision") or 0):
                        raise HTTPException(409, "This design changed in another editor. Reload before publishing.")
                    payload = {k: imported[k] for k in ("selected_template_id", "theme_config", "wording_config", "asset_config")}
                    seeded = await c.put(f"{DESIGN_URL}/api/v1/design/events/{event_id}", json={**payload, "expected_revision": int(source.get("revision") or 0)}, headers=_headers(event.org_id))
                    if seeded.status_code != 200:
                        return _passthrough(seeded)
                    body = {**body, "expected_revision": seeded.json()["revision"]}
            r = await c.post(f"{DESIGN_URL}/api/v1/design/events/{event_id}/publish", json=body, headers=_headers())
            if r.status_code == 200 and preferences(event):
                published = await c.get(f"{DESIGN_URL}/api/v1/design/events/{event_id}", headers=_headers())
                if published.status_code != 200:
                    raise HTTPException(503, "Studio published, but invitation verification is unavailable. Your existing invitation is preserved. Reload before trying again.")
                published_invitation(event, published.json())
                await db.commit()
        return _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.get("/{event_id}/design/outputs")
async def list_outputs(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{DESIGN_URL}/api/v1/design/events/{event_id}/outputs", headers=_headers())
        return _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.post("/{event_id}/design/assets")
async def upload_asset(event_id: str, file: UploadFile = File(...), attach_to_design: bool = True,
                       db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    org = await _org_id(event_id, db)
    data = await file.read()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.post(
                f"{DESIGN_URL}/api/v1/design/events/{event_id}/assets",
                params={"attach_to_design": str(attach_to_design).lower()},
                files={"file": (file.filename or "upload", data, file.content_type or "application/octet-stream")},
                headers=_headers(org),
            )
        return _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.post("/{event_id}/design/render/flyer")
async def render_flyer(event_id: str, body: dict = Body(default={}),
                       db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.post(f"{DESIGN_URL}/api/v1/design/events/{event_id}/render/flyer", json=body, headers=_headers())
        # Stream the rendered PNG/PDF straight back to the browser for download.
        headers = {"Content-Disposition": r.headers.get("content-disposition", "inline")}
        if r.headers.get("x-design-output-url"):
            headers["X-Design-Output-Url"] = r.headers["x-design-output-url"]
        return Response(content=r.content, status_code=r.status_code,
                        media_type=r.headers.get("content-type", "application/octet-stream"),
                        headers=headers)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.get("/{event_id}/design/versions")
async def design_versions(event_id: str, _: User = Depends(require_paid_event_admin)):
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{DESIGN_URL}/api/v1/design/events/{event_id}/versions", headers=_headers())
        return _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)


@router.post("/{event_id}/design/restore")
async def restore_design_version(event_id: str, body: dict = Body(...), _: User = Depends(require_paid_event_admin)):
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.post(f"{DESIGN_URL}/api/v1/design/events/{event_id}/restore", json=body, headers=_headers())
        return _passthrough(r)
    except httpx.RequestError:
        raise HTTPException(503, _UNAVAILABLE)
