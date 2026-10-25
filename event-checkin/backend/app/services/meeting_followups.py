"""Opt-in email reminders and explicit follow-ups, under the meeting row lock.

No publication sequence changes, no paid-channel charges, no automatic retry of
uncertain SMTP sends. Purpose participates in the durable delivery uniqueness key.
"""
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy import select, or_
from ..config import settings
from ..models import Meeting, MeetingAttendee, MeetingDelivery, Membership, Organization
from .meeting_service import utc_time
from .meeting_channels import Suppressed

BAD_RECEIPTS = {"bounced", "complained", "failed", "suppressed"}


def schedule_followups(m, *, cancel=False, authorized_by=None):
    m.next_followup_at = None
    m.followup_schedule = []
    if cancel:
        return
    start = utc_time(m.published["start"], m.published["timezone"], m.published.get("start_fold")).replace(tzinfo=None)
    now = datetime.utcnow()
    entries = [(f"reminder:{minutes}", start - timedelta(minutes=minutes)) for minutes in m.published.get("reminder_minutes", [])]
    hours = m.published.get("nudge_hours_before", 0)
    if hours:
        entries.append((f"nudge:{hours}", start - timedelta(hours=hours)))
    m.followup_schedule = [{"purpose": purpose, "authorized_by": authorized_by or m.organizer_id, "due_at": due.isoformat(), "status": "pending" if due > now else "skipped"}
        for purpose, due in entries]
    pending = [due for _, due in entries if due > now]
    m.next_followup_at = min(pending) if pending else None


def allowed(m, a, row):
    if row.purpose == "invitation" or row.method == "CANCEL":
        return True
    return (not m.archived and not a.reminders_stopped and a.response != "declined" and a.active and m.status == "scheduled"
        and utc_time(m.published["start"], m.published["timezone"], m.published.get("start_fold")) > datetime.now(timezone.utc)
        and (not row.purpose.startswith("nudge:") or a.response == "pending"))


async def followup_guard(db, m, a, row):
    if not allowed(m, a, row):
        raise Suppressed("Follow-up no longer eligible: response, preferences or meeting time changed")
    if row.purpose != "invitation":
        authorizer = row.payload.get("_authorized_by", m.organizer_id)
        if not await authorized(db, m, authorizer):
            raise Suppressed("Follow-up organizer access changed")
        blocked = await db.scalar(select(MeetingDelivery.id).where(MeetingDelivery.meeting_id == m.id,
            MeetingDelivery.attendee_id == a.id, MeetingDelivery.sequence == m.sequence,
            MeetingDelivery.channel == "email", MeetingDelivery.purpose == "invitation",
            MeetingDelivery.delivery_status.in_(BAD_RECEIPTS)).limit(1))
        if blocked:
            raise Suppressed("Initial email bounced, failed, was suppressed or received a complaint")


async def authorized(db, m, user_id):
    if user_id != m.organizer_id and not m.shared_with_org_admins:
        return False
    return bool(await db.scalar(select(Membership.id).where(Membership.org_id == m.org_id,
        Membership.user_id == user_id, Membership.role.in_(["owner", "admin"]))))


async def queue_email(m, db, a, purpose, *, authorized_by=None):
    existing = await db.scalar(select(MeetingDelivery.id).where(MeetingDelivery.meeting_id == m.id,
        MeetingDelivery.attendee_id == a.id, MeetingDelivery.sequence == m.sequence,
        MeetingDelivery.method == "REQUEST", MeetingDelivery.channel == "email", MeetingDelivery.recipient == a.email,
        MeetingDelivery.purpose == purpose))
    if existing:
        return False
    db.add(MeetingDelivery(meeting_id=m.id, attendee_id=a.id, sequence=m.sequence, method="REQUEST",
        channel="email", recipient=a.email, credit_units=0, purpose=purpose, payload={**m.published, "_authorized_by": authorized_by or m.organizer_id}))
    return True


