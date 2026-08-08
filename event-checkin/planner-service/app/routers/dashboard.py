"""Dashboard aggregation endpoint — rolls up budget, vendor, task, document,
and runsheet data into a single summary payload for the planner overview
page."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..auth import Identity, current_identity
from ..database import get_db

router = APIRouter(prefix="/api/planner", tags=["planner-dashboard"])


@router.get("/{event_id}/audit")
async def list_planner_audit(
    event_id: str, limit: int = 100,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    if identity.role not in ("owner", "admin"):
        raise HTTPException(403, "Planner administrator access is required")
    rows = (await db.execute(select(models.PlannerAuditEvent).where(
        models.PlannerAuditEvent.event_id == event_id,
    ).order_by(models.PlannerAuditEvent.created_at.desc()).limit(max(1, min(limit, 500))))).scalars().all()
    return [{
        "id": row.id, "actor": row.actor_email or row.actor_subject,
        "method": row.method, "path": row.path, "outcome": row.outcome,
        "status_code": row.status_code, "created_at": row.created_at,
    } for row in rows]


@router.get("/{event_id}/dashboard", response_model=schemas.DashboardOut)
async def get_dashboard(
    event_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> schemas.DashboardOut:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")

    today = date.today()
    week_out = today + timedelta(days=7)
    month_out = today + timedelta(days=30)

    # ── Budget totals ────────────────────────────────────────────────────
    budget = (await db.execute(
        select(models.PlannerBudget).where(models.PlannerBudget.event_id == event_id)
    )).scalar_one_or_none()

    if budget is None:
        currency = "USD"
        budget_total = 0.0
        budget_estimated = 0.0
        budget_actual = 0.0
    else:
        currency = budget.currency
        budget_total = float(budget.total_budget or 0)
        # `actual` is left un-coalesced so SUM stays NULL when no item has an
        # actual value recorded yet — distinguishable from a real $0 actual,
        # which a `coalesce(..., 0)` would otherwise silently mask. Mirrors
        # the None-based rollup in budget.py's own `_rollup()`.
        estimated_sum, actual_sum = (await db.execute(
            select(
                func.coalesce(func.sum(models.PlannerBudgetItem.estimated), 0),
                func.sum(models.PlannerBudgetItem.actual),
            )
            .select_from(models.PlannerBudgetItem)
            .join(
                models.PlannerBudgetCategory,
                models.PlannerBudgetCategory.id == models.PlannerBudgetItem.category_id,
            )
            .where(models.PlannerBudgetCategory.budget_id == budget.id)
        )).one()
        budget_estimated = float(estimated_sum)
        budget_actual = float(actual_sum) if actual_sum is not None else None
    budget_remaining = budget_total - (budget_actual if budget_actual is not None else budget_estimated)

    # ── Vendor counts by status ──────────────────────────────────────────
    vendor_rows = (await db.execute(
        select(models.PlannerVendor.status, func.count(models.PlannerVendor.id))
        .where(models.PlannerVendor.event_id == event_id, models.PlannerVendor.deleted_at.is_(None))
        .group_by(models.PlannerVendor.status)
    )).all()
    vendor_counts = {status: count for status, count in vendor_rows}

    # ── Tasks due this week / overdue ────────────────────────────────────
    tasks_due_this_week = (await db.execute(
        select(models.PlannerTask)
        .join(models.PlannerMilestone, models.PlannerMilestone.id == models.PlannerTask.milestone_id)
        .where(
            models.PlannerMilestone.event_id == event_id,
            models.PlannerTask.due_at.is_not(None),
            models.PlannerTask.due_at >= today,
            models.PlannerTask.due_at <= week_out,
            models.PlannerTask.status != "done",
        )
        .order_by(models.PlannerTask.due_at)
    )).scalars().all()

    overdue_tasks = (await db.execute(
        select(models.PlannerTask)
        .join(models.PlannerMilestone, models.PlannerMilestone.id == models.PlannerTask.milestone_id)
        .where(
            models.PlannerMilestone.event_id == event_id,
            models.PlannerTask.due_at.is_not(None),
            models.PlannerTask.due_at < today,
            models.PlannerTask.status != "done",
        )
        .order_by(models.PlannerTask.due_at)
    )).scalars().all()

    # ── Documents expiring soon ──────────────────────────────────────────
    documents_expiring_soon = (await db.execute(
        select(models.PlannerDocument).where(
            models.PlannerDocument.event_id == event_id,
            models.PlannerDocument.expires_at.is_not(None),
            models.PlannerDocument.expires_at >= today,
            models.PlannerDocument.expires_at <= month_out,
        ).order_by(models.PlannerDocument.expires_at)
    )).scalars().all()

    # ── Next runsheet item ───────────────────────────────────────────────
    next_runsheet_item = (await db.execute(
        select(models.PlannerRunsheetItem).where(
            models.PlannerRunsheetItem.event_id == event_id,
            models.PlannerRunsheetItem.status != "done",
        ).order_by(
            models.PlannerRunsheetItem.start_at.asc().nullslast(),
            models.PlannerRunsheetItem.start_time,
        ).limit(1)
    )).scalar_one_or_none()

    # ── Milestone progress ───────────────────────────────────────────────
    milestones_total = (await db.execute(
        select(func.count(models.PlannerMilestone.id)).where(models.PlannerMilestone.event_id == event_id)
    )).scalar_one()
    milestones_done = (await db.execute(
        select(func.count(models.PlannerMilestone.id)).where(
            models.PlannerMilestone.event_id == event_id, models.PlannerMilestone.status == "done",
        )
    )).scalar_one()

    return schemas.DashboardOut(
        role=identity.role,
        capabilities=list(identity.capabilities),
        budget_total=budget_total,
        budget_estimated=budget_estimated,
        budget_actual=budget_actual if budget_actual is not None else 0.0,
        budget_remaining=budget_remaining,
        currency=currency,
        vendor_counts=vendor_counts,
        tasks_due_this_week=[schemas.TaskOut.model_validate(t) for t in tasks_due_this_week],
        overdue_tasks=[schemas.TaskOut.model_validate(t) for t in overdue_tasks],
        documents_expiring_soon=[schemas.DocumentOut.model_validate(d) for d in documents_expiring_soon],
        next_runsheet_item=(
            schemas.RunsheetItemOut.model_validate(next_runsheet_item) if next_runsheet_item else None
        ),
        milestones_total=milestones_total,
        milestones_done=milestones_done,
    )
