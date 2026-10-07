import httpx
from datetime import timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from urllib.parse import quote_plus
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, Body
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_event_admin
from ..config import settings
from ..database import get_db
from ..models import Event, GuestSpeaker, User
from .engagement import ensure_live_join_code, live_join_url
from ..services.experience import active_workflow
from .speakers import ensure_speaker_token

router = APIRouter()

def _event_zone(event):
    try: return ZoneInfo(event.timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "The event timezone is invalid. Update it in Event Setup before continuing.")



async def _website_connections(event: Event, db: AsyncSession) -> dict:
    base = (event.checkin_base_url or settings.public_base_url or settings.frontend_url).rstrip("/")
    venue_query = event.venue_address or event.venue_name or ""
    speakers_url = ""
    if event.speaker_enabled:
        speakers_url = f"{base}/speakers/{await ensure_speaker_token(event, db)}"
    live_url = ""
    if event.engagement_enabled:
        live_url = live_join_url(await ensure_live_join_code(event.id, db))
    # festiome_open_url is an in-app route (e.g. "/festiome?group=…"), meant for
    # the SPA's own router — resolve it against the public base so it's a real
    # absolute URL wherever it's used outside the SPA (the site's Link/
    # NavigationItem fields both require one; see the Al-Azeemah publish 422).
    festiome_raw = event.festiome_open_url or ""
    festiome_url = f"{base}{festiome_raw}" if festiome_raw.startswith("/") else festiome_raw
    connections = {
        "section": {"label": "Programme", "url": "#programme", "available": True, "source": "Website programme", "configure_url": "/design-studio-redesign/website"},
        "venue": {"label": "Venue", "url": f"https://www.google.com/maps/search/?api=1&query={quote_plus(venue_query)}" if venue_query else "", "available": bool(venue_query), "source": "Event Setup", "configure_url": "/admin-redesign"},
        "speakers": {"label": "Speakers", "url": speakers_url, "available": bool(speakers_url), "source": "Speakers add-on", "configure_url": "/addons-redesign?tab=speakers"},
        "rsvp": {"label": "Register / RSVP", "url": f"{base}/rsvp/{event.rsvp_token}" if event.rsvp_enabled and event.rsvp_token else "", "available": bool(event.rsvp_enabled and event.rsvp_token), "source": "Invites & RSVP", "configure_url": "/guests-redesign?tab=invite"},
        "festio_live": {"label": "Festio Live", "url": live_url, "available": bool(live_url), "source": "Festio Live", "configure_url": "/festio-live-redesign"},
        "guesthub": {"label": "My GuestHub", "url": f"{base}/rsvp/{event.rsvp_token}?recover=1" if event.rsvp_enabled and event.rsvp_token else "", "available": bool(event.rsvp_enabled and event.rsvp_token), "source": "Email-only GuestHub recovery", "configure_url": "/guests-redesign?tab=invite"},
        "festiome": {"label": "FestioMe", "url": festiome_url, "available": bool(event.festiome_addon_enabled and festiome_url), "source": "FestioMe", "configure_url": "/festiome-redesign"},
        "contact": {"label": "Contact", "url": "", "available": False, "source": "Website settings", "configure_url": "/design-studio-redesign/website"},
    }
    return connections


async def _website_content_sources(event: Event, db: AsyncSession) -> dict:
    """Return public-safe projections from existing event-owned records.

    The website draft may import these projections, but the source records remain
    owned by Event Setup, Experience, and Speakers. No guest data is exposed.
    """
    speaker_rows = (await db.execute(
        select(GuestSpeaker)
        .where(GuestSpeaker.event_id == event.id, GuestSpeaker.is_active.is_(True))
        .order_by(GuestSpeaker.sort_order, GuestSpeaker.created_at)
    )).scalars().all() if event.speaker_enabled else []
    speakers = [{
        "source_id": row.id,
        "name": row.name,
        "title": row.title or "",
        "organization": "",
        "bio": row.bio or "",
        "photo_url": row.photo_url or "",
        "session_titles": [],
    } for row in speaker_rows]

    sessions = []
    workflow = await active_workflow(event.id, db) if event.experience_enabled else None
    if workflow and event.event_date:
        for step in sorted(workflow.steps, key=lambda item: (item.sort_order, item.title)):
            if not step.enabled or not step.is_segment or step.starts_offset_seconds is None:
                continue
            starts_at = event.event_date + timedelta(seconds=step.starts_offset_seconds)
            if starts_at.tzinfo is None: starts_at = starts_at.replace(tzinfo=timezone.utc)
            starts_at = starts_at.astimezone(_event_zone(event))
            config = step.config or {}
            program = config.get("program") or {}
            sessions.append({
                "source_id": step.id,
                "day": starts_at.strftime("%A"),
                "date": starts_at.strftime("%Y-%m-%d"),
                "time": starts_at.strftime("%-I:%M %p"),
                "title": step.title,
                "description": step.description or "",
                "venue": str(program.get("venue") or ""),
                "audience": str(program.get("audience") or ""),
                "track": str(program.get("category") or ""),
                "speaker": str(program.get("speaker") or ""),
                "action_label": "",
                "action_url": "",
            })
    return {
        "sessions": sessions,
        "speakers": speakers,
        "sources": {
            "sessions": "Published Experience programme" if workflow else "Experience programme",
            "speakers": "Speakers add-on",
        },
    }