async def manual_followup(m, db, revision, key, *, aid=None, authorized_by=None):
    if m.revision != revision or m.published_revision != revision:
        raise HTTPException(409, "Review and send current meeting changes before following up")
    if not settings.meetings_sending_enabled or m.archived or m.status != "scheduled":
        raise HTTPException(409, "An active published meeting is required")
    if utc_time(m.published["start"], m.published["timezone"], m.published.get("start_fold")) <= datetime.now(timezone.utc):
        raise HTTPException(409, "Meeting has already started")
    authorizer = authorized_by or m.organizer_id
    if not await authorized(db, m, authorizer):
        raise HTTPException(403, "Organizer access changed")
    purpose = ("resend:" if aid else "nudge:") + key
    repeated = await db.scalar(select(MeetingDelivery.id).where(MeetingDelivery.meeting_id == m.id,
        MeetingDelivery.sequence == m.sequence, MeetingDelivery.purpose == purpose).limit(1))
    if repeated:
        return 0
    attendees = (await db.scalars(select(MeetingAttendee).where(MeetingAttendee.meeting_id == m.id,
        MeetingAttendee.active.is_(True), *([MeetingAttendee.id == aid] if aid else [MeetingAttendee.response == "pending"])))).all()
    if aid and not attendees:
        raise HTTPException(404, "Attendee not found")
    eligible = [a for a in attendees if a.email and "email" in a.channels and not a.reminders_stopped and a.response != "declined"]
    if not eligible:
        if not aid and not attendees:
            raise HTTPException(422, "Everyone has replied. There are no pending replies to nudge.")
        raise HTTPException(422, "No pending attendees can receive this email. Check their email channel and reminder preferences.")
    unresolved = await db.scalar(select(MeetingDelivery.id).where(MeetingDelivery.meeting_id == m.id,
        MeetingDelivery.sequence == m.sequence, MeetingDelivery.channel == "email",
        MeetingDelivery.attendee_id.in_([a.id for a in eligible]),
        MeetingDelivery.status.in_(["queued", "sending", "uncertain"])).limit(1))
    if unresolved:
        raise HTTPException(409, "Wait for pending email delivery or reconcile unknown outcomes before following up")
    for a in eligible:
        initial = await db.scalar(select(MeetingDelivery.id).where(MeetingDelivery.meeting_id == m.id,
            MeetingDelivery.sequence == m.sequence, MeetingDelivery.attendee_id == a.id,
            MeetingDelivery.channel == "email", MeetingDelivery.purpose == "invitation", MeetingDelivery.status == "accepted",
            or_(MeetingDelivery.delivery_status.is_(None), MeetingDelivery.delivery_status.not_in(BAD_RECEIPTS))).limit(1))
        if not initial:
            raise HTTPException(409, "Resolve the initial email delivery before following up")
    recent = await db.scalar(select(MeetingDelivery.id).where(MeetingDelivery.meeting_id == m.id,
        MeetingDelivery.sequence == m.sequence, MeetingDelivery.attendee_id.in_([a.id for a in eligible]),
        MeetingDelivery.purpose != "invitation", MeetingDelivery.created_at > datetime.utcnow() - timedelta(minutes=5)).limit(1))
    if recent:
        raise HTTPException(429, "Wait five minutes before another follow-up to these attendees")
    return sum([await queue_email(m, db, a, purpose, authorized_by=authorizer) for a in eligible])


async def release_followups(sessions, *, meeting_id=None):
    if not settings.meetings_sending_enabled:
        return
    async with sessions() as db:
        stmt = select(Meeting.id).where(Meeting.next_followup_at <= datetime.utcnow(), Meeting.archived.is_(False))
        if meeting_id:
            stmt = stmt.where(Meeting.id == meeting_id)
        ids = (await db.scalars(stmt.limit(20))).all()
    for mid in ids:
        async with sessions() as db:
            m = await db.scalar(select(Meeting).where(Meeting.id == mid).with_for_update(skip_locked=True))
            if not m or not m.next_followup_at or m.next_followup_at > datetime.utcnow():
                continue
            org = await db.get(Organization, m.org_id)
            entries = [dict(item) for item in m.followup_schedule or []]
            valid = bool(org and org.is_active and m.status == "scheduled" and not m.archived)
            if valid:
                valid = utc_time(m.published["start"], m.published["timezone"], m.published.get("start_fold")) > datetime.now(timezone.utc)
            attendees = (await db.scalars(select(MeetingAttendee).where(MeetingAttendee.meeting_id == mid, MeetingAttendee.active.is_(True)))).all()
            history = (await db.scalars(select(MeetingDelivery).where(MeetingDelivery.meeting_id == mid,
                MeetingDelivery.sequence == m.sequence, MeetingDelivery.channel == "email"))).all()
            initial_accepted = {row.attendee_id for row in history if row.purpose == "invitation" and row.status == "accepted" and row.delivery_status not in BAD_RECEIPTS}
            recent_followup = {row.attendee_id for row in history if row.purpose != "invitation" and
                (row.status in {"queued", "sending", "uncertain"} or row.created_at > datetime.utcnow() - timedelta(minutes=5))}
            # If the worker was down, send at most the latest due follow-up to
            # each recipient instead of a burst of missed reminders.
            for item in sorted(entries, key=lambda entry: entry["due_at"], reverse=True):
                if item["status"] != "pending" or datetime.fromisoformat(item["due_at"]) > datetime.utcnow():
                    continue
                queued = 0
                authorizer = item.get("authorized_by", m.organizer_id)
                if valid and await authorized(db, m, authorizer):
                    for a in attendees:
                        if not a.email or "email" not in a.channels or a.reminders_stopped or a.response == "declined":
                            continue
                        if item["purpose"].startswith("nudge:") and a.response != "pending":
                            continue
                        # A same-time pending-reply nudge replaces the generic
                        # reminder for pending recipients, never two emails.
                        nudge = m.published.get("nudge_hours_before", 0)
                        if a.response == "pending" and nudge and item["purpose"] == f"reminder:{nudge * 60}":
                            continue
                        if a.id in initial_accepted and a.id not in recent_followup:
                            added = await queue_email(m, db, a, item["purpose"], authorized_by=authorizer)
                            queued += int(added)
                            if added:
                                recent_followup.add(a.id)
                item.update(status="queued" if queued else "skipped", recipients=queued)
            m.followup_schedule = entries
            pending = [datetime.fromisoformat(item["due_at"]) for item in entries if item["status"] == "pending"]
            m.next_followup_at = min(pending) if pending else None
            await db.commit()
