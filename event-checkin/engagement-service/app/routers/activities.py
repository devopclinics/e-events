from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import Identity, current_identity, require_admin, require_staff
from ..database import get_db
from ..models import ActivityQuestion, EngagementActivity, ParticipantResponse, QuestionOption
from ..schemas import ActivityCreate, ActivityOut, ActivitySummary, ActivityUpdate, QuestionCreate, QuestionOut, QuestionUpdate

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-activities"])


# Session.get(Model, pk, options=[...]) silently ignores `options` and returns
# the cached identity-map object as-is if that row was already touched earlier
# in the same request (e.g. right after db.add()+commit()) -- a real, easy-to-
# hit SQLAlchemy async gotcha, not a hypothetical one (this is exactly what
# broke create_activity's first version). An explicit select().options() always
# re-applies eager loading regardless of identity-map state, so every fetch
# that needs relationships loaded goes through these two helpers instead of
# db.get(..., options=...).
async def _fetch_activity(activity_id: str, db: AsyncSession) -> EngagementActivity | None:
    return await db.scalar(
        select(EngagementActivity)
        .where(EngagementActivity.id == activity_id)
        .options(selectinload(EngagementActivity.questions).selectinload(ActivityQuestion.options))
    )


async def _fetch_question(question_id: str, db: AsyncSession) -> ActivityQuestion | None:
    return await db.scalar(
        select(ActivityQuestion)
        .where(ActivityQuestion.id == question_id)
        .options(selectinload(ActivityQuestion.activity), selectinload(ActivityQuestion.options))
    )


async def _get_owned_activity(activity_id: str, identity: Identity, db: AsyncSession) -> EngagementActivity:
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id:
        raise HTTPException(404, "Activity not found")
    return activity


async def _get_owned_question(question_id: str, identity: Identity, db: AsyncSession) -> ActivityQuestion:
    question = await _fetch_question(question_id, db)
    if not question or question.activity.event_id != identity.event_id:
        raise HTTPException(404, "Question not found")
    return question


@router.get("/activities", response_model=list[ActivitySummary])
async def list_activities(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    rows = (await db.execute(
        select(EngagementActivity).where(EngagementActivity.event_id == identity.event_id).order_by(EngagementActivity.created_at.desc())
    )).scalars().all()
    out = []
    for a in rows:
        response_count = await db.scalar(select(func.count()).select_from(ParticipantResponse).where(ParticipantResponse.activity_id == a.id)) or 0
        participant_count = await db.scalar(
            select(func.count(func.distinct(ParticipantResponse.participant_id))).where(ParticipantResponse.activity_id == a.id)
        ) or 0
        summary = ActivitySummary.model_validate(a)
        summary.response_count = response_count
        summary.participant_count = participant_count
        out.append(summary)
    return out


@router.post("/activities", response_model=ActivityOut, status_code=201)
async def create_activity(body: ActivityCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    activity = EngagementActivity(
        org_id=identity.org_id, event_id=identity.event_id, session_id=body.session_id,
        type=body.type, title=body.title, description=body.description, config=body.config,
        created_by=identity.subject,
    )
    db.add(activity)
    await db.commit()
    return await _fetch_activity(activity.id, db)


@router.get("/activities/{activity_id}", response_model=ActivityOut)
async def get_activity(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    return await _get_owned_activity(activity_id, identity, db)


@router.patch("/activities/{activity_id}", response_model=ActivityOut)
async def update_activity(activity_id: str, body: ActivityUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    activity = await _get_owned_activity(activity_id, identity, db)
    if body.title is not None:
        activity.title = body.title
    if body.description is not None:
        activity.description = body.description
    if body.status is not None:
        activity.status = body.status
    if body.config is not None:
        activity.config = {**activity.config, **body.config}
    await db.commit()
    return await _fetch_activity(activity_id, db)


@router.delete("/activities/{activity_id}", status_code=204)
async def delete_activity(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    activity = await _get_owned_activity(activity_id, identity, db)
    await db.delete(activity)
    await db.commit()


@router.post("/activities/{activity_id}/questions", response_model=QuestionOut, status_code=201)
async def add_question(activity_id: str, body: QuestionCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    activity = await _get_owned_activity(activity_id, identity, db)
    question = ActivityQuestion(
        activity_id=activity.id, question_type=body.question_type, prompt=body.prompt,
        description=body.description, sequence=body.sequence, required=body.required,
        time_limit_seconds=body.time_limit_seconds, config=body.config,
    )
    db.add(question)
    await db.flush()
    for i, opt in enumerate(body.options):
        db.add(QuestionOption(question_id=question.id, label=opt.label, sequence=i, is_correct=opt.is_correct, config=opt.config))
    await db.commit()
    return await _fetch_question(question.id, db)


@router.patch("/questions/{question_id}", response_model=QuestionOut)
async def update_question(question_id: str, body: QuestionUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    question = await _get_owned_question(question_id, identity, db)
    if body.prompt is not None:
        question.prompt = body.prompt
    if body.description is not None:
        question.description = body.description
    if body.sequence is not None:
        question.sequence = body.sequence
    if body.required is not None:
        question.required = body.required
    if body.time_limit_seconds is not None:
        question.time_limit_seconds = body.time_limit_seconds
    if body.config is not None:
        question.config = {**question.config, **body.config}
    if body.status is not None:
        question.status = body.status
    if body.options is not None:
        for existing in list(question.options):
            await db.delete(existing)
        await db.flush()
        for i, opt in enumerate(body.options):
            db.add(QuestionOption(question_id=question.id, label=opt.label, sequence=i, is_correct=opt.is_correct, config=opt.config))
    await db.commit()
    return await _fetch_question(question_id, db)


@router.delete("/questions/{question_id}", status_code=204)
async def delete_question(question_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    question = await _get_owned_question(question_id, identity, db)
    await db.delete(question)
    await db.commit()
