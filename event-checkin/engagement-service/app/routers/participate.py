from collections import Counter, defaultdict
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import Identity, current_identity, require_activity_session, require_guest
from ..database import get_db
from ..config import settings
from ..models import (
    ActivityParticipant, ActivityQuestion, ActivityRule, EngagementActivity,
    EngagementQnaQuestion, FeedbackAnalysis, ModerationItem, ParticipantResponse, QuestionOption,
    ResponseOptionSelection,
)
from ..moderation import flag_public_text
from ..realtime import publish
from ..ratelimit import enforce_rate_limit
from ..metrics import RESPONSES
from ..scoring import score_choice_response
from ..schemas import (
    ActivityOut, ActivityResultsOut, CompleteSurveyOut, DraftAnswerOut, ParticipateStateOut,
    QuestionResultOut, RespondIn, RespondOut, RuleOut,
)
from ..wordcloud import word_cloud

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-participate"])


def _rule_matches(operator: str, actual, expected) -> bool:
    if operator == "answered": return actual is not None
    if operator == "not_answered": return actual is None
    if operator == "equals": return actual == expected
    if operator == "not_equals": return actual != expected
    if operator == "contains": return expected in actual if isinstance(actual, (str, list, dict)) else False
    try:
        if operator == "greater_than": return actual > expected
        if operator == "less_than": return actual < expected
    except TypeError:
        return False
    return False


async def _visible_question_ids(activity: EngagementActivity, participant_id: str, db: AsyncSession) -> set[str]:
    rules = (await db.execute(select(ActivityRule).where(ActivityRule.activity_id == activity.id))).scalars().all()
    if not rules: return {q.id for q in activity.questions if q.status == "active"}
    responses = (await db.execute(select(ParticipantResponse).where(ParticipantResponse.participant_id == participant_id, ParticipantResponse.activity_id == activity.id).options(selectinload(ParticipantResponse.selections)))).scalars().all()
    by_question = {response.question_id: response for response in responses}
    visible = {q.id for q in activity.questions if q.status == "active"}
    for rule in rules:
        response = by_question.get(rule.source_question_id)
        actual = response.answer_value if response else None
        if response and response.selections: actual = [selection.option_id for selection in response.selections]
        matches = _rule_matches(rule.operator, actual, rule.comparison_value)
        if (rule.action == "show" and not matches) or (rule.action == "hide" and matches): visible.discard(rule.target_question_id)
    return visible


async def _load_activity(activity_id: str, event_id: str, org_id: str, db: AsyncSession) -> EngagementActivity:
    # Explicit select().options(), not db.get(..., options=...) -- see
    # activities.py's _fetch_activity docstring for why db.get() silently
    # skips eager-load hints when the row is already in the identity map.
    activity = await db.scalar(
        select(EngagementActivity)
        .where(EngagementActivity.id == activity_id)
        .options(selectinload(EngagementActivity.questions).selectinload(ActivityQuestion.options))
    )
    if not activity or activity.event_id != event_id or (org_id and activity.org_id != org_id):
        raise HTTPException(404, "Activity not found")
    return activity


async def _get_or_create_participant(activity_id: str, identity: Identity, db: AsyncSession, truly_anonymous: bool = False) -> ActivityParticipant:
    """Identified guests are tracked by guest_id; a broadcast/QR join (no
    Guest record — see auth.py's Identity.is_anonymous) is tracked by anon_id
    instead. Both columns have their own unique(activity_id, col) constraint,
    so the two never collide even though only one is ever set per row."""
    column, subject = _participant_locator(activity_id, identity, truly_anonymous)
    participant = await db.scalar(
        select(ActivityParticipant).where(ActivityParticipant.activity_id == activity_id, column == subject)
    )
    if participant:
        return participant
    kwargs = {"anon_id": subject} if (identity.is_anonymous or truly_anonymous) else {"guest_id": subject}
    participant = ActivityParticipant(activity_id=activity_id, display_name=None if truly_anonymous else (identity.name or None), **kwargs)
    try:
        # A savepoint makes simultaneous first requests from the same device
        # converge on the database uniqueness constraint without poisoning the
        # outer response transaction.
        async with db.begin_nested():
            db.add(participant)
            await db.flush()
        return participant
    except IntegrityError:
        existing = await db.scalar(
            select(ActivityParticipant).where(ActivityParticipant.activity_id == activity_id, column == subject)
        )
        if existing:
            return existing
        raise


