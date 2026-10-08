"""Certificates and presenter materials shared by Experience, Festio Live, and GuestHub."""
import base64
import hashlib
import html
import os
import re
import uuid
from datetime import datetime
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..auth import require_event_admin, require_event_member
from ..config import settings
from ..database import get_db
from ..models import (Event, EventCertificate, EventCertificateTemplate, ExperienceStep,
                      Guest, GuestExperienceProgress, PresenterMaterial, User, ExperienceWorkflow)
from services.email_service import send_simple_email
from services.qr_service import generate_qr_for_url

router = APIRouter()
public_router = APIRouter()
ALLOWED_MATERIAL_TYPES = {
    "application/pdf", "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/jpeg", "image/png", "image/webp", "video/mp4",
}
MAX_MATERIAL_BYTES = 100 * 1024 * 1024


class TemplateSave(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    design: dict = Field(default_factory=dict)
    eligibility: dict = Field(default_factory=dict)
    active: bool = True


class MaterialLinkCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    url: str = Field(min_length=8, max_length=1000)
    session_step_id: str | None = None
    kind: str = "link"
    visibility: str = "production"
    availability: str = "after_approval"
    presenter_notes: str | None = None


class MaterialUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    session_step_id: str | None = None
    kind: str | None = None
    visibility: str | None = None
    availability: str | None = None
    status: str | None = None
    presenter_notes: str | None = None


class IssueRequest(BaseModel):
    template_id: str
    guest_ids: list[str] = Field(default_factory=list)
    eligible_only: bool = True
    send_email: bool = False


class RevokeRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


def _absolute_public_url(path: str) -> str:
    return f"{(settings.public_base_url or settings.frontend_url).rstrip('/')}{path}"


def _template_out(row):
    return {"id": row.id, "event_id": row.event_id, "key": row.key, "name": row.name,
            "design": row.design or {}, "eligibility": row.eligibility or {}, "active": row.active,
            "created_at": row.created_at, "updated_at": row.updated_at}


def _material_out(row, session_title=None):
    return {"id": row.id, "event_id": row.event_id, "session_step_id": row.session_step_id,
            "session_title": session_title, "title": row.title, "kind": row.kind,
            "source_type": row.source_type, "source_url": row.source_url,
            "content_type": row.content_type, "size_bytes": row.size_bytes,
            "visibility": row.visibility, "availability": row.availability, "status": row.status,
            "presenter_notes": row.presenter_notes, "metadata": row.metadata_json or {},
            "approved_at": row.approved_at, "created_at": row.created_at, "updated_at": row.updated_at}


def _certificate_out(row, guest=None):
    snapshot = row.snapshot or {}
    return {"id": row.id, "event_id": row.event_id, "template_id": row.template_id,
            "guest_id": row.guest_id, "guest_name": snapshot.get("participant_name") or
            (f"{guest.first_name} {guest.last_name}".strip() if guest else ""),
            "certificate_number": row.certificate_number, "status": row.status,
            "verification_url": _absolute_public_url(f"/certificates/{row.verification_token}"),
            "document_url": f"/api/certificates/{row.verification_token}/document.pdf",
            "issued_at": row.issued_at, "sent_at": row.sent_at, "viewed_at": row.viewed_at,
            "revoked_at": row.revoked_at, "revoke_reason": row.revoke_reason}


async def _event(event_id, db):
    row = await db.get(Event, event_id)
    if not row:
        raise HTTPException(404, "Event not found")
    return row


async def _validate_session(event_id, step_id, db):
    if not step_id:
        return None
    step = await db.scalar(select(ExperienceStep).join(ExperienceWorkflow, ExperienceWorkflow.id == ExperienceStep.workflow_id)
        .where(ExperienceStep.id == step_id, ExperienceWorkflow.event_id == event_id))
    if not step or step.type != "session_attendance":
        raise HTTPException(400, "Select a valid session from this event")
    return step


@router.get("/{event_id}/live-content/sessions")
async def sessions(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_member)):
    await _event(event_id, db)
    rows = (await db.execute(select(ExperienceStep)
        .join(ExperienceWorkflow, ExperienceWorkflow.id == ExperienceStep.workflow_id)
        .where(ExperienceWorkflow.event_id == event_id, ExperienceWorkflow.status.in_(("published", "draft")), ExperienceStep.type == "session_attendance",
               ExperienceStep.enabled.is_(True)).order_by(ExperienceStep.sort_order))).scalars().all()
    return [{"id": row.id, "title": row.title, "description": row.description,
             "config": row.config or {}} for row in rows]


