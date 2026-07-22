"""dashboard-service — read-only multi-day command-center analytics.

Reads the same Postgres database as `backend` (via the `dashboard_ro` role,
SELECT-only) and never writes guest data. See
docs/MULTI-DAY-DASHBOARD-IMPLEMENTATION-PLAN.md, Track A, for the design.
"""
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import current_user, require_event_admin
from .config import settings
from .database import get_db
from .models import (
    EmailDeliveryEvent, Event, ExperienceStep, ExperienceWorkflow, Guest,
    GuestExperienceProgress, GuestMealFulfillment, GuestMenuChoice, MenuCategory,
    MessageCreditLedger, ScanEvent, SeatingTable, User, Zone,
)
from .timeutil import event_tz, to_event_local, to_utc_naive

logger = logging.getLogger("dashboard-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="Festio Results / Command Center", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/results/health")
async def health(db: AsyncSession = Depends(get_db)):
    await db.execute(select(1))
    return {"status": "ok", "service": "dashboard-service"}


async def admin_event(
    event_id: str,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Event:
    return await require_event_admin(event_id, user, db)


# ── scope parser ──────────────────────────────────────────────────────────────

@dataclass
class Scope:
    event_id: str
    start_at: datetime   # naive UTC, inclusive
    end_at: datetime     # naive UTC, exclusive
    day: str | None
    venue_id: str | None
    timezone: str


def _local_midnight(d: date, tz) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=tz)


def resolve_scope(event: Event, day: str | None, start: str | None, end: str | None, venue_id: str | None) -> Scope:
    tz = event_tz(event)
    event_start_local = to_event_local(event.event_date, tz)
    event_end_local = to_event_local(event.event_end_date, tz) if event.event_end_date else event_start_local

    entire_start_date = event_start_local.date()
    entire_end_date = event_end_local.date()  # inclusive last day

    if day:
        try:
            d = datetime.strptime(day, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "day must be YYYY-MM-DD")
        if not (entire_start_date <= d <= entire_end_date):
            raise HTTPException(400, "day is outside the event's date range")
        local_start = _local_midnight(d, tz)
        local_end = local_start + timedelta(days=1)
    elif start and end:
        try:
            sd = datetime.strptime(start, "%Y-%m-%d").date()
            ed = datetime.strptime(end, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "start/end must be YYYY-MM-DD")
        local_start = _local_midnight(sd, tz)
        local_end = _local_midnight(ed, tz) + timedelta(days=1)
    else:
        local_start = _local_midnight(entire_start_date, tz)
        local_end = _local_midnight(entire_end_date, tz) + timedelta(days=1)

    return Scope(
        event_id=event.id,
        start_at=to_utc_naive(local_start),
        end_at=to_utc_naive(local_end),
        day=day,
        venue_id=venue_id,
        timezone=str(tz),
    )


def _event_days(event: Event) -> list[date]:
    tz = event_tz(event)
    start_d = to_event_local(event.event_date, tz).date()
    end_d = to_event_local(event.event_end_date, tz).date() if event.event_end_date else start_d
    days = []
    d = start_d
    while d <= end_d:
        days.append(d)
        d += timedelta(days=1)
    return days


# ── attendance queries (ScanEvent is the source of truth, per the plan) ──────

async def _expected_count(db: AsyncSession, event_id: str) -> int:
    return await db.scalar(
        select(func.count()).select_from(Guest)
        .where(Guest.event_id == event_id, Guest.rsvp_status != "declined")
    ) or 0


async def _distinct_guest_ids(db: AsyncSession, event_id: str, direction: str, start_at: datetime, end_at: datetime) -> set[str]:
    rows = (await db.execute(
        select(ScanEvent.guest_id).distinct().where(
            ScanEvent.event_id == event_id, ScanEvent.direction == direction,
            ScanEvent.denied.is_(False),
            ScanEvent.scanned_at >= start_at, ScanEvent.scanned_at < end_at,
        )
    )).scalars().all()
    return set(rows)


