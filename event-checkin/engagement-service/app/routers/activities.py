import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import Identity, current_identity, require_activity_session, require_admin, require_capability, require_staff
from ..database import get_db
from ..models import ActivityParticipant, ActivityQuestion, EngagementActivity, EngagementEventSettings, ParticipantResponse, ProgramSession, QuestionOption
from ..realtime import publish
from ..schemas import ActivityAdvanceIn, ActivityCreate, ActivityExtendIn, ActivityOut, ActivityStatusIn, ActivitySummary, ActivityUpdate, QuestionCreate, QuestionLiveStateIn, QuestionOut, QuestionUpdate

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-activities"])

VALID_STATUS_TRANSITIONS = {
    "draft": {"scheduled", "live", "archived"},
    "scheduled": {"live", "draft", "archived"},
    "live": {"paused", "closed"},
    "paused": {"live", "closed"},
    "closed": {"completed", "live", "archived"},
    "completed": {"archived"},
    "archived": set(),
}


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
        .options(
            selectinload(ActivityQuestion.activity).selectinload(EngagementActivity.questions),
            selectinload(ActivityQuestion.options),
        )
    )


async def _get_owned_activity(activity_id: str, identity: Identity, db: AsyncSession) -> EngagementActivity:
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Activity not found")
    return activity


async def _get_owned_question(question_id: str, identity: Identity, db: AsyncSession) -> ActivityQuestion:
    question = await _fetch_question(question_id, db)
    if not question or question.activity.event_id != identity.event_id or (identity.org_id and question.activity.org_id != identity.org_id):
        raise HTTPException(404, "Question not found")
    return question


async def _question_response_count(question_id: str, db: AsyncSession) -> int:
    return await db.scalar(
        select(func.count()).select_from(ParticipantResponse).where(ParticipantResponse.question_id == question_id)
    ) or 0


