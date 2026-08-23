from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import Identity, current_identity, require_admin, require_staff
from ..database import get_db
from ..models import ActivityQuestion, EngagementActivity, QuestionBankItem, QuestionOption
from ..schemas import BankItemCreate, BankItemOut, QuestionOut

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-question-bank"])


@router.get("/question-bank", response_model=list[BankItemOut])
async def list_bank(category: str | None = None, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    q = select(QuestionBankItem).where(QuestionBankItem.org_id == identity.org_id)
    if category:
        q = q.where(QuestionBankItem.category == category)
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


@router.delete("/question-bank/{item_id}", status_code=204)
async def delete_bank_item(item_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    item = await db.get(QuestionBankItem, item_id)
    if not item or item.org_id != identity.org_id:
        raise HTTPException(404, "Question not found")
    await db.delete(item)
    await db.commit()


@router.post("/activities/{activity_id}/questions/import/{bank_item_id}", response_model=QuestionOut, status_code=201)
async def import_bank_item(activity_id: str, bank_item_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Copies the bank item's fields into a brand-new ActivityQuestion row.
    Never a live reference — see models.py's QuestionBankItem docstring."""
    require_admin(identity)
    activity = await db.get(EngagementActivity, activity_id)
    if not activity or activity.event_id != identity.event_id:
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