@router.get("/{event_id}/certificate-templates")
async def templates(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_member)):
    event = await _event(event_id, db)
    rows = (await db.execute(select(EventCertificateTemplate).where(EventCertificateTemplate.event_id == event_id)
                             .order_by(EventCertificateTemplate.created_at))).scalars().all()
    if not rows:
        row = EventCertificateTemplate(event_id=event_id, name="Certificate of Participation",
            design={"title": "Certificate of Participation", "subtitle": "This certificate is proudly presented to",
                    "body": f"For participating in {event.name}", "primary_color": "#075845", "accent_color": "#dba92e",
                    "signature_name": "Event Organizer", "orientation": "landscape"},
            eligibility={"minimum_sessions": 1, "require_event_checkin": True})
        db.add(row); await db.commit(); await db.refresh(row); rows = [row]
    return [_template_out(row) for row in rows]


@router.post("/{event_id}/certificate-templates", status_code=201)
async def create_template(event_id: str, body: TemplateSave, db: AsyncSession = Depends(get_db),
                          user: User = Depends(require_event_admin)):
    await _event(event_id, db)
    base_key = re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-")[:64] or "certificate"
    key, suffix = base_key, 1
    while await db.scalar(select(EventCertificateTemplate.id).where(
        EventCertificateTemplate.event_id == event_id, EventCertificateTemplate.key == key)):
        suffix += 1; key = f"{base_key[:70]}-{suffix}"
    row = EventCertificateTemplate(event_id=event_id, key=key, name=body.name, design=body.design,
        eligibility=body.eligibility, active=body.active, created_by_user_id=user.id)
    db.add(row); await db.commit(); await db.refresh(row)
    return _template_out(row)


@router.post("/{event_id}/certificate-assets", status_code=201)
async def upload_certificate_asset(event_id: str, file: UploadFile = File(...),
                                   db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    await _event(event_id, db)
    content_type = (file.content_type or "").lower()
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(400, "Use a JPEG, PNG, or WebP image")
    data = await file.read(8 * 1024 * 1024 + 1)
    if len(data) > 8 * 1024 * 1024: raise HTTPException(413, "Image is larger than 8 MB")
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.basename(file.filename or "certificate-image"))[-140:]
    url = storage.save(f"certificate-assets/{event_id}/{uuid.uuid4().hex}-{safe_name}", data, content_type)
    return {"url": url, "content_type": content_type, "size_bytes": len(data)}


@router.put("/{event_id}/certificate-templates/{template_id}")
async def save_template(event_id: str, template_id: str, body: TemplateSave, db: AsyncSession = Depends(get_db),
                        user: User = Depends(require_event_admin)):
    row = await db.get(EventCertificateTemplate, template_id)
    if not row or row.event_id != event_id: raise HTTPException(404, "Certificate template not found")
    row.name, row.design, row.eligibility, row.active = body.name, body.design, body.eligibility, body.active
    row.created_by_user_id = row.created_by_user_id or user.id
    await db.commit(); await db.refresh(row)
    return _template_out(row)


async def _candidate_rows(event_id, template, db):
    minimum = max(0, int((template.eligibility or {}).get("minimum_sessions") or 0))
    require_checkin = bool((template.eligibility or {}).get("require_event_checkin"))
    guests = (await db.execute(select(Guest).where(Guest.event_id == event_id).order_by(Guest.last_name, Guest.first_name))).scalars().all()
    attended_rows = (await db.execute(select(GuestExperienceProgress.guest_id, GuestExperienceProgress.step_id)
        .join(ExperienceStep, ExperienceStep.id == GuestExperienceProgress.step_id)
        .where(GuestExperienceProgress.event_id == event_id, GuestExperienceProgress.status.in_(["completed", "overridden"]),
               ExperienceStep.type == "session_attendance"))).all()
    attended = {}
    for guest_id, step_id in attended_rows: attended.setdefault(guest_id, set()).add(step_id)
    required = set((template.eligibility or {}).get("required_session_ids") or [])
    return [(g, len(attended.get(g.id, set())),
             (not require_checkin or bool(g.admitted)) and len(attended.get(g.id, set())) >= minimum
             and required.issubset(attended.get(g.id, set()))) for g in guests]


