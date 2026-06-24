import asyncio
import json
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Guest, Event, User, SeatingTable
from ..schemas import DashboardStats, GuestOut, TableStat
from ..auth import require_admin, get_current_user, _ensure_firebase
from . import sse_subscribers

router = APIRouter()


@router.get("/{event_id}/dashboard", response_model=DashboardStats)
async def get_dashboard(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    all_guests = (await db.execute(
        select(Guest).where(Guest.event_id == event_id)
    )).scalars().all()

    total         = len(all_guests)
    admitted_list = [g for g in all_guests if g.admitted]
    admitted_count = len(admitted_list)

    # Sort admitted by time desc for the live feed
    admitted_list.sort(key=lambda g: g.admitted_at or datetime.min, reverse=True)

    last_admitted_at = admitted_list[0].admitted_at if admitted_list else None

    # Admission timeline — 15-min buckets over the last 2 hours
    now = datetime.utcnow()
    buckets: dict[int, int] = {i: 0 for i in range(8)}  # 0 = oldest, 7 = most recent
    for g in admitted_list:
        if g.admitted_at:
            mins_ago = (now - g.admitted_at).total_seconds() / 60
            if mins_ago <= 120:
                bucket = min(7, int(mins_ago // 15))
                buckets[7 - bucket] += 1  # flip so index 7 = now

    def bucket_label(i):
        mins = (7 - i) * 15
        if mins == 0:
            return "now"
        return f"{mins}m ago"

    admitted_timeline = [{"label": bucket_label(i), "count": buckets[i]} for i in range(8)]

    # ── seating stats ─────────────────────────────────────────────────────────
    tables_db = (await db.execute(
        select(SeatingTable).where(SeatingTable.event_id == event_id).order_by(SeatingTable.name)
    )).scalars().all()

    # index guests by table_id for O(1) lookup
    from collections import defaultdict
    guests_by_table: dict[str, list] = defaultdict(list)
    for g in all_guests:
        if g.table_id:
            guests_by_table[g.table_id].append(g)

    table_stats = []
    for t in tables_db:
        tguests = guests_by_table[t.id]
        table_stats.append(TableStat(
            id=t.id,
            name=t.name,
            capacity=t.capacity,
            assigned=len(tguests),
            seated=sum(1 for g in tguests if g.seat_number),
            admitted=sum(1 for g in tguests if g.admitted),
        ))

    total_seats   = sum(t.capacity for t in tables_db)
    seats_assigned = sum(ts.assigned for ts in table_stats)
    seats_seated   = sum(ts.seated   for ts in table_stats)

    return DashboardStats(
        total=total,
        admitted=admitted_count,
        pending=total - admitted_count,
        invited=sum(1 for g in all_guests if g.invite_sent_at),
        invite_failed=sum(1 for g in all_guests if g.invite_status == "failed"),
        no_qr=sum(1 for g in all_guests if not g.qr_generated_at),
        vip_total=sum(1 for g in all_guests if g.is_vip),
        vip_admitted=sum(1 for g in all_guests if g.is_vip and g.admitted),
        no_phone=sum(1 for g in all_guests if not g.phone),
        last_admitted_at=last_admitted_at,
        admitted_timeline=admitted_timeline,
        seating_enabled=event.seating_enabled,
        tables=table_stats,
        total_seats=total_seats,
        seats_assigned=seats_assigned,
        seats_seated=seats_seated,
        admitted_guests=[GuestOut.model_validate(g) for g in admitted_list],
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
