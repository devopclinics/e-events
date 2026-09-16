import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import SessionLocal, get_db
from .models import Preview, Release, Site
from .render import render_site
from .schemas import PublishRequest, SiteUpsert

app = FastAPI(title="Festio Public Sites", version="1.0.0")


def require_internal(x_internal_token: str | None = Header(default=None)):
    if not settings.internal_service_token or not secrets.compare_digest(x_internal_token or "", settings.internal_service_token):
        raise HTTPException(401, "Invalid internal service token")


def serialize(site: Site):
    return {"event_id": site.event_id, "org_id": site.org_id, "slug": site.slug, "template_family": site.template_family, "content": site.draft, "published_release_id": site.published_release_id, "enabled": site.enabled, "public_url": f"{settings.public_base_url.rstrip('/')}/site/{site.slug}"}


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
    return serialize(site)


@app.put("/internal/sites/{event_id}", dependencies=[Depends(require_internal)])
async def put_site(event_id: str, body: SiteUpsert, db: AsyncSession = Depends(get_db)):
    site = await db.scalar(select(Site).where(Site.event_id == event_id))
    slug_owner = await db.scalar(select(Site).where(Site.slug == body.slug, Site.event_id != event_id))
    if slug_owner:
        raise HTTPException(409, "That website address is already in use")
    if not site:
        site = Site(event_id=event_id, org_id=body.org_id, slug=body.slug)
        db.add(site)
    site.org_id, site.slug, site.template_family, site.draft = body.org_id, body.slug, body.template_family, body.content.model_dump(mode="json")
    await db.commit(); await db.refresh(site)
    return serialize(site)


@app.post("/internal/sites/{event_id}/preview", dependencies=[Depends(require_internal)])
async def create_preview(event_id: str, db: AsyncSession = Depends(get_db)):
    site = await db.scalar(select(Site).where(Site.event_id == event_id))
    if not site:
        raise HTTPException(404, "Website not configured")
    token = secrets.token_urlsafe(32)
    db.add(Preview(token=token, site_id=site.id, snapshot={"family": site.template_family, "content": site.draft}, expires_at=datetime.now(timezone.utc) + timedelta(hours=24)))
    await db.commit()
    return {"preview_url": f"{settings.public_base_url.rstrip('/')}/site-preview/{token}", "expires_in": 86400}


@app.post("/internal/sites/{event_id}/publish", dependencies=[Depends(require_internal)])
async def publish(event_id: str, body: PublishRequest, db: AsyncSession = Depends(get_db)):
    site = await db.scalar(select(Site).where(Site.event_id == event_id))
    if not site:
        raise HTTPException(404, "Website not configured")
    version = (await db.scalar(select(func.max(Release.version)).where(Release.site_id == site.id)) or 0) + 1
    release = Release(site_id=site.id, version=version, snapshot={"family": site.template_family, "content": site.draft}, published_by=body.published_by)
    db.add(release); await db.flush(); site.published_release_id = release.id
    await db.commit()
    return {"version": version, "release_id": release.id, "public_url": f"{settings.public_base_url.rstrip('/')}/site/{site.slug}"}


@app.get("/internal/sites/{event_id}/releases", dependencies=[Depends(require_internal)])
async def releases(event_id: str, db: AsyncSession = Depends(get_db)):
    site = await db.scalar(select(Site).where(Site.event_id == event_id))
    if not site: raise HTTPException(404, "Website not configured")
    rows = (await db.execute(select(Release).where(Release.site_id == site.id).order_by(Release.version.desc()))).scalars().all()
    return [{"id": r.id, "version": r.version, "published_by": r.published_by, "created_at": r.created_at} for r in rows]


@app.post("/internal/sites/{event_id}/rollback/{release_id}", dependencies=[Depends(require_internal)])
async def rollback(event_id: str, release_id: str, db: AsyncSession = Depends(get_db)):
    site = await db.scalar(select(Site).where(Site.event_id == event_id))
    release = await db.get(Release, release_id)
    if not site or not release or release.site_id != site.id: raise HTTPException(404, "Release not found")
    site.published_release_id = release.id; await db.commit()
    return {"release_id": release.id, "version": release.version}


@app.get("/site-preview/{token}", response_class=HTMLResponse)
async def preview(token: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(Preview, token)
    if not row or row.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc): raise HTTPException(404, "Preview expired")
    return HTMLResponse(render_site(row.snapshot["content"], row.snapshot["family"], preview=True), headers={"Cache-Control": "private, no-store", "X-Robots-Tag": "noindex"})


@app.get("/site/{slug}", response_class=HTMLResponse)
async def public_site(slug: str, db: AsyncSession = Depends(get_db)):
    if not settings.enabled: raise HTTPException(404, "Public websites are not enabled")
    site = await db.scalar(select(Site).where(Site.slug == slug, Site.enabled.is_(True)))
    if not site or not site.published_release_id: raise HTTPException(404, "Website not published")
    release = await db.get(Release, site.published_release_id)
    if not release: raise HTTPException(404, "Website release unavailable")
    return HTMLResponse(render_site(release.snapshot["content"], release.snapshot["family"]), headers={"Cache-Control": "public, max-age=60, stale-while-revalidate=300", "Content-Security-Policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", "X-Content-Type-Options": "nosniff"})

