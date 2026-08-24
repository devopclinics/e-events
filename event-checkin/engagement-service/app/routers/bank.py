from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import Identity, current_identity, require_admin, require_staff
from ..database import get_db
from ..models import ActivityQuestion, EngagementActivity, QuestionBankItem, QuestionOption
from ..schemas import BankImportIn, BankItemCreate, BankItemOut, BankItemUpdate, QuestionOut

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-question-bank"])


@router.get("/question-bank", response_model=list[BankItemOut])
async def list_bank(category: str | None = None, search: str | None = None, include_archived: bool = False, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    q = select(QuestionBankItem).where(QuestionBankItem.org_id == identity.org_id)
    if category:
        q = q.where(QuestionBankItem.category == category)
    if not include_archived:
        q = q.where(QuestionBankItem.archived.is_(False))
    if search:
        q = q.where(QuestionBankItem.prompt.ilike(f"%{search.strip()}%"))
    rows = (await db.execute(q.order_by(QuestionBankItem.created_at.desc()))).scalars().all()
    return rows


@router.post("/question-bank", response_model=BankItemOut, status_code=201)
async def create_bank_item(body: BankItemCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    item = QuestionBankItem(
        org_id=identity.org_id, question_type=body.question_type, prompt=body.prompt,
        description=body.description, config=body.config,
        options=[o.model_dump() for o in body.options],
        category=body.category, tags=body.tags, created_by=identity.subject,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.post("/question-bank/import", response_model=list[BankItemOut], status_code=201)
async def import_bank_items(body: BankImportIn, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Batch import parsed CSV rows without accepting files in the service.

    The browser performs CSV decoding and this endpoint validates the same
    typed contract as an individually-created bank item.
    """
    require_admin(identity)
    created = []
    for source in body.items:
        item = QuestionBankItem(
            org_id=identity.org_id,
            question_type=source.question_type,
            prompt=source.prompt.strip(),
            description=source.description,
            config=source.config,
            options=[option.model_dump() for option in source.options],
            category=source.category,
            tags=source.tags,
            created_by=identity.subject,
        )
        db.add(item)
        created.append(item)
    await db.commit()
    for item in created:
        await db.refresh(item)
    return created


@router.delete("/question-bank/{item_id}", status_code=204)
async def delete_bank_item(item_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    item = await db.get(QuestionBankItem, item_id)
    if not item or item.org_id != identity.org_id:
        raise HTTPException(404, "Question not found")
    item.archived = True
    await db.commit()


@router.patch("/question-bank/{item_id}", response_model=BankItemOut)
async def update_bank_item(item_id: str, body: BankItemUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    item = await db.get(QuestionBankItem, item_id)
    if not item or item.org_id != identity.org_id: raise HTTPException(404, "Question not found")
    changes = body.model_dump(exclude_unset=True)
    if "options" in changes and changes["options"] is not None: changes["options"] = [option.model_dump() if hasattr(option, "model_dump") else option for option in body.options]
    for key, value in changes.items(): setattr(item, key, value)
    await db.commit(); await db.refresh(item)
    return item


@router.post("/question-bank/{item_id}/duplicate", response_model=BankItemOut, status_code=201)
async def duplicate_bank_item(item_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    source = await db.get(QuestionBankItem, item_id)
    if not source or source.org_id != identity.org_id: raise HTTPException(404, "Question not found")
    duplicate = QuestionBankItem(org_id=source.org_id, question_type=source.question_type, prompt=f"{source.prompt} (copy)", description=source.description, config=source.config, options=source.options, category=source.category, tags=source.tags, created_by=identity.subject)
    db.add(duplicate); await db.commit(); await db.refresh(duplicate)
    return duplicate


@router.post("/activities/{activity_id}/questions/import/{bank_item_id}", response_model=QuestionOut, status_code=201)
async def import_bank_item(activity_id: str, bank_item_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Copies the bank item's fields into a brand-new ActivityQuestion row.
    Never a live reference — see models.py's QuestionBankItem docstring."""
    require_admin(identity)
    activity = await db.get(EngagementActivity, activity_id)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Activity not found")
    item = await db.get(QuestionBankItem, bank_item_id)
    if not item or item.org_id != identity.org_id:
        raise HTTPException(404, "Question not found")
    next_sequence = await db.scalar(select(func.count()).select_from(ActivityQuestion).where(ActivityQuestion.activity_id == activity.id)) or 0
    question = ActivityQuestion(
        activity_id=activity.id, question_type=item.question_type, prompt=item.prompt,
        description=item.description, sequence=next_sequence,
        config=item.config,
    )
    db.add(question)
    await db.flush()
    for i, opt in enumerate(item.options or []):
        db.add(QuestionOption(question_id=question.id, label=opt.get("label", ""), sequence=i, is_correct=opt.get("is_correct")))
    item.usage_count += 1
    await db.commit()
    # db.get(..., options=...) would silently ignore the eager-load options and
    # return the plain cached object here, since `question` is already in the
    # identity map from db.add() above -- see activities.py's _fetch_activity
    # docstring for the full explanation. An explicit select() always re-applies
    # the options regardless of identity-map state.
    return await db.scalar(select(ActivityQuestion).where(ActivityQuestion.id == question.id).options(selectinload(ActivityQuestion.options)))
