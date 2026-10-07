import hashlib
import json
import secrets
import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from .modern import security_policy
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import SessionLocal, get_db
from .models import Preview, Release, Site, SiteAddress
from .render import render_site
from .schemas import PublishRequest, SiteUpsert, RevisionRequest

app = FastAPI(title="Festio Public Sites", version="1.0.0")
ALLOWED_IMAGES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def require_internal(x_internal_token: str | None = Header(default=None)):
    if not settings.internal_service_token or not secrets.compare_digest(x_internal_token or "", settings.internal_service_token):
        raise HTTPException(401, "Invalid internal service token")


def revision(site: Site):
    value = {"slug":site.slug,"family":site.template_family,"draft":site.draft,"published":site.published_release_id,"updated":str(site.updated_at)}
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def check_revision(site, expected):
    if expected is None:
        raise HTTPException(428, "Refresh the website editor before saving. A draft revision is required.")
    if expected != (revision(site) if site else "new"):
        raise HTTPException(409, "This website changed in another window. Reload the latest draft before trying again.")


async def locked_site(event_id, db):
    return await db.scalar(select(Site).where(Site.event_id == event_id).with_for_update())


async def serialize(site: Site, db: AsyncSession):
    release = await db.get(Release, site.published_release_id) if site.published_release_id else None
    published_snapshot = release.snapshot if release else None
    draft_snapshot = {"family": site.template_family, "content": site.draft}
    return {
        "event_id": site.event_id, "org_id": site.org_id, "slug": site.slug, "revision": revision(site),
        "template_family": site.template_family, "content": site.draft,
        "published_release_id": site.published_release_id, "enabled": site.enabled,
        "public_url": f"{settings.public_base_url.rstrip('/')}/site/{site.slug}",
        "draft_updated_at": site.updated_at,
        "published_at": release.created_at if release else None,
        "published_version": release.version if release else None,
        "draft_is_newer": bool(release and published_snapshot != draft_snapshot),
        "live_release_outdated": bool(release and (release.snapshot.get("content") or {}).get("publication_features_version", 1) < 2),
    }


@app.post("/internal/sites/{event_id}/assets", dependencies=[Depends(require_internal)])
async def upload_asset(event_id: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    site = await db.scalar(select(Site).where(Site.event_id == event_id))
    if not site:
        raise HTTPException(404, "Save the website before uploading images")
    suffix = ALLOWED_IMAGES.get(file.content_type or "")
    if not suffix:
        raise HTTPException(415, "Upload a JPG, PNG, or WebP image")
    data = await file.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Image must be 5 MB or smaller")
    try:
        from PIL import Image
        from io import BytesIO
        image = Image.open(BytesIO(data)); image.verify()
        width, height = Image.open(BytesIO(data)).size
    except Exception:
        raise HTTPException(422, "The uploaded file is not a valid image")
    if width > 6000 or height > 6000:
        raise HTTPException(422, "Image dimensions must not exceed 6000 pixels")
    os.makedirs(settings.upload_dir, exist_ok=True)
    name = f"{site.id}-{uuid.uuid4().hex}{suffix}"
    with open(os.path.join(settings.upload_dir, name), "wb") as target:
        target.write(data)
    return {"url": f"{settings.public_base_url.rstrip('/')}/site-assets/{name}", "width": width, "height": height}


@app.get("/site-assets/{name}", response_class=FileResponse)
async def site_asset(name: str):
    if not name or name != os.path.basename(name):
        raise HTTPException(404)
    path = os.path.join(settings.upload_dir, name)
    if not os.path.isfile(path):
        raise HTTPException(404, "Image not found")
    media_type = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})


@app.get("/health")
def health():
    return {"status": "ok", "service": "public-site-service", "enabled": settings.enabled}


@app.get("/health/ready")
async def ready():
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(503, f"Not ready: {exc}")
    return {"status": "ok", "database": "ok"}


@app.get("/internal/sites/{event_id}", dependencies=[Depends(require_internal)])
async def get_site(event_id: str, db: AsyncSession = Depends(get_db)):
    site = await db.scalar(select(Site).where(Site.event_id == event_id))
    if not site:
        raise HTTPException(404, "Website not configured")
    return await serialize(site, db)


@app.put("/internal/sites/{event_id}", dependencies=[Depends(require_internal)])
async def put_site(event_id: str, body: SiteUpsert, db: AsyncSession = Depends(get_db)):
    site = await locked_site(event_id, db)
    check_revision(site, body.expected_revision)
    owner = await db.scalar(select(Site).where(Site.slug == body.slug, Site.event_id != event_id))
    address = await db.get(SiteAddress, body.slug)
    if owner or (address and (not site or address.site_id != site.id)):
        raise HTTPException(409, "That website address is already in use or reserved by another website")
    if site and site.slug != body.slug and site.published_release_id and not body.confirm_slug_change:
        raise HTTPException(409, "Confirm the address change. The old address will redirect to the new one.")
    try:
        if not site:
            site = Site(event_id=event_id, org_id=body.org_id, slug=body.slug)
            db.add(site); await db.flush()
        old_address = await db.get(SiteAddress, site.slug)
        if not old_address: db.add(SiteAddress(slug=site.slug, site_id=site.id))
        if body.slug != site.slug and not address: db.add(SiteAddress(slug=body.slug, site_id=site.id))
        site.org_id, site.slug, site.template_family, site.draft = body.org_id, body.slug, body.template_family, body.content.model_dump(mode="json")
        site.updated_at = datetime.now(timezone.utc)
        await db.commit(); await db.refresh(site)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "The website or address changed in another window. Reload before saving.")
    return await serialize(site, db)


