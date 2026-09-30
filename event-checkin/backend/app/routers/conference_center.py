"""Conference Center orchestration.

Adds application/review and conference operations while reusing the canonical
GuestSpeaker and Partner records. Accepted applications are promoted exactly
once, so public showcases and downstream modules keep one source of truth.
"""
from datetime import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_paid_event_admin, require_paid_event_member
from ..database import get_db
from ..models import (ConferenceOperation, ConferenceProfile, ConferenceSubmission,
    ConferenceTrack, Event, GuestSpeaker, OrganizationConferenceTemplate, Partner,
    PartnerCategory, User)
from ..schemas import (ConferenceOperationIn, ConferenceProfileUpdate,
    ConferenceSubmissionCreate, ConferenceSubmissionReview, ConferenceTemplateIn,
    ConferenceTrackIn)

router = APIRouter()
public_router = APIRouter()
KINDS = {"speaker", "abstract", "exhibitor", "sponsor"}
CATEGORIES = {"meeting", "release", "gallery", "integration"}

async def event_or_404(event_id: str, db: AsyncSession) -> Event:
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return event

async def profile_for(event_id: str, db: AsyncSession) -> ConferenceProfile:
    profile = await db.scalar(select(ConferenceProfile).where(ConferenceProfile.event_id == event_id))
    if not profile:
        profile = ConferenceProfile(event_id=event_id, enabled_call_types=[])
        db.add(profile)
        await db.commit(); await db.refresh(profile)
    return profile

def profile_out(p, event):
    return {"id": p.id, "event_id": p.event_id, "event_name": event.name,
        "public_token": p.public_token, "public_url": f"/conference/apply/{p.public_token}",
        "calls_open": p.calls_open, "enabled_call_types": p.enabled_call_types or [],
        "welcome_text": p.welcome_text, "deadline": p.deadline,
        "created_at": p.created_at, "updated_at": p.updated_at}

def row_out(row):
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}

@router.get("/{event_id}/conference-center")
async def overview(event_id: str, db: AsyncSession = Depends(get_db), _=Depends(require_paid_event_member)):
    event = await event_or_404(event_id, db); profile = await profile_for(event_id, db)
    submissions = (await db.execute(select(ConferenceSubmission).where(ConferenceSubmission.event_id == event_id).order_by(ConferenceSubmission.created_at.desc()))).scalars().all()
    tracks = (await db.execute(select(ConferenceTrack).where(ConferenceTrack.event_id == event_id).order_by(ConferenceTrack.sort_order, ConferenceTrack.name))).scalars().all()
    operations = (await db.execute(select(ConferenceOperation).where(ConferenceOperation.event_id == event_id).order_by(ConferenceOperation.created_at.desc()))).scalars().all()
    templates = (await db.execute(select(OrganizationConferenceTemplate).where(OrganizationConferenceTemplate.organization_id == event.org_id).order_by(OrganizationConferenceTemplate.created_at.desc()))).scalars().all()
    return {"profile": profile_out(profile, event), "submissions": [row_out(x) for x in submissions],
        "tracks": [row_out(x) for x in tracks], "operations": [row_out(x) for x in operations],
        "templates": [row_out(x) for x in templates]}

@router.put("/{event_id}/conference-center/profile")
async def update_profile(event_id: str, data: ConferenceProfileUpdate, db: AsyncSession = Depends(get_db), _=Depends(require_paid_event_admin)):
    event = await event_or_404(event_id, db); p = await profile_for(event_id, db)
    for k, v in data.model_dump().items(): setattr(p, k, v)
    await db.commit(); await db.refresh(p)
    return profile_out(p, event)

@router.patch("/{event_id}/conference-center/submissions/{submission_id}")
async def review_submission(event_id: str, submission_id: str, data: ConferenceSubmissionReview, db: AsyncSession = Depends(get_db), _=Depends(require_paid_event_admin)):
    await event_or_404(event_id, db)
    item = await db.get(ConferenceSubmission, submission_id)
    if not item or item.event_id != event_id: raise HTTPException(404, "Submission not found")
    item.status, item.review_notes = data.status, data.review_notes
    if data.promote:
        if data.status != "accepted": raise HTTPException(400, "Only accepted submissions can be promoted")
        if item.promoted_record_id: raise HTTPException(409, "Submission is already connected to its canonical record")
        if item.kind in {"speaker", "abstract"}:
            record = GuestSpeaker(event_id=event_id, name=item.name, title=item.title or item.organization,
                bio=item.summary, social_links=[], is_active=True)
            item.promoted_record_type = "speaker"
        else:
            category_name = "Sponsors" if item.kind == "sponsor" else "Exhibitors"
            category = await db.scalar(select(PartnerCategory).where(PartnerCategory.event_id == event_id, PartnerCategory.name == category_name))
            if not category:
                category = PartnerCategory(event_id=event_id, name=category_name); db.add(category); await db.flush()
            record = Partner(event_id=event_id, category_id=category.id, name=item.organization or item.name,
                description=item.summary, website_url=item.website_url, is_active=True)
            item.promoted_record_type = "partner"
        db.add(record); await db.flush(); item.promoted_record_id = record.id
    await db.commit(); await db.refresh(item)
    return row_out(item)

