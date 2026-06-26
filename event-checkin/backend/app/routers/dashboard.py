import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Guest, Event, User, Zone, MenuCategory, SeatingTable
from ..schemas import DashboardStats, GuestOut, ZoneOccupancy, TableReport
from ..auth import require_dashboard_access, verify_token_user, user_has_dashboard_access
from .access import zone_occupancy
from . import sse_subscribers

router = APIRouter()


async def _count(db, *where):
    return await db.scalar(select(func.count()).select_from(Guest).where(*where)) or 0


@router.get("/{event_id}/dashboard", response_model=DashboardStats)
async def get_dashboard(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_dashboard_access)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    total = await _count(db, Guest.event_id == event_id)
    admitted_count = await _count(db, Guest.event_id == event_id, Guest.admitted == True)
    walk_in_count = await _count(db, Guest.event_id == event_id, Guest.is_walk_in == True)

    admitted_guests = (await db.execute(
        select(Guest).where(Guest.event_id == event_id, Guest.admitted == True)
        .order_by(Guest.admitted_at.desc())
    )).scalars().all()

    # RSVP breakdown
    rsvp_confirmed = await _count(db, Guest.event_id == event_id, Guest.rsvp_status == "confirmed")
    rsvp_declined = await _count(db, Guest.event_id == event_id, Guest.rsvp_status == "declined")
    rsvp_pending = await _count(db, Guest.event_id == event_id, Guest.rsvp_status == "pending")
    rsvp_invited = await _count(db, Guest.event_id == event_id, Guest.rsvp_status == "invited")

    # Venue-access live occupancy (only when enabled)
    zones: list[ZoneOccupancy] = []
    if event.venue_access_enabled:
        zrows = (await db.execute(
            select(Zone).where(Zone.event_id == event_id, Zone.is_active == True)
            .order_by(Zone.sort_order))).scalars().all()
        for z in zrows:
            zones.append(ZoneOccupancy(name=z.name, inside=await zone_occupancy(z.id, db), capacity=z.capacity))

    # Catering progress (only when menu enabled)
    catering_served = catering_total = None
    if event.menu_enabled:
        has_menu = await db.scalar(select(func.count()).select_from(MenuCategory).where(MenuCategory.event_id == event_id))
        if has_menu:
            catering_total = total
            catering_served = await _count(db, Guest.event_id == event_id, Guest.meal_served == True)

    # Per-table report (only when seating enabled) — helps table-assigned staff.
    tables: list[TableReport] = []
    if event.seating_enabled:
        trows = (await db.execute(
            select(SeatingTable).where(SeatingTable.event_id == event_id)
            .order_by(SeatingTable.name))).scalars().all()
        agg = {tid: (n, ci, sv) for tid, n, ci, sv in (await db.execute(
            select(
                Guest.table_id,
                func.count(Guest.id),
                func.count(Guest.id).filter(Guest.admitted.is_(True)),
                func.count(Guest.id).filter(Guest.meal_served.is_(True)),
            ).where(Guest.event_id == event_id, Guest.table_id.isnot(None))
            .group_by(Guest.table_id))).all()}
        for t in trows:
            n, ci, sv = agg.get(t.id, (0, 0, 0))
            tables.append(TableReport(name=t.name, capacity=t.capacity,
                                      seated=int(n), checked_in=int(ci), served=int(sv)))

    return DashboardStats(
        total=total, admitted=admitted_count, pending=total - admitted_count,
        walk_in=walk_in_count,
        admitted_guests=[GuestOut.model_validate(g) for g in admitted_guests],
        rsvp_confirmed=rsvp_confirmed, rsvp_declined=rsvp_declined,
        rsvp_pending=rsvp_pending, rsvp_invited=rsvp_invited,
        zones=zones, catering_served=catering_served, catering_total=catering_total,
        tables=tables,
    )


@router.get("/{event_id}/stream")
async def event_stream(
    event_id: str,
    token: str = Query(..., description="Firebase ID token (EventSource can't send auth headers)"),
    db: AsyncSession = Depends(get_db),
):
    # EventSource can't set an Authorization header, so the token comes as a query
    # param and is verified here (ported from prod a077c15, using main's
    # dashboard-access rule incl. grantable staff access).
    user = await verify_token_user(token, db)
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if not await user_has_dashboard_access(user, event, db):
        raise HTTPException(403, "You don't have dashboard access for this event.")

    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    if event_id not in sse_subscribers:
        sse_subscribers[event_id] = []
    sse_subscribers[event_id].append(queue)

    async def generate():
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                try:
                    event_data = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {json.dumps(event_data)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            subscribers = sse_subscribers.get(event_id, [])
            if queue in subscribers:
                subscribers.remove(queue)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
