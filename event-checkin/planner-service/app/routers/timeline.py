"""Timeline: milestones and their tasks."""
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value

from .. import models, schemas
from ..auth import Identity, current_identity, ensure_capability
from ..database import get_db

router = APIRouter(prefix="/api/planner", tags=["planner-timeline"])
STARTER_MARKER = "festio-starter-plan:v1"


def _starter_sections(payload: schemas.StarterPlanIn):
    day = payload.event_date
    attendance = payload.attendance_mode
    launch_title = "Launch ticket sales" if attendance in {"ticketed", "hybrid"} else "Open invitations and RSVP"
    launch_link = "/ticketing-redesign" if attendance in {"ticketed", "hybrid"} else "/guests-redesign"
    guest_title = "Reconcile purchasers and guest access" if attendance == "ticketed" else "Confirm guest list and RSVP deadline"
    sections = [
        ("Foundation", day - timedelta(days=90), [
            ("Confirm event brief, venue and schedule", "/event-settings-redesign", "high"),
            ("Set the working budget and vendor categories", "/planner-redesign?tab=Budget", "normal"),
        ]),
        ("Guest launch", day - timedelta(days=60), [
            (launch_title, launch_link, "high"),
            (guest_title, "/guests-redesign", "high"),
        ]),
        ("Guest experience", day - timedelta(days=21), [
            ("Finalize seating and access rules", "/seating-redesign", "normal"),
            ("Finalize menu and catering counts", "/menu-redesign", "normal"),
            ("Publish the run of show", "/planner-redesign?tab=Run%20of%20show", "high"),
        ]),
        ("Event readiness", day - timedelta(days=3), [
            ("Test check-in devices and staff permissions", "/checkin-redesign", "high"),
            ("Run final guest and admission reconciliation", launch_link, "high"),
        ]),
    ]
    if attendance == "private":
        sections[1][2][0] = ("Confirm the private invite list", "/guests-redesign", "high")
    return sections


@router.post("/{event_id}/starter-plan", response_model=schemas.StarterPlanOut)
async def create_starter_plan(
    event_id: str,
    payload: schemas.StarterPlanIn,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> schemas.StarterPlanOut:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "tasks")
    existing = (await db.execute(select(models.PlannerMilestone).where(
        models.PlannerMilestone.event_id == event_id,
        models.PlannerMilestone.description.like(f"%{STARTER_MARKER}%"),
    ).limit(1))).scalar_one_or_none()
    if existing:
        return schemas.StarterPlanOut(created=False, milestones_created=0, tasks_created=0)
    task_count = 0
    for order, (title, due_at, tasks) in enumerate(_starter_sections(payload)):
        milestone = models.PlannerMilestone(
            event_id=event_id, title=title, due_at=due_at, sort_order=order,
            description=f"{STARTER_MARKER} · Generated for {payload.attendance_mode} attendance.",
        )
        db.add(milestone)
        await db.flush()
        for task_title, link, priority in tasks:
            db.add(models.PlannerTask(
                event_id=event_id, milestone_id=milestone.id, title=task_title,
                due_at=due_at, priority=priority,
                notes=f"Open the owning workspace: {link}",
            ))
            task_count += 1
    await db.commit()
    return schemas.StarterPlanOut(created=True, milestones_created=4, tasks_created=task_count)


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
