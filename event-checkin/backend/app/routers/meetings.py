"""Organizer workspace API. All mutations lock the parent meeting first."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, case
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Literal
import jwt

from ..auth import get_current_user
from ..database import get_db
from ..config import settings
from ..models import Meeting, MeetingAttendee, MeetingDelivery, Membership, Organization, User
from ..services.meeting_service import MeetingInput, invitation, utc_time
from ..ratelimit import rate_limit
from datetime import datetime, timezone
from .admin import DEFAULT_ORG_ID

router = APIRouter()
public_router = APIRouter(dependencies=[Depends(rate_limit(limit=60, window=60, scope="meeting-responses"))])


async def org_for(user, db):
    if not user:
        raise HTTPException(401, "Sign in to manage meetings")
    org = await db.scalar(select(Organization).join(Membership, Membership.org_id == Organization.id)
        .where(Membership.user_id == user.id, Membership.role.in_(["owner", "admin"]), Organization.is_active.is_(True))
        .order_by(case((Organization.id == DEFAULT_ORG_ID, 1), else_=0), Organization.created_at).limit(1))
    if not org:
        raise HTTPException(403, "An active organizer membership is required")
    return org


async def owned(mid, user, db):
    org = await org_for(user, db)
    meeting = await db.scalar(select(Meeting).where(Meeting.id == mid, Meeting.org_id == org.id,
        Meeting.organizer_id == user.id).with_for_update())
    if not meeting:
        raise HTTPException(404, "Meeting not found")
    return meeting


async def output(m, db):
    attendees = (await db.scalars(select(MeetingAttendee).where(MeetingAttendee.meeting_id == m.id))).all()
    deliveries = (await db.scalars(select(MeetingDelivery).where(MeetingDelivery.meeting_id == m.id)
        .order_by(MeetingDelivery.sequence, MeetingDelivery.created_at))).all()
    return {"id": m.id, "draft": m.draft, "status": m.status, "revision": m.revision,
        "published_revision": m.published_revision, "sequence": m.sequence,
        "sending_enabled": settings.meetings_sending_enabled,
        "attendees": [{"id": a.id, "name": a.name, "email": a.email, "active": a.active,
            "response": a.response, "response_sequence": a.response_sequence} for a in attendees],
        "deliveries": [{"id": d.id, "attendee_id": d.attendee_id, "sequence": d.sequence,
            "method": d.method, "status": d.status, "delivery_status": d.delivery_status,
            "attempts": d.attempts, "error": d.error} for d in deliveries]}


@router.get("")
async def listing(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await org_for(user, db)
    rows = (await db.scalars(select(Meeting).where(Meeting.org_id == org.id, Meeting.organizer_id == user.id)
        .order_by(Meeting.created_at.desc()))).all()
    return [await output(m, db) for m in rows]


@router.post("", status_code=201)
async def create(data: MeetingInput, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await org_for(user, db)
    m = Meeting(org_id=org.id, organizer_id=user.id, organizer_email=user.email, draft=data.model_dump(mode="json"))
    db.add(m)
    await db.commit()
    return await output(m, db)


@router.get("/{mid}")
async def detail(mid: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await output(await owned(mid, user, db), db)


class Edit(MeetingInput):
    revision: int


def check_revision(m, revision):
    if m.revision != revision:
        raise HTTPException(409, "Meeting changed. Reload and review the current version.")


@router.put("/{mid}")
async def edit(mid: str, data: Edit, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    check_revision(m, data.revision)
    if m.status == "cancelled":
        raise HTTPException(409, "Cancelled meetings cannot be edited")
    m.draft = data.model_dump(mode="json", exclude={"revision"})
    m.revision += 1
    await db.commit()
    return await output(m, db)


@router.get("/{mid}/preview")
async def preview(mid: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    subject, body = invitation(m.draft)
    previous = {a["email"] for a in (m.published or {}).get("attendees", [])}
    current = {a["email"] for a in m.draft["attendees"]}
    unfinished = (await db.scalars(select(MeetingAttendee.email).join(MeetingDelivery,
        MeetingDelivery.attendee_id == MeetingAttendee.id).where(MeetingDelivery.meeting_id == m.id,
        MeetingDelivery.method == "CANCEL", MeetingDelivery.status.in_(["queued", "sending", "failed", "uncertain"])))).all()
    return {"revision": m.revision, "subject": subject, "html": body, "recipients": m.draft["attendees"],
        "cancellations": sorted((previous | set(unfinished)) - current), "attachment": "meeting.ics", "sending_enabled": settings.meetings_sending_enabled}


class Version(BaseModel):
    revision: int


async def enqueue(m, db, cancel=False):
    # Supersede pending and failed work while holding the same lock used by worker.
    old = (await db.scalars(select(MeetingDelivery).where(MeetingDelivery.meeting_id == m.id,
        MeetingDelivery.status.in_(["queued", "sending", "failed", "uncertain"])))).all()
    for row in old:
        row.status = "superseded"
    m.sequence += 1
    existing = {a.email: a for a in (await db.scalars(select(MeetingAttendee)
        .where(MeetingAttendee.meeting_id == m.id))).all()}
    current = {} if cancel else {a["email"]: a for a in m.draft["attendees"]}
    previous = {a["email"] for a in (m.published or {}).get("attendees", [])}
    unfinished_cancellations = {row.attendee_id: row.payload for row in old if row.method == "CANCEL"}
    for email, item in current.items():
        if email not in existing:
            a = MeetingAttendee(meeting_id=m.id, email=email, name=item["name"])
            db.add(a)
            await db.flush()
            existing[email] = a
        existing[email].name = item["name"]
    for email, a in existing.items():
        active = email in current
        method = "REQUEST" if active else "CANCEL"
        a.active = active
        if not active and email not in previous and a.id not in unfinished_cancellations:
            continue  # An already delivered removal must not send another unpreviewed cancellation.
        a.response = "pending" if active else "cancelled"
        a.response_sequence = m.sequence
        snapshot = m.draft if active else unfinished_cancellations.get(a.id, m.published or m.draft)
        db.add(MeetingDelivery(meeting_id=m.id, attendee_id=a.id, sequence=m.sequence, method=method,
            payload=snapshot))
    m.published = m.draft if not cancel else m.published
    m.published_revision = m.revision
    m.status = "cancelled" if cancel else "scheduled"


@router.post("/{mid}/send")
async def send(mid: str, data: Version, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    check_revision(m, data.revision)
    if m.status == "cancelled":
        raise HTTPException(409, "Meeting is cancelled")
    if m.published_revision == m.revision:
        return await output(m, db)  # duplicate explicit click: no new version/deliveries
    if not settings.meetings_sending_enabled or len(settings.meetings_signing_key) < 32:
        raise HTTPException(503, "Invitation sending is disabled until Meetings is configured")
    if utc_time(m.draft["end"], m.draft["timezone"], m.draft.get("end_fold")) <= datetime.now(timezone.utc):
        raise HTTPException(422, "Choose a future meeting time before sending invitations")
    await enqueue(m, db)
    await db.commit()
    return await output(m, db)


@router.post("/{mid}/cancel")
async def cancel(mid: str, data: Version, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    if m.status == "cancelled":
        return await output(m, db)
    check_revision(m, data.revision)
    if m.status != "cancelled":
        m.revision += 1
        await enqueue(m, db, cancel=True)
        await db.commit()
    return await output(m, db)


@router.post("/{mid}/deliveries/{delivery_id}/retry")
async def retry(mid: str, delivery_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    row = await db.get(MeetingDelivery, delivery_id)
    if not row or row.meeting_id != m.id:
        raise HTTPException(404, "Delivery not found")
    if row.sequence != m.sequence or (m.status == "cancelled" and row.method != "CANCEL"):
        raise HTTPException(409, "This delivery was superseded")
    if row.status == "uncertain":
        raise HTTPException(409, "Provider outcome unknown. Reconcile before retrying to avoid duplicate mail.")
    if row.status == "failed":
        row.status = "queued"
        row.error = None
        await db.commit()
    return await output(m, db)


async def resolve(token, db):
    try:
        if len(settings.meetings_signing_key) < 32:
            raise ValueError()
        p = jwt.decode(token, settings.meetings_signing_key, algorithms=["HS256"],
                       options={"require": ["exp", "scope", "mid", "aid", "seq"]})
        if p["scope"] != "meeting-response":
            raise ValueError()
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(410, "This invitation link is invalid or expired")
    m = await db.scalar(select(Meeting).where(Meeting.id == p["mid"]).with_for_update())
    a = await db.get(MeetingAttendee, p["aid"])
    org = await db.get(Organization, m.org_id) if m else None
    if not m or not a or a.meeting_id != m.id or not a.active or m.status != "scheduled" or m.sequence != p["seq"] or not org or not org.is_active:
        raise HTTPException(410, "This invitation has changed or was cancelled. Use the latest invitation.")
    return m, a


def private_headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"


@public_router.get("/{token}")
async def response_preview(token: str, response: Response, db: AsyncSession = Depends(get_db)):
    private_headers(response)
    m, a = await resolve(token, db)
    # Only the intended recipient, never other attendees or their response links.
    return {"meeting": {k: v for k, v in m.published.items() if k != "attendees"},
        "name": a.name, "response": a.response, "sequence": m.sequence}


class Reply(BaseModel):
    response: Literal["accepted", "maybe", "declined"]


@public_router.post("/{token}")
async def respond(token: str, data: Reply, response: Response, db: AsyncSession = Depends(get_db)):
    private_headers(response)
    m, a = await resolve(token, db)
    a.response = data.response
    a.response_sequence = m.sequence
    await db.commit()
    return {"response": a.response}
