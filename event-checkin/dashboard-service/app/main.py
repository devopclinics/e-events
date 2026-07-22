"""dashboard-service — read-only multi-day command-center analytics.

Reads the same Postgres database as `backend` (via the `dashboard_ro` role,
SELECT-only) and never writes guest data. See
docs/MULTI-DAY-DASHBOARD-IMPLEMENTATION-PLAN.md, Track A, for the design.
"""
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import current_user, require_dashboard_access
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


def utc_now_naive() -> datetime:
    """UTC now in the database's existing naive-UTC representation."""
    return datetime.now(UTC).replace(tzinfo=None)


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
    return await require_dashboard_access(event_id, user, db)


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


async def resolve_scope(
    db: AsyncSession, event: Event, day: str | None, start: str | None, end: str | None, venue_id: str | None,
) -> Scope:
    if day and (start or end):
        raise HTTPException(400, "Use either day or start/end, not both")
    if bool(start) != bool(end):
        raise HTTPException(400, "start and end must be provided together")
    if venue_id:
        if not event.venue_access_enabled:
            raise HTTPException(400, "This event doesn't have venue/zone tracking enabled")
        zone = await db.get(Zone, venue_id)
        if not zone or zone.event_id != event.id:
            raise HTTPException(404, "Venue/zone not found")

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
        if sd > ed:
            raise HTTPException(400, "start must be on or before end")
        if sd < entire_start_date or ed > entire_end_date:
            raise HTTPException(400, "start/end are outside the event's date range")
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


async def _distinct_guest_ids(
    db: AsyncSession, event_id: str, direction: str, start_at: datetime, end_at: datetime,
    zone_id: str | None = None,
) -> set[str]:
    where = [
        ScanEvent.event_id == event_id, ScanEvent.direction == direction,
        ScanEvent.denied.is_(False),
        ScanEvent.scanned_at >= start_at, ScanEvent.scanned_at < end_at,
    ]
    if zone_id:
        where.append(ScanEvent.zone_id == zone_id)
    rows = (await db.execute(select(ScanEvent.guest_id).distinct().where(*where))).scalars().all()
    return set(rows)


async def _first_scan_map(db: AsyncSession, event_id: str, zone_id: str | None = None) -> dict[str, datetime]:
    """Each guest's first-ever accepted entry scan, across the whole event
    (not scoped to `day`) — this is what makes a same-scope arrival
    "first-time" vs "returning". When `zone_id` is set, "first-time" means
    first time in THAT zone specifically, not the event overall."""
    where = [ScanEvent.event_id == event_id, ScanEvent.direction == "in", ScanEvent.denied.is_(False)]
    if zone_id:
        where.append(ScanEvent.zone_id == zone_id)
    rows = (await db.execute(
        select(ScanEvent.guest_id, func.min(ScanEvent.scanned_at)).where(*where).group_by(ScanEvent.guest_id)
    )).all()
    return {gid: first_at for gid, first_at in rows}