def _resolve_navigation(content: dict, connections: dict) -> dict:
    result = dict(content or {})
    contact_email = str(result.get("contact_email") or "").strip()
    connections = dict(connections)
    connections["contact"] = {**connections.get("contact", {}), "url": f"mailto:{contact_email}" if contact_email else "", "available": bool(contact_email)}
    navigation = []
    for raw in result.get("navigation") or []:
        item = dict(raw)
        source = connections.get(item.get("destination_type"))
        if item.get("destination_type") == "section":
            allowed = {"#programme": "programme" in result.get("visible_sections", []), "#tracks": "tracks" in result.get("visible_sections", []) and bool(result.get("tracks")), "#speakers": bool(result.get("speakers")), "#venue": bool(result.get("venue") or result.get("venue_facts")), "#registration": bool(result.get("registration_facts")), "#faq": bool(result.get("faqs")), "#contact": bool(contact_email), "#connect": "connect" in result.get("visible_sections", [])}
            requested = bool(item.get("enabled", True) if item.get("requested_enabled") is None else item["requested_enabled"])
            item["requested_enabled"] = requested
            item["enabled"] = requested and allowed.get(item.get("url"), False)
            source = None
        if source is not None:
            requested = bool(item.get("enabled", True) if item.get("requested_enabled") is None else item["requested_enabled"])
            item["requested_enabled"] = requested
            item["url"] = source["url"]
            item["enabled"] = bool(requested and source.get("available"))
        navigation.append(item)
    result["navigation"] = navigation
    return result


def _absolute_site_urls(value, public_base: str):
    """Resolve safe site-relative URLs before public-site validation.

    Event-owned media and older add-ons can legitimately store paths such as
    ``/uploads/speaker.webp``. Make those paths portable using the event's
    public base while leaving anchors, mail links, and protocol-relative URLs
    for their existing validators.
    """
    if isinstance(value, list):
        return [_absolute_site_urls(item, public_base) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        if (
            isinstance(item, str)
            and (key == "url" or key.endswith("_url"))
            and item.startswith("/")
            and not item.startswith("//")
        ):
            result[key] = f"{public_base.rstrip('/')}{item}"
        else:
            result[key] = _absolute_site_urls(item, public_base)
    return result


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


@router.post("/{event_id}/website/assets")
async def upload_website_asset(event_id: str, file: UploadFile = File(...), _: User = Depends(require_event_admin)):
    if not settings.public_site_management_enabled:
        raise HTTPException(404, "Event websites are not enabled")
    data = await file.read(5 * 1024 * 1024 + 1)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(f"{settings.public_site_service_url.rstrip('/')}/internal/sites/{event_id}/assets", headers={"X-Internal-Token": settings.public_site_internal_token}, files={"file": (file.filename or "image", data, file.content_type or "application/octet-stream")})
    except httpx.RequestError:
        raise HTTPException(503, "Website service is temporarily unavailable")
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.json().get("detail", "Image upload failed"))
    return response.json()


@router.get("/{event_id}/website")
async def get_website(event_id: str, _: User = Depends(require_event_admin)):
    return await _call("GET", f"/internal/sites/{event_id}")


