import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Guest, Event, User
from ..schemas import DashboardStats, GuestOut
from ..auth import require_admin, get_current_user, _ensure_firebase
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
async def event_stream(
    event_id: str,
    token: str = Query(..., description="Firebase ID token"),
    db: AsyncSession = Depends(get_db),
):
    # Verify token manually (EventSource can't send Authorization headers)
    import firebase_admin.auth as firebase_auth
    _ensure_firebase()
    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    from sqlalchemy import select as sa_select
    from ..models import EventUser
    email = (decoded.get("email") or "").lower()
    firebase_uid = decoded["uid"]

    from sqlalchemy import or_
    result = await db.execute(
        sa_select(User).where(
            or_(User.firebase_uid == firebase_uid, User.email == email)
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(403, "User not found")

    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    if user.role != "admin":
        assigned = await db.scalar(
            sa_select(EventUser).where(
                EventUser.event_id == event_id, EventUser.user_id == user.id
            )
        )
        if not assigned:
            raise HTTPException(403, "You are not assigned to this event")

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