def _participant_locator(activity_id: str, identity: Identity, truly_anonymous: bool = False):
    """Return the participant identity column/value used by every guest path.

    Keeping reads and writes on the same locator is important for anonymous
    activities: identified Guest records are deliberately represented by a
    one-way activity-specific anon id there.
    """
    if truly_anonymous:
        subject = hmac.new(settings.internal_service_token.encode(), f"{activity_id}:{identity.subject}".encode(), hashlib.sha256).hexdigest()[:48]
        return ActivityParticipant.anon_id, subject
    return (ActivityParticipant.anon_id if identity.is_anonymous else ActivityParticipant.guest_id), identity.subject


async def _compute_results(activity: EngagementActivity, db: AsyncSession) -> ActivityResultsOut:
    responses = (await db.execute(
        select(ParticipantResponse).where(ParticipantResponse.activity_id == activity.id)
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
        ranking_scores: Counter[str] = Counter()
        if question.question_type == "ranking":
            option_count = len(question.options)
            for response in q_responses:
                for selection in response.selections:
                    ranking_scores[selection.option_id] += max(1, option_count - selection.sequence)

        points: list[list[float]] = []
        if question.question_type in ("quadrant", "image_click"):
            points = [
                [r.answer_value["x"], r.answer_value["y"]] for r in q_responses
                if isinstance(r.answer_value, dict) and "x" in r.answer_value and "y" in r.answer_value
            ][:500]

        value_counts: Counter[str] = Counter()
        numeric_values: list[float] = []
        if question.question_type in ("rating_5", "rating_10", "nps"):
            for value in ratings:
                value_counts[str(int(value))] += 1
        elif question.question_type == "number":
            numeric_values = ratings[:300]

        response_timeline: list[int] = []
        opened_at_raw = question.config.get("opened_at")
        if opened_at_raw and q_responses:
            try:
                opened_at = datetime.fromisoformat(opened_at_raw)
                if opened_at.tzinfo is None:
                    opened_at = opened_at.replace(tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)
                span = max((now - opened_at).total_seconds(), 1.0)
                bucket_count = 12
                bucket_seconds = span / bucket_count
                buckets = [0] * bucket_count
                for response in q_responses:
                    submitted = response.submitted_at
                    if submitted.tzinfo is None:
                        submitted = submitted.replace(tzinfo=timezone.utc)
                    elapsed = (submitted - opened_at).total_seconds()
                    index = min(bucket_count - 1, max(0, int(elapsed // bucket_seconds)))
                    buckets[index] += 1
                response_timeline = buckets
            except ValueError:
                pass

        questions_out.append(QuestionResultOut(
            question_id=question.id, question_type=question.question_type, prompt=question.prompt,
            response_count=len(q_responses), option_counts=dict(option_counts),
            average_rating=(sum(ratings) / len(ratings)) if ratings else None,
            text_samples=text_samples,
            ranking_scores=dict(ranking_scores),
            value_counts=dict(value_counts),
            numeric_values=numeric_values,
            response_timeline=response_timeline,
            points=points,
        ))

    return ActivityResultsOut(
        activity_id=activity.id, participant_count=participant_count,
        response_count=len(responses), questions=questions_out,
    )


def _leaderboard_name(activity_id: str, participant_id: str, name: str, privacy: str, anonymous: bool) -> str:
    if anonymous or privacy in ("anonymous", "anonymous_alias"):
        return f"Guest {hashlib.sha256(f'{activity_id}:{participant_id}'.encode()).hexdigest()[:4].upper()}"
    parts = name.split()
    if privacy == "initials":
        return "".join(part[:1].upper() for part in parts[:2]) or "Guest"
    if privacy == "first_name":
        return parts[0] if parts else "Guest"
    if privacy == "first_last_initial":
        return (parts[0] + (f" {parts[-1][0].upper()}." if len(parts) > 1 and parts[-1] else "")) if parts else "Guest"
    return parts[0] if parts else "Guest"


async def _compute_leaderboard(activity: EngagementActivity, db: AsyncSession, limit: int = 20) -> list[dict]:
    responses = (await db.execute(
        select(ParticipantResponse.participant_id, ParticipantResponse.score)
        .where(ParticipantResponse.activity_id == activity.id, ParticipantResponse.score.isnot(None))
    )).all()
    totals: dict[str, int] = defaultdict(int)
    for participant_id, score in responses:
        totals[participant_id] += score or 0
    if not totals:
        return []
    participants = (await db.execute(
        select(ActivityParticipant).where(ActivityParticipant.id.in_(totals.keys()))
    )).scalars().all()
    names = {p.id: (p.display_name or "Guest") for p in participants}
    privacy = activity.config.get("leaderboard_privacy", "first_name")
    names = {
        pid: _leaderboard_name(activity.id, pid, name, privacy, bool(activity.config.get("anonymous")))
        for pid, name in names.items()
    }
    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    return [
        {"rank": i + 1, "participant_id": pid, "display_name": names.get(pid, "Guest"), "score": score}
        for i, (pid, score) in enumerate(ranked)
    ]


def _survey_completion_summary(participants: list[ActivityParticipant], participant_count: int, answer_count: int) -> dict:
    """Privacy-safe aggregate metrics for a public survey projector.

    Completion is an explicit final submission, not an estimate based on how
    many individual questions somebody answered. That distinction matters for
    branched surveys where two fully-completed guests may legitimately answer
    different numbers of questions.
    """
    completed = [participant for participant in participants if participant.completed_at is not None]
    durations: list[float] = []
    for participant in completed:
        try:
            duration = (participant.completed_at - participant.joined_at).total_seconds()
        except (AttributeError, TypeError):
            continue
        if duration >= 0:
            durations.append(duration)
    completed_count = len(completed)
    return {
        "participant_count": participant_count,
        "completed_count": completed_count,
        "completion_rate": round((completed_count / participant_count) * 100) if participant_count else 0,
        "avg_completion_seconds": round(sum(durations) / len(durations), 2) if durations else None,
        "answer_count": answer_count,
    }


async def _display_payload(activity: EngagementActivity, db: AsyncSession) -> dict:
    results = await _compute_results(activity, db)
    participants = list((await db.execute(
        select(ActivityParticipant).where(ActivityParticipant.activity_id == activity.id)
    )).scalars().all())
    participant_ids = [participant.id for participant in participants]
    joined_count = len(participants)
    participant_count = max(joined_count, results.participant_count)
    leaderboard = await _compute_leaderboard(activity, db) if activity.config.get("leaderboard_enabled") else []
    current_source = next((q for q in activity.questions if q.id == activity.config.get("current_question_id")), None)
    current_result = next((q for q in results.questions if q.question_id == activity.config.get("current_question_id")), None)

    featured_qna = await db.scalar(
        select(EngagementQnaQuestion).where(
            EngagementQnaQuestion.activity_id == activity.id,
            EngagementQnaQuestion.status.in_(("featured", "answered")),
        ).order_by(
            (EngagementQnaQuestion.status == "featured").desc(),
            EngagementQnaQuestion.upvote_count.desc(),
            EngagementQnaQuestion.created_at.asc(),
        )
    )
    analysis = None
    if current_source:
        analysis = await db.scalar(select(FeedbackAnalysis).where(
            FeedbackAnalysis.question_id == current_source.id,
            FeedbackAnalysis.status == "completed",
        ).order_by(FeedbackAnalysis.completed_at.desc()).limit(1))

    participation = round((current_result.response_count / participant_count) * 100) if current_result and participant_count else 0
    option_total = sum(current_result.option_counts.values()) if current_result else 0
    consensus = round((max(current_result.option_counts.values(), default=0) / option_total) * 100) if option_total else 0
    energy = min(100, round(participation * .8 + min(results.response_count, 40) * .5))
    team_scores = [0, 0]
    team_players = [0, 0]
    for participant_id in participant_ids:
        team_players[int(hashlib.sha256(participant_id.encode()).hexdigest(), 16) % 2] += 1
    for index, entry in enumerate(leaderboard):
        team_index = int(hashlib.sha256(entry["participant_id"].encode()).hexdigest(), 16) % 2
        team_scores[team_index] += entry["score"]

    safe_config_keys = {
        "event_name", "event_venue", "start_at", "join_code", "leaderboard_enabled",
        "display_scene", "moderation_enabled", "live_results_enabled", "registered_progress_mode",
        "survey_insights_layout",
    }
    return {
        "event_id": activity.event_id,
        "activity_id": activity.id,
        "title": activity.title,
        "description": activity.description,
        "type": activity.type,
        "status": activity.status,
        "current_question_id": activity.config.get("current_question_id"),
        "participant_count": participant_count,
        "response_count": results.response_count,
        "survey_summary": (
            _survey_completion_summary(participants, participant_count, results.response_count)
            if activity.type in ("survey", "feedback") else None
        ),
        "display_config": {key: activity.config.get(key) for key in safe_config_keys if key in activity.config},
        "questions": [
            {
                **q.model_dump(),
                "option_labels": {o.id: o.label for source in activity.questions if source.id == q.question_id for o in source.options},
                "option_images": {
                    o.id: o.config["image_url"] for source in activity.questions if source.id == q.question_id
                    for o in source.options if o.config.get("image_url")
                },
                "correct_option_ids": [
                    o.id for source in activity.questions if source.id == q.question_id
                    for o in source.options if o.is_correct and source.live_state == "answer_revealed"
                ],
                "board_image": next((source.config.get("image_url") for source in activity.questions if source.id == q.question_id and source.question_type == "image_click"), None),
                "axis_labels": next((
                    {k: source.config.get(k) for k in ("x_label_low", "x_label_high", "y_label_low", "y_label_high") if source.config.get(k)}
                    for source in activity.questions if source.id == q.question_id and source.question_type == "quadrant"
                ), {}),
                "explanation": next((source.config.get("explanation") for source in activity.questions if source.id == q.question_id and source.live_state == "answer_revealed"), None),
                "time_limit_seconds": next((source.time_limit_seconds for source in activity.questions if source.id == q.question_id), None),
                "opened_at": next((source.config.get("opened_at") for source in activity.questions if source.id == q.question_id), None),
                # Open text never reaches a public display without a future,
                # explicit moderation record. Counts remain safe to show.
                "text_samples": [],
                "live_state": next((source.live_state for source in activity.questions if source.id == q.question_id), "pending"),
            }
            for q in results.questions
        ],
        "leaderboard": leaderboard,
        "featured_qna": ({"id": featured_qna.id, "text": featured_qna.text, "upvote_count": featured_qna.upvote_count, "status": featured_qna.status} if featured_qna else None),
        "word_cloud": await _approved_word_cloud(activity.id, current_source.id, db) if current_source and current_source.question_type == "word_cloud" else [],
        "ai_insight": analysis.result if analysis else None,
        "room_pulse": {
            "energy": energy,
            "participation_percent": participation,
            "consensus_percent": consensus,
            "sentiment": (analysis.result or {}).get("sentiment") if analysis else None,
            "responses": current_result.response_count if current_result else results.response_count,
        },
        "teams": [
            {"name": "Team Aurora", "score": team_scores[0], "players": team_players[0]},
            {"name": "Team Pulse", "score": team_scores[1], "players": team_players[1]},
        ],
    }


async def _approved_word_cloud(activity_id: str, question_id: str, db: AsyncSession) -> list[dict]:
    texts = list((await db.execute(select(ModerationItem.content).where(
        ModerationItem.activity_id == activity_id,
        ModerationItem.question_id == question_id,
        ModerationItem.status == "approved",
    ))).scalars().all())
    return word_cloud(texts)


@router.get("/activities/{activity_id}/participate", response_model=ParticipateStateOut)
async def get_participation_state(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_guest(identity)
    activity = await _load_activity(activity_id, identity.event_id, identity.org_id, db)
    require_activity_session(identity, activity.session_id, activity.config)
    if activity.status not in ("live", "paused") or not activity.config.get("allow_guest_participation", True):
        raise HTTPException(403, "This activity isn't open right now")
    participant = await _get_or_create_participant(activity_id, identity, db, bool(activity.config.get("anonymous")))
    await db.commit()
    responses = (await db.execute(
        select(ParticipantResponse).where(ParticipantResponse.participant_id == participant.id)
        .options(selectinload(ParticipantResponse.selections))
    )).scalars().all()
    safe_activity = ActivityOut.model_validate(activity)
    if activity.type not in ("survey", "feedback"):
        # Quiz/poll/Q&A: unchanged — the server is the sole authority on
        # visibility since the client only ever reacts after a round trip.
        visible_ids = await _visible_question_ids(activity, participant.id, db)
        safe_activity.questions = [question for question in safe_activity.questions if question.id in visible_ids]
    # Survey/feedback: send every active question. The client evaluates
    # branching itself (via `rules` + draft answers below) so selecting an
    # answer updates the form instantly instead of waiting on a save + reload
    # round trip; the server still independently re-validates which
    # questions were actually required at /complete time.
    for question in safe_activity.questions:
        question.config.pop("correct_answer", None)
        question.config.pop("explanation", None)
        for option in question.options:
            option.is_correct = None
    # Survey/feedback-only additions: draft answers (refresh recovery, instant
    # client-side branching) and the activity's branching rules. Quiz/poll/Q&A
    # don't need either — they stay on the existing one-question-at-a-time,
    # server-round-trip-driven flow untouched.
    draft_answers: dict[str, DraftAnswerOut] = {}
    rules: list[RuleOut] = []
    if activity.type in ("survey", "feedback"):
        for response in responses:
            draft_answers[response.question_id] = DraftAnswerOut(
                selected_option_ids=[selection.option_id for selection in response.selections] or None,
                answer_value=response.answer_value,
            )
        rules = (await db.execute(select(ActivityRule).where(ActivityRule.activity_id == activity_id))).scalars().all()
    return ParticipateStateOut(
        activity=safe_activity,
        already_responded_question_ids=[response.question_id for response in responses],
        participant_id=participant.id,
        draft_answers=draft_answers,
        rules=rules,
        completed_at=participant.completed_at,
    )


@router.post("/activities/{activity_id}/complete", response_model=CompleteSurveyOut)
async def complete_survey(activity_id: str, request: Request, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Finalize a survey/feedback participation. This is the ONLY thing that
    marks a guest's feedback as completed — answering individual questions via
    /respond (autosave) never does, by design: it neither sets this nor drives
    any analytics/AI-analysis trigger, so a refresh or abandoned draft never
    counts as a completed submission."""
    require_guest(identity)
    await enforce_rate_limit(request, "complete", f"{activity_id}:{identity.subject}", 10)
    activity = await _load_activity(activity_id, identity.event_id, identity.org_id, db)
    require_activity_session(identity, activity.session_id, activity.config)
    if activity.type not in ("survey", "feedback"):
        raise HTTPException(400, "Only survey/feedback activities have a final submission step")
    if activity.status != "live":
        raise HTTPException(409, "This activity isn't accepting responses right now")
    participant = await _get_or_create_participant(activity_id, identity, db, bool(activity.config.get("anonymous")))
    if participant.completed_at:
        # Idempotent: a duplicate click (or a retried request) just confirms
        # the same completion rather than erroring or double-processing.
        return CompleteSurveyOut(completed=True, completed_at=participant.completed_at)
    visible_ids = await _visible_question_ids(activity, participant.id, db)
    required_ids = {question.id for question in activity.questions if question.id in visible_ids and question.required}
    answered_ids = set((await db.execute(
        select(ParticipantResponse.question_id).where(ParticipantResponse.participant_id == participant.id)
    )).scalars().all())
    missing = list(required_ids - answered_ids)
    if missing:
        return CompleteSurveyOut(completed=False, missing_question_ids=missing)
    participant.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(participant)
    return CompleteSurveyOut(completed=True, completed_at=participant.completed_at)


@router.post("/activities/{activity_id}/respond", response_model=RespondOut)
async def respond(activity_id: str, body: RespondIn, request: Request, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_guest(identity)
    await enforce_rate_limit(request, "respond", f"{activity_id}:{identity.subject}", 30)
    activity = await _load_activity(activity_id, identity.event_id, identity.org_id, db)
    require_activity_session(identity, activity.session_id, activity.config)
    if activity.status != "live":
        raise HTTPException(409, "This activity isn't accepting responses right now")
    question = next((q for q in activity.questions if q.id == body.question_id and q.status == "active"), None)
    if not question:
        raise HTTPException(404, "Question not found")
    # A survey or feedback form is self-paced, not a presenter-advanced quiz/
    # poll -- every active question is answerable the whole time the activity
    # is live, not just whichever one Live Control currently has "open".
    if activity.type not in ("survey", "feedback") and (question.live_state != "open" or activity.config.get("current_question_id") != question.id):
        raise HTTPException(409, "This question isn't open for responses")
    if question.time_limit_seconds and question.config.get("opened_at"):
        try:
            opened_at = datetime.fromisoformat(question.config["opened_at"])
            if datetime.now(timezone.utc) > opened_at + timedelta(seconds=question.time_limit_seconds + 2):
                raise HTTPException(409, "Time is up for this question")
        except ValueError:
            pass

    participant = await _get_or_create_participant(activity_id, identity, db, bool(activity.config.get("anonymous")))

    option_types = {"single_choice", "multiple_choice", "true_false", "yes_no", "ranking"}
    selected = list(dict.fromkeys(body.selected_option_ids))
    valid_option_ids = {o.id for o in question.options}
    if question.question_type in option_types:
        if not selected and question.required:
            raise HTTPException(422, "Select an answer")
        if any(option_id not in valid_option_ids for option_id in selected):
            raise HTTPException(422, "One or more options do not belong to this question")
        if question.question_type in {"single_choice", "true_false", "yes_no"} and len(selected) > 1:
            raise HTTPException(422, "Select only one answer")
        if question.question_type == "ranking" and question.required and set(selected) != valid_option_ids:
            raise HTTPException(422, "Rank every option before submitting")
    elif selected:
        raise HTTPException(422, "This question does not accept option selections")
    if question.question_type in {"short_text", "long_text", "word_cloud"}:
        if not isinstance(body.answer_value, str) or (question.required and not body.answer_value.strip()):
            raise HTTPException(422, "Enter a response")
        if len(body.answer_value) > (280 if question.question_type == "word_cloud" else 5000):
            raise HTTPException(422, "Response is too long")
    if question.question_type in {"rating_5", "rating_10", "nps", "number"}:
        if not isinstance(body.answer_value, (int, float)) or isinstance(body.answer_value, bool):
            raise HTTPException(422, "Enter a numeric response")
        limits = {"rating_5": (1, 5), "rating_10": (1, 10), "nps": (0, 10)}
        if question.question_type in limits:
            low, high = limits[question.question_type]
            if not low <= body.answer_value <= high:
                raise HTTPException(422, f"Response must be between {low} and {high}")
    if question.question_type in {"quadrant", "image_click"}:
        point = body.answer_value
        if (
            not isinstance(point, dict)
            or "x" not in point or "y" not in point
            or not isinstance(point.get("x"), (int, float)) or isinstance(point.get("x"), bool)
            or not isinstance(point.get("y"), (int, float)) or isinstance(point.get("y"), bool)
            or not (0 <= point["x"] <= 1) or not (0 <= point["y"] <= 1)
        ):
            raise HTTPException(422, "Tap a point on the board to answer")
        body.answer_value = {"x": float(point["x"]), "y": float(point["y"])}

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
        return RespondOut(response_id=existing.id, score=None, correct=None)

    already = await db.scalar(
        select(ParticipantResponse).where(
            ParticipantResponse.question_id == body.question_id,
            ParticipantResponse.participant_id == participant.id,
        )
    )
    # A survey/feedback draft is revisable up until final submission (the guest
    # can go back and change an earlier answer, and autosave itself may fire
    # more than once for the same question as they keep editing) -- always
    # allow it there regardless of the explicit opt-in flag. Quiz/poll/Q&A
    # keep the existing config-gated behavior exactly as before.
    can_change = activity.config.get("allow_answer_changes", False) or activity.type in ("survey", "feedback")
    if already and not can_change:
        raise HTTPException(409, "You already answered this question")
    if already and can_change:
        await db.execute(
            ResponseOptionSelection.__table__.delete().where(ResponseOptionSelection.response_id == already.id)
        )
        await db.delete(already)
        await db.flush()

    score = None
    correct = None
    correct_ids = {o.id for o in question.options if o.is_correct}
    if question.question_type in ("single_choice", "multiple_choice", "true_false", "yes_no") and correct_ids and selected:
        strategy = question.config.get("scoring_strategy") or ("time_weighted" if question.time_limit_seconds else "fixed")
        score, correct = score_choice_response(
            selected, correct_ids,
            points=int(question.config.get("points") or 100),
            strategy=strategy,
            response_time_ms=body.response_time_ms,
            time_limit_seconds=question.time_limit_seconds,
        )

    try:
        response = ParticipantResponse(
            activity_id=activity_id, question_id=body.question_id, participant_id=participant.id,
            answer_value=body.answer_value, response_time_ms=body.response_time_ms,
            score=score, idempotency_key=body.idempotency_key,
        )
        db.add(response)
        await db.flush()
        for index, option_id in enumerate(selected):
            db.add(ResponseOptionSelection(response_id=response.id, option_id=option_id, sequence=index))
        if question.question_type in {"short_text", "long_text", "word_cloud"}:
            content = body.answer_value.strip()
            flagged, flag_reason = flag_public_text(content) if activity.config.get("profanity_filtering", True) else (False, None)
            requires_review = activity.config.get("moderation_enabled", False) or flagged
            db.add(ModerationItem(
                activity_id=activity_id,
                question_id=question.id,
                response_id=response.id,
                content_type="word_cloud" if question.question_type == "word_cloud" else "open_text",
                content=content,
                status="pending" if requires_review else "approved",
                flagged=flagged,
                flag_reason=flag_reason,
            ))
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
            return RespondOut(response_id=existing.id, score=None, correct=None)
        raise HTTPException(409, "This response could not be recorded — please try again")

    await publish(activity_id, "response.submitted", {"question_id": body.question_id})
    RESPONSES.inc()
    # Correctness and score are deliberately withheld while voting is open.
    # They become audience-visible only through an explicit reveal state.
    return RespondOut(response_id=response.id, score=None, correct=None)


@router.get("/activities/{activity_id}/results", response_model=ActivityResultsOut)
async def get_results(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    activity = await _load_activity(activity_id, identity.event_id, identity.org_id, db)
    require_activity_session(identity, activity.session_id, activity.config)
    if identity.identity_kind != "staff":
        require_guest(identity)
        if not activity.config.get("live_results_enabled", True):
            raise HTTPException(403, "Results aren't available for this activity")
        visible_ids = {q.id for q in activity.questions if q.live_state in ("results_visible", "answer_revealed")}
        if not visible_ids:
            raise HTTPException(403, "Results haven't been revealed")
        results = await _compute_results(activity, db)
        results.questions = [q for q in results.questions if q.question_id in visible_ids]
        for question in results.questions:
            question.text_samples = []
        return results
    return await _compute_results(activity, db)


@router.get("/activities/{activity_id}/leaderboard")
async def get_leaderboard(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    activity = await _load_activity(activity_id, identity.event_id, identity.org_id, db)
    require_activity_session(identity, activity.session_id, activity.config)
    if identity.identity_kind != "staff":
        require_guest(identity)
        if not activity.config.get("leaderboard_enabled", False):
            raise HTTPException(403, "The leaderboard isn't available for this activity")
        if not any(q.live_state in ("results_visible", "answer_revealed") for q in activity.questions):
            raise HTTPException(403, "The leaderboard hasn't been revealed")
    return {"entries": await _compute_leaderboard(activity, db)}
