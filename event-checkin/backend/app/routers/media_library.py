"""Organization-scoped reusable uploads, selected through an authorized event."""
import asyncio
import hashlib
import io
import uuid
import warnings
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from PIL import Image, ImageOps, UnidentifiedImageError
from ..auth import get_current_user
from ..database import get_db
from ..models import Event, Membership, Organization, OrganizationMediaAsset, User
from .. import storage

router = APIRouter()
MAX_FILE = 20 * 1024 * 1024
TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}

class MediaTitle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=255)

async def media_org(event_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    event = await db.get(Event, event_id)
    org = await db.get(Organization, event.org_id) if event else None
    if not org or (not org.is_active and not user.is_platform_superadmin):
        raise HTTPException(404, "Event not found")
    if not user.is_platform_superadmin:
        role = await db.scalar(select(Membership.role).where(Membership.org_id == org.id, Membership.user_id == user.id))
        if role not in ("owner", "admin"):
            raise HTTPException(403, "Organization owner or admin access is required for shared media")
    return org

def output(asset):
    return {key: getattr(asset, key) for key in ("id", "org_id", "title", "filename", "url", "content_type", "byte_size", "width", "height", "created_at")}

def validate_file(data, content_type):
    if content_type not in TYPES:
        raise HTTPException(400, "Choose a JPG, PNG, WebP image or PDF file")
    if not data or len(data) > MAX_FILE:
        raise HTTPException(400, "Choose a file up to 20 MB")
    if content_type == "application/pdf":
        if not data.startswith(b"%PDF-"):
            raise HTTPException(400, "The file is not a valid PDF")
        return data, None, None
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "Images must be 5 MB or smaller")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format != {"image/jpeg":"JPEG", "image/png":"PNG", "image/webp":"WEBP"}[content_type]:
                    raise ValueError("Image type mismatch")
                if image.width * image.height > 25_000_000:
                    raise ValueError("Image exceeds 25 megapixels")
                image.load()
                image_format = image.format
                normalized = ImageOps.exif_transpose(image)
                clean = io.BytesIO()
                normalized.save(clean, format=image_format)
                if clean.tell() > 5 * 1024 * 1024:
                    raise ValueError("Processed image is too large")
                return clean.getvalue(), normalized.width, normalized.height
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise HTTPException(400, "Choose a valid image up to 25 megapixels")

@router.get("/{event_id}/media-library")
async def list_media(org=Depends(media_org), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(OrganizationMediaAsset).where(OrganizationMediaAsset.org_id == org.id, OrganizationMediaAsset.archived.is_(False)).order_by(OrganizationMediaAsset.created_at.desc()).limit(500))).scalars().all()
    return {"organization": {"id": org.id, "name": org.name}, "assets": [output(row) for row in rows]}

@router.post("/{event_id}/media-library", status_code=201)
async def upload_media(file: UploadFile = File(...), org=Depends(media_org), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    content_type = (file.content_type or "").lower()
    data, width, height = await asyncio.to_thread(validate_file, await file.read(MAX_FILE + 1), content_type)
    await db.scalar(select(Organization).where(Organization.id == org.id).with_for_update())
    digest = hashlib.sha256(data).hexdigest()
    existing = await db.scalar(select(OrganizationMediaAsset).where(OrganizationMediaAsset.org_id == org.id, OrganizationMediaAsset.sha256 == digest, OrganizationMediaAsset.archived.is_(False)).limit(1))
    if existing:
        return output(existing)
    size = await db.scalar(select(func.coalesce(func.sum(OrganizationMediaAsset.byte_size), 0)).where(OrganizationMediaAsset.org_id == org.id))
    count = await db.scalar(select(func.count()).select_from(OrganizationMediaAsset).where(OrganizationMediaAsset.org_id == org.id))
    if size + len(data) > 500 * 1024 * 1024 or count >= 500:
        raise HTTPException(400, "This organization’s shared media library has reached its storage limit")
    aid = str(uuid.uuid4())
    filename = (file.filename or f"file.{TYPES[content_type]}").replace('\\', '/').split('/')[-1][:255]
    path = f"shared-media/{org.id}/{aid}.{TYPES[content_type]}"
    url = await asyncio.to_thread(storage.save, path, data, content_type)
    asset = OrganizationMediaAsset(id=aid, org_id=org.id, title=filename, filename=filename, url=url, content_type=content_type, byte_size=len(data), sha256=digest, width=width, height=height, uploaded_by=user.id)
    db.add(asset)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        await asyncio.to_thread(storage.delete, path)
        raise
    await db.refresh(asset)
    return output(asset)

async def find_asset(asset_id, org, db):
    asset = await db.get(OrganizationMediaAsset, asset_id)
    if not asset or asset.org_id != org.id or asset.archived:
        raise HTTPException(404, "Media file not found")
    return asset

@router.patch("/{event_id}/media-library/{asset_id}")
async def rename_media(asset_id: str, data: MediaTitle, org=Depends(media_org), db: AsyncSession = Depends(get_db)):
    asset = await find_asset(asset_id, org, db)
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "Enter a file name")
    asset.title = title
    await db.commit()
    return output(asset)

@router.delete("/{event_id}/media-library/{asset_id}")
async def archive_media(asset_id: str, org=Depends(media_org), db: AsyncSession = Depends(get_db)):
    asset = await find_asset(asset_id, org, db)
    asset.archived = True
    await db.commit()
    return {"ok": True, "existing_links_preserved": True}
