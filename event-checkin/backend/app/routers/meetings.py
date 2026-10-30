"""Organizer workspace API. All mutations lock the parent meeting first."""
from fastapi import APIRouter, Depends, HTTPException, Response, Query
from sqlalchemy import select, case, func, or_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only
from pydantic import BaseModel, Field, field_validator
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
from datetime import datetime, timezone, timedelta
from .admin import DEFAULT_ORG_ID

router = APIRouter()
public_router = APIRouter(dependencies=[Depends(rate_limit(limit=60, window=60, scope="meeting-responses"))])


async def org_for(user, db, org_id=None):
    if not user:
        raise HTTPException(401, "Sign in to manage meetings")
    org = await db.scalar(select(Organization).join(Membership, Membership.org_id == Organization.id)
        .where(Membership.user_id == user.id, Membership.role.in_(["owner", "admin"]), Organization.is_active.is_(True), *([Organization.id == org_id] if org_id else []))
        .order_by(case((Organization.id == DEFAULT_ORG_ID, 1), else_=0), Organization.created_at).limit(1))
    if not org:
        raise HTTPException(403, "An active organizer membership is required")
    return org


async def owned(mid, user, db):
    meeting = await db.scalar(select(Meeting).where(Meeting.id == mid).with_for_update())
    if not meeting:
        raise HTTPException(404, "Meeting not found")
    member = await db.scalar(select(Membership.id).join(Organization, Organization.id == Membership.org_id).where(
        Membership.org_id == meeting.org_id, Membership.user_id == user.id,
        Membership.role.in_(["owner", "admin"]), Organization.is_active.is_(True)))
    if not member or (meeting.organizer_id != user.id and not meeting.shared_with_org_admins):
        raise HTTPException(404, "Meeting not found")
    return meeting


def delivery_view():
    # Status polling must not read frozen MIME, provider JSON or message bodies.
    return select(MeetingDelivery).options(load_only(MeetingDelivery.id, MeetingDelivery.meeting_id,
        MeetingDelivery.attendee_id, MeetingDelivery.sequence, MeetingDelivery.method, MeetingDelivery.channel,
        MeetingDelivery.recipient, MeetingDelivery.credit_units, MeetingDelivery.status, MeetingDelivery.delivery_status,
        MeetingDelivery.attempts, MeetingDelivery.error, MeetingDelivery.purpose, MeetingDelivery.provider_id))


async def output(m, db, *, attendees=None, deliveries=None):
    if attendees is None:
        attendees = (await db.scalars(select(MeetingAttendee).where(MeetingAttendee.meeting_id == m.id))).all()
    if deliveries is None:
        deliveries = (await db.scalars(delivery_view().where(MeetingDelivery.meeting_id == m.id)
            .order_by(MeetingDelivery.sequence, MeetingDelivery.created_at))).all()
    return {"id": m.id, "draft": m.draft, "status": m.status, "revision": m.revision,
        "published_revision": m.published_revision, "sequence": m.sequence if m.published else None,
        "sending_enabled": settings.meetings_sending_enabled, "send_schedule": m.send_schedule,
        "org_id": m.org_id, "organizer_id": m.organizer_id, "archived": m.archived, "has_published_invitation": bool(m.published),
        "followup_schedule": m.followup_schedule or [],
        "attendees": [{"id": a.id, "name": a.name, "email": a.email, "phone": a.phone, "channels": a.channels, "active": a.active,
            "response": a.response, "response_sequence": a.response_sequence, "reminders_stopped": a.reminders_stopped} for a in attendees],
        "deliveries": [{"id": d.id, "attendee_id": d.attendee_id, "sequence": d.sequence,
            "method": d.method, "channel": d.channel, "recipient": d.recipient, "credit_units": d.credit_units,
            "status": d.status, "delivery_status": d.delivery_status, "receipt_tracking": "unavailable" if d.channel != "email" or (d.provider_id or "").startswith("smtp:") else "tracked" if d.provider_id else "pending",
            "attempts": d.attempts, "error": d.error, "purpose": d.purpose} for d in deliveries]}