@router.post("/{event_id}/conference-center/tracks", status_code=201)
async def create_track(event_id: str, data: ConferenceTrackIn, db: AsyncSession = Depends(get_db), _=Depends(require_paid_event_admin)):
    await event_or_404(event_id, db); row = ConferenceTrack(event_id=event_id, **data.model_dump()); db.add(row)
    await db.commit(); await db.refresh(row); return row_out(row)

@router.put("/{event_id}/conference-center/tracks/{row_id}")
async def update_track(event_id: str, row_id: str, data: ConferenceTrackIn, db: AsyncSession = Depends(get_db), _=Depends(require_paid_event_admin)):
    row = await db.get(ConferenceTrack, row_id)
    if not row or row.event_id != event_id: raise HTTPException(404, "Track not found")
    for k,v in data.model_dump().items(): setattr(row,k,v)
    await db.commit(); await db.refresh(row); return row_out(row)

@router.post("/{event_id}/conference-center/operations", status_code=201)
async def create_operation(event_id: str, data: ConferenceOperationIn, db: AsyncSession = Depends(get_db), _=Depends(require_paid_event_admin)):
    await event_or_404(event_id, db)
    row = ConferenceOperation(event_id=event_id, **data.model_dump()); db.add(row)
    await db.commit(); await db.refresh(row); return row_out(row)

@router.delete("/{event_id}/conference-center/operations/{row_id}", status_code=204)
async def delete_operation(event_id: str, row_id: str, db: AsyncSession = Depends(get_db), _=Depends(require_paid_event_admin)):
    row = await db.get(ConferenceOperation, row_id)
    if not row or row.event_id != event_id: raise HTTPException(404, "Operation not found")
    await db.delete(row); await db.commit()

@router.post("/{event_id}/conference-center/templates", status_code=201)
async def create_template(event_id: str, data: ConferenceTemplateIn, db: AsyncSession = Depends(get_db), _=Depends(require_paid_event_admin)):
    event = await event_or_404(event_id, db)
    row = OrganizationConferenceTemplate(organization_id=event.org_id, **data.model_dump()); db.add(row)
    await db.commit(); await db.refresh(row); return row_out(row)

@public_router.get("/{token}")
async def public_call(token: str, db: AsyncSession = Depends(get_db)):
    p = await db.scalar(select(ConferenceProfile).where(ConferenceProfile.public_token == token))
    if not p or not p.calls_open: raise HTTPException(404, "Call is not open")
    event = await event_or_404(p.event_id, db)
    tracks = (await db.execute(select(ConferenceTrack).where(ConferenceTrack.event_id == event.id, ConferenceTrack.is_active.is_(True)).order_by(ConferenceTrack.sort_order))).scalars().all()
    return {"event_name": event.name, "welcome_text": p.welcome_text, "deadline": p.deadline,
        "enabled_call_types": p.enabled_call_types or [], "tracks": [row_out(x) for x in tracks]}

@public_router.post("/{token}", status_code=201)
async def submit_application(token: str, data: ConferenceSubmissionCreate, db: AsyncSession = Depends(get_db)):
    p = await db.scalar(select(ConferenceProfile).where(ConferenceProfile.public_token == token))
    if not p or not p.calls_open: raise HTTPException(404, "Call is not open")
    if data.kind not in (p.enabled_call_types or []): raise HTTPException(400, "This application type is not open")
    if p.deadline and p.deadline < datetime.utcnow(): raise HTTPException(400, "The submission deadline has passed")
    row = ConferenceSubmission(event_id=p.event_id, **data.model_dump()); db.add(row)
    await db.commit(); await db.refresh(row)
    return {"id": row.id, "status": row.status, "message": "Submission received"}