@router.get("/{event_id}/website/connections")
async def website_connections(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return {"connections": await _website_connections(event, db)}


@router.get("/{event_id}/website/content-sources")
async def website_content_sources(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return await _website_content_sources(event, db)


async def _prepare_website(event, content, db):
    """Resolve published brand and event-owned facts, never personal guest credentials."""
    content = dict(content or {})
    content["publication_features_version"] = 2
    zone = _event_zone(event)
    def iso(value):
        if not value: return ""
        if value.tzinfo is None: value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(zone).isoformat()
    connections = await _website_connections(event, db)
    content.update(event_name=event.name, start_date=iso(event.event_date), end_date=iso(event.event_end_date), timezone=event.timezone or "UTC", venue=event.venue_name or "", venue_address=event.venue_address or "", venue_url=connections["venue"]["url"], guesthub_url=connections["guesthub"]["url"], festiome_url=connections["festiome"]["url"] if connections["festiome"]["available"] else "", festio_live_url=connections["festio_live"]["url"])
    if content.get("use_event_branding"):
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(settings.design_service_url.rstrip("/") + f"/api/v1/design/events/{event.id}/public-theme")
                response.raise_for_status(); theme = response.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(503, "Published event branding is unavailable. Retry before saving or publishing.")
        image = theme.get("image_settings") or {}
        content.update(primary_color=theme["colors"]["primary"], accent_color=theme["colors"]["accent"], font_pairing=theme.get("font_pairing", "modern-sans"), logo_url=theme.get("logo_image_url"), feature_image_url=theme.get("cover_image_url"), hero_image_url=None, image_fit=image.get("fit", "cover"), image_position=image.get("position", "center"), image_alt=image.get("alt", ""))
    content = _resolve_navigation(content, connections)
    return _absolute_site_urls(content, event.checkin_base_url or settings.public_base_url or settings.frontend_url)


@router.put("/{event_id}/website")
async def save_website(event_id: str, request: Request, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    event = await db.get(Event, event_id)
    if not event: raise HTTPException(404, "Event not found")
    body = await request.json(); body["org_id"] = event.org_id
    body["content"] = await _prepare_website(event, body.get("content"), db)
    return await _call("PUT", f"/internal/sites/{event_id}", json=body)


@router.post("/{event_id}/website/render-preview")
async def render_website_preview(event_id: str, request: Request, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    event = await db.get(Event, event_id)
    if not event: raise HTTPException(404, "Event not found")
    body = await request.json(); body["org_id"] = event.org_id
    # Preview is independent of saving; a not-yet-chosen address is acceptable.
    body["slug"] = body.get("slug") or "draft-preview"
    body["content"] = await _prepare_website(event, body.get("content"), db)
    return await _call("POST", f"/internal/sites/{event_id}/render-preview", json=body)


@router.post("/{event_id}/website/preview")
async def preview_website(event_id: str, body: dict = Body(...), _: User = Depends(require_event_admin)):
    return await _call("POST", f"/internal/sites/{event_id}/preview", json=body)


@router.post("/{event_id}/website/publish")
async def publish_website(event_id: str, body: dict = Body(...), user: User = Depends(require_event_admin), db: AsyncSession = Depends(get_db)):
    event = await db.get(Event, event_id)
    if not event: raise HTTPException(404, "Event not found")
    draft = await _call("GET", f"/internal/sites/{event_id}")
    if not body.get("expected_revision") or draft.get("revision") != body["expected_revision"]:
        raise HTTPException(409, "This website changed. Reload and review before publishing.")
    content = await _prepare_website(event, draft.get("content"), db)
    return await _call("POST", f"/internal/sites/{event_id}/publish", json={"published_by": user.email, "expected_revision":draft["revision"], "content":content})


@router.post("/{event_id}/website/unpublish")
async def unpublish_website(event_id: str, body: dict = Body(...), _: User = Depends(require_event_admin)):
    return await _call("POST", f"/internal/sites/{event_id}/unpublish", json=body)


@router.post("/{event_id}/website/restore/{release_id}")
async def restore_website(event_id: str, release_id: str, body: dict = Body(...), _: User = Depends(require_event_admin)):
    return await _call("POST", f"/internal/sites/{event_id}/restore/{release_id}", json=body)


@router.get("/{event_id}/website/releases")
async def website_releases(event_id: str, _: User = Depends(require_event_admin)):
    return await _call("GET", f"/internal/sites/{event_id}/releases")


@router.post("/{event_id}/website/rollback/{release_id}")
async def rollback_website(event_id: str, release_id: str, body: dict = Body(...), _: User = Depends(require_event_admin)):
    return await _call("POST", f"/internal/sites/{event_id}/rollback/{release_id}", json=body)
