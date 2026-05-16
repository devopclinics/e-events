import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Guest, Event, User
from ..schemas import DashboardStats, GuestOut
from ..auth import require_admin
from . import sse_subscribers

router = APIRouter()


@router.get("/{event_id}/dashboard", response_model=DashboardStats)
async def get_dashboard(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    total = await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id == event_id))
    admitted_count = await db.scalar(
        select(func.count()).select_from(Guest).where(Guest.event_id == event_id, Guest.admitted == True)
    )

    result = await db.execute(
        select(Guest)
        .where(Guest.event_id == event_id, Guest.admitted == True)
        .order_by(Guest.admitted_at.desc())
    )
    admitted_guests = result.scalars().all()

    return DashboardStats(
        total=total or 0,
        admitted=admitted_count or 0,
        pending=(total or 0) - (admitted_count or 0),
        admitted_guests=[GuestOut.model_validate(g) for g in admitted_guests],
    )


@router.get("/{event_id}/stream")
async def event_stream(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
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