@router.get("")
async def listing(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
                  org_id: str | None = None, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
    org = await org_for(user, db, org_id)
    rows = (await db.scalars(select(Meeting).where(Meeting.org_id == org.id,
        or_(Meeting.organizer_id == user.id, Meeting.shared_with_org_admins.is_(True)))
        .order_by(Meeting.created_at.desc(), Meeting.id).limit(limit).offset(offset))).all()
    ids = [m.id for m in rows]
    attendees = (await db.scalars(select(MeetingAttendee).where(MeetingAttendee.meeting_id.in_(ids)))).all() if ids else []
    deliveries = (await db.scalars(delivery_view().where(MeetingDelivery.meeting_id.in_(ids))
        .order_by(MeetingDelivery.sequence, MeetingDelivery.created_at))).all() if ids else []
    people, messages = {}, {}
    for row in attendees:
        people.setdefault(row.meeting_id, []).append(row)
    for row in deliveries:
        messages.setdefault(row.meeting_id, []).append(row)
    return [await output(m, db, attendees=people.get(m.id, []), deliveries=messages.get(m.id, [])) for m in rows]


@router.post("", status_code=201)
async def create(data: MeetingInput, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), org_id: str | None = None):
    org = await org_for(user, db, org_id)
    if utc_time(data.start, data.timezone, data.start_fold) <= datetime.now(timezone.utc):
        raise HTTPException(422, "Choose a future meeting start before saving")
    m = Meeting(org_id=org.id, organizer_id=user.id, organizer_email=user.email, draft=data.model_dump(mode="json"),
        shared_with_org_admins=data.shared_with_org_admins,
        start_utc=utc_time(data.start, data.timezone, data.start_fold).replace(tzinfo=None),
        end_utc=utc_time(data.end, data.timezone, data.end_fold).replace(tzinfo=None))
    db.add(m)
    await db.commit()
    return await output(m, db)


