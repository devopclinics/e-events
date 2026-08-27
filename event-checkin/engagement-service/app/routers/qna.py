from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Identity, current_identity, require_activity_session, require_capability, require_guest, require_staff
from ..database import get_db
from ..models import ActivityParticipant, EngagementQnaQuestion, EngagementQnaUpvote
from ..realtime import publish
from ..ratelimit import enforce_rate_limit
from ..schemas import QnaModerateIn, QnaQuestionOut, QnaSubmitIn
from .activities import _fetch_activity
from .participate import _get_or_create_participant, _participant_locator

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-qna"])


async def _get_owned_qna(qna_id: str, identity: Identity, db: AsyncSession) -> EngagementQnaQuestion:
    qna = await db.get(EngagementQnaQuestion, qna_id)
    if not qna:
        raise HTTPException(404, "Question not found")
    activity = await _fetch_activity(qna.activity_id, db)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Question not found")
    return qna


@router.get("/activities/{activity_id}/qna", response_model=list[QnaQuestionOut])
async def list_qna(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Activity not found")
    if identity.identity_kind != "staff":
        require_guest(identity)
        require_activity_session(identity, activity.session_id, activity.config)
    participant = None
    if identity.identity_kind == "guest":
        column, subject = _participant_locator(activity_id, identity, bool(activity.config.get("anonymous")))
        participant = await db.scalar(
            select(ActivityParticipant).where(ActivityParticipant.activity_id == activity_id, column == subject)
        )
        visibility = EngagementQnaQuestion.status.in_(("featured", "answered"))
        if participant:
            # A pending submission remains private, but its author must be able
            # to see that it was saved and is awaiting moderation.
            visibility = or_(
                visibility,
                and_(
                    EngagementQnaQuestion.status == "pending",
                    EngagementQnaQuestion.participant_id == participant.id,
                ),
            )
    else:
        visibility = EngagementQnaQuestion.status.in_(("pending", "featured", "answered", "dismissed"))
    rows = (await db.execute(
        select(EngagementQnaQuestion).where(EngagementQnaQuestion.activity_id == activity_id, visibility)
        .order_by(EngagementQnaQuestion.upvote_count.desc(), EngagementQnaQuestion.created_at.asc())
    )).scalars().all()
    upvoted_ids: set[str] = set()
    if identity.identity_kind == "guest" and rows and participant:
        upvoted_ids = set((await db.execute(
            select(EngagementQnaUpvote.qna_question_id).where(
                EngagementQnaUpvote.qna_question_id.in_([r.id for r in rows]),
                EngagementQnaUpvote.participant_id == participant.id,
            )
        )).scalars().all())
    out = [QnaQuestionOut.model_validate(r) for r in rows]
    for o in out:
        o.upvoted_by_me = o.id in upvoted_ids
        o.is_mine = bool(participant and next(r for r in rows if r.id == o.id).participant_id == participant.id)
    return out


@router.post("/activities/{activity_id}/qna", response_model=QnaQuestionOut, status_code=201)
async def submit_qna(activity_id: str, body: QnaSubmitIn, request: Request, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_guest(identity)
    await enforce_rate_limit(request, "qna-submit", f"{activity_id}:{identity.subject}", 10)
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Activity not found")
    require_activity_session(identity, activity.session_id, activity.config)
    if activity.type != "q_and_a":
        raise HTTPException(409, "This activity doesn't accept Q&A submissions")
    if activity.status not in ("live", "paused"):
        raise HTTPException(409, "This Q&A isn't open right now")
    if activity.config.get("show_mode") == "guided" and activity.config.get("show_phase") != "answering":
        raise HTTPException(409, "The presenter hasn't opened Q&A yet")
    if not body.text.strip():
        raise HTTPException(422, "Enter a question")
    participant = await _get_or_create_participant(activity_id, identity, db, bool(activity.config.get("anonymous")))
    qna = EngagementQnaQuestion(activity_id=activity_id, participant_id=participant.id, text=body.text.strip())
    db.add(qna)
    await db.commit()
    await db.refresh(qna)
    await publish(activity_id, "qna.submitted", {"id": qna.id})
    out = QnaQuestionOut.model_validate(qna)
    out.is_mine = True
    return out


@router.post("/qna/{qna_id}/upvote", response_model=QnaQuestionOut)
async def upvote_qna(qna_id: str, request: Request, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_guest(identity)
    await enforce_rate_limit(request, "qna-upvote", identity.subject, 60)
    qna = await _get_owned_qna(qna_id, identity, db)
    activity = await _fetch_activity(qna.activity_id, db)
    require_activity_session(identity, activity.session_id, activity.config)
    if activity.config.get("show_mode") == "guided" and activity.config.get("show_phase") != "answering":
        raise HTTPException(409, "The presenter has closed Q&A")
    if qna.status not in ("featured", "answered"):
        raise HTTPException(409, "This question is awaiting moderation")
    participant = await _get_or_create_participant(qna.activity_id, identity, db, bool(activity.config.get("anonymous")))
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