async def auto_issue_eligible_certificates(event: Event, guest: Guest, db: AsyncSession, background_tasks: BackgroundTasks | None = None) -> list[EventCertificate]:
    """Issue active auto-issue templates after a journey transition. Caller commits."""
    templates = (await db.execute(select(EventCertificateTemplate).where(
        EventCertificateTemplate.event_id == event.id, EventCertificateTemplate.active.is_(True)
    ))).scalars().all()
    created = []
    for template in templates:
        if not (template.eligibility or {}).get("auto_issue"): continue
        candidates = await _candidate_rows(event.id, template, db)
        candidate = next(((count, eligible) for row, count, eligible in candidates if row.id == guest.id), None)
        if not candidate or not candidate[1]: continue
        existing = await db.scalar(select(EventCertificate.id).where(
            EventCertificate.template_id == template.id, EventCertificate.guest_id == guest.id))
        if existing: continue
        count = candidate[0]
        cert = EventCertificate(event_id=event.id, template_id=template.id, guest_id=guest.id,
            certificate_number=f"FESTIO-{datetime.utcnow():%Y%m}-{uuid.uuid4().hex[:10].upper()}",
            snapshot={"participant_name": f"{guest.first_name} {guest.last_name}".strip(), "event_name": event.name,
                      "event_date": event.event_date.isoformat() if event.event_date else "", "sessions_attended": count,
                      "template_name": template.name, "design": template.design or {}, "eligibility": template.eligibility or {}})
        db.add(cert); await db.flush(); created.append(cert)
        if background_tasks is not None and guest.email:
            url = _absolute_public_url(f"/certificates/{cert.verification_token}")
            background_tasks.add_task(send_simple_email, guest.email, f"Your certificate — {event.name}",
                f"<p>Hello {html.escape(guest.first_name)},</p><p>Your certificate is ready.</p><p><a href='{url}'>View and download certificate</a></p>",
                event.id, None, guest.id, "event_certificate")
            cert.sent_at = datetime.utcnow()
    return created


@router.get("/{event_id}/certificate-candidates")
async def candidates(event_id: str, template_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_member)):
    template = await db.get(EventCertificateTemplate, template_id)
    if not template or template.event_id != event_id: raise HTTPException(404, "Certificate template not found")
    issued = set((await db.execute(select(EventCertificate.guest_id).where(EventCertificate.template_id == template_id))).scalars().all())
    return [{"guest_id": g.id, "name": f"{g.first_name} {g.last_name}".strip(), "email": g.email,
             "admitted": g.admitted, "sessions_attended": count, "eligible": eligible, "issued": g.id in issued}
            for g, count, eligible in await _candidate_rows(event_id, template, db)]


@router.post("/{event_id}/certificates/issue")
async def issue(event_id: str, body: IssueRequest, background_tasks: BackgroundTasks,
                db: AsyncSession = Depends(get_db), user: User = Depends(require_event_admin)):
    event = await _event(event_id, db)
    template = await db.get(EventCertificateTemplate, body.template_id)
    if not template or template.event_id != event_id or not template.active: raise HTTPException(404, "Active certificate template not found")
    selected = set(body.guest_ids)
    created = []
    for guest, count, eligible in await _candidate_rows(event_id, template, db):
        if selected and guest.id not in selected: continue
        if body.eligible_only and not eligible: continue
        existing = await db.scalar(select(EventCertificate).where(EventCertificate.template_id == template.id, EventCertificate.guest_id == guest.id))
        if existing: continue
        cert = EventCertificate(event_id=event_id, template_id=template.id, guest_id=guest.id,
            certificate_number=f"FESTIO-{datetime.utcnow():%Y%m}-{uuid.uuid4().hex[:10].upper()}", issued_by_user_id=user.id,
            snapshot={"participant_name": f"{guest.first_name} {guest.last_name}".strip(), "event_name": event.name,
                      "event_date": event.event_date.isoformat() if event.event_date else "", "sessions_attended": count,
                      "template_name": template.name, "design": template.design or {}, "eligibility": template.eligibility or {}})
        db.add(cert); await db.flush(); created.append((cert, guest))
    await db.commit()
    for cert, guest in created:
        await db.refresh(cert)
        if body.send_email and guest.email:
            url = _absolute_public_url(f"/certificates/{cert.verification_token}")
            background_tasks.add_task(send_simple_email, guest.email, f"Your certificate — {event.name}",
                f"<p>Hello {html.escape(guest.first_name)},</p><p>Your certificate is ready.</p><p><a href='{url}'>View and download certificate</a></p>",
                event.id, None, guest.id, "event_certificate")
            cert.sent_at = datetime.utcnow()
    if created: await db.commit()
    return {"issued": len(created), "certificates": [_certificate_out(c, g) for c, g in created]}


