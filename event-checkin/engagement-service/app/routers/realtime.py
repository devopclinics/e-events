import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Identity, current_identity
from ..database import get_db
from ..realtime import mint_realtime_ticket, redis, verify_realtime_ticket
from .activities import _fetch_activity
from .participate import _display_payload

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-realtime"])


async def _sse(channel: str):
    pubsub = redis.pubsub()
    await pubsub.subscribe(channel)
    try:
        yield "event: ready\ndata: {}\n\n"
        while True:
            try:
                item = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15)
            except Exception:
                # Redis unreachable mid-stream: keep the connection open with
                # keepalives rather than tearing it down — the client's next
                # manual refresh/poll still works against plain HTTP.
                item = None
            if item:
                payload = json.loads(item["data"])
                yield f"event: {payload['event']}\ndata: {json.dumps(payload['data'])}\n\n"
            else:
                yield ": keepalive\n\n"
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()


@router.get("/activities/{activity_id}/realtime-ticket")
async def realtime_ticket(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Staff or guest — either way must be scoped to this activity's event.
    Returns a short-lived ticket for the ticket-only /stream endpoint below,
    since EventSource can't carry the normal Authorization bearer token."""
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id:
        raise HTTPException(404, "Activity not found")
    return {"ticket": mint_realtime_ticket(activity_id, identity.subject), "expires_in": 180 * 60}


@router.get("/activities/{activity_id}/stream")
async def activity_stream(activity_id: str, ticket: str = Query(...)):
    try:
        verify_realtime_ticket(ticket, activity_id)
    except ValueError as exc:
        raise HTTPException(401, str(exc))
    return StreamingResponse(
        _sse(f"engagement:activity:{activity_id}"),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/activities/{activity_id}/display")
async def display_state(activity_id: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Unauthenticated except by the activity's own display_token — meant to
    be opened once on a TV/projector browser and left running for the whole
    event, so it deliberately doesn't expire like staff/guest tokens do."""
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.config.get("display_token") != token:
        raise HTTPException(404, "Activity not found")
    return await _display_payload(activity, db)


@router.get("/activities/{activity_id}/display-stream")
async def display_stream(activity_id: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.config.get("display_token") != token:
        raise HTTPException(404, "Activity not found")
    return StreamingResponse(
        _sse(f"engagement:activity:{activity_id}"),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
