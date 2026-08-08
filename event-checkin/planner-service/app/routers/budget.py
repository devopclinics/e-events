"""Budget: a single per-event budget envelope with categories and line items."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value

from .. import models, schemas
from ..auth import Identity, current_identity, ensure_capability
from ..database import get_db

router = APIRouter(prefix="/api/planner", tags=["planner-budget"])


async def _get_or_create_budget(db: AsyncSession, event_id: str, org_id: str) -> models.PlannerBudget:
    budget = (await db.execute(
        select(models.PlannerBudget)
        .options(selectinload(models.PlannerBudget.categories).selectinload(models.PlannerBudgetCategory.items))
        .where(models.PlannerBudget.event_id == event_id)
    )).scalar_one_or_none()
    if budget is None:
        budget = models.PlannerBudget(event_id=event_id, org_id=org_id)
        db.add(budget)
        await db.commit()
        budget = (await db.execute(
            select(models.PlannerBudget)
            .options(selectinload(models.PlannerBudget.categories).selectinload(models.PlannerBudgetCategory.items))
            .where(models.PlannerBudget.event_id == event_id)
        )).scalar_one()
    return budget


async def _get_category(db: AsyncSession, event_id: str, cat_id: str) -> models.PlannerBudgetCategory:
    category = (await db.execute(
        select(models.PlannerBudgetCategory)
        .options(selectinload(models.PlannerBudgetCategory.items))
        .join(models.PlannerBudget, models.PlannerBudget.id == models.PlannerBudgetCategory.budget_id)
        .where(models.PlannerBudgetCategory.id == cat_id, models.PlannerBudget.event_id == event_id)
    )).scalar_one_or_none()
    if category is None:
        raise HTTPException(404, "Not found")
    return category


async def _get_item(db: AsyncSession, event_id: str, item_id: str) -> models.PlannerBudgetItem:
    item = (await db.execute(
        select(models.PlannerBudgetItem)
        .join(models.PlannerBudgetCategory, models.PlannerBudgetCategory.id == models.PlannerBudgetItem.category_id)
        .join(models.PlannerBudget, models.PlannerBudget.id == models.PlannerBudgetCategory.budget_id)
        .where(models.PlannerBudgetItem.id == item_id, models.PlannerBudget.event_id == event_id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, "Not found")
    return item


def _rollup(budget: models.PlannerBudget) -> dict:
    total_allocated = sum(float(c.allocated or 0) for c in budget.categories)
    all_items = [item for c in budget.categories for item in c.items]
    total_estimated = sum(float(i.estimated or 0) for i in all_items)
    actual_values = [float(i.actual) for i in all_items if i.actual is not None]
    total_actual = sum(actual_values) if actual_values else None
    total_budget = float(budget.total_budget or 0)
    remaining = total_budget - (total_actual if total_actual is not None else total_estimated)
    return {
        "total_allocated": total_allocated,
        "total_estimated": total_estimated,
        "total_actual": total_actual if total_actual is not None else 0.0,
        "total_remaining": remaining,
    }


def _budget_out(budget: models.PlannerBudget) -> schemas.BudgetOut:
    return schemas.BudgetOut.model_validate(budget).model_copy(update=_rollup(budget))


@router.get("/{event_id}/budget", response_model=schemas.BudgetOut)
async def get_budget(
    event_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> schemas.BudgetOut:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    budget = await _get_or_create_budget(db, event_id, identity.org_id)
    return _budget_out(budget)


@router.post("/{event_id}/budget", response_model=schemas.BudgetOut)
async def update_budget(
    event_id: str,
    payload: schemas.BudgetIn,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> schemas.BudgetOut:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "budget")
    budget = await _get_or_create_budget(db, event_id, identity.org_id)
    budget.total_budget = payload.total_budget
    budget.currency = payload.currency
    budget.notes = payload.notes
    await db.commit()
    budget = await _get_or_create_budget(db, event_id, identity.org_id)
    return _budget_out(budget)


@router.get("/{event_id}/budget/categories", response_model=list[schemas.BudgetCategoryOut])
async def list_categories(
    event_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> list[models.PlannerBudgetCategory]:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    budget = await _get_or_create_budget(db, event_id, identity.org_id)
    return budget.categories


@router.post("/{event_id}/budget/categories", response_model=schemas.BudgetCategoryOut, status_code=201)
async def create_category(
    event_id: str,
    payload: schemas.BudgetCategoryIn,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerBudgetCategory:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "budget")
    budget = await _get_or_create_budget(db, event_id, identity.org_id)
    category = models.PlannerBudgetCategory(budget_id=budget.id, **payload.model_dump())
    db.add(category)
    await db.commit()
    await db.refresh(category)
    set_committed_value(category, "items", [])
    return category


@router.patch("/{event_id}/budget/categories/{cat_id}", response_model=schemas.BudgetCategoryOut)
async def update_category(
    event_id: str,
    cat_id: str,
    payload: schemas.BudgetCategoryUpdate,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerBudgetCategory:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "budget")
    category = await _get_category(db, event_id, cat_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    await db.commit()
    return await _get_category(db, event_id, cat_id)


@router.delete("/{event_id}/budget/categories/{cat_id}", status_code=204)
async def delete_category(
    event_id: str,
    cat_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "budget")
    category = await _get_category(db, event_id, cat_id)
    await db.delete(category)
    await db.commit()


@router.post("/{event_id}/budget/items", response_model=schemas.BudgetItemOut, status_code=201)
async def create_item(
    event_id: str,
    category_id: str,
    payload: schemas.BudgetItemIn,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerBudgetItem:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "budget")
    category = await _get_category(db, event_id, category_id)
    item = models.PlannerBudgetItem(category_id=category.id, **payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{event_id}/budget/items/{item_id}", response_model=schemas.BudgetItemOut)
async def update_item(
    event_id: str,
    item_id: str,
    payload: schemas.BudgetItemUpdate,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerBudgetItem:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "budget")
    item = await _get_item(db, event_id, item_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{event_id}/budget/items/{item_id}", status_code=204)
async def delete_item(
    event_id: str,
    item_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "budget")
    item = await _get_item(db, event_id, item_id)
    await db.delete(item)
    await db.commit()