@app.post("/internal/sites/{event_id}/render-preview", dependencies=[Depends(require_internal)])
async def render_preview(event_id: str, body: SiteUpsert):
    # Validate and render without modifying a draft, release, address or asset.
    return {"html": render_site(body.content.model_dump(mode="json"), body.template_family, preview=True)}


@app.post("/internal/sites/{event_id}/preview", dependencies=[Depends(require_internal)])
async def create_preview(event_id: str, body: RevisionRequest, db: AsyncSession = Depends(get_db)):
    site = await locked_site(event_id, db)
    if not site:
        raise HTTPException(404, "Website not configured")
    check_revision(site, body.expected_revision)
    token = secrets.token_urlsafe(32)
    db.add(Preview(token=token, site_id=site.id, snapshot={"family": site.template_family, "content": site.draft}, expires_at=datetime.now(timezone.utc) + timedelta(hours=24)))
    await db.commit()
    return {"preview_url": f"{settings.public_base_url.rstrip('/')}/site-preview/{token}", "expires_in": 86400}


@app.post("/internal/sites/{event_id}/publish", dependencies=[Depends(require_internal)])
async def publish(event_id: str, body: PublishRequest, db: AsyncSession = Depends(get_db)):
    site = await locked_site(event_id, db)
    if not site:
        raise HTTPException(404, "Website not configured")
    check_revision(site, body.expected_revision)
    if body.content is not None: site.draft = body.content.model_dump(mode="json")
    version = (await db.scalar(select(func.max(Release.version)).where(Release.site_id == site.id)) or 0) + 1
    release = Release(site_id=site.id, version=version, snapshot={"family": site.template_family, "content": site.draft}, published_by=body.published_by)
    db.add(release); await db.flush(); site.published_release_id = release.id
    await db.commit()
    return {"version": version, "release_id": release.id, "public_url": f"{settings.public_base_url.rstrip('/')}/site/{site.slug}"}


@app.post("/internal/sites/{event_id}/unpublish", dependencies=[Depends(require_internal)])
async def unpublish(event_id: str, body: RevisionRequest, db: AsyncSession = Depends(get_db)):
    site = await locked_site(event_id, db)
    if not site:
        raise HTTPException(404, "Website not configured")
    check_revision(site, body.expected_revision)
    if not site.published_release_id:
        raise HTTPException(409, "Website is not currently published")
    site.published_release_id = None
    await db.commit()
    return await serialize(site, db)


@app.get("/internal/sites/{event_id}/releases", dependencies=[Depends(require_internal)])
async def releases(event_id: str, db: AsyncSession = Depends(get_db)):
    site = await db.scalar(select(Site).where(Site.event_id == event_id))
    if not site: raise HTTPException(404, "Website not configured")
    rows = (await db.execute(select(Release).where(Release.site_id == site.id).order_by(Release.version.desc()))).scalars().all()
    return [{"id": r.id, "version": r.version, "published_by": r.published_by, "created_at": r.created_at} for r in rows]


@app.post("/internal/sites/{event_id}/rollback/{release_id}", dependencies=[Depends(require_internal)])
async def rollback(event_id: str, release_id: str, body: RevisionRequest, db: AsyncSession = Depends(get_db)):
    site = await locked_site(event_id, db)
    release = await db.get(Release, release_id)
    if not site or not release or release.site_id != site.id: raise HTTPException(404, "Release not found")
    check_revision(site, body.expected_revision)
    site.published_release_id = release.id; await db.commit()
    return {"release_id": release.id, "version": release.version}


@app.post("/internal/sites/{event_id}/restore/{release_id}", dependencies=[Depends(require_internal)])
async def restore_draft(event_id: str, release_id: str, body: RevisionRequest, db: AsyncSession = Depends(get_db)):
    site = await locked_site(event_id, db)
    release = await db.get(Release, release_id)
    if not site or not release or release.site_id != site.id: raise HTTPException(404, "Release not found")
    check_revision(site, body.expected_revision)
    site.template_family = release.snapshot["family"]
    site.draft = release.snapshot["content"]
    site.updated_at = datetime.now(timezone.utc)
    await db.commit(); await db.refresh(site)
    return await serialize(site, db)


@app.get("/site-preview/{token}", response_class=HTMLResponse)
async def preview(token: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(Preview, token)
    if not row or row.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc): raise HTTPException(404, "Preview expired")
    return HTMLResponse(render_site(row.snapshot["content"], row.snapshot["family"], preview=True), headers={"Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Content-Security-Policy": security_policy()})


@app.get("/site/{slug}", response_class=HTMLResponse)
async def public_site(slug: str, db: AsyncSession = Depends(get_db)):
    if not settings.enabled: raise HTTPException(404, "Public websites are not enabled")
    site = await db.scalar(select(Site).where(Site.slug == slug, Site.enabled.is_(True)))
    if not site:
        address = await db.get(SiteAddress, slug)
        prior = await db.get(Site, address.site_id) if address else None
        if prior and prior.enabled and prior.published_release_id:
            return RedirectResponse(f"/site/{prior.slug}", status_code=308, headers={"Cache-Control":"no-store"})
    if not site or not site.published_release_id: raise HTTPException(404, "Website not published")
    release = await db.get(Release, site.published_release_id)
    if not release: raise HTTPException(404, "Website release unavailable")
    return HTMLResponse(render_site(release.snapshot["content"], release.snapshot["family"]), headers={"Cache-Control": "public, max-age=60, stale-while-revalidate=300", "Content-Security-Policy": security_policy(), "X-Content-Type-Options": "nosniff"})

