"""Festio Design Studio API — /api/v1/design/*

Ownership of an event is enforced UPSTREAM (the admin backend verifies the user
owns the event, then calls these endpoints with the internal token). Public-theme
is open so guest-facing pages can read it with no auth. Every read has a safe
default so a missing/broken design never blocks a public page.
"""
import os
import uuid

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response

from ..config import settings
from ..catalog import build_catalog, get_template, default_template, resolve_template_asset
from ..store import load_design, save_design, publish_design
from ..assets import save_upload, asset_path, UploadError
from ..render import render_flyer, PNG_SIZES, PDF_SIZES
from ..schemas import (
    EventDesignIn, EventDesignOut, PublicTheme, EmailTheme, PublishResult, RenderRequest,
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


@router.get("/template-assets/{pack_slug}/{asset_path:path}")
def serve_template_asset(pack_slug: str, asset_path: str):
    """Public, read-only serving for bundled template pack thumbnails/previews."""
    path = resolve_template_asset(pack_slug, asset_path)
    if not path:
        raise HTTPException(404, "not found")
    return FileResponse(path)


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
    data = body.model_dump(exclude_unset=True, exclude_none=True)
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
def _resolve(event_id: str, *, published_only: bool = False) -> tuple[dict, dict, bool]:
    """Returns (template, design, is_default)."""
    design = load_design(event_id) or {}
    if published_only:
        if not design.get("is_published"):
            return default_template(), design, True
        design = design.get("published_snapshot") or design
    tpl = get_template(design.get("selected_template_id") or "") if design else None
    if not tpl:
        return default_template(), design, True
    return tpl, design, False


@router.get("/events/{event_id}/public-theme", response_model=PublicTheme)
def public_theme(event_id: str):
    tpl, design, is_default = _resolve(event_id, published_only=True)
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
    tpl, design, is_default = _resolve(event_id, published_only=True)
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


# ── Asset uploads (validated) + safe file serving ────────────────────────────
@router.post("/events/{event_id}/assets", dependencies=[Depends(require_internal)])
async def upload_asset(event_id: str, file: UploadFile = File(...), asset_type: str = "image"):
    data = await file.read()
    try:
        meta = save_upload(event_id, file.filename or "upload", data, asset_type)
    except UploadError as e:
        raise HTTPException(400, str(e))
    # Record the asset ref on the event design so the editor can list them.
    d = load_design(event_id) or {}
    assets = d.get("asset_config", {})
    lib = assets.get("library", [])
    lib.insert(0, meta)
    assets["library"] = lib[:100]
    save_design(event_id, {"asset_config": assets})
    return meta


@router.get("/files/{event_id}/{filename}")
def serve_file(event_id: str, filename: str):
    """Public, path-traversal-guarded serving of stored assets/outputs."""
    path = asset_path(event_id, filename)
    if not path:
        # also look in the rendered-outputs dir
        out = os.path.join(settings.storage_path, "outputs", event_id, filename)
        if event_id.replace("-", "").isalnum() and os.path.isfile(out) and ".." not in filename:
            path = out
    if not path:
        raise HTTPException(404, "not found")
    return FileResponse(path)


# ── Flyer rendering (PNG / PDF) ──────────────────────────────────────────────
@router.post("/events/{event_id}/render/flyer", dependencies=[Depends(require_internal)])
async def render_event_flyer(event_id: str, body: RenderRequest):
    size = body.size
    fmt = body.format or ("pdf" if size in PDF_SIZES else "png")
    if size not in PNG_SIZES and size not in PDF_SIZES:
        raise HTTPException(400, f"unknown size '{size}'")
    if fmt not in ("png", "pdf"):
        raise HTTPException(400, "format must be png or pdf")

    design = load_design(event_id) or {}
    tpl = get_template(body.template_id or design.get("selected_flyer_template_id")
                       or design.get("selected_template_id") or "") or default_template()
    colors = {**tpl["defaultColors"], **(design.get("theme_config", {}).get("colors", {})), **(body.colors or {})}
    wording = {**design.get("wording_config", {}), **(body.wording or {})}
    ctx = {
        "template": tpl,
        "colors": colors,
        "fontPairing": tpl["fontPairing"],
        "wording": wording,
        "coverImageUrl": body.cover_image_url or design.get("asset_config", {}).get("cover_image_url"),
        "imagePosition": body.image_position or design.get("asset_config", {}).get("image_position", {}),
        "qr": {"enabled": body.qr_enabled and bool(body.qr_data), "position": body.qr_position, "data": body.qr_data},
    }
    try:
        content = await render_flyer(ctx, size, fmt, settings.render_timeout_seconds)
    except Exception as e:  # rendering must never 500 the studio hard
        raise HTTPException(502, f"render failed: {e}")

    # Persist the output so it can be re-downloaded / listed.
    out_dir = os.path.join(settings.storage_path, "outputs", event_id)
    os.makedirs(out_dir, exist_ok=True)
    name = f"flyer-{size}-{uuid.uuid4().hex[:8]}.{fmt}"
    with open(os.path.join(out_dir, name), "wb") as f:
        f.write(content)

    media = "application/pdf" if fmt == "pdf" else "image/png"
    return Response(
        content=content, media_type=media,
        headers={"Content-Disposition": f'inline; filename="{name}"',
                 "X-Design-Output-Url": f"{settings.public_asset_base_url}/api/v1/design/files/{event_id}/{name}"},
    )


@router.get("/events/{event_id}/outputs", dependencies=[Depends(require_internal)])
def list_outputs(event_id: str):
    out_dir = os.path.join(settings.storage_path, "outputs", event_id)
    if not (event_id.replace("-", "").isalnum() and os.path.isdir(out_dir)):
        return {"outputs": []}
    base = settings.public_asset_base_url
    files = sorted(os.listdir(out_dir), reverse=True)
    return {"outputs": [
        {"filename": f, "format": f.rsplit(".", 1)[-1],
         "url": f"{base}/api/v1/design/files/{event_id}/{f}"}
        for f in files if "." in f
    ]}
