from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import Identity, current_identity, require_guest
from ..database import get_db
from ..models import (
    ActivityParticipant, ActivityQuestion, EngagementActivity, ParticipantResponse,
    QuestionOption, ResponseOptionSelection,
)
from ..schemas import ActivityResultsOut, ParticipateStateOut, QuestionResultOut, RespondIn, RespondOut

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-participate"])


async def _load_activity(activity_id: str, event_id: str, db: AsyncSession) -> EngagementActivity:
    activity = await db.get(
        EngagementActivity, activity_id,
        options=[selectinload(EngagementActivity.questions).selectinload(ActivityQuestion.options)],
    )
    if not activity or activity.event_id != event_id:
        raise HTTPException(404, "Activity not found")
    return activity


async def _get_or_create_participant(activity_id: str, guest_id: str, display_name: str, db: AsyncSession) -> ActivityParticipant:
    participant = await db.scalar(
        select(ActivityParticipant).where(ActivityParticipant.activity_id == activity_id, ActivityParticipant.guest_id == guest_id)
    )
    if participant:
        return participant
    participant = ActivityParticipant(activity_id=activity_id, guest_id=guest_id, display_name=display_name or None)
    db.add(participant)
    await db.flush()
    return participant


@router.get("/activities/{activity_id}/participate", response_model=ParticipateStateOut)
async def get_participation_state(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_guest(identity)
    activity = await _load_activity(activity_id, identity.event_id, db)
    if activity.status not in ("live", "paused") and not activity.config.get("allow_guest_participation", True):
        raise HTTPException(403, "This activity isn't open right now")
    participant = await _get_or_create_participant(activity_id, identity.subject, identity.name, db)
    await db.commit()
    answered = (await db.execute(
        select(ParticipantResponse.question_id).where(ParticipantResponse.participant_id == participant.id)
    )).scalars().all()
    return ParticipateStateOut(activity=activity, already_responded_question_ids=list(answered), participant_id=participant.id)


@router.post("/activities/{activity_id}/respond", response_model=RespondOut)
async def respond(activity_id: str, body: RespondIn, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_guest(identity)
    activity = await _load_activity(activity_id, identity.event_id, db)
    if activity.status not in ("live", "paused"):
        raise HTTPException(409, "This activity isn't accepting responses right now")
    question = next((q for q in activity.questions if q.id == body.question_id), None)
    if not question:
        raise HTTPException(404, "Question not found")

    participant = await _get_or_create_participant(activity_id, identity.subject, identity.name, db)

    # Idempotent re-submission: same participant+question+idempotency_key
    # returns the original response instead of erroring or double-counting —
    # safe for weak-Wi-Fi retries (see architecture doc §D/§K).
    existing = await db.scalar(
        select(ParticipantResponse).where(
            ParticipantResponse.activity_id == activity_id,
            ParticipantResponse.question_id == body.question_id,
            ParticipantResponse.participant_id == participant.id,
            ParticipantResponse.idempotency_key == body.idempotency_key,
        )
    )
    if existing:
        return RespondOut(response_id=existing.id, score=existing.score, correct=None)

    if not activity.config.get("allow_multiple_submissions", False):
        already = await db.scalar(
            select(ParticipantResponse).where(
                ParticipantResponse.question_id == body.question_id,
                ParticipantResponse.participant_id == participant.id,
            )
        )
        if already and not activity.config.get("allow_answer_changes", False):
            raise HTTPException(409, "You already answered this question")
        if already and activity.config.get("allow_answer_changes", False):
            await db.execute(
                ResponseOptionSelection.__table__.delete().where(ResponseOptionSelection.response_id == already.id)
            )
            await db.delete(already)
            await db.flush()

    score = None
    correct = None
    if question.question_type in ("single_choice", "true_false", "yes_no") and question.config.get("correct_answer") is not None and body.selected_option_ids:
        chosen = body.selected_option_ids[0]
        opt = next((o for o in question.options if o.id == chosen), None)
        correct = bool(opt and opt.is_correct)
        if correct:
            points = int(question.config.get("points") or 100)
            if question.time_limit_seconds and body.response_time_ms is not None:
                fraction_remaining = max(0.0, 1 - (body.response_time_ms / 1000) / question.time_limit_seconds)
                score = int(points * (0.5 + 0.5 * fraction_remaining))  # time-weighted, floor at 50%
            else:
                score = points
        else:
            score = 0

    try:
        response = ParticipantResponse(
            activity_id=activity_id, question_id=body.question_id, participant_id=participant.id,
            answer_value=body.answer_value, response_time_ms=body.response_time_ms,
            score=score, idempotency_key=body.idempotency_key,
        )
        db.add(response)
        await db.flush()
        for option_id in body.selected_option_ids:
            db.add(ResponseOptionSelection(response_id=response.id, option_id=option_id))
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await db.scalar(
            select(ParticipantResponse).where(
                ParticipantResponse.activity_id == activity_id,
                ParticipantResponse.question_id == body.question_id,
                ParticipantResponse.participant_id == participant.id,
                ParticipantResponse.idempotency_key == body.idempotency_key,
            )
        )
        if existing:
            return RespondOut(response_id=existing.id, score=existing.score, correct=None)
        raise HTTPException(409, "This response could not be recorded — please try again")

    return RespondOut(response_id=response.id, score=score, correct=correct)


@router.get("/activities/{activity_id}/results", response_model=ActivityResultsOut)
async def get_results(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    activity = await _load_activity(activity_id, identity.event_id, db)
    if identity.identity_kind != "staff":
        require_guest(identity)
        if not activity.config.get("live_results_enabled", True):
            raise HTTPException(403, "Results aren't available for this activity")

    responses = (await db.execute(
        select(ParticipantResponse).where(ParticipantResponse.activity_id == activity_id)
        .options(selectinload(ParticipantResponse.selections))
    )).scalars().all()
    participant_count = len({r.participant_id for r in responses})

    questions_out = []
    for question in sorted(activity.questions, key=lambda q: q.sequence):
        q_responses = [r for r in responses if r.question_id == question.id]
        option_counts: Counter[str] = Counter()
        for r in q_responses:
            for sel in r.selections:
                option_counts[sel.option_id] += 1
        ratings = [r.answer_value for r in q_responses if isinstance(r.answer_value, (int, float))]
        text_samples = [str(r.answer_value) for r in q_responses if isinstance(r.answer_value, str)][:20]
        questions_out.append(QuestionResultOut(
            question_id=question.id, question_type=question.question_type, prompt=question.prompt,
            response_count=len(q_responses), option_counts=dict(option_counts),
            average_rating=(sum(ratings) / len(ratings)) if ratings else None,
            text_samples=text_samples,
        ))

    return ActivityResultsOut(
        activity_id=activity_id, participant_count=participant_count,
        response_count=len(responses), questions=questions_out,
    )
