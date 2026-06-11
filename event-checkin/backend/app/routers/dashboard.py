import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Guest, Event, User, Zone, MenuCategory
from ..schemas import DashboardStats, GuestOut, ZoneOccupancy
from ..auth import require_dashboard_access
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

    return DashboardStats(
        total=total, admitted=admitted_count, pending=total - admitted_count,
        admitted_guests=[GuestOut.model_validate(g) for g in admitted_guests],
        rsvp_confirmed=rsvp_confirmed, rsvp_declined=rsvp_declined,
        rsvp_pending=rsvp_pending, rsvp_invited=rsvp_invited,
        zones=zones, catering_served=catering_served, catering_total=catering_total,
    )


@router.get("/{event_id}/stream")
async def event_stream(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_dashboard_access)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

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
