"""Day-of runsheet: an ordered list of cues for the event day."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..auth import Identity, current_identity, ensure_capability
from ..database import get_db

router = APIRouter(prefix="/api/planner", tags=["planner-runsheet"])


async def _get_item(db: AsyncSession, event_id: str, item_id: str) -> models.PlannerRunsheetItem:
    item = (await db.execute(
        select(models.PlannerRunsheetItem).where(
            models.PlannerRunsheetItem.id == item_id, models.PlannerRunsheetItem.event_id == event_id,
        )
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, "Not found")
    return item


def _conflict_map(items: list[models.PlannerRunsheetItem]) -> dict[str, list[str]]:
    conflicts = {item.id: [] for item in items}
    scheduled = [item for item in items if item.start_at and item.end_at]
    for index, left in enumerate(scheduled):
        for right in scheduled[index + 1:]:
            overlaps = left.start_at < right.end_at and right.start_at < left.end_at
            same_owner = bool(left.owner and right.owner and left.owner.casefold() == right.owner.casefold())
            same_location = bool(left.location and right.location and left.location.casefold() == right.location.casefold())
            if overlaps and (same_owner or same_location):
                conflicts[left.id].append(right.id)
                conflicts[right.id].append(left.id)
    return conflicts


def _out(item: models.PlannerRunsheetItem, conflict_ids: list[str] | None = None) -> dict:
    return {
        column.name: getattr(item, column.name)
        for column in models.PlannerRunsheetItem.__table__.columns
    } | {"conflict_ids": conflict_ids or []}


async def _validate_dependency(
    db: AsyncSession, event_id: str, dependency_id: str | None, item_id: str | None = None,
) -> None:
    if not dependency_id:
        return
    if dependency_id == item_id:
        raise HTTPException(400, "A runsheet item cannot depend on itself")
    dependency = await _get_item(db, event_id, dependency_id)
    seen = {item_id} if item_id else set()
    while dependency.dependency_id:
        if dependency.dependency_id in seen:
            raise HTTPException(400, "Runsheet dependency cycle detected")
        seen.add(dependency.id)
        dependency = await _get_item(db, event_id, dependency.dependency_id)


@router.get("/{event_id}/runsheet", response_model=list[schemas.RunsheetItemOut])
async def list_runsheet(
    event_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    items = (await db.execute(
        select(models.PlannerRunsheetItem)
        .where(models.PlannerRunsheetItem.event_id == event_id)
        .order_by(models.PlannerRunsheetItem.start_at.asc().nullslast(), models.PlannerRunsheetItem.sort_order, models.PlannerRunsheetItem.start_time)
    )).scalars().all()
    conflicts = _conflict_map(items)
    return [_out(item, conflicts[item.id]) for item in items]


@router.post("/{event_id}/runsheet", response_model=schemas.RunsheetItemOut, status_code=201)
async def create_runsheet_item(
    event_id: str,
    payload: schemas.RunsheetItemIn,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "runsheet")
    data = payload.model_dump()
    await _validate_dependency(db, event_id, data.get("dependency_id"))
    if not data.get("sort_order"):
        max_sort = (await db.execute(
            select(func.max(models.PlannerRunsheetItem.sort_order)).where(
                models.PlannerRunsheetItem.event_id == event_id,
            )
        )).scalar_one()
        data["sort_order"] = (max_sort or 0) + 1
    item = models.PlannerRunsheetItem(event_id=event_id, **data)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _out(item)


# NOTE: /reorder must be declared before the /{item_id} routes below so
# FastAPI doesn't match "reorder" as an item_id path parameter.
@router.patch("/{event_id}/runsheet/reorder", response_model=list[schemas.RunsheetItemOut])
async def reorder_runsheet(
    event_id: str,
    payload: schemas.RunsheetReorderIn,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> list[models.PlannerRunsheetItem]:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "runsheet")
    ids = [entry.id for entry in payload.items]
    existing = (await db.execute(
        select(models.PlannerRunsheetItem).where(
            models.PlannerRunsheetItem.id.in_(ids), models.PlannerRunsheetItem.event_id == event_id,
        )
    )).scalars().all()
    existing_by_id = {item.id: item for item in existing}
    if len(existing_by_id) != len(ids):
        raise HTTPException(404, "Not found")
    for entry in payload.items:
        existing_by_id[entry.id].sort_order = entry.sort_order
    await db.commit()
    return (await db.execute(
        select(models.PlannerRunsheetItem)
        .where(models.PlannerRunsheetItem.event_id == event_id)
        .order_by(models.PlannerRunsheetItem.sort_order, models.PlannerRunsheetItem.start_time)
    )).scalars().all()


@router.patch("/{event_id}/runsheet/{item_id}", response_model=schemas.RunsheetItemOut)
async def update_runsheet_item(
    event_id: str,
    item_id: str,
    payload: schemas.RunsheetItemUpdate,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "runsheet")
    item = await _get_item(db, event_id, item_id)
    data = payload.model_dump(exclude_unset=True)
    supplied_version = data.pop("version", None)
    if supplied_version is not None and supplied_version != item.version:
        raise HTTPException(409, "This runsheet item changed. Refresh and try again.")
    await _validate_dependency(db, event_id, data.get("dependency_id"), item_id)
    candidate_start = data.get("start_at", item.start_at)
    candidate_end = data.get("end_at", item.end_at)
    if candidate_start and candidate_end and candidate_end <= candidate_start:
        raise HTTPException(400, "end_at must be later than start_at")
    for field, value in data.items():
        setattr(item, field, value)
    item.version += 1
    await db.commit()
    await db.refresh(item)
    return _out(item)


@router.delete("/{event_id}/runsheet/{item_id}", status_code=204)
async def delete_runsheet_item(
    event_id: str,
    item_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "runsheet")
    item = await _get_item(db, event_id, item_id)
    await db.delete(item)
    await db.commit()
