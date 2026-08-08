"""Document vault: contracts, quotes, invoices, proposals attached to an event
or vendor."""
import os
import re
import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..auth import Identity, current_identity, ensure_capability
from ..config import settings
from ..database import get_db

router = APIRouter(prefix="/api/planner", tags=["planner-documents"])

_UNSAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._-]")
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
ALLOWED_DOCUMENT_TYPES = {
    "application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/jpeg", "image/png", "image/webp", "text/plain", "text/csv",
}


def _safe_filename(raw: str) -> str:
    """Strip any directory components and unsafe characters from a
    client-supplied filename before it ever touches the filesystem.

    `file.filename` is attacker-controlled — without this, a name like
    "../../../etc/passwd" survives `os.path.join` unchanged (it does not
    sanitize ".." segments) and lets an upload write outside upload_dir."""
    base = os.path.basename(raw or "upload")
    base = _UNSAFE_FILENAME_CHARS.sub("_", base).lstrip(".") or "upload"
    return base[-150:]  # keep the uuid prefix + extension comfortably under typical fs limits


async def _get_document(db: AsyncSession, event_id: str, doc_id: str) -> models.PlannerDocument:
    document = (await db.execute(
        select(models.PlannerDocument).where(
            models.PlannerDocument.id == doc_id, models.PlannerDocument.event_id == event_id,
        )
    )).scalar_one_or_none()
    if document is None:
        raise HTTPException(404, "Not found")
    return document


@router.get("/{event_id}/documents", response_model=list[schemas.DocumentOut])
async def list_documents(
    event_id: str,
    vendor_id: str | None = Query(None),
    type: str | None = Query(None),
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> list[models.PlannerDocument]:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    q = select(models.PlannerDocument).where(models.PlannerDocument.event_id == event_id)
    if vendor_id:
        q = q.where(models.PlannerDocument.vendor_id == vendor_id)
    if type:
        q = q.where(models.PlannerDocument.type == type)
    q = q.order_by(models.PlannerDocument.uploaded_at.desc())
    return (await db.execute(q)).scalars().all()


@router.get("/{event_id}/documents/files/{filename}")
async def get_document_file(
    event_id: str,
    filename: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    expected_url = f"/api/planner/{event_id}/documents/files/{filename}"
    document = await db.scalar(select(models.PlannerDocument).where(
        models.PlannerDocument.event_id == event_id, models.PlannerDocument.file_url == expected_url,
    ))
    if document is None:
        raise HTTPException(404, "Not found")
    dest_dir = os.path.realpath(os.path.join(settings.upload_dir, event_id))
    file_path = os.path.realpath(os.path.join(dest_dir, filename))
    if not file_path.startswith(dest_dir + os.sep) or not os.path.isfile(file_path):
        raise HTTPException(404, "Not found")
    return FileResponse(file_path, filename=document.name)


@router.post("/{event_id}/documents/upload", response_model=schemas.DocumentOut, status_code=201)
async def upload_document(
    event_id: str,
    file: UploadFile = File(...),
    name: str = Form(...),
    type: str = Form("other"),
    vendor_id: str | None = Form(None),
    expires_at: str | None = Form(None),
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerDocument:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "documents")
    if file.content_type not in ALLOWED_DOCUMENT_TYPES:
        raise HTTPException(415, "Unsupported planner document type")
    try:
        parsed_expires_at = date.fromisoformat(expires_at) if expires_at else None
    except ValueError as exc:
        raise HTTPException(422, "expires_at must be an ISO date") from exc
    if vendor_id:
        vendor = await db.scalar(select(models.PlannerVendor).where(
            models.PlannerVendor.id == vendor_id,
            models.PlannerVendor.event_id == event_id,
            models.PlannerVendor.deleted_at.is_(None),
        ))
        if not vendor:
            raise HTTPException(404, "Vendor not found")

    dest_dir = os.path.join(settings.upload_dir, event_id)
    os.makedirs(dest_dir, exist_ok=True)
    stored_filename = f"{uuid.uuid4()}_{_safe_filename(file.filename)}"
    dest_path = os.path.join(dest_dir, stored_filename)
    size = 0
    try:
        with open(dest_path, "xb") as destination:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_DOCUMENT_BYTES:
                    raise HTTPException(413, "Planner documents are limited to 25 MB")
                destination.write(chunk)
    except Exception:
        try:
            os.remove(dest_path)
        except OSError:
            pass
        raise

    document = models.PlannerDocument(
        event_id=event_id,
        vendor_id=vendor_id,
        type=type,
        name=name,
        file_url=f"/api/planner/{event_id}/documents/files/{stored_filename}",
        file_size_bytes=size,
        expires_at=parsed_expires_at,
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)
    return document


@router.patch("/{event_id}/documents/{doc_id}", response_model=schemas.DocumentOut)
async def update_document(
    event_id: str,
    doc_id: str,
    payload: schemas.DocumentUpdate,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerDocument:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "documents")
    document = await _get_document(db, event_id, doc_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(document, field, value)
    await db.commit()
    await db.refresh(document)
    return document


@router.delete("/{event_id}/documents/{doc_id}", status_code=204)
async def delete_document(
    event_id: str,
    doc_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "documents")
    document = await _get_document(db, event_id, doc_id)
    stored_filename = document.file_url.rsplit("/", 1)[-1]
    file_path = os.path.join(settings.upload_dir, event_id, stored_filename)
    try:
        os.remove(file_path)
    except OSError:
        pass
    await db.delete(document)
    await db.commit()
