"""Festio Design Studio API — /api/v1/design/*

Ownership of an event is enforced UPSTREAM (the admin backend verifies the user
owns the event, then calls these endpoints with the internal token). Public-theme
is open so guest-facing pages can read it with no auth. Every read has a safe
default so a missing/broken design never blocks a public page.
"""
from fastapi import APIRouter, Depends, Header, HTTPException, Query

from ..config import settings
from ..catalog import build_catalog, get_template, default_template
from ..store import load_design, save_design, publish_design
from ..schemas import (
    EventDesignIn, EventDesignOut, PublicTheme, EmailTheme, PublishResult,
)

router = APIRouter(prefix="/api/v1/design")


def require_internal(x_internal_token: str | None = Header(default=None)) -> None:
    """Write + internal-read guard. If no token is configured (local dev), allow;
    in prod set DESIGN_INTERNAL_TOKEN so only the core backend can write."""
    if settings.internal_token and x_internal_token != settings.internal_token:
        raise HTTPException(401, "invalid internal token")


# ── Template gallery ──────────────────────────────────────────────────────────
@router.get("/templates")
def list_templates(
    category: str | None = Query(default=None),
    style: str | None = Query(default=None),
    free: bool | None = Query(default=None),
    surface: str | None = Query(default=None),
):
    items = build_catalog()
    if category:
        items = [t for t in items if t["categoryKey"] == category or t["category"] == category]
    if style:
        items = [t for t in items if t["styleKey"] == style or t["style"] == style]
    if free is not None:
        items = [t for t in items if t["isFree"] is free]
    if surface:
        items = [t for t in items if surface in t["surfaces"]]
    return {"count": len(items), "templates": items}


@router.get("/templates/{template_id}")
def get_one_template(template_id: str):
    tpl = get_template(template_id)
    if not tpl:
        raise HTTPException(404, "template not found")
    return tpl


# ── Per-event design config ───────────────────────────────────────────────────
@router.get("/events/{event_id}", response_model=EventDesignOut, dependencies=[Depends(require_internal)])
def get_event_design(event_id: str):
    d = load_design(event_id) or {}
    return EventDesignOut(
        event_id=event_id,
        organization_id=d.get("organization_id"),
        selected_template_id=d.get("selected_template_id"),
        selected_flyer_template_id=d.get("selected_flyer_template_id"),
        theme_config=d.get("theme_config", {}),
        wording_config=d.get("wording_config", {}),
        asset_config=d.get("asset_config", {}),
        is_published=bool(d.get("is_published")),
        published_version=d.get("published_version"),
        updated_at=d.get("updated_at"),
    )


@router.put("/events/{event_id}", response_model=EventDesignOut, dependencies=[Depends(require_internal)])
def put_event_design(event_id: str, body: EventDesignIn, x_org_id: str | None = Header(default=None)):
    if body.selected_template_id and not get_template(body.selected_template_id):
        raise HTTPException(400, "unknown selected_template_id")
    if body.selected_flyer_template_id and not get_template(body.selected_flyer_template_id):
        raise HTTPException(400, "unknown selected_flyer_template_id")
    data = body.model_dump(exclude_none=True)
    if x_org_id:
        data["organization_id"] = x_org_id
    saved = save_design(event_id, data)
    return get_event_design(event_id)


@router.post("/events/{event_id}/publish", response_model=PublishResult, dependencies=[Depends(require_internal)])
def publish(event_id: str):
    d = publish_design(event_id)
    return PublishResult(
        event_id=event_id,
        is_published=True,
        published_version=d["published_version"],
        published_at=d["published_at"],
    )


# ── Theme payloads (with fallback to the default family) ───────────────────────
def _resolve(event_id: str) -> tuple[dict, dict, bool]:
    """Returns (template, design, is_default)."""
    design = load_design(event_id) or {}
    tpl = get_template(design.get("selected_template_id") or "") if design else None
    if not tpl:
        return default_template(), design, True
    return tpl, design, False


@router.get("/events/{event_id}/public-theme", response_model=PublicTheme)
def public_theme(event_id: str):
    tpl, design, is_default = _resolve(event_id)
    colors = {**tpl["defaultColors"], **(design.get("theme_config", {}).get("colors", {}))}
    assets = design.get("asset_config", {})
    return PublicTheme(
        event_id=event_id,
        template_id=tpl["id"],
        is_default=is_default,
        colors=colors,
        font_pairing=design.get("theme_config", {}).get("fontPairing", tpl["fontPairing"]),
        button_style=design.get("theme_config", {}).get("buttonStyle", tpl["buttonStyle"]),
        layout=tpl["layout"],
        cover_image_url=assets.get("cover_image_url"),
        flyer_image_url=assets.get("flyer_image_url"),
        wording=design.get("wording_config", {}),
    )


@router.get("/events/{event_id}/theme", response_model=EmailTheme, dependencies=[Depends(require_internal)])
def email_theme(event_id: str):
    tpl, design, is_default = _resolve(event_id)
    colors = {**tpl["defaultColors"], **(design.get("theme_config", {}).get("colors", {}))}
    assets = design.get("asset_config", {})
    return EmailTheme(
        event_id=event_id,
        primary_color=colors["primary"],
        accent_color=colors["accent"],
        background_color=colors["background"],
        button_style=design.get("theme_config", {}).get("buttonStyle", tpl["buttonStyle"]),
        cover_image_url=assets.get("cover_image_url"),
        flyer_image_url=assets.get("flyer_image_url"),
        is_default=is_default,
    )