async def _first_scan_map(db: AsyncSession, event_id: str) -> dict[str, datetime]:
    """Each guest's first-ever accepted entry scan, across the whole event
    (not scoped to `day`) — this is what makes a same-scope arrival
    "first-time" vs "returning"."""
    rows = (await db.execute(
        select(ScanEvent.guest_id, func.min(ScanEvent.scanned_at))
        .where(ScanEvent.event_id == event_id, ScanEvent.direction == "in", ScanEvent.denied.is_(False))
        .group_by(ScanEvent.guest_id)
    )).all()
    return {gid: first_at for gid, first_at in rows}


async def _on_site_count(db: AsyncSession, event_id: str, cutoff: datetime) -> int:
    """Guests whose latest accepted scan at/before `cutoff` is an entry."""
    sub = (
        select(ScanEvent.guest_id, func.max(ScanEvent.scanned_at).label("last_at"))
        .where(ScanEvent.event_id == event_id, ScanEvent.denied.is_(False), ScanEvent.scanned_at <= cutoff)
        .group_by(ScanEvent.guest_id)
        .subquery()
    )
    cnt = await db.scalar(
        select(func.count(func.distinct(sub.c.guest_id)))
        .select_from(sub)
        .join(
            ScanEvent,
            (ScanEvent.guest_id == sub.c.guest_id)
            & (ScanEvent.scanned_at == sub.c.last_at)
            & (ScanEvent.event_id == event_id),
        )
        .where(ScanEvent.direction == "in", ScanEvent.denied.is_(False))
    )
    return int(cnt or 0)


async def attendance_stats(db: AsyncSession, event: Event, scope: Scope) -> dict:
    expected = await _expected_count(db, event.id)
    checked_in_ids = await _distinct_guest_ids(db, event.id, "in", scope.start_at, scope.end_at)
    checked_out_ids = await _distinct_guest_ids(db, event.id, "out", scope.start_at, scope.end_at)
    first_at = await _first_scan_map(db, event.id)
    first_time_ids = {gid for gid in checked_in_ids if first_at.get(gid) and scope.start_at <= first_at[gid] < scope.end_at}
    returning_ids = checked_in_ids - first_time_ids
    cutoff = min(datetime.utcnow(), scope.end_at)
    on_site = await _on_site_count(db, event.id, cutoff)

    declined = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.rsvp_status == "declined")) or 0
    confirmed_ids = set((await db.execute(select(Guest.id).where(
        Guest.event_id == event.id, Guest.rsvp_status == "confirmed"))).scalars().all())
    confirmed_not_here = len(confirmed_ids - checked_in_ids)
    walk_in_ids = set((await db.execute(select(Guest.id).where(
        Guest.event_id == event.id, Guest.is_walk_in.is_(True)))).scalars().all())
    walk_ins = len(walk_in_ids & checked_in_ids)

    tz = event_tz(event)
    rows = (await db.execute(
        select(ScanEvent.guest_id, ScanEvent.direction, ScanEvent.scanned_at)
        .where(ScanEvent.event_id == event.id, ScanEvent.denied.is_(False),
               ScanEvent.scanned_at >= scope.start_at, ScanEvent.scanned_at < scope.end_at)
        .order_by(ScanEvent.scanned_at)
    )).all()
    hourly: dict[str, dict[str, int]] = defaultdict(lambda: {"first_arrival": 0, "returning": 0, "exit": 0})
    for gid, direction, ts in rows:
        local = to_event_local(ts, tz)
        bucket = local.strftime("%H:00")
        if direction == "in":
            hourly[bucket]["first_arrival" if first_at.get(gid) == ts else "returning"] += 1
        else:
            hourly[bucket]["exit"] += 1

    return {
        "scope": {"start_at": scope.start_at.isoformat() + "Z", "end_at": scope.end_at.isoformat() + "Z", "timezone": scope.timezone},
        "expected": expected,
        "checked_in": len(checked_in_ids),
        "on_site": on_site,
        "first_time": len(first_time_ids),
        "returning": len(returning_ids),
        "checked_out": len(checked_out_ids),
        "declined": declined,
        "confirmed_not_here": confirmed_not_here,
        "walk_ins": walk_ins,
        "hourly": [{"hour": h, **v} for h, v in sorted(hourly.items())],
    }