async def _legacy_admitted_map(
    db: AsyncSession, event_id: str, start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> dict[str, datetime]:
    """Legacy check-in stored only on Guest, before scan_events existed.

    Production contains valid admitted/admitted_at values for historical events
    whose scan ledger is empty. Keep those events visible without inventing
    return visits, exits, zones, or other detail that the legacy row cannot
    represent.
    """
    where = [
        Guest.event_id == event_id,
        Guest.admitted.is_(True),
        Guest.admitted_at.is_not(None),
    ]
    if start_at is not None:
        where.append(Guest.admitted_at >= start_at)
    if end_at is not None:
        where.append(Guest.admitted_at < end_at)
    rows = (await db.execute(select(Guest.id, Guest.admitted_at).where(*where))).all()
    return {guest_id: admitted_at for guest_id, admitted_at in rows}


async def _on_site_count(db: AsyncSession, event_id: str, cutoff: datetime, zone_id: str | None = None) -> int:
    """Guests whose latest accepted scan at/before `cutoff` is an entry —
    scoped to a single zone when `zone_id` is given (answers "who's
    currently inside this venue/zone", not the event as a whole)."""
    sub_where = [ScanEvent.event_id == event_id, ScanEvent.denied.is_(False), ScanEvent.scanned_at <= cutoff]
    if zone_id:
        sub_where.append(ScanEvent.zone_id == zone_id)
    sub = (
        select(ScanEvent.guest_id, func.max(ScanEvent.scanned_at).label("last_at"))
        .where(*sub_where).group_by(ScanEvent.guest_id).subquery()
    )
    join_on = (
        (ScanEvent.guest_id == sub.c.guest_id)
        & (ScanEvent.scanned_at == sub.c.last_at)
        & (ScanEvent.event_id == event_id)
    )
    if zone_id:
        join_on = join_on & (ScanEvent.zone_id == zone_id)
    cnt = await db.scalar(
        select(func.count(func.distinct(sub.c.guest_id)))
        .select_from(sub)
        .join(ScanEvent, join_on)
        .where(ScanEvent.direction == "in", ScanEvent.denied.is_(False))
    )
    return int(cnt or 0)


async def attendance_stats(db: AsyncSession, event: Event, scope: Scope) -> dict:
    zid = scope.venue_id
    expected = await _expected_count(db, event.id)
    checked_in_ids = await _distinct_guest_ids(db, event.id, "in", scope.start_at, scope.end_at, zid)
    checked_out_ids = await _distinct_guest_ids(db, event.id, "out", scope.start_at, scope.end_at, zid)
    first_at = await _first_scan_map(db, event.id, zid)
    has_scan_entries = bool(first_at)
    legacy_admitted: dict[str, datetime] = {}
    if not zid:
        # Entire-event legacy Results counted Guest.admitted regardless of the
        # event date configuration. Day scopes can only use admitted_at.
        legacy_admitted = await _legacy_admitted_map(
            db, event.id,
            None if scope.day is None else scope.start_at,
            None if scope.day is None else scope.end_at,
        )
        checked_in_ids.update(legacy_admitted)
        for guest_id, admitted_at in legacy_admitted.items():
            first_at.setdefault(guest_id, admitted_at)
    first_time_ids = {gid for gid in checked_in_ids if first_at.get(gid) and scope.start_at <= first_at[gid] < scope.end_at}
    returning_ids = checked_in_ids - first_time_ids

    # "On-site now" only means something in the present tense. A future scope
    # hasn't started (today's global occupancy would be a misleading answer to
    # "who's on-site on that future day"); a past scope gets occupancy AS OF
    # that period's close, not "now" — both explicitly labeled via
    # occupancy_mode/occupancy_as_of rather than one ambiguous number.
    now = utc_now_naive()
    if scope.start_at > now:
        occupancy_mode, occupancy_as_of, on_site = "future", None, None
    elif scope.end_at <= now:
        occupancy_mode = "historical"
        occupancy_as_of = scope.end_at
        on_site = await _on_site_count(db, event.id, scope.end_at, zid)
    else:
        occupancy_mode = "live"
        occupancy_as_of = now
        on_site = await _on_site_count(db, event.id, now, zid)
    # With no scan ledger, the only honest legacy approximation is admitted
    # guests. Do not apply this to zones, where Guest has no location history.
    if not zid and legacy_admitted and not has_scan_entries and occupancy_mode != "future":
        on_site = len(legacy_admitted)

    declined = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.rsvp_status == "declined")) or 0
    confirmed_ids = set((await db.execute(select(Guest.id).where(
        Guest.event_id == event.id, Guest.rsvp_status == "confirmed"))).scalars().all())
    arrival_gap_mode = "confirmed" if confirmed_ids else "expected"
    confirmed_not_here = (
        len(confirmed_ids - checked_in_ids)
        if confirmed_ids else max(expected - len(checked_in_ids), 0)
    )
    walk_in_ids = set((await db.execute(select(Guest.id).where(
        Guest.event_id == event.id, Guest.is_walk_in.is_(True)))).scalars().all())
    walk_ins = len(walk_in_ids & checked_in_ids)

    tz = event_tz(event)
    hourly_where = [
        ScanEvent.event_id == event.id, ScanEvent.denied.is_(False),
        ScanEvent.scanned_at >= scope.start_at, ScanEvent.scanned_at < scope.end_at,
    ]
    if zid:
        hourly_where.append(ScanEvent.zone_id == zid)
    rows = (await db.execute(
        select(ScanEvent.guest_id, ScanEvent.direction, ScanEvent.scanned_at)
        .where(*hourly_where)
        .order_by(ScanEvent.scanned_at)
    )).all()
    scanned_entry_ids = {gid for gid, direction, _ts in rows if direction == "in"}
    for guest_id, admitted_at in legacy_admitted.items():
        if guest_id not in scanned_entry_ids and scope.start_at <= admitted_at < scope.end_at:
            rows.append((guest_id, "in", admitted_at))
    rows.sort(key=lambda row: row[2])
    hourly: dict[str, dict[str, int]] = defaultdict(lambda: {"first_arrival": 0, "returning": 0, "exit": 0})
    for gid, direction, ts in rows:
        local = to_event_local(ts, tz)
        bucket = local.strftime("%H:00")
        if direction == "in":
            hourly[bucket]["first_arrival" if first_at.get(gid) == ts else "returning"] += 1
        else:
            hourly[bucket]["exit"] += 1

    return {
        "scope": {"start_at": scope.start_at.isoformat() + "Z", "end_at": scope.end_at.isoformat() + "Z", "timezone": scope.timezone, "venue_id": scope.venue_id},
        "expected": expected,
        "checked_in": len(checked_in_ids),
        "on_site": on_site,
        "occupancy_mode": occupancy_mode,
        "occupancy_as_of": occupancy_as_of.isoformat() + "Z" if occupancy_as_of else None,
        "first_time": len(first_time_ids),
        "returning": len(returning_ids),
        "checked_out": len(checked_out_ids),
        "declined": declined,
        "confirmed_not_here": confirmed_not_here,
        "arrival_gap_mode": arrival_gap_mode,
        "walk_ins": walk_ins,
        "hourly": [{"hour": h, **v} for h, v in sorted(hourly.items())],
    }


