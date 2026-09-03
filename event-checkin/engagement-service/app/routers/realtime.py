import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Identity, current_identity, require_activity_session
from ..database import get_db
from ..realtime import claim_display, mint_realtime_ticket, redis, release_display, renew_display, verify_realtime_ticket
from ..metrics import REALTIME_CONNECTIONS
from ..models import LiveDisplay, WorkflowRun
from .activities import _fetch_activity
from .participate import _display_payload

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-realtime"])


async def _sse(channel: str | list[str], display_lease: tuple[str, str] | None = None):
    channels = [channel] if isinstance(channel, str) else channel
    pubsub = redis.pubsub()
    REALTIME_CONNECTIONS.inc()
    try:
        try:
            await pubsub.subscribe(*channels)
        except Exception:
            pass
        yield "event: ready\ndata: {}\n\n"
        while True:
            if display_lease and not await renew_display(*display_lease):
                return
            try:
                # A short heartbeat lets the ASGI server notice a closed
                # projector socket and release its exclusive display lease
                # promptly, without client-side polling.
                item = await pubsub.get_message(ignore_subscribe_messages=True, timeout=5)
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
        REALTIME_CONNECTIONS.dec()
        try:
            await pubsub.unsubscribe(*channels)
            await pubsub.aclose()
        except Exception:
            pass
        if display_lease:
            try:
                await release_display(*display_lease)
            except Exception:
                pass


@router.get("/activities/{activity_id}/realtime-ticket")
async def realtime_ticket(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Staff or guest — either way must be scoped to this activity's event.
    Returns a short-lived ticket for the ticket-only /stream endpoint below,
    since EventSource can't carry the normal Authorization bearer token."""
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Activity not found")
    require_activity_session(identity, activity.session_id, activity.config)
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
    await db.rollback()
    return StreamingResponse(
        _sse(f"engagement:activity:{activity_id}"),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/live/{display_code}/stream")
async def named_display_stream(display_code: str, token: str = Query(...), client_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    display = await db.scalar(select(LiveDisplay).where(
        LiveDisplay.display_code == display_code,
        LiveDisplay.access_token == token,
        LiveDisplay.status == "active",
    ))
    if not display:
        raise HTTPException(404, "Display not found")
    # AsyncSession.rollback() expires ORM attributes. Copy everything the
    # streaming response needs first so opening the generator cannot trigger
    # an async lazy load (MissingGreenlet) after the transaction is released.
    display_id = display.id
    assigned_activity_id = display.assigned_activity_id
    assigned_workflow_run_id = display.assigned_workflow_run_id
    try:
        claimed = await claim_display(display_id, client_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if not claimed:
        raise HTTPException(409, "This display already has a connected projector")
    channels = [f"engagement:display:{display_id}"]
    if assigned_activity_id:
        channels.append(f"engagement:activity:{assigned_activity_id}")
    if assigned_workflow_run_id:
        channels.append(f"engagement:workflow-run:{assigned_workflow_run_id}")
    await db.rollback()
    return StreamingResponse(
        _sse(channels, (display_id, client_id)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/live/{display_code}/lease", status_code=204)
async def release_named_display(display_code: str, token: str = Query(...), client_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    display = await db.scalar(select(LiveDisplay).where(
        LiveDisplay.display_code == display_code,
        LiveDisplay.access_token == token,
        LiveDisplay.status == "active",
    ))
    if not display:
        raise HTTPException(404, "Display not found")
    await release_display(display.id, client_id)
    return Response(status_code=204)


@router.get("/live-short/{short_code}/stream")
async def short_display_stream(short_code: str, client_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    display = await db.scalar(select(LiveDisplay).where(
        LiveDisplay.short_code == short_code,
        LiveDisplay.status == "active",
    ))
    if not display:
        raise HTTPException(404, "Display not found")
    display_id = display.id
    assigned_activity_id = display.assigned_activity_id
    assigned_workflow_run_id = display.assigned_workflow_run_id
    try:
        claimed = await claim_display(display_id, client_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if not claimed:
        raise HTTPException(409, "This display already has a connected projector")
    channels = [f"engagement:display:{display_id}"]
    if assigned_activity_id:
        channels.append(f"engagement:activity:{assigned_activity_id}")
    if assigned_workflow_run_id:
        channels.append(f"engagement:workflow-run:{assigned_workflow_run_id}")
    await db.rollback()
    return StreamingResponse(
        _sse(channels, (display_id, client_id)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/live-short/{short_code}/lease", status_code=204)
async def release_short_display(short_code: str, client_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    display = await db.scalar(select(LiveDisplay).where(
        LiveDisplay.short_code == short_code,
        LiveDisplay.status == "active",
    ))
    if not display:
        raise HTTPException(404, "Display not found")
    await release_display(display.id, client_id)
    return Response(status_code=204)


@router.get("/runs/{run_id}/stream")
async def workflow_run_stream(run_id: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Public display stream, protected by the run's high-entropy token."""
    run = await db.scalar(select(WorkflowRun).where(
        WorkflowRun.id == run_id, WorkflowRun.public_token == token,
    ))
    if not run:
        raise HTTPException(404, "Run not found")
    await db.rollback()
    return StreamingResponse(
        _sse(f"engagement:workflow-run:{run_id}"),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