async def attendance_by_day(db: AsyncSession, event: Event) -> list[dict]:
    tz = event_tz(event)
    expected = await _expected_count(db, event.id)
    out = []
    for d in _event_days(event):
        local_start = _local_midnight(d, tz)
        local_end = local_start + timedelta(days=1)
        start_at, end_at = to_utc_naive(local_start), to_utc_naive(local_end)
        checked_in = len(await _distinct_guest_ids(db, event.id, "in", start_at, end_at))
        out.append({
            "day": d.isoformat(),
            "expected": expected,
            "checked_in": checked_in,
            "attendance_rate": round(checked_in / expected * 100) if expected else 0,
            "upcoming": end_at > datetime.utcnow(),
        })
    return out


@app.get("/api/results/events/{event_id}/analytics/attendance")
async def get_attendance(
    event_id: str,
    day: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    venue_id: str | None = Query(None),
    event: Event = Depends(admin_event),
    db: AsyncSession = Depends(get_db),
):
    scope = resolve_scope(event, day, start, end, venue_id)
    stats = await attendance_stats(db, event, scope)
    stats["by_day"] = await attendance_by_day(db, event)
    return stats


# ── venue occupancy (reuse the same logic as backend/app/routers/access.py) ──

async def _zone_occupancy(db: AsyncSession, zone_id: str) -> int:
    ins = await db.scalar(select(func.count(ScanEvent.id)).where(
        ScanEvent.zone_id == zone_id, ScanEvent.direction == "in", ScanEvent.denied.is_(False))) or 0
    outs = await db.scalar(select(func.count(ScanEvent.id)).where(
        ScanEvent.zone_id == zone_id, ScanEvent.direction == "out", ScanEvent.denied.is_(False))) or 0
    return max(int(ins) - int(outs), 0)


async def venue_occupancy(db: AsyncSession, event: Event) -> list[dict]:
    if not event.venue_access_enabled:
        return []
    zones = (await db.execute(
        select(Zone).where(Zone.event_id == event.id, Zone.is_active.is_(True)).order_by(Zone.sort_order)
    )).scalars().all()
    return [{"id": z.id, "name": z.name, "occupancy": await _zone_occupancy(db, z.id), "capacity": z.capacity} for z in zones]


# ── program (session) analytics ───────────────────────────────────────────────
# Mirrors backend/app/routers/experience.py::_session_config exactly — session
# scheduling lives in ExperienceStep.config, not the generic starts_offset_seconds
# field (that's used for the separate timed-agenda display, not session_attendance
# steps). Kept in sync by hand since this is a read-only mirror, same as models.py.

def _session_config(step: ExperienceStep) -> dict:
    config = step.config or {}
    raw = (
        config.get("session") or config.get("session_details")
        or config.get("schedule") or config.get("session_config")
    )
    if not isinstance(raw, dict) and isinstance(config.get("sessions"), list) and config["sessions"]:
        raw = config["sessions"][0]
    if not isinstance(raw, dict):
        raw = {}
    session = {
        "topic": raw.get("topic") or raw.get("title") or raw.get("name") or step.title,
        "date": raw.get("date") or raw.get("session_date") or "",
        "start_time": raw.get("start_time") or raw.get("startTime") or raw.get("start") or "",
        "end_time": raw.get("end_time") or raw.get("endTime") or raw.get("end") or "",
        "room": raw.get("room") or raw.get("location") or raw.get("venue") or "",
        "speaker": raw.get("speaker") or raw.get("host") or raw.get("presenter") or "",
        "capacity": raw.get("capacity"),
    }
    return session


def _parse_session_dt(session: dict, time_key: str) -> datetime | None:
    d = str(session.get("date") or "").strip()
    t = str(session.get(time_key) or "").strip()
    if not d or not t:
        return None
    try:
        return datetime.fromisoformat(f"{d}T{t}")
    except ValueError:
        return None


async def _default_workflow(db: AsyncSession, event_id: str) -> ExperienceWorkflow | None:
    return await db.scalar(select(ExperienceWorkflow).where(
        ExperienceWorkflow.event_id == event_id, ExperienceWorkflow.is_default.is_(True)))