async def attendance_by_day(db: AsyncSession, event: Event) -> list[dict]:
    tz = event_tz(event)
    expected = await _expected_count(db, event.id)
    now = utc_now_naive()
    out = []
    for d in _event_days(event):
        local_start = _local_midnight(d, tz)
        local_end = local_start + timedelta(days=1)
        start_at, end_at = to_utc_naive(local_start), to_utc_naive(local_end)
        # Bug fixed: this used to check `end_at > now`, which is true for
        # TODAY too (today's midnight-tomorrow is still in the future) — so
        # the current, currently-live day was mislabeled "upcoming" and its
        # attendance hidden. "upcoming" now means "hasn't started yet".
        if start_at > now:
            status = "upcoming"
        elif end_at <= now:
            status = "past"
        else:
            status = "live"
        if status == "upcoming":
            checked_in = 0
        else:
            checked_ids = await _distinct_guest_ids(db, event.id, "in", start_at, end_at)
            checked_ids.update(await _legacy_admitted_map(db, event.id, start_at, end_at))
            checked_in = len(checked_ids)
        out.append({
            "day": d.isoformat(),
            "expected": expected,
            "checked_in": checked_in,
            "attendance_rate": round(checked_in / expected * 100) if expected else 0,
            "status": status,
            "upcoming": status == "upcoming",  # back-compat for the current frontend
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
    scope = await resolve_scope(db, event, day, start, end, venue_id)
    stats = await attendance_stats(db, event, scope)
    stats["by_day"] = await attendance_by_day(db, event)
    return stats


# ── venue occupancy (reuse the same logic as backend/app/routers/access.py) ──

async def venue_occupancy(db: AsyncSession, event: Event, zone_id: str | None = None) -> list[dict]:
    """Occupancy = accepted ins minus accepted outs per zone — matches
    backend/app/routers/access.py::zone_occupancy's exact semantics
    intentionally, even though it's fragile to duplicate scans (a double
    entry-scan inflates occupancy, a double exit-scan can mask it): diverging
    only here would make the same zone show two different numbers between
    the legacy Venue Access page and this one. Fix both together if this
    changes. One grouped query for all zones instead of 2 queries per zone."""
    if not event.venue_access_enabled:
        return []
    zone_where = [Zone.event_id == event.id, Zone.is_active.is_(True)]
    if zone_id:
        zone_where.append(Zone.id == zone_id)
    zones = (await db.execute(
        select(Zone).where(*zone_where).order_by(Zone.sort_order)
    )).scalars().all()
    if not zones:
        return []
    zone_ids = [z.id for z in zones]
    counts = (await db.execute(
        select(ScanEvent.zone_id, ScanEvent.direction, func.count())
        .where(ScanEvent.zone_id.in_(zone_ids), ScanEvent.denied.is_(False))
        .group_by(ScanEvent.zone_id, ScanEvent.direction)
    )).all()
    ins: dict[str, int] = defaultdict(int)
    outs: dict[str, int] = defaultdict(int)
    for zid, direction, cnt in counts:
        (ins if direction == "in" else outs)[zid] = cnt
    return [
        {"id": z.id, "name": z.name, "occupancy": max(ins.get(z.id, 0) - outs.get(z.id, 0), 0), "capacity": z.capacity}
        for z in zones
    ]


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


def _parse_session_dt(session: dict, time_key: str, tz) -> datetime | None:
    """Session date/time is entered in the organizer's event-local time (e.g.
    "10:00" means 10am Chicago, not 10am UTC) — parse naive, attach the
    event's tz, then convert to naive UTC so it's comparable with
    datetime.utcnow(). Previously this compared naive-local against naive-UTC
    directly, so a session could show "in progress" hours off from reality."""
    d = str(session.get("date") or "").strip()
    t = str(session.get(time_key) or "").strip()
    if not d or not t:
        return None
    try:
        naive_local = datetime.fromisoformat(f"{d}T{t}")
    except ValueError:
        return None
    return to_utc_naive(naive_local.replace(tzinfo=tz))


async def _default_workflow(db: AsyncSession, event_id: str) -> ExperienceWorkflow | None:
    """Mirrors backend/app/services/experience.py::active_workflow — the
    runtime workflow real guest progress uses. Previously this just grabbed
    is_default=True unconditionally, which could surface a draft/archived
    default's stats in Results even when a newer published version (or none
    at all) is what's actually governing guest behavior."""
    return await db.scalar(
        select(ExperienceWorkflow)
        .where(ExperienceWorkflow.event_id == event_id, ExperienceWorkflow.status == "published")
        .order_by(ExperienceWorkflow.version.desc(), ExperienceWorkflow.created_at.desc())
        .limit(1)
    )


async def program_sessions(db: AsyncSession, event: Event, day: str | None = None) -> list[dict]:
    if not event.experience_enabled:
        return []
    wf = await _default_workflow(db, event.id)
    if not wf:
        return []
    steps = (await db.execute(select(ExperienceStep).where(
        ExperienceStep.workflow_id == wf.id, ExperienceStep.type == "session_attendance",
        ExperienceStep.enabled.is_(True),
    ).order_by(ExperienceStep.sort_order))).scalars().all()
    if not steps:
        return []
    if day:
        # Session config's own "date" string (YYYY-MM-DD, event-local) is
        # already in the same format the day-scope selector uses — filter on
        # it directly rather than converting start_at back to a local date.
        steps = [s for s in steps if str((_session_config(s).get("date") or "")) == day]
        if not steps:
            return []
    step_ids = [s.id for s in steps]

    # Grouped queries instead of 2-per-session (N+1).
    registered_by_step: dict[str, int] = dict((await db.execute(
        select(GuestExperienceProgress.step_id, func.count())
        .where(GuestExperienceProgress.step_id.in_(step_ids)).group_by(GuestExperienceProgress.step_id)
    )).all())
    attended_by_step: dict[str, int] = dict((await db.execute(
        select(GuestExperienceProgress.step_id, func.count())
        .where(GuestExperienceProgress.step_id.in_(step_ids),
               GuestExperienceProgress.status.in_(["completed", "overridden"]))
        .group_by(GuestExperienceProgress.step_id)
    )).all())

    tz = event_tz(event)
    now = utc_now_naive()
    out = []
    for step in steps:
        session = _session_config(step)
        start = _parse_session_dt(session, "start_time", tz)
        end = _parse_session_dt(session, "end_time", tz)
        # "Registered" = every guest with a progress row for this step (workflow
        # assignment creates one per eligible guest); "attended" = actually
        # checked into the session. Approximate — see plan doc Track A/A3.
        attended = attended_by_step.get(step.id, 0)
        registered = registered_by_step.get(step.id, 0)
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
async def get_program(
    day: str | None = Query(None), event: Event = Depends(admin_event), db: AsyncSession = Depends(get_db),
):
    sessions = await program_sessions(db, event, day)
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
    if not steps:
        return []
    step_ids = [s.id for s in steps]

    # One grouped query per status bucket instead of 3-per-step (N+1).
    total_by_step: dict[str, int] = dict((await db.execute(
        select(GuestExperienceProgress.step_id, func.count())
        .where(GuestExperienceProgress.step_id.in_(step_ids)).group_by(GuestExperienceProgress.step_id)
    )).all())
    completed_by_step: dict[str, int] = dict((await db.execute(
        select(GuestExperienceProgress.step_id, func.count())
        .where(GuestExperienceProgress.step_id.in_(step_ids),
               GuestExperienceProgress.status.in_(["completed", "overridden"]))
        .group_by(GuestExperienceProgress.step_id)
    )).all())
    failed_by_step: dict[str, int] = dict((await db.execute(
        select(GuestExperienceProgress.step_id, func.count())
        .where(GuestExperienceProgress.step_id.in_(step_ids), GuestExperienceProgress.status == "failed")
        .group_by(GuestExperienceProgress.step_id)
    )).all())

    return [
        {
            "step_id": step.id, "title": step.title, "type": step.type, "required": step.required,
            "total": total_by_step.get(step.id, 0),
            "completed": completed_by_step.get(step.id, 0),
            "failed": failed_by_step.get(step.id, 0),
        }
        for step in steps
    ]


@app.get("/api/results/events/{event_id}/analytics/experience")
async def get_experience(event: Event = Depends(admin_event), db: AsyncSession = Depends(get_db)):
    return {"steps": await experience_funnel(db, event)}


# ── RSVP funnel ────────────────────────────────────────────────────────────────

async def rsvp_funnel(db: AsyncSession, event: Event) -> dict:
    # "guests" = every guest record, regardless of invite/RSVP state — NOT
    # "invited". "invited" is guests an invite actually went out to
    # (invite_status == "sent"); conflating the two previously mislabeled the
    # whole-guest-list count as "Total invitations sent".
    guests = await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id == event.id)) or 0
    invited = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.invite_status == "sent")) or 0
    confirmed = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.rsvp_status == "confirmed")) or 0
    declined = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.rsvp_status == "declined")) or 0
    pending = await db.scalar(select(func.count()).select_from(Guest).where(
        Guest.event_id == event.id, Guest.rsvp_status == "pending")) or 0
    checked_in = await db.scalar(select(func.count(func.distinct(ScanEvent.guest_id))).where(
        ScanEvent.event_id == event.id, ScanEvent.direction == "in", ScanEvent.denied.is_(False))) or 0
    return {
        "guests": guests,
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
    # Only count confirmed-delivered outcomes as "reached" — "sent"/"delayed"/
    # an unrecognized provider status is still in flight, not confirmed
    # reached, so it must not count toward the rate as if it had arrived.
    reached_statuses = {"delivered", "opened", "clicked"}
    email_sent = len(latest_by_email)
    email_reached = sum(1 for s in latest_by_email.values() if s in reached_statuses)

    return {
        "email": {"sent": email_sent, "reached": email_reached,
                   "rate": round(email_reached / email_sent * 100) if email_sent else None},
        "sms": sms_rate,
        "whatsapp": whatsapp_rate,
        "credits_remaining": event.message_credits,
    }


# ── recent activity feed ──────────────────────────────────────────────────────

async def recent_activity(db: AsyncSession, event: Event, scope: "Scope | None" = None, limit: int = 15) -> list[dict]:
    where = [ScanEvent.event_id == event.id, ScanEvent.denied.is_(False)]
    # Day/venue scoped when a scope is given (this feed genuinely has a time
    # dimension, unlike RSVP/communication/meals-category data) — see review
    # notes on day scope not propagating past the Attendance tab.
    if scope is not None:
        if scope.day:
            where += [ScanEvent.scanned_at >= scope.start_at, ScanEvent.scanned_at < scope.end_at]
        if scope.venue_id:
            where.append(ScanEvent.zone_id == scope.venue_id)
    rows = (await db.execute(
        select(ScanEvent, Guest.first_name, Guest.last_name, Guest.is_walk_in, Zone.name)
        .join(Guest, Guest.id == ScanEvent.guest_id)
        .outerjoin(Zone, Zone.id == ScanEvent.zone_id)
        .where(*where)
        .order_by(ScanEvent.scanned_at.desc())
        .limit(limit)
    )).all()
    # Historical production events may predate scan_events while still having
    # authoritative Guest.admitted/admitted_at values used by legacy Results.
    # Fall back only when the scan query is empty and never for a zone scope.
    if not rows and not (scope and scope.venue_id):
        guest_where = [
            Guest.event_id == event.id,
            Guest.admitted.is_(True),
            Guest.admitted_at.is_not(None),
        ]
        if scope and scope.day:
            guest_where += [Guest.admitted_at >= scope.start_at, Guest.admitted_at < scope.end_at]
        legacy_rows = (await db.execute(
            select(Guest.first_name, Guest.last_name, Guest.is_walk_in, Guest.admitted_at)
            .where(*guest_where)
            .order_by(Guest.admitted_at.desc())
            .limit(limit)
        )).all()
        return [{
            "guest_name": f"{first_name} {last_name}".strip(),
            "action": "Walk-in added" if is_walk_in else "Guest checked in",
            "location": None,
            "at": admitted_at.isoformat() + "Z",
        } for first_name, last_name, is_walk_in, admitted_at in legacy_rows]
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

async def meals_breakdown(db: AsyncSession, event: Event) -> dict:
    """Per-category eligible/served/remaining, PLUS distinct-guest totals —
    NOT a sum of the per-category numbers. A guest eligible for breakfast,
    lunch, and dinner is one guest, not three; summing counted them three
    times, so the headline was really "meal entitlements", not "guests"."""
    if not event.menu_enabled:
        return {"categories": [], "eligible_guests": 0, "served_guests": 0, "missing_selection": 0}
    cat_ids = (await db.execute(
        select(MenuCategory.id).where(MenuCategory.event_id == event.id, MenuCategory.display_only.is_(False))
    )).scalars().all()
    if not cat_ids:
        return {"categories": [], "eligible_guests": 0, "served_guests": 0, "missing_selection": 0}

    cats = (await db.execute(
        select(MenuCategory).where(MenuCategory.id.in_(cat_ids)).order_by(MenuCategory.sort_order)
    )).scalars().all()
    # One grouped query instead of one per category (N+1) — see review notes
    # on dashboard-service's query pattern.
    eligible_by_cat: dict[str, int] = dict((await db.execute(
        select(GuestMenuChoice.category_id, func.count(func.distinct(GuestMenuChoice.guest_id)))
        .where(GuestMenuChoice.category_id.in_(cat_ids)).group_by(GuestMenuChoice.category_id)
    )).all())
    served_by_cat: dict[str, int] = dict((await db.execute(
        select(GuestMealFulfillment.category_id, func.count())
        .where(GuestMealFulfillment.category_id.in_(cat_ids), GuestMealFulfillment.status == "served")
        .group_by(GuestMealFulfillment.category_id)
    )).all())

    categories = []
    for cat in cats:
        eligible = eligible_by_cat.get(cat.id, 0)
        served = served_by_cat.get(cat.id, 0)
        categories.append({
            "category_id": cat.id, "name": cat.name, "day_label": cat.day_label,
            "eligible": eligible, "served": served, "remaining": max(eligible - served, 0),
            "rate": round(served / eligible * 100) if eligible else 0,
        })

    eligible_guests = await db.scalar(select(func.count(func.distinct(GuestMenuChoice.guest_id))).where(
        GuestMenuChoice.category_id.in_(cat_ids))) or 0
    served_guests = await db.scalar(select(func.count(func.distinct(GuestMealFulfillment.guest_id))).where(
        GuestMealFulfillment.category_id.in_(cat_ids), GuestMealFulfillment.status == "served")) or 0

    # "eligible" above is choice-based (a guest who never made a selection is
    # otherwise invisible to this metric entirely) — surface that gap
    # explicitly rather than silently excluding those guests from the
    # picture. Same "not declined" definition already used by the
    # missing_meal_selection alert, kept consistent with it here.
    not_declined = set((await db.execute(select(Guest.id).where(
        Guest.event_id == event.id, Guest.rsvp_status != "declined"))).scalars().all())
    chosen_ids = set((await db.execute(select(GuestMenuChoice.guest_id).distinct().where(
        GuestMenuChoice.category_id.in_(cat_ids)))).scalars().all())
    missing_selection = len(not_declined - chosen_ids)

    return {
        "categories": categories, "eligible_guests": eligible_guests,
        "served_guests": served_guests, "missing_selection": missing_selection,
    }


@app.get("/api/results/events/{event_id}/analytics/meals")
async def get_meals(event: Event = Depends(admin_event), db: AsyncSession = Depends(get_db)):
    breakdown = await meals_breakdown(db, event)
    return {
        "categories": breakdown["categories"],
        "eligible_total": breakdown["eligible_guests"],
        "served_total": breakdown["served_guests"],
        "missing_selection": breakdown["missing_selection"],
    }


# ── operational alerts ────────────────────────────────────────────────────────

async def _consent_step(db: AsyncSession, event_id: str) -> ExperienceStep | None:
    wf = await _default_workflow(db, event_id)
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
    breakdown = await meals_breakdown(db, event)
    return {
        "meals": {"categories": breakdown["categories"],
                  "eligible_total": breakdown["eligible_guests"],
                  "served_total": breakdown["served_guests"],
                  "missing_selection": breakdown["missing_selection"]},
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
    scope = await resolve_scope(db, event, day, None, None, venue_id)
    attendance = await attendance_stats(db, event, scope)
    sessions = await program_sessions(db, event, day)
    funnel = await experience_funnel(db, event)
    meals = await meals_breakdown(db, event)
    return {
        "scope": attendance["scope"],
        "attendance": {k: v for k, v in attendance.items() if k != "scope"},
        "attendance_by_day": await attendance_by_day(db, event),
        "venue_occupancy": await venue_occupancy(db, event, scope.venue_id),
        "alerts": await build_alerts(db, event),
        # Real per-category fulfillment now that Track B (guest_meal_fulfillment)
        # has shipped; Overview gets the distinct-guest aggregate (not a sum of
        # per-category counts — see meals_breakdown), Meals tab gets the
        # per-category/per-day breakdown via /analytics/meals.
        "meals": {
            "categories": meals["categories"],
            "eligible_total": meals["eligible_guests"],
            "served_total": meals["served_guests"],
            "missing_selection": meals["missing_selection"],
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
        "recent_activity": await recent_activity(db, event, scope),
        # Which sections actually change with the day/venue selector, so the
        # frontend can label the rest "Entire event" instead of silently
        # implying everything scoped when only some of it does.
        "day_scoped_sections": ["attendance", "attendance_by_day", "program", "recent_activity"],
        "venue_scoped_sections": ["attendance", "venue_occupancy", "recent_activity"],
    }