@router.get("/options")
async def options(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await org_for(user, db)
    organizations = (await db.scalars(select(Organization).join(Membership, Membership.org_id == Organization.id).where(
        Membership.user_id == user.id, Membership.role.in_(["owner", "admin"]), Organization.is_active.is_(True)).order_by(Organization.name))).all()
    return {"sending_enabled": settings.meetings_sending_enabled, "paid_sending_enabled": settings.meetings_paid_sending_enabled,
        "user_id": user.id, "organizations": [{"id": item.id, "name": item.name} for item in organizations], "default_org_id": org.id,
        "email_transport": settings.meetings_email_transport,
        "whatsapp_templates": [{"id": r.id, "name": r.name, "body": r.body} for r in await approved_templates(db, org.id)]}


@router.get("/directory")
async def attendee_directory(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
                            org_id: str | None = None, q: str = Query("", max_length=100), source: Literal["contacts", "guests"] = "contacts"):
    from ..models import Contact, Guest, Event
    org = await org_for(user, db, org_id)
    if len(q.strip()) < 2:
        return []
    model = Contact if source == "contacts" else Guest
    stmt = select(model)
    if source == "contacts":
        stmt = stmt.where(Contact.org_id == org.id)
    else:
        stmt = stmt.join(Event, Event.id == Guest.event_id).where(Event.org_id == org.id)
    needle = q.strip().lower()
    stmt = stmt.where(model.email.is_not(None), or_(func.lower(model.email).contains(needle, autoescape=True),
        func.lower(model.first_name).contains(needle, autoescape=True), func.lower(model.last_name).contains(needle, autoescape=True)))
    rows = (await db.scalars(stmt.order_by(model.first_name, model.id).limit(25))).all()
    people = {}
    for row in rows:
        people.setdefault(row.email.lower(), {"name": " ".join(filter(None, [row.first_name, row.last_name])), "email": row.email})
    return list(people.values())


@router.get("/overview")
async def overview(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
                   org_id: str | None = None, q: str = Query("", max_length=200),
                   view: Literal["all", "upcoming", "past", "draft", "cancelled", "archived"] = "all",
                   offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50)):
    org = await org_for(user, db, org_id)
    scope = [Meeting.org_id == org.id, or_(Meeting.organizer_id == user.id, Meeting.shared_with_org_admins.is_(True))]
    active = [*scope, Meeting.archived.is_(False)]
    total = await db.scalar(select(func.count()).select_from(Meeting).where(*active))
    scheduled = await db.scalar(select(func.count()).select_from(Meeting).where(*active, Meeting.send_at.is_not(None)))
    counts = (await db.execute(select(MeetingAttendee.response, func.count()).join(Meeting, Meeting.id == MeetingAttendee.meeting_id)
        .where(*active, MeetingAttendee.active.is_(True)).group_by(MeetingAttendee.response))).all()
    filters = [*scope, Meeting.archived.is_(view == "archived")]
    if q.strip():
        filters.append(func.lower(Meeting.draft["title"].as_string()).contains(q.strip().lower(), autoescape=True))
    if view == "upcoming":
        filters += [Meeting.end_utc > datetime.utcnow(), Meeting.status != "cancelled"]
    elif view == "past":
        filters.append(Meeting.end_utc <= datetime.utcnow())
    elif view in {"draft", "cancelled"}:
        filters.append(Meeting.status == view)
    matching = await db.scalar(select(func.count()).select_from(Meeting).where(*filters))
    rows = (await db.scalars(select(Meeting).where(*filters).order_by(Meeting.created_at.desc(), Meeting.id)
        .limit(limit).offset(offset))).all()
    ids = [m.id for m in rows]
    reply_counts = {}
    if ids:
        for mid, response, count in (await db.execute(select(MeetingAttendee.meeting_id, MeetingAttendee.response, func.count())
            .where(MeetingAttendee.meeting_id.in_(ids), MeetingAttendee.active.is_(True))
            .group_by(MeetingAttendee.meeting_id, MeetingAttendee.response))).all():
            reply_counts.setdefault(mid, {})[response] = count
    delivery_counts = {}
    delivery_state = case((MeetingDelivery.delivery_status.in_(["bounced", "complained", "failed", "suppressed"]), MeetingDelivery.delivery_status), else_=MeetingDelivery.status)
    if ids:
        for mid, status, count in (await db.execute(select(MeetingDelivery.meeting_id, delivery_state, func.count())
            .join(Meeting, Meeting.id == MeetingDelivery.meeting_id).where(MeetingDelivery.meeting_id.in_(ids),
                MeetingDelivery.sequence == Meeting.sequence, MeetingDelivery.purpose == "invitation", MeetingDelivery.method == "REQUEST")
            .group_by(MeetingDelivery.meeting_id, delivery_state))).all():
            delivery_counts.setdefault(mid, {})[status] = count
    items = [{"id": m.id, "org_id": m.org_id, "draft": {k: m.draft.get(k) for k in ("title", "start", "end", "timezone")},
        "status": m.status, "revision": m.revision, "published_revision": m.published_revision, "sequence": m.sequence if m.published else None,
        "send_schedule": m.send_schedule, "archived": m.archived, "response_counts": reply_counts.get(m.id, {}),
        "attendee_count": len(m.draft.get("attendees", [])), "delivery_counts": delivery_counts.get(m.id, {})} for m in rows]
    return {"items": items, "total": matching, "offset": offset, "limit": limit, "org_id": org.id,
        "totals": {"meetings": total, "pending_sends": scheduled, "accepted": dict(counts).get("accepted", 0)}}


class ArchiveRequest(BaseModel):
    revision: int
    archived: bool