@router.get("/{event_id}/certificates")
async def list_certificates(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_member)):
    rows = (await db.execute(select(EventCertificate, Guest).join(Guest, Guest.id == EventCertificate.guest_id)
        .where(EventCertificate.event_id == event_id).order_by(EventCertificate.issued_at.desc()))).all()
    return [_certificate_out(cert, guest) for cert, guest in rows]


@router.get("/{event_id}/certificates/report")
async def certificate_report(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_member)):
    await _event(event_id, db)
    rows = (await db.execute(select(EventCertificate, Guest, EventCertificateTemplate)
        .join(Guest, Guest.id == EventCertificate.guest_id)
        .join(EventCertificateTemplate, EventCertificateTemplate.id == EventCertificate.template_id)
        .where(EventCertificate.event_id == event_id).order_by(EventCertificate.issued_at.desc()))).all()
    return {"summary": {"total": len(rows), "issued": sum(c.status == "issued" for c, _, _ in rows),
        "revoked": sum(c.status == "revoked" for c, _, _ in rows), "emailed": sum(c.sent_at is not None for c, _, _ in rows),
        "viewed": sum(c.viewed_at is not None for c, _, _ in rows)},
        "rows": [{**_certificate_out(cert, guest), "template_name": template.name, "email": guest.email} for cert, guest, template in rows]}


@router.post("/{event_id}/certificates/{certificate_id}/revoke")
async def revoke(event_id: str, certificate_id: str, body: RevokeRequest, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    row = await db.get(EventCertificate, certificate_id)
    if not row or row.event_id != event_id: raise HTTPException(404, "Certificate not found")
    row.status, row.revoked_at, row.revoke_reason = "revoked", datetime.utcnow(), body.reason
    await db.commit(); return _certificate_out(row)


@router.get("/{event_id}/presenter-materials")
async def list_materials(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_member)):
    rows = (await db.execute(select(PresenterMaterial, ExperienceStep.title).outerjoin(ExperienceStep, ExperienceStep.id == PresenterMaterial.session_step_id)
        .where(PresenterMaterial.event_id == event_id, PresenterMaterial.status != "archived")
        .order_by(PresenterMaterial.created_at.desc()))).all()
    return [_material_out(row, title) for row, title in rows]


@router.post("/{event_id}/presenter-materials/link", status_code=201)
async def add_material_link(event_id: str, body: MaterialLinkCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_event_admin)):
    await _event(event_id, db); step = await _validate_session(event_id, body.session_step_id, db)
    parsed = urlparse(body.url)
    if parsed.scheme not in ("https", "http") or not parsed.netloc: raise HTTPException(400, "Enter a valid https:// link")
    host = (parsed.hostname or "").lower()
    provider = "google" if "google.com" in host else "microsoft" if host.endswith(("office.com", "live.com", "sharepoint.com")) else "youtube" if host.endswith(("youtube.com", "youtu.be")) else "external"
    present_url = body.url
    if provider == "google":
        present_url = re.sub(r"/(edit|view)(?:[?#].*)?$", "/preview", body.url)
    elif provider == "youtube":
        video_id = (parsed.path.strip("/") if host.endswith("youtu.be") else parse_qs(parsed.query).get("v", [""])[0])
        if video_id: present_url = f"https://www.youtube.com/embed/{video_id}"
    row = PresenterMaterial(event_id=event_id, session_step_id=step.id if step else None, title=body.title.strip(), kind=body.kind,
        source_type="link", source_url=body.url, visibility=body.visibility, availability=body.availability,
        presenter_notes=body.presenter_notes, metadata_json={"provider": provider, "present_url": present_url, "version": 1, "processing_status": "ready"}, created_by_user_id=user.id)
    db.add(row); await db.commit(); await db.refresh(row); return _material_out(row, step.title if step else None)