async def program_sessions(db: AsyncSession, event: Event) -> list[dict]:
    if not event.experience_enabled:
        return []
    wf = await _default_workflow(db, event.id)
    if not wf:
        return []
    steps = (await db.execute(select(ExperienceStep).where(
        ExperienceStep.workflow_id == wf.id, ExperienceStep.type == "session_attendance",
        ExperienceStep.enabled.is_(True),
    ).order_by(ExperienceStep.sort_order))).scalars().all()

    now = datetime.utcnow()
    out = []
    for step in steps:
        session = _session_config(step)
        start = _parse_session_dt(session, "start_time")
        end = _parse_session_dt(session, "end_time")
        # "Registered" = every guest with a progress row for this step (workflow
        # assignment creates one per eligible guest); "attended" = actually
        # checked into the session. Approximate — see plan doc Track A/A3.
        attended = await db.scalar(select(func.count()).select_from(GuestExperienceProgress).where(
            GuestExperienceProgress.step_id == step.id,
            GuestExperienceProgress.status.in_(["completed", "overridden"]),
        )) or 0
        registered = await db.scalar(select(func.count()).select_from(GuestExperienceProgress).where(
            GuestExperienceProgress.step_id == step.id
        )) or 0
        state = "upcoming"
        if start and end:
            if start <= now <= end:
                state = "in_progress"
            elif now > end:
                state = "ended"
        out.append({
            "step_id": step.id,
            "topic": session.get("topic") or step.title,
            "room": session.get("room") or None,
            "speaker": session.get("speaker") or None,
            "capacity": session.get("capacity"),
            "start_at": start.isoformat() if start else None,
            "end_at": end.isoformat() if end else None,
            "state": state,
            "registered": registered,
            "attended": attended,
            "no_show_rate": round((registered - attended) / registered * 100) if registered else 0,
        })
    return out


@app.get("/api/results/events/{event_id}/analytics/program")
async def get_program(event: Event = Depends(admin_event), db: AsyncSession = Depends(get_db)):
    sessions = await program_sessions(db, event)
    return {
        "sessions": sessions,
        "in_progress_count": sum(1 for s in sessions if s["state"] == "in_progress"),
        "upcoming_count": sum(1 for s in sessions if s["state"] == "upcoming"),
    }


# ── experience completion funnel ──────────────────────────────────────────────

async def experience_funnel(db: AsyncSession, event: Event) -> list[dict]:
    if not event.experience_enabled:
        return []
    wf = await _default_workflow(db, event.id)
    if not wf:
        return []
    steps = (await db.execute(select(ExperienceStep).where(
        ExperienceStep.workflow_id == wf.id, ExperienceStep.enabled.is_(True),
    ).order_by(ExperienceStep.sort_order))).scalars().all()

    out = []
    for step in steps:
        total = await db.scalar(select(func.count()).select_from(GuestExperienceProgress).where(
            GuestExperienceProgress.step_id == step.id
        )) or 0
        completed = await db.scalar(select(func.count()).select_from(GuestExperienceProgress).where(
            GuestExperienceProgress.step_id == step.id,
            GuestExperienceProgress.status.in_(["completed", "overridden"]),
        )) or 0
        failed = await db.scalar(select(func.count()).select_from(GuestExperienceProgress).where(
            GuestExperienceProgress.step_id == step.id, GuestExperienceProgress.status == "failed",
        )) or 0
        out.append({
            "step_id": step.id, "title": step.title, "type": step.type, "required": step.required,
            "total": total, "completed": completed, "failed": failed,
        })
    return out


@app.get("/api/results/events/{event_id}/analytics/experience")
async def get_experience(event: Event = Depends(admin_event), db: AsyncSession = Depends(get_db)):
    return {"steps": await experience_funnel(db, event)}


# ── RSVP funnel ────────────────────────────────────────────────────────────────

async def rsvp_funnel(db: AsyncSession, event: Event) -> dict:
    invited = await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id == event.id)) or 0
    confirmed = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.rsvp_status == "confirmed")) or 0
    declined = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.rsvp_status == "declined")) or 0
    pending = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.rsvp_status == "pending")) or 0
    checked_in = await db.scalar(select(func.count(func.distinct(ScanEvent.guest_id))).where(
        ScanEvent.event_id == event.id, ScanEvent.direction == "in", ScanEvent.denied.is_(False))) or 0
    return {
        "invited": invited,
        "responded": confirmed + declined + pending,
        "confirmed": confirmed,
        "checked_in": checked_in,
    }


