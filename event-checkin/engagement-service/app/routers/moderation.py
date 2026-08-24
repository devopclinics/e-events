from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Identity, current_identity, require_capability
from ..database import get_db
from ..models import ModerationItem
from ..realtime import publish
from ..schemas import ModerationDecisionIn, ModerationItemOut
from .activities import _fetch_activity

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-moderation"])


@router.get("/activities/{activity_id}/moderation", response_model=list[ModerationItemOut])
async def list_moderation_items(
    activity_id: str,
    status: str | None = Query(default=None, pattern="^(pending|approved|rejected)$"),
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
):
    require_capability(identity, "moderate")
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Activity not found")
    query = select(ModerationItem).where(ModerationItem.activity_id == activity_id)
    if status:
        query = query.where(ModerationItem.status == status)
    return (await db.execute(query.order_by(ModerationItem.created_at.desc()))).scalars().all()


@router.patch("/moderation/{item_id}", response_model=ModerationItemOut)
async def decide_moderation_item(
    item_id: str,
    body: ModerationDecisionIn,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
):
    require_capability(identity, "moderate")
    item = await db.get(ModerationItem, item_id)
    activity = await _fetch_activity(item.activity_id, db) if item else None
    if not item or not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Moderation item not found")
    item.status = body.status
    item.reviewed_by = identity.subject
    await db.commit()
    await db.refresh(item)
    await publish(item.activity_id, "moderation.changed", {"id": item.id, "status": item.status})
    return item
