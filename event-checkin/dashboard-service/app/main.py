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
    Event, ExperienceStep, ExperienceWorkflow, Guest, GuestExperienceProgress,
    GuestMenuChoice, MenuCategory, ScanEvent, User, Zone,
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


# ── operational alerts ────────────────────────────────────────────────────────

async def _consent_step(db: AsyncSession, event_id: str) -> ExperienceStep | None:
    wf = await db.scalar(select(ExperienceWorkflow).where(
        ExperienceWorkflow.event_id == event_id, ExperienceWorkflow.is_default.is_(True)))
    if not wf:
        return None
    return await db.scalar(select(ExperienceStep).where(
        ExperienceStep.workflow_id == wf.id, ExperienceStep.type == "consent", ExperienceStep.enabled.is_(True)))


async def build_alerts(db: AsyncSession, event: Event) -> list[dict]:
    alerts: list[dict] = []

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
        expected_ids = set((await db.execute(
            select(Guest.id).where(Guest.event_id == event.id, Guest.rsvp_status == "confirmed")
        )).scalars().all())
        chosen_ids = set((await db.execute(
            select(GuestMenuChoice.guest_id).distinct()
            .join(MenuCategory, MenuCategory.id == GuestMenuChoice.category_id)
            .where(MenuCategory.event_id == event.id, MenuCategory.display_only.is_(False))
        )).scalars().all())
        missing = len(expected_ids - chosen_ids)
        if missing:
            alerts.append({
                "id": "missing_meal_selections", "type": "missing_meal_selection", "severity": "warning",
                "title": f"{missing} meal selections missing",
                "description": "Confirmed guests with no menu choice yet.",
                "count": missing, "action_label": "Resolve",
                "action_url": f"/admin?event={event.id}&tab=menu",
            })

    if event.experience_enabled:
        consent_step = await _consent_step(db, event.id)
        if consent_step:
            confirmed = await db.scalar(select(func.count()).select_from(Guest).where(
                Guest.event_id == event.id, Guest.rsvp_status == "confirmed")) or 0
            signed = await db.scalar(select(func.count()).select_from(GuestExperienceProgress).where(
                GuestExperienceProgress.step_id == consent_step.id,
                GuestExperienceProgress.status.in_(["completed", "overridden"]),
            )) or 0
            unsigned = max(confirmed - signed, 0)
            if unsigned:
                alerts.append({
                    "id": "unsigned_consent", "type": "unsigned_consent", "severity": "warning",
                    "title": f"{unsigned} consent forms unsigned",
                    "description": "Confirmed guests who haven't completed the consent step.",
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
    return {
        "scope": attendance["scope"],
        "attendance": {k: v for k, v in attendance.items() if k != "scope"},
        "attendance_by_day": await attendance_by_day(db, event),
        "venue_occupancy": await venue_occupancy(db, event),
        "alerts": await build_alerts(db, event),
        # Coarse until Track B (guest_meal_fulfillment) ships — see the plan doc.
        "meals": {"served_total": await db.scalar(
            select(func.count()).select_from(Guest).where(Guest.event_id == event.id, Guest.meal_served.is_(True))
        ) or 0},
    }