# ── communication health (mirrors backend/app/routers/dashboard.py exactly —
# same message_credit_ledger dedup-by-provider-message-id logic, same email
# delivery event dedup-by-latest-per-message) ─────────────────────────────────

async def communication_health(db: AsyncSession, event: Event) -> dict:
    msg_rows = (await db.execute(
        select(MessageCreditLedger.id, MessageCreditLedger.channel, MessageCreditLedger.action,
               MessageCreditLedger.status, MessageCreditLedger.provider_message_id)
        .where(MessageCreditLedger.event_id == event.id, MessageCreditLedger.channel.in_(("sms", "mms", "whatsapp")))
    )).all()
    failed_statuses = {"failed", "undelivered", "error", "rejected"}
    msg_ids = {c: {"sent": set(), "delivered": set(), "failed": set()} for c in ("sms", "mms", "whatsapp")}
    for row_id, c, action, status, provider_message_id in msg_rows:
        d = msg_ids.get(c)
        if d is None:
            continue
        key = provider_message_id or f"ledger:{row_id}"
        if action == "spend":
            d["sent"].add(key)
            st = (status or "").lower()
            if "deliver" in st:
                d["delivered"].add(key)
            elif st in failed_statuses:
                d["failed"].add(key)
        elif action == "refund":
            d["failed"].add(key)

    def _rate(c):
        sent = len(msg_ids[c]["sent"])
        delivered = len(msg_ids[c]["delivered"] - msg_ids[c]["failed"])
        return {"sent": sent, "delivered": delivered, "rate": round(delivered / sent * 100) if sent else None}

    sms_rate = _rate("sms")
    whatsapp_rate = _rate("whatsapp")

    email_rows = (await db.execute(
        select(EmailDeliveryEvent.provider_email_id, EmailDeliveryEvent.provider_event_id,
               EmailDeliveryEvent.id, EmailDeliveryEvent.status, EmailDeliveryEvent.occurred_at)
        .where(EmailDeliveryEvent.event_id == event.id)
        .order_by(EmailDeliveryEvent.occurred_at.desc())
    )).all()
    latest_by_email = {}
    for provider_email_id, provider_event_id, row_id, status, _occurred in email_rows:
        key = provider_email_id or provider_event_id or row_id
        latest_by_email.setdefault(key, status)
    bad = {"bounced", "failed", "complained", "suppressed"}
    email_sent = len(latest_by_email)
    email_reached = sum(1 for s in latest_by_email.values() if s not in bad)

    return {
        "email": {"sent": email_sent, "reached": email_reached,
                   "rate": round(email_reached / email_sent * 100) if email_sent else None},
        "sms": sms_rate,
        "whatsapp": whatsapp_rate,
        "credits_remaining": event.message_credits,
    }


# ── recent activity feed ──────────────────────────────────────────────────────

async def recent_activity(db: AsyncSession, event: Event, limit: int = 15) -> list[dict]:
    rows = (await db.execute(
        select(ScanEvent, Guest.first_name, Guest.last_name, Guest.is_walk_in, Zone.name)
        .join(Guest, Guest.id == ScanEvent.guest_id)
        .outerjoin(Zone, Zone.id == ScanEvent.zone_id)
        .where(ScanEvent.event_id == event.id, ScanEvent.denied.is_(False))
        .order_by(ScanEvent.scanned_at.desc())
        .limit(limit)
    )).all()
    out = []
    for scan, first_name, last_name, is_walk_in, zone_name in rows:
        if scan.direction == "in" and is_walk_in:
            action = "Walk-in added"
        elif scan.direction == "in":
            action = "Guest checked in"
        else:
            action = "Guest checked out"
        out.append({
            "guest_name": f"{first_name} {last_name}".strip(),
            "action": action,
            "location": zone_name,
            "at": scan.scanned_at.isoformat() + "Z",
        })
    return out


