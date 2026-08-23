from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Identity, current_identity, require_capability, require_guest, require_staff
from ..database import get_db
from ..models import ActivityParticipant, EngagementQnaQuestion, EngagementQnaUpvote
from ..realtime import publish
from ..schemas import QnaModerateIn, QnaQuestionOut, QnaSubmitIn
from .activities import _fetch_activity
from .participate import _get_or_create_participant

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-qna"])


async def _get_owned_qna(qna_id: str, identity: Identity, db: AsyncSession) -> EngagementQnaQuestion:
    qna = await db.get(EngagementQnaQuestion, qna_id)
    if not qna:
        raise HTTPException(404, "Question not found")
    activity = await _fetch_activity(qna.activity_id, db)
    if not activity or activity.event_id != identity.event_id:
        raise HTTPException(404, "Question not found")
    return qna


@router.get("/activities/{activity_id}/qna", response_model=list[QnaQuestionOut])
async def list_qna(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id:
        raise HTTPException(404, "Activity not found")
    if identity.identity_kind != "staff":
        require_guest(identity)
    rows = (await db.execute(
        select(EngagementQnaQuestion).where(EngagementQnaQuestion.activity_id == activity_id, EngagementQnaQuestion.status != "dismissed")
        .order_by(EngagementQnaQuestion.upvote_count.desc(), EngagementQnaQuestion.created_at.asc())
    )).scalars().all()
    upvoted_ids: set[str] = set()
    if identity.identity_kind == "guest" and rows:
        participant = await db.scalar(
            select(ActivityParticipant).where(ActivityParticipant.activity_id == activity_id, ActivityParticipant.guest_id == identity.subject)
        )
        if participant:
            upvoted_ids = set((await db.execute(
                select(EngagementQnaUpvote.qna_question_id).where(
                    EngagementQnaUpvote.qna_question_id.in_([r.id for r in rows]),
                    EngagementQnaUpvote.participant_id == participant.id,
                )
            )).scalars().all())
    out = [QnaQuestionOut.model_validate(r) for r in rows]
    for o in out:
        o.upvoted_by_me = o.id in upvoted_ids
    return out


@router.post("/activities/{activity_id}/qna", response_model=QnaQuestionOut, status_code=201)
async def submit_qna(activity_id: str, body: QnaSubmitIn, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_guest(identity)
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id:
        raise HTTPException(404, "Activity not found")
    if activity.type != "q_and_a":
        raise HTTPException(409, "This activity doesn't accept Q&A submissions")
    if activity.status not in ("live", "paused"):
        raise HTTPException(409, "This Q&A isn't open right now")
    participant = await _get_or_create_participant(activity_id, identity.subject, identity.name, db)
    qna = EngagementQnaQuestion(activity_id=activity_id, participant_id=participant.id, text=body.text.strip())
    db.add(qna)
    await db.commit()
    await db.refresh(qna)
    await publish(activity_id, "qna.submitted", {"id": qna.id})
    return QnaQuestionOut.model_validate(qna)


@router.post("/qna/{qna_id}/upvote", response_model=QnaQuestionOut)
async def upvote_qna(qna_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_guest(identity)
    qna = await _get_owned_qna(qna_id, identity, db)
    participant = await _get_or_create_participant(qna.activity_id, identity.subject, identity.name, db)
    try:
        db.add(EngagementQnaUpvote(qna_question_id=qna_id, participant_id=participant.id))
        await db.flush()
        qna.upvote_count += 1
        await db.commit()
    except IntegrityError:
        await db.rollback()  # already upvoted -- idempotent no-op
    await db.refresh(qna)
    await publish(qna.activity_id, "qna.upvoted", {"id": qna.id, "upvote_count": qna.upvote_count})
    return QnaQuestionOut.model_validate(qna)


@router.patch("/qna/{qna_id}", response_model=QnaQuestionOut)
async def moderate_qna(qna_id: str, body: QnaModerateIn, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_capability(identity, "moderate")
    qna = await _get_owned_qna(qna_id, identity, db)
    qna.status = body.status
    await db.commit()
    await db.refresh(qna)
    await publish(qna.activity_id, "qna.moderated", {"id": qna.id, "status": qna.status})
    return QnaQuestionOut.model_validate(qna)
