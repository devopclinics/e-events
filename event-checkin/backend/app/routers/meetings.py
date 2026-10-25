"""Organizer workspace API. All mutations lock the parent meeting first."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, case
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, field_validator
from typing import Literal
import jwt
import re
from services import messaging

from ..auth import get_current_user
from ..database import get_db
from ..config import settings
from ..models import Meeting, MeetingAttendee, MeetingDelivery, Membership, Organization, User, MeetingSuppression
from ..services.meeting_service import MeetingInput, invitation, utc_time, contact_key, targets, phone_message
from ..services.meeting_channels import approved_templates, preflight, cost
from types import SimpleNamespace
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
        "sending_enabled": settings.meetings_sending_enabled, "send_schedule": m.send_schedule,
        "attendees": [{"id": a.id, "name": a.name, "email": a.email, "phone": a.phone, "channels": a.channels, "active": a.active,
            "response": a.response, "response_sequence": a.response_sequence} for a in attendees],
        "deliveries": [{"id": d.id, "attendee_id": d.attendee_id, "sequence": d.sequence,
            "method": d.method, "channel": d.channel, "recipient": d.recipient, "credit_units": d.credit_units,
            "status": d.status, "delivery_status": d.delivery_status,
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


@router.get("/options")
async def options(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await org_for(user, db)
    return {"sending_enabled": settings.meetings_sending_enabled, "paid_sending_enabled": settings.meetings_paid_sending_enabled,
        "whatsapp_templates": [{"id": r.id, "name": r.name, "body": r.body} for r in await approved_templates(db, org.id)]}


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
    updated = data.model_dump(mode="json", exclude={"revision"})
    if updated == m.draft:
        return await output(m, db)
    m.draft = updated
    m.revision += 1
    clear_schedule(m, "cancelled", "Meeting details changed. Preview and schedule the updated invitation.")
    await db.commit()
    return await output(m, db)


async def plan(m, db, cancel=False):
    current = [] if cancel else targets(m.draft)
    current_ids = {(ch, recipient) for a, ch, recipient in current}
    result = [(a, ch, recipient, "REQUEST", m.draft) for a, ch, recipient in current]
    for a, ch, recipient in targets(m.published or {}):
        if (ch, recipient) not in current_ids:
            result.append((a, ch, recipient, "CANCEL", m.published))
    unfinished = (await db.scalars(select(MeetingDelivery).where(MeetingDelivery.meeting_id == m.id,
        MeetingDelivery.method == "CANCEL", MeetingDelivery.status.in_(["queued", "sending", "failed", "uncertain", "setup_required"])))).all()
    for d in unfinished:
        a = await db.get(MeetingAttendee, d.attendee_id)
        item = {"name": a.name, "email": a.email, "phone": a.phone,
                "sms_consent": a.sms_consent, "whatsapp_consent": a.whatsapp_consent}
        if (d.channel, d.recipient) not in current_ids:
            result.append((item, d.channel, d.recipient, "CANCEL", d.payload))
    unique = {}
    for a, ch, recipient, method, snapshot in result:
        unique[(ch, recipient, method)] = (a, ch, recipient, method, snapshot)
    return list(unique.values())


@router.get("/{mid}/preview")
async def preview(mid: str, cancel: bool = False, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    subject, body = invitation(m.draft)
    rows = await plan(m, db, cancel)
    org = await db.get(Organization, m.org_id)
    channel_recipients = []
    for a, channel, recipient, method, snapshot in rows:
        readiness = "ready"
        template = None
        try:
            template = await preflight(db, m, SimpleNamespace(sms_consent=a.get("sms_consent", False),
                whatsapp_consent=a.get("whatsapp_consent", False)), channel, recipient, snapshot, org)
        except ValueError as exc:
            readiness = str(exc)
        message = phone_message(snapshot, method=method)
        if channel == "sms":
            message = messaging._brand_sms(message + ". Details / notification preferences: [personal Festio link]")
        elif channel == "whatsapp" and template:
            values = {"firstName": a["name"], "eventName": snapshot["title"], "message": message, "ticketLink": "[personal Festio link]"}
            message = re.sub(r"\{\{\s*(\w+)\s*\}\}", lambda match: values.get(match[1], match[0]), template.body)
        channel_recipients.append({"name": a["name"], "channel": channel, "recipient": recipient,
            "method": method, "credit_units": cost(channel, m.org_id), "readiness": readiness,
            "message": message if channel != "email" else invitation(snapshot, method=method)[0]})
    return {"revision": m.revision, "subject": subject, "html": body, "recipients": m.draft["attendees"],
        "channel_recipients": channel_recipients, "credit_units": sum(r["credit_units"] for r in channel_recipients),
        "calendar_mode": settings.meetings_email_transport,
        "cancellations": sorted({recipient for a, ch, recipient, method, snapshot in rows if method == "CANCEL"}),
        "attachment": "meeting.ics", "sending_enabled": settings.meetings_sending_enabled}


class Version(BaseModel):
    revision: int
    confirm_paid_channels: bool = False
    quoted_credit_units: int | None = None
    send_at: str | None = None
    send_fold: Literal[0, 1] | None = None

    @field_validator("send_at")
    @classmethod
    def nonempty_send_time(cls, value):
        if value is not None and not value.strip():
            raise ValueError("Choose an invitation send time")
        return value



async def enqueue(m, db, cancel=False):
    rows = await plan(m, db, cancel)
    # Supersede pending and failed work while holding the same lock used by worker.
    old = (await db.scalars(select(MeetingDelivery).where(MeetingDelivery.meeting_id == m.id,
        MeetingDelivery.status.in_(["queued", "sending", "failed", "uncertain", "setup_required", "blocked"])))).all()
    for row in old:
        row.status = "superseded"
    m.sequence += 1
    existing = {(a.email or a.phone): a for a in (await db.scalars(select(MeetingAttendee)
        .where(MeetingAttendee.meeting_id == m.id))).all()}
    current = {} if cancel else {contact_key(a): a for a in m.draft["attendees"]}
    for key, item in current.items():
        if key not in existing:
            a = MeetingAttendee(meeting_id=m.id, email=item.get("email"), phone=item.get("phone"), name=item["name"])
            db.add(a)
            await db.flush()
            existing[key] = a
        a = existing[key]
        for field in ("name", "phone", "sms_consent", "whatsapp_consent"):
            setattr(a, field, item.get(field, False if field.endswith("consent") else None))
        a.channels = item.get("channels", ["email"])
    for key, a in existing.items():
        active = key in current
        a.active = active
        a.response = "pending" if active else "cancelled"
        a.response_sequence = m.sequence
    for item, channel, recipient, method, snapshot in rows:
        a = existing[contact_key(item)]
        db.add(MeetingDelivery(meeting_id=m.id, attendee_id=a.id, sequence=m.sequence, method=method,
            channel=channel, recipient=recipient, credit_units=cost(channel, m.org_id), payload=snapshot))
    m.published = m.draft if not cancel else m.published
    m.published_revision = m.revision
    m.status = "cancelled" if cancel else "scheduled"


def clear_schedule(m, status, message=None):
    m.send_at = None
    if m.send_schedule and (m.send_schedule.get("status") in {"pending", "blocked"} or status == "queued"):
        m.send_schedule = {**m.send_schedule, "status": status, "error": message}


async def validate_publish(m, data, db):
    check_revision(m, data.revision)
    if m.status == "cancelled":
        raise HTTPException(409, "Meeting is cancelled")
    if not settings.meetings_sending_enabled or len(settings.meetings_signing_key) < 32:
        raise HTTPException(503, "Invitation sending is disabled until Meetings is configured")
    if utc_time(m.draft["end"], m.draft["timezone"], m.draft.get("end_fold")) <= datetime.now(timezone.utc):
        raise HTTPException(422, "Choose a future meeting time before sending invitations")
    rows = await plan(m, db)
    if any(ch != "email" for a, ch, recipient, method, snapshot in rows) and not data.confirm_paid_channels:
        raise HTTPException(422, "Review paid channel recipients and explicitly confirm messaging charges")
    quote = sum(cost(ch, m.org_id) for a, ch, recipient, method, snapshot in rows)
    if quote and data.quoted_credit_units != quote:
        raise HTTPException(409, "Messaging price changed or was not reviewed. Preview again before sending.")


@router.post("/{mid}/send")
async def send(mid: str, data: Version, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    check_revision(m, data.revision)
    if m.status == "cancelled":
        raise HTTPException(409, "Meeting is cancelled")
    if m.published_revision == m.revision:
        if data.send_at:
            raise HTTPException(409, "This version was already sent. Edit and preview a new version before scheduling.")
        return await output(m, db)
    await validate_publish(m, data, db)
    if data.send_at:
        try:
            when = utc_time(data.send_at, m.draft["timezone"], data.send_fold)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        if when <= datetime.now(timezone.utc):
            raise HTTPException(422, "Choose a future invitation send time")
        if when >= utc_time(m.draft["start"], m.draft["timezone"], m.draft.get("start_fold")):
            raise HTTPException(422, "Schedule invitations before the meeting starts")
        # Store only the explicit, reviewed send instruction. Attendees, live
        # response links, calendar sequence and wallet stay unchanged until due.
        m.send_at = when.replace(tzinfo=None)
        m.send_schedule = {"status": "pending", "send_at": when.isoformat(), "timezone": m.draft["timezone"],
            "local_time": data.send_at, "revision": m.revision, "send_fold": data.send_fold,
            "confirm_paid_channels": data.confirm_paid_channels, "quoted_credit_units": data.quoted_credit_units, "error": None}
    else:
        await enqueue(m, db)
        clear_schedule(m, "queued")
    await db.commit()
    return await output(m, db)


@router.delete("/{mid}/schedule")
async def unschedule(mid: str, data: Version, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    check_revision(m, data.revision)
    if not m.send_at:
        raise HTTPException(409, "There is no pending invitation send to cancel")
    clear_schedule(m, "cancelled")
    await db.commit()
    return await output(m, db)


@router.post("/{mid}/cancel")
async def cancel(mid: str, data: Version, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    if m.status == "cancelled":
        return await output(m, db)
    check_revision(m, data.revision)
    if any(ch != "email" for a, ch, recipient, method, snapshot in await plan(m, db, cancel=True)) and not data.confirm_paid_channels:
        raise HTTPException(422, "Confirm paid-channel cancellation notifications and charges")
    quote = sum(cost(ch, m.org_id) for a, ch, recipient, method, snapshot in await plan(m, db, cancel=True))
    if quote and data.quoted_credit_units != quote:
        raise HTTPException(409, "Review cancellation notification charges before confirming")
    if m.status != "cancelled":
        clear_schedule(m, "cancelled")
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
    if row.status in {"failed", "setup_required"}:
        row.status = "queued"
        row.error = None
        await db.commit()
    return await output(m, db)


async def resolve(token, db, *, preferences=False):
    try:
        if len(settings.meetings_signing_key) < 32:
            raise ValueError()
        p = jwt.decode(token, settings.meetings_signing_key, algorithms=["HS256"],
                       options={"require": ["exp", "scope", "mid", "aid", "seq"]})
        if p["scope"] not in ({"meeting-response", "meeting-preferences"} if preferences else {"meeting-response"}):
            raise ValueError()
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(410, "This invitation link is invalid or expired")
    m = await db.scalar(select(Meeting).where(Meeting.id == p["mid"]).with_for_update())
    a = await db.get(MeetingAttendee, p["aid"])
    org = await db.get(Organization, m.org_id) if m else None
    if not m or not a or a.meeting_id != m.id or not org or not org.is_active or (
            not preferences and (not a.active or m.status != "scheduled" or m.sequence != p["seq"])):
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


@public_router.get("/preferences/{token}")
async def preference_preview(token: str, response: Response, db: AsyncSession = Depends(get_db)):
    private_headers(response)
    m, a = await resolve(token, db, preferences=True)
    claims = jwt.decode(token, settings.meetings_signing_key, algorithms=["HS256"])
    phone = claims.get("phone") or a.phone
    stopped = (await db.scalars(select(MeetingSuppression.channel).where(MeetingSuppression.org_id == m.org_id,
        MeetingSuppression.phone == phone))).all() if phone else []
    return {"name": a.name, "phone": phone, "stopped": list(stopped)}


class StopNotifications(BaseModel):
    channel: Literal["sms", "whatsapp"]


@public_router.post("/preferences/{token}")
async def stop_notifications(token: str, data: StopNotifications, response: Response, db: AsyncSession = Depends(get_db)):
    private_headers(response)
    m, a = await resolve(token, db, preferences=True)
    claims = jwt.decode(token, settings.meetings_signing_key, algorithms=["HS256"])
    phone = claims.get("phone") or a.phone
    if not phone:
        raise HTTPException(422, "This invitation has no phone notification address")
    await db.scalar(select(Organization).where(Organization.id == m.org_id).with_for_update())
    exists = await db.scalar(select(MeetingSuppression.id).where(MeetingSuppression.org_id == m.org_id,
        MeetingSuppression.phone == phone, MeetingSuppression.channel == data.channel))
    if not exists:
        db.add(MeetingSuppression(org_id=m.org_id, phone=phone, channel=data.channel))
    if a.phone == phone:
        setattr(a, data.channel + "_consent", False)
    await db.commit()
    return {"stopped": data.channel}


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