# ── meals (Track B — per-category fulfillment, replaces the coarse
# Guest.meal_served total now that guest_meal_fulfillment exists) ────────────

async def meals_breakdown(db: AsyncSession, event: Event) -> list[dict]:
    if not event.menu_enabled:
        return []
    cats = (await db.execute(
        select(MenuCategory).where(MenuCategory.event_id == event.id, MenuCategory.display_only.is_(False))
        .order_by(MenuCategory.sort_order)
    )).scalars().all()
    out = []
    for cat in cats:
        eligible = await db.scalar(select(func.count(func.distinct(GuestMenuChoice.guest_id))).where(
            GuestMenuChoice.category_id == cat.id)) or 0
        served = await db.scalar(select(func.count()).select_from(GuestMealFulfillment).where(
            GuestMealFulfillment.category_id == cat.id, GuestMealFulfillment.status == "served")) or 0
        out.append({
            "category_id": cat.id, "name": cat.name, "day_label": cat.day_label,
            "eligible": eligible, "served": served, "remaining": max(eligible - served, 0),
            "rate": round(served / eligible * 100) if eligible else 0,
        })
    return out


@app.get("/api/results/events/{event_id}/analytics/meals")
async def get_meals(event: Event = Depends(admin_event), db: AsyncSession = Depends(get_db)):
    categories = await meals_breakdown(db, event)
    return {
        "categories": categories,
        "eligible_total": sum(c["eligible"] for c in categories),
        "served_total": sum(c["served"] for c in categories),
    }


# ── operational alerts ────────────────────────────────────────────────────────

async def _consent_step(db: AsyncSession, event_id: str) -> ExperienceStep | None:
    wf = await db.scalar(select(ExperienceWorkflow).where(
        ExperienceWorkflow.event_id == event_id, ExperienceWorkflow.is_default.is_(True)))
    if not wf:
        return None
    return await db.scalar(select(ExperienceStep).where(
        ExperienceStep.workflow_id == wf.id, ExperienceStep.type == "consent", ExperienceStep.enabled.is_(True)))


async def invite_delivery_status(db: AsyncSession, event: Event) -> dict:
    sent = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.invite_status == "sent")) or 0
    failed = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.invite_status == "failed")) or 0
    unsent = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.invite_status.is_(None))) or 0
    return {"sent": sent, "failed": failed, "unsent": unsent}


@app.get("/api/results/events/{event_id}/analytics/invitations")
async def get_invitations(event: Event = Depends(admin_event), db: AsyncSession = Depends(get_db)):
    return {
        "rsvp_funnel": await rsvp_funnel(db, event),
        "delivery": await invite_delivery_status(db, event),
        "communication": await communication_health(db, event),
    }


# ── operations (denied scans, consent completion — the Operations tab) ───────

async def consent_status(db: AsyncSession, event: Event) -> dict | None:
    if not event.experience_enabled:
        return None
    consent_step = await _consent_step(db, event.id)
    if not consent_step:
        return None
    eligible = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.rsvp_status != "declined")) or 0
    signed = await db.scalar(select(func.count()).select_from(GuestExperienceProgress).where(
        GuestExperienceProgress.step_id == consent_step.id,
        GuestExperienceProgress.status.in_(["completed", "overridden"]),
    )) or 0
    return {"eligible": eligible, "signed": signed, "rate": round(signed / eligible * 100) if eligible else 0}


async def denied_scans_breakdown(db: AsyncSession, event: Event) -> dict:
    total = await db.scalar(select(func.count()).select_from(ScanEvent).where(
        ScanEvent.event_id == event.id, ScanEvent.denied.is_(True))) or 0
    rows = (await db.execute(
        select(ScanEvent.deny_reason, func.count()).where(
            ScanEvent.event_id == event.id, ScanEvent.denied.is_(True),
        ).group_by(ScanEvent.deny_reason)
    )).all()
    by_reason = sorted(
        [{"reason": r or "Unknown", "count": c} for r, c in rows],
        key=lambda x: -x["count"],
    )
    return {"total": total, "by_reason": by_reason}