@router.post("/{mid}/archive")
async def archive(mid: str, data: ArchiveRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    check_revision(m, data.revision)
    if m.send_at and data.archived:
        raise HTTPException(409, "Cancel the pending invitation send before archiving")
    was_archived = m.archived
    m.archived = data.archived
    if data.archived or was_archived:
        m.followup_schedule = [{**item, **({"status": "stopped", "reason": "Meeting archived"} if item.get("status") == "pending" else {})}
            for item in m.followup_schedule or []]
        m.next_followup_at = None
        followups = (await db.scalars(select(MeetingDelivery).where(MeetingDelivery.meeting_id == m.id,
            MeetingDelivery.purpose != "invitation", MeetingDelivery.status == "queued"))).all()
        for delivery in followups:
            delivery.status, delivery.error = "blocked", "Meeting archived; automatic follow-ups stopped"
    await db.commit()
    return await output(m, db)


@router.delete("/{mid}")
async def delete_draft(mid: str, revision: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    check_revision(m, revision)
    history = await db.scalar(select(MeetingDelivery.id).where(MeetingDelivery.meeting_id == m.id).limit(1))
    if m.published or m.send_at or history:
        raise HTTPException(409, "Archive published meetings; cancel a pending send before deleting a draft")
    await db.delete(m)
    await db.commit()
    return {"deleted": True}


@router.get("/{mid}/calendar")
async def organizer_calendar(mid: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from ..services.meeting_service import calendar_bytes
    m = await owned(mid, user, db)
    if m.status == "cancelled":
        raise HTTPException(409, "Meeting is cancelled")
    data = m.published or m.draft
    content = calendar_bytes(m, data, SimpleNamespace(name=user.name or "Organizer", email=user.email), "REQUEST", max(0, m.sequence))
    return {"filename": "meeting.ics", "content": content.decode("utf-8")}


@router.get("/{mid}/responses.csv")
async def export_responses(mid: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    import csv
    import io
    m = await owned(mid, user, db)
    rows = (await db.scalars(select(MeetingAttendee).where(MeetingAttendee.meeting_id == m.id, MeetingAttendee.active.is_(True)))).all()
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["Name", "Email", "Phone", "Response"])
    def safe(value):
        value = str(value or "")
        return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value
    for a in rows:
        writer.writerow([safe(a.name), safe(a.email), safe(a.phone), a.response])
    return {"filename": "meeting-responses.csv", "content": stream.getvalue()}


@router.get("/{mid}/attendees/{aid}/link")
async def attendee_link(mid: str, aid: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from ..services.meeting_service import response_token
    m = await owned(mid, user, db)
    a = await db.get(MeetingAttendee, aid)
    if not a or a.meeting_id != m.id or not a.active or m.status != "scheduled":
        raise HTTPException(404, "Active invitation not found")
    if utc_time(m.published["end"], m.published["timezone"], m.published.get("end_fold")) + timedelta(days=1) < datetime.now(timezone.utc):
        raise HTTPException(410, "Responses closed 24 hours after this meeting ended")
    return {"url": settings.frontend_url.rstrip("/") + "/meeting-response/" + response_token(m, a)}


@router.post("/{mid}/share-link")
async def share_invitation(mid: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await owned(mid, user, db)
    if m.status == "cancelled":
        raise HTTPException(410, "This meeting was cancelled")
    if len(settings.meetings_signing_key) < 32:
        raise HTTPException(503, "Invitation sharing is not configured")
    end = utc_time(m.draft["end"], m.draft["timezone"], m.draft.get("end_fold")) + timedelta(days=1)
    if end < datetime.now(timezone.utc):
        raise HTTPException(410, "This meeting invitation has expired")
    token = jwt.encode({"scope": "meeting-shared-invitation", "mid": m.id, "revision": m.revision, "exp": end}, settings.meetings_signing_key, algorithm="HS256")
    return {"url": settings.frontend_url.rstrip("/") + "/meeting-invitation/" + token}


class FollowupRequest(BaseModel):
    revision: int
    key: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


@router.post("/{mid}/attendees/{aid}/resend")
async def resend_attendee(mid: str, aid: str, data: FollowupRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from ..services.meeting_followups import manual_followup
    m = await owned(mid, user, db)
    await manual_followup(m, db, data.revision, data.key, aid=aid, authorized_by=user.id)
    await db.commit()
    return await output(m, db)


@router.post("/{mid}/nudge")
async def nudge_pending(mid: str, data: FollowupRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from ..services.meeting_followups import manual_followup
    m = await owned(mid, user, db)
    count = await manual_followup(m, db, data.revision, data.key, authorized_by=user.id)
    await db.commit()
    return {"queued": count}


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
    if m.archived:
        raise HTTPException(409, "Restore this meeting before editing")
    if utc_time(data.start, data.timezone, data.start_fold) <= datetime.now(timezone.utc):
        raise HTTPException(422, "Choose a future meeting start before saving")
    if m.organizer_id != user.id and data.shared_with_org_admins != m.shared_with_org_admins:
        raise HTTPException(403, "Only the organizer can change sharing")
    updated = data.model_dump(mode="json", exclude={"revision"})
    if updated == m.draft:
        return await output(m, db)
    m.draft = updated
    m.shared_with_org_admins = data.shared_with_org_admins
    m.start_utc = utc_time(data.start, data.timezone, data.start_fold).replace(tzinfo=None)
    m.end_utc = utc_time(data.end, data.timezone, data.end_fold).replace(tzinfo=None)
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



async def enqueue(m, db, cancel=False, authorized_by=None):
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
    from ..services.meeting_followups import schedule_followups
    schedule_followups(m, cancel=cancel, authorized_by=authorized_by)


def clear_schedule(m, status, message=None):
    m.send_at = None
    if m.send_schedule and (m.send_schedule.get("status") in {"pending", "blocked"} or status == "queued"):
        m.send_schedule = {**m.send_schedule, "status": status, "error": message}


async def validate_publish(m, data, db):
    check_revision(m, data.revision)
    if m.status == "cancelled" or m.archived:
        raise HTTPException(409, "Meeting is cancelled or archived")
    if not settings.meetings_sending_enabled or len(settings.meetings_signing_key) < 32:
        raise HTTPException(503, "Invitation sending is disabled until Meetings is configured")
    if utc_time(m.draft["start"], m.draft["timezone"], m.draft.get("start_fold")) <= datetime.now(timezone.utc):
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
            "confirm_paid_channels": data.confirm_paid_channels, "quoted_credit_units": data.quoted_credit_units, "authorized_by": user.id, "error": None}
    else:
        await enqueue(m, db, authorized_by=user.id)
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
    if not preferences and utc_time(m.published["end"], m.published["timezone"], m.published.get("end_fold")) + timedelta(days=1) < datetime.now(timezone.utc):
        raise HTTPException(410, "Responses closed 24 hours after this meeting ended")
    return m, a


def private_headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"


@public_router.get("/shared/{token}")
async def shared_invitation(token: str, response: Response, db: AsyncSession = Depends(get_db)):
    private_headers(response)
    try:
        if len(settings.meetings_signing_key) < 32:
            raise ValueError()
        claims = jwt.decode(token, settings.meetings_signing_key, algorithms=["HS256"], options={"require": ["exp", "scope", "mid", "revision"]})
        if claims["scope"] != "meeting-shared-invitation":
            raise ValueError()
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(410, "This invitation link is invalid or expired")
    m = await db.get(Meeting, claims["mid"])
    org = await db.get(Organization, m.org_id) if m else None
    if not m or not org or not org.is_active or m.status == "cancelled" or m.revision != claims["revision"]:
        raise HTTPException(410, "This invitation changed or was cancelled. Ask the organizer for the latest link.")
    data = {key: m.draft[key] for key in ["title", "agenda", "start", "end", "timezone", "location_type", "location", "video_url", "invitation_style"] if key in m.draft}
    return {"meeting": data, "html": invitation(data, web=True, shared=True)[1]}


@public_router.get("/{token}")
async def response_preview(token: str, response: Response, db: AsyncSession = Depends(get_db)):
    private_headers(response)
    m, a = await resolve(token, db)
    # Only the intended recipient, never other attendees or their response links.
    return {"meeting": {k: v for k, v in m.published.items() if k not in {"attendees", "shared_with_org_admins", "reminder_minutes", "nudge_hours_before"}},
        "name": a.name, "response": a.response, "sequence": m.sequence,
        "html": invitation(m.published, response_url="#meeting-reply", recipient_name=a.name, web=True)[1]}


@public_router.get("/preferences/{token}")
async def preference_preview(token: str, response: Response, db: AsyncSession = Depends(get_db)):
    private_headers(response)
    m, a = await resolve(token, db, preferences=True)
    claims = jwt.decode(token, settings.meetings_signing_key, algorithms=["HS256"])
    phone = claims.get("phone") or a.phone
    stopped = (await db.scalars(select(MeetingSuppression.channel).where(MeetingSuppression.org_id == m.org_id,
        MeetingSuppression.phone == phone))).all() if phone else []
    return {"name": a.name, "phone": phone, "stopped": list(stopped), "reminders_stopped": a.reminders_stopped, "email": bool(a.email)}


class StopNotifications(BaseModel):
    channel: Literal["sms", "whatsapp", "reminders"]


@public_router.post("/preferences/{token}")
async def stop_notifications(token: str, data: StopNotifications, response: Response, db: AsyncSession = Depends(get_db)):
    private_headers(response)
    m, a = await resolve(token, db, preferences=True)
    claims = jwt.decode(token, settings.meetings_signing_key, algorithms=["HS256"])
    if data.channel == "reminders":
        a.reminders_stopped = True
        await db.commit()
        return {"stopped": "reminders"}
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