@router.post("/{event_id}/presenter-materials/upload", status_code=201)
async def upload_material(event_id: str, file: UploadFile = File(...), title: str = Form(""), session_step_id: str = Form(""),
                          kind: str = Form("document"), visibility: str = Form("production"), availability: str = Form("after_approval"),
                          db: AsyncSession = Depends(get_db), user: User = Depends(require_event_admin)):
    await _event(event_id, db); step = await _validate_session(event_id, session_step_id or None, db)
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_MATERIAL_TYPES: raise HTTPException(400, "Use PDF, PowerPoint, Excel, JPEG, PNG, WebP, or MP4")
    data = await file.read(MAX_MATERIAL_BYTES + 1)
    if len(data) > MAX_MATERIAL_BYTES: raise HTTPException(413, "Material is larger than 100 MB")
    signatures = {"application/pdf": data.startswith(b"%PDF"), "image/jpeg": data.startswith(b"\xff\xd8\xff"),
                  "image/png": data.startswith(b"\x89PNG"), "video/mp4": b"ftyp" in data[:32]}
    if content_type in signatures and not signatures[content_type]: raise HTTPException(400, "The file contents do not match its declared type")
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.basename(file.filename or "material"))[-180:]
    storage_key = f"presenter-materials/{event_id}/{uuid.uuid4().hex}-{safe_name}"
    original_url = storage.save(storage_key, data, content_type)
    url, served_type, processing_status, pages = original_url, content_type, "ready", None
    presentation_types = {"application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"}
    if content_type in presentation_types:
        try:
            async with httpx.AsyncClient(timeout=100) as client:
                response = await client.post(
                    settings.design_service_url.rstrip("/") + "/api/v1/design/convert-presentation",
                    files={"file": (safe_name, data, content_type)},
                    headers={"X-Internal-Token": settings.design_internal_token},
                )
            response.raise_for_status()
            converted = response.content
            url = storage.save(storage_key.rsplit(".", 1)[0] + ".pdf", converted, "application/pdf")
            served_type, processing_status = "application/pdf", "converted"
            pages = int(response.headers.get("X-Document-Pages") or 0) or None
        except (httpx.HTTPError, ValueError):
            processing_status = "conversion_failed"
    metadata = {"sha256": hashlib.sha256(data).hexdigest(), "version": 1, "original_filename": safe_name,
                "original_url": original_url, "processing_status": processing_status}
    if pages: metadata["page_count"] = pages
    row = PresenterMaterial(event_id=event_id, session_step_id=step.id if step else None, title=(title.strip() or safe_name), kind=kind,
        source_type="upload", source_url=url, content_type=served_type, size_bytes=len(data), visibility=visibility,
        availability=availability, metadata_json=metadata, created_by_user_id=user.id)
    db.add(row); await db.commit(); await db.refresh(row); return _material_out(row, step.title if step else None)


@router.patch("/{event_id}/presenter-materials/{material_id}")
async def update_material(event_id: str, material_id: str, body: MaterialUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(require_event_admin)):
    row = await db.get(PresenterMaterial, material_id)
    if not row or row.event_id != event_id: raise HTTPException(404, "Material not found")
    values = body.model_dump(exclude_unset=True)
    if "session_step_id" in values: await _validate_session(event_id, values["session_step_id"], db)
    for key, value in values.items(): setattr(row, key, value)
    if body.status == "approved": row.approved_at, row.approved_by_user_id = datetime.utcnow(), user.id
    await db.commit(); await db.refresh(row)
    step = await db.get(ExperienceStep, row.session_step_id) if row.session_step_id else None
    return _material_out(row, step.title if step else None)