@app.get("/api/results/events/{event_id}/analytics/operations")
async def get_operations(event: Event = Depends(admin_event), db: AsyncSession = Depends(get_db)):
    meal_cats = await meals_breakdown(db, event)
    return {
        "meals": {"categories": meal_cats,
                  "eligible_total": sum(c["eligible"] for c in meal_cats),
                  "served_total": sum(c["served"] for c in meal_cats)},
        "consent": await consent_status(db, event),
        "denied_scans": await denied_scans_breakdown(db, event),
        "venue_occupancy": await venue_occupancy(db, event),
    }


async def build_alerts(db: AsyncSession, event: Event) -> list[dict]:
    alerts: list[dict] = []

    failed_invites = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.invite_status == "failed")) or 0
    if failed_invites:
        alerts.append({
            "id": "failed_invitations", "type": "failed_invitations", "severity": "warning",
            "title": f"{failed_invites} invitation{'s' if failed_invites != 1 else ''} failed",
            "description": "No channel could reach these guests — check contact info or delivery status.",
            "count": failed_invites, "action_label": "Review",
            "action_url": f"/admin?event={event.id}&tab=invite",
        })

    no_contact = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id,
        (Guest.email.is_(None) | (Guest.email == "")),
        (Guest.phone.is_(None) | (Guest.phone == "")),
    )) or 0
    if no_contact:
        alerts.append({
            "id": "no_contact_info", "type": "no_contact_info", "severity": "warning",
            "title": f"{no_contact} guest{'s' if no_contact != 1 else ''} have no contact info",
            "description": "No email or phone on file — they can't be messaged on any channel.",
            "count": no_contact, "action_label": "View guests",
            "action_url": f"/admin?event={event.id}&tab=guests",
        })

    if event.seating_enabled:
        table_rows = (await db.execute(
            select(SeatingTable.id, SeatingTable.capacity, func.count(Guest.id))
            .outerjoin(Guest, Guest.table_id == SeatingTable.id)
            .where(SeatingTable.event_id == event.id)
            .group_by(SeatingTable.id, SeatingTable.capacity)
        )).all()
        over_capacity = sum(1 for _id, capacity, seated in table_rows if capacity and seated > capacity)
        if over_capacity:
            alerts.append({
                "id": "tables_over_capacity", "type": "tables_over_capacity", "severity": "critical",
                "title": f"{over_capacity} table{'s' if over_capacity != 1 else ''} over capacity",
                "description": "More guests are assigned to these tables than they seat.",
                "count": over_capacity, "action_label": "Fix seating",
                "action_url": f"/admin?event={event.id}&tab=seating",
            })

    if event.message_credits <= 20:
        alerts.append({
            "id": "low_credits", "type": "low_credits", "severity": "warning",
            "title": "Message credits running low",
            "description": f"{event.message_credits} credits left.",
            "count": event.message_credits, "action_label": "Top up credits",
            "action_url": f"/admin?event={event.id}&tab=billing",
        })

    for z in await venue_occupancy(db, event):
        if z["capacity"] and z["capacity"] > 0:
            pct = z["occupancy"] / z["capacity"]
            if pct >= 0.9:
                alerts.append({
                    "id": f"zone_capacity_{z['id']}", "type": "zone_capacity",
                    "severity": "critical" if pct >= 1.0 else "warning",
                    "title": f"{z['name']} at {round(pct * 100)}% capacity",
                    "description": f"{z['occupancy']}/{z['capacity']} guests inside.",
                    "count": z["occupancy"], "action_label": "View room",
                    "action_url": f"/admin?event={event.id}&tab=access",
                })

    if event.menu_enabled:
        # Only meaningful when at least one category actually takes a selection —
        # an event with display-only (informational) categories only, e.g. one
        # that skips RSVP and just shows the week's menu, has nothing to "miss".
        selectable_cat_ids = set((await db.execute(
            select(MenuCategory.id).where(MenuCategory.event_id == event.id, MenuCategory.display_only.is_(False))
        )).scalars().all())
        # "Eligible" mirrors _expected_count: not declined, same definition used
        # for the Overview "Expected" card — NOT rsvp_status == "confirmed", which
        # is wrong for events that skip RSVP entirely (guests stay "invited" forever).
        expected_ids = set((await db.execute(
            select(Guest.id).where(Guest.event_id == event.id, Guest.rsvp_status != "declined")
        )).scalars().all()) if selectable_cat_ids else set()
        chosen_ids = set((await db.execute(
            select(GuestMenuChoice.guest_id).distinct()
            .where(GuestMenuChoice.category_id.in_(selectable_cat_ids))
        )).scalars().all()) if selectable_cat_ids else set()
        missing = len(expected_ids - chosen_ids)
        if missing:
            alerts.append({
                "id": "missing_meal_selections", "type": "missing_meal_selection", "severity": "warning",
                "title": f"{missing} meal selections missing",
                "description": "Invited guests (not declined) with no menu choice yet.",
                "count": missing, "action_label": "Resolve",
                "action_url": f"/admin?event={event.id}&tab=menu",
            })

    if event.experience_enabled:
        consent_step = await _consent_step(db, event.id)
        if consent_step:
            # Same "not declined" eligibility as the Overview "Expected" card —
            # see the meal-selection alert above for why this isn't "confirmed".
            eligible = await db.scalar(select(func.count()).select_from(Guest).where(
                Guest.event_id == event.id, Guest.rsvp_status != "declined")) or 0
            signed = await db.scalar(select(func.count()).select_from(GuestExperienceProgress).where(
                GuestExperienceProgress.step_id == consent_step.id,
                GuestExperienceProgress.status.in_(["completed", "overridden"]),
            )) or 0
            unsigned = max(eligible - signed, 0)
            if unsigned:
                alerts.append({
                    "id": "unsigned_consent", "type": "unsigned_consent", "severity": "warning",
                    "title": f"{unsigned} consent forms unsigned",
                    "description": "Invited guests (not declined) who haven't completed the consent step.",
                    "count": unsigned, "action_label": "Contact",
                    "action_url": f"/admin?event={event.id}&tab=experience",
                })

    denied = await db.scalar(select(func.count()).select_from(ScanEvent).where(
        ScanEvent.event_id == event.id, ScanEvent.denied.is_(True))) or 0
    if denied >= 5:
        alerts.append({
            "id": "denied_scans", "type": "denied_scans", "severity": "warning",
            "title": f"{denied} denied scans", "description": "Review denial reasons and gates.",
            "count": denied, "action_label": "View all",
            "action_url": f"/admin?event={event.id}&tab=access",
        })

    return alerts