@router.get("/activities", response_model=list[ActivitySummary])
async def list_activities(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    rows = (await db.execute(
        select(EngagementActivity).where(
            EngagementActivity.event_id == identity.event_id,
            EngagementActivity.org_id == identity.org_id,
        ).order_by(EngagementActivity.created_at.desc())
    )).scalars().all()
    out = []
    for a in rows:
        response_count = await db.scalar(select(func.count()).select_from(ParticipantResponse).where(ParticipantResponse.activity_id == a.id)) or 0
        # Count joined participants, not only people who submitted a standard
        # response. Q&A participants create questions/upvotes rather than
        # ParticipantResponse rows and must still appear in the command center.
        participant_count = await db.scalar(
            select(func.count()).select_from(ActivityParticipant).where(ActivityParticipant.activity_id == a.id)
        ) or 0
        completed_count = await db.scalar(
            select(func.count()).select_from(ActivityParticipant).where(
                ActivityParticipant.activity_id == a.id, ActivityParticipant.completed_at.is_not(None),
            )
        ) or 0
        summary = ActivitySummary.model_validate(a)
        summary.response_count = response_count
        summary.participant_count = participant_count
        summary.completed_count = completed_count
        out.append(summary)
    return out


@router.get("/activities/live", response_model=list[ActivitySummary])
async def list_live_activities(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Guest-visible discovery — what's open to join right now. Staff can hit
    this too (it's just a filtered view of the admin listing above)."""
    rows = (await db.execute(
        select(EngagementActivity)
        .where(
            EngagementActivity.event_id == identity.event_id,
            EngagementActivity.org_id == identity.org_id,
            EngagementActivity.status.in_(("live", "paused")),
        )
        .order_by(EngagementActivity.created_at.desc())
    )).scalars().all()
    if identity.identity_kind == "guest":
        rows = [a for a in rows if not _session_denied(a, identity)]
    session_ids = {a.session_id for a in rows if a.session_id}
    session_titles: dict[str, str] = {}
    if session_ids:
        session_rows = (await db.execute(
            select(ProgramSession.source_step_id, ProgramSession.title).where(
                ProgramSession.org_id == identity.org_id,
                ProgramSession.event_id == identity.event_id,
                ProgramSession.source_step_id.in_(session_ids),
            )
        )).all()
        session_titles = dict(session_rows)
    out = []
    for a in rows:
        summary = ActivitySummary.model_validate(a)
        summary.session_title = session_titles.get(a.session_id) if a.session_id else None
        out.append(summary)
    return out


def _session_denied(activity: EngagementActivity, identity: Identity) -> bool:
    try:
        require_activity_session(identity, activity.session_id, activity.config)
    except HTTPException:
        return True
    return False


@router.post("/activities", response_model=ActivityOut, status_code=201)
async def create_activity(body: ActivityCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    if body.session_id:
        linked_session = await db.scalar(select(ProgramSession).where(
            ProgramSession.org_id == identity.org_id,
            ProgramSession.event_id == identity.event_id,
            ProgramSession.source_step_id == body.session_id,
        ))
        if not linked_session:
            raise HTTPException(422, "The Experience program session is not synchronized for this event")
    event_settings = await db.scalar(select(EngagementEventSettings).where(
        EngagementEventSettings.event_id == identity.event_id,
        EngagementEventSettings.org_id == identity.org_id,
    ))
    defaults = event_settings.settings if event_settings else {}
    privacy_style = {
        "first_last_initial": "first_last_initial",
        "first_name": "first_name",
        "anonymous_alias": "anonymous_alias",
    }.get(defaults.get("leaderboard_name_style"), "first_last_initial")
    config = {
        "anonymous": False,
        "allow_guest_participation": defaults.get("guest_hub_participation", True) or defaults.get("broadcast_join_enabled", True),
        "allow_answer_changes": defaults.get("allow_answer_changes", False),
        "leaderboard_enabled": False,
        "leaderboard_privacy": privacy_style,
        "live_results_enabled": False,
        "moderation_enabled": defaults.get("moderation_enabled", False),
        # Session-linked activities auto-close a grace period after their
        # session's scheduled end -- see app/worker.py's _auto_close_tick.
        # Off for event-wide activities (no session to compare against) and
        # overridable per-activity below.
        "auto_close_enabled": True,
        "auto_close_grace_minutes": 20,
        # Opt-in only -- see app/worker.py's _auto_start_tick. The product
        # promise is that Festio Live never starts anything on its own unless
        # a presenter explicitly turns this on for a session-linked activity.
        "auto_start_enabled": False,
        "profanity_filtering": defaults.get("profanity_filtering", True),
        "display_scene": "welcome",
        **body.config,
        "display_token": secrets.token_urlsafe(24),
    }
    activity = EngagementActivity(
        org_id=identity.org_id, event_id=identity.event_id, session_id=body.session_id,
        type=body.type, title=body.title, description=body.description, config=config,
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
        if body.status not in VALID_STATUS_TRANSITIONS.get(activity.status, set()):
            raise HTTPException(409, f"Can't move from {activity.status} to {body.status}")
        activity.status = body.status
    if body.config is not None:
        activity.config = {**activity.config, **body.config}
    if "session_id" in body.model_fields_set:
        if body.session_id:
            linked_session = await db.scalar(select(ProgramSession).where(
                ProgramSession.org_id == identity.org_id,
                ProgramSession.event_id == identity.event_id,
                ProgramSession.source_step_id == body.session_id,
            ))
            if not linked_session:
                raise HTTPException(422, "The Experience program session is not synchronized for this event")
        activity.session_id = body.session_id
    await db.commit()
    if body.status is not None:
        await publish(activity_id, "activity.status_changed", {"status": activity.status})
    return await _fetch_activity(activity_id, db)


@router.post("/activities/{activity_id}/status", response_model=ActivityOut)
async def set_activity_status(activity_id: str, body: ActivityStatusIn, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Presenter-capability status control — a narrower, transition-guarded
    sibling of the admin-only PATCH above, for the Live Control screen and
    any Presenter share-link (see the backend's /live/share-link)."""
    require_capability(identity, "control")
    activity = await _get_owned_activity(activity_id, identity, db)
    allowed = VALID_STATUS_TRANSITIONS.get(activity.status, set())
    if body.status not in allowed:
        raise HTTPException(409, f"Can't move from {activity.status} to {body.status}")
    activity.status = body.status
    await db.commit()
    await publish(activity_id, "activity.status_changed", {"status": activity.status})
    return await _fetch_activity(activity_id, db)


@router.post("/activities/{activity_id}/advance", response_model=ActivityOut)
async def advance_question(activity_id: str, body: ActivityAdvanceIn, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Sets (or clears) the activity's "current question" pointer that the
    Live Control screen and the TV/projector display both follow."""
    require_capability(identity, "control")
    activity = await _get_owned_activity(activity_id, identity, db)
    if body.question_id is not None and not any(q.id == body.question_id and q.status == "active" for q in activity.questions):
        raise HTTPException(404, "Question not found on this activity")
    for question in activity.questions:
        if question.id != body.question_id and question.live_state == "open":
            question.live_state = "closed"
    if body.question_id:
        current = next(q for q in activity.questions if q.id == body.question_id)
        current.live_state = "open"
        current.config = {**(current.config or {}), "opened_at": datetime.now(timezone.utc).isoformat()}
    activity.config = {**activity.config, "current_question_id": body.question_id, "display_scene": "question" if body.question_id else "waiting"}
    await db.commit()
    await publish(activity_id, "question.changed", {"question_id": body.question_id})
    return await _fetch_activity(activity_id, db)


@router.post("/activities/{activity_id}/extend", response_model=ActivityOut)
async def extend_activity(activity_id: str, body: ActivityExtendIn, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Pushes back a session-linked activity's auto-close deadline (see
    app/worker.py's _auto_close_tick) — the presenter's "running long" override.
    Session-end + grace stays the default; this only overrides it forward."""
    require_capability(identity, "control")
    activity = await _get_owned_activity(activity_id, identity, db)
    until = datetime.now(timezone.utc) + timedelta(minutes=body.minutes)
    activity.config = {**activity.config, "extended_until": until.isoformat()}
    await db.commit()
    await publish(activity_id, "activity.extended", {"extended_until": until.isoformat()})
    return await _fetch_activity(activity_id, db)


@router.post("/questions/{question_id}/live-state", response_model=QuestionOut)
async def set_question_live_state(question_id: str, body: QuestionLiveStateIn, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_capability(identity, "control")
    question = await _get_owned_question(question_id, identity, db)
    if question.status != "active":
        raise HTTPException(409, "Archived questions cannot be presented")
    activity = question.activity
    allowed = {
        "pending": {"open"}, "open": {"closed"},
        "closed": {"open", "results_visible"},
        "results_visible": {"answer_revealed", "open", "closed"},
        "answer_revealed": {"open", "closed"},
    }
    if body.state not in allowed.get(question.live_state, set()):
        raise HTTPException(409, f"Can't move question from {question.live_state} to {body.state}")
    if body.state == "open":
        for sibling in activity.questions:
            if sibling.id != question.id and sibling.live_state == "open":
                sibling.live_state = "closed"
        activity.config = {**activity.config, "current_question_id": question.id, "display_scene": "question"}
        question.config = {**(question.config or {}), "opened_at": datetime.now(timezone.utc).isoformat()}
    elif body.state in ("results_visible", "answer_revealed"):
        activity.config = {**activity.config, "current_question_id": question.id, "display_scene": body.state}
    question.live_state = body.state
    await db.commit()
    await publish(activity.id, "question.state_changed", {"question_id": question.id, "state": body.state})
    return await _fetch_question(question_id, db)


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
    if activity.status not in ("draft", "scheduled", "live", "paused"):
        raise HTTPException(409, "Questions can't be added to a closed or archived activity")
    choice_types = {"single_choice", "multiple_choice", "true_false", "yes_no", "ranking"}
    if body.question_type in choice_types and len(body.options) < 2:
        raise HTTPException(422, "Choice questions need at least two options")
    if body.question_type not in choice_types and body.options:
        raise HTTPException(422, "This question type does not accept options")
    if body.question_type == "single_choice" and sum(o.is_correct is True for o in body.options) > 1:
        raise HTTPException(422, "Single-choice questions can have only one correct answer")
    scoring_strategy = body.config.get("scoring_strategy")
    if scoring_strategy not in (None, "fixed", "fixed_points", "time_weighted", "no_speed_bonus", "partial"):
        raise HTTPException(422, "Unknown scoring strategy")
    points = body.config.get("points")
    if points is not None and (isinstance(points, bool) or not isinstance(points, int) or not 0 <= points <= 1_000_000):
        raise HTTPException(422, "Points must be a whole number between 0 and 1,000,000")
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
    if activity.status in ("live", "paused"):
        # Nudges already-connected guests and displays to refetch so the new
        # question shows up without waiting on their 5s poll fallback.
        await publish(activity.id, "question.changed", {"question_id": question.id})
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
        if await _question_response_count(question.id, db):
            raise HTTPException(409, detail={
                "code": "QUESTION_HAS_RESPONSES",
                "message": "Options cannot be changed after participant responses have been recorded.",
            })
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
    if await _question_response_count(question.id, db):
        return JSONResponse(status_code=409, content={
            "code": "QUESTION_HAS_RESPONSES",
            "message": "This question has participant responses and cannot be deleted.",
        })
    await db.delete(question)
    await db.commit()
