"""Timeline: milestones and their tasks."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value

from .. import models, schemas
from ..auth import Identity, current_identity, ensure_capability
from ..database import get_db

router = APIRouter(prefix="/api/planner", tags=["planner-timeline"])


async def _get_milestone(db: AsyncSession, event_id: str, ms_id: str) -> models.PlannerMilestone:
    milestone = (await db.execute(
        select(models.PlannerMilestone)
        .options(selectinload(models.PlannerMilestone.tasks))
        .where(models.PlannerMilestone.id == ms_id, models.PlannerMilestone.event_id == event_id)
    )).scalar_one_or_none()
    if milestone is None:
        raise HTTPException(404, "Not found")
    return milestone


async def _get_task(db: AsyncSession, event_id: str, task_id: str) -> models.PlannerTask:
    task = (await db.execute(
        select(models.PlannerTask).where(
            models.PlannerTask.id == task_id, models.PlannerTask.event_id == event_id,
        )
    )).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "Not found")
    return task


def _milestone_out(milestone: models.PlannerMilestone) -> schemas.MilestoneOut:
    total = len(milestone.tasks)
    done = sum(1 for t in milestone.tasks if t.status == "done")
    pct = round(100 * done / total) if total else 0
    return schemas.MilestoneOut.model_validate(milestone).model_copy(update={"completion_pct": pct})


@router.get("/{event_id}/milestones", response_model=list[schemas.MilestoneOut])
async def list_milestones(
    event_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> list[schemas.MilestoneOut]:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    milestones = (await db.execute(
        select(models.PlannerMilestone)
        .options(selectinload(models.PlannerMilestone.tasks))
        .where(models.PlannerMilestone.event_id == event_id)
        .order_by(models.PlannerMilestone.sort_order)
    )).scalars().all()
    return [_milestone_out(m) for m in milestones]


@router.post("/{event_id}/milestones", response_model=schemas.MilestoneOut, status_code=201)
async def create_milestone(
    event_id: str,
    payload: schemas.MilestoneIn,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> schemas.MilestoneOut:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "tasks")
    milestone = models.PlannerMilestone(event_id=event_id, **payload.model_dump())
    db.add(milestone)
    await db.commit()
    await db.refresh(milestone)
    set_committed_value(milestone, "tasks", [])
    return _milestone_out(milestone)


@router.patch("/{event_id}/milestones/{ms_id}", response_model=schemas.MilestoneOut)
async def update_milestone(
    event_id: str,
    ms_id: str,
    payload: schemas.MilestoneUpdate,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> schemas.MilestoneOut:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "tasks")
    milestone = await _get_milestone(db, event_id, ms_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(milestone, field, value)
    await db.commit()
    milestone = await _get_milestone(db, event_id, ms_id)
    return _milestone_out(milestone)


@router.delete("/{event_id}/milestones/{ms_id}", status_code=204)
async def delete_milestone(
    event_id: str,
    ms_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "tasks")
    milestone = await _get_milestone(db, event_id, ms_id)
    await db.delete(milestone)
    await db.commit()


@router.post("/{event_id}/tasks", response_model=schemas.TaskOut, status_code=201)
async def create_task(
    event_id: str,
    payload: schemas.TaskIn,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerTask:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "tasks")
    milestone = (await db.execute(
        select(models.PlannerMilestone).where(
            models.PlannerMilestone.id == payload.milestone_id,
            models.PlannerMilestone.event_id == event_id,
        )
    )).scalar_one_or_none()
    if milestone is None:
        raise HTTPException(404, "Not found")
    task = models.PlannerTask(event_id=event_id, **payload.model_dump())
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


@router.patch("/{event_id}/tasks/{task_id}", response_model=schemas.TaskOut)
async def update_task(
    event_id: str,
    task_id: str,
    payload: schemas.TaskUpdate,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerTask:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "tasks")
    task = await _get_task(db, event_id, task_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    await db.commit()
    await db.refresh(task)
    return task


@router.delete("/{event_id}/tasks/{task_id}", status_code=204)
async def delete_task(
    event_id: str,
    task_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "tasks")
    task = await _get_task(db, event_id, task_id)
    await db.delete(task)
    await db.commit()