# ── command-center composite endpoint ─────────────────────────────────────────

@app.get("/api/results/events/{event_id}/command-center")
async def command_center(
    day: str | None = Query(None),
    venue_id: str | None = Query(None),
    event: Event = Depends(admin_event),
    db: AsyncSession = Depends(get_db),
):
    scope = resolve_scope(event, day, None, None, venue_id)
    attendance = await attendance_stats(db, event, scope)
    sessions = await program_sessions(db, event)
    funnel = await experience_funnel(db, event)
    meal_cats = await meals_breakdown(db, event)
    return {
        "scope": attendance["scope"],
        "attendance": {k: v for k, v in attendance.items() if k != "scope"},
        "attendance_by_day": await attendance_by_day(db, event),
        "venue_occupancy": await venue_occupancy(db, event),
        "alerts": await build_alerts(db, event),
        # Real per-category fulfillment now that Track B (guest_meal_fulfillment)
        # has shipped; Overview gets the aggregate, the Meals tab gets the
        # per-category/per-day breakdown via /analytics/meals.
        "meals": {
            "categories": meal_cats,
            "eligible_total": sum(c["eligible"] for c in meal_cats),
            "served_total": sum(c["served"] for c in meal_cats),
        },
        # Overview-card-sized summaries; full detail lives behind /analytics/program
        # and /analytics/experience for the dedicated tabs.
        "program": {
            "in_progress": [s for s in sessions if s["state"] == "in_progress"],
            "in_progress_count": sum(1 for s in sessions if s["state"] == "in_progress"),
        },
        "experience": {"steps": funnel[:6]},
        "rsvp_funnel": await rsvp_funnel(db, event),
        "communication": await communication_health(db, event),
        "recent_activity": await recent_activity(db, event),
    }