@router.delete("/{event_id}/presenter-materials/{material_id}", status_code=204)
async def delete_material(event_id: str, material_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    row = await db.get(PresenterMaterial, material_id)
    if not row or row.event_id != event_id: raise HTTPException(404, "Material not found")
    row.status = "archived"; await db.commit()


def _certificate_html(cert: EventCertificate):
    snap, design = cert.snapshot or {}, (cert.snapshot or {}).get("design") or {}
    primary, accent = html.escape(design.get("primary_color", "#075845")), html.escape(design.get("accent_color", "#dba92e"))
    verify_url = _absolute_public_url(f"/certificates/{cert.verification_token}")
    qr = base64.b64encode(generate_qr_for_url(verify_url)).decode()
    asset = lambda value: _absolute_public_url(str(value)) if str(value or "").startswith("/") else str(value or "")
    logo = html.escape(asset(design.get("logo_url"))); background = html.escape(asset(design.get("background_url"))); signature = html.escape(asset(design.get("signature_url")))
    bg = f"background-image:linear-gradient(#ffffffdd,#ffffffdd),url('{background}');background-size:cover;" if background else ""
    return f"""<!doctype html><html><head><meta charset='utf-8'><style>@page{{size:A4 landscape;margin:0}}*{{box-sizing:border-box}}body{{margin:0;font-family:Arial;color:{primary}}}.certificate{{width:1120px;height:790px;padding:58px;text-align:center;border:18px solid {primary};box-shadow:inset 0 0 0 5px {accent};display:flex;flex-direction:column;justify-content:center;{bg}}}.logo{{max-width:130px;max-height:75px;margin:0 auto 10px}}.eyebrow{{letter-spacing:.24em;text-transform:uppercase;color:{accent};font-weight:700}}h1{{font:58px Georgia;margin:18px}}h2{{font:48px Georgia;margin:15px;border-bottom:2px solid {accent};display:inline-block;padding:0 30px 10px}}p{{font-size:20px}}footer{{margin-top:30px;display:flex;align-items:end;justify-content:space-around;font-size:13px}}footer img.signature{{display:block;max-width:150px;max-height:50px;margin:auto}}.qr{{width:86px;height:86px}}</style></head><body><main class='certificate'>{f'<img class="logo" src="{logo}">' if logo else ''}<div class='eyebrow'>{html.escape(design.get('title','Certificate of Participation'))}</div><p>{html.escape(design.get('subtitle','This certificate is proudly presented to'))}</p><h2>{html.escape(snap.get('participant_name','Participant'))}</h2><h1>{html.escape(snap.get('event_name','Event'))}</h1><p>{html.escape(design.get('body','For successful participation in this event'))}</p><footer><span>{f'<img class="signature" src="{signature}">' if signature else ''}{html.escape(design.get('signature_name','Event Organizer'))}<br>Authorized signature</span><span><img class='qr' src='data:image/png;base64,{qr}'><br>Scan to verify</span><span>{html.escape(cert.certificate_number)}<br>Verification number</span></footer></main></body></html>"""


@router.get("/{event_id}/guest-content/{token}")
async def guest_content(event_id: str, token: str, db: AsyncSession = Depends(get_db)):
    guest = await db.scalar(select(Guest).where(Guest.event_id == event_id, or_(Guest.invite_token == token, Guest.qr_token == token)))
    if not guest:
        raise HTTPException(404, "Guest access not found")
    certificates = (await db.execute(select(EventCertificate).where(
        EventCertificate.event_id == event_id, EventCertificate.guest_id == guest.id, EventCertificate.status == "issued"
    ).order_by(EventCertificate.issued_at.desc()))).scalars().all()
    progress_step_ids = set((await db.execute(select(GuestExperienceProgress.step_id).where(
        GuestExperienceProgress.event_id == event_id, GuestExperienceProgress.guest_id == guest.id,
        GuestExperienceProgress.status.in_(["completed", "overridden"])
    ))).scalars().all())
    material_rows = (await db.execute(select(PresenterMaterial, ExperienceStep.title).outerjoin(
        ExperienceStep, ExperienceStep.id == PresenterMaterial.session_step_id
    ).where(PresenterMaterial.event_id == event_id, PresenterMaterial.status == "approved",
            PresenterMaterial.visibility == "attendees").order_by(PresenterMaterial.created_at.desc()))).all()
    materials = []
    for material, session_title in material_rows:
        if material.availability == "after_session_attendance" and material.session_step_id not in progress_step_ids:
            continue
        materials.append(_material_out(material, session_title))
    return {"guest_id": guest.id, "materials": materials,
            "certificates": [_certificate_out(cert, guest) for cert in certificates]}


@public_router.get("/{token}")
async def verify(token: str, db: AsyncSession = Depends(get_db)):
    cert = await db.scalar(select(EventCertificate).where(EventCertificate.verification_token == token))
    if not cert: raise HTTPException(404, "Certificate not found")
    if not cert.viewed_at: cert.viewed_at = datetime.utcnow(); await db.commit()
    return {**_certificate_out(cert), "valid": cert.status == "issued", "snapshot": cert.snapshot or {}}


@public_router.get("/{token}/document.pdf")
async def document(token: str, db: AsyncSession = Depends(get_db)):
    cert = await db.scalar(select(EventCertificate).where(EventCertificate.verification_token == token))
    if not cert: raise HTTPException(404, "Certificate not found")
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(settings.design_service_url.rstrip("/") + "/api/v1/design/render-pdf",
                json={"html": _certificate_html(cert), "width": "1120px", "height": "790px", "landscape": True},
                headers={"X-Internal-Token": settings.design_internal_token})
        response.raise_for_status()
        return Response(response.content, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{cert.certificate_number}.pdf"'})
    except (httpx.HTTPError, AttributeError):
        return HTMLResponse(_certificate_html(cert), status_code=200)
