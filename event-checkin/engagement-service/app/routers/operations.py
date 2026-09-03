import csv
import copy
import io
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Identity, current_identity, require_admin, require_capability, require_staff
from ..database import get_db
from ..models import ActivityParticipant, ActivityQuestion, ActivityRule, EngagementActivity, EngagementEventSettings, EngagementQnaQuestion, LiveDisplay, ParticipantResponse, ProgramSession, QuestionOption, ResponseOptionSelection, WorkflowRun
from ..realtime import claim_display, publish_display
from ..schemas import DisplayControlUpdate, DisplayCreate, DisplayOut, DisplayRehearsalIn, DisplayResultsControlIn, DisplayUpdate, EventSettings, EventSettingsOut, ResponseDetailOut, RuleCreate, RuleOut
from .activities import _fetch_activity
from .participate import _display_payload

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-operations"])


def _new_display_short_code() -> str:
    # 96 bits of entropy, URL-safe and still short enough to type/copy.
    return secrets.token_urlsafe(12)


def _take_manual_display_control(display: LiveDisplay, changed_fields: set[str]) -> None:
    """Detach a workflow when an operator explicitly chooses TV content."""
    if changed_fields & {"scene", "assigned_activity_id"}:
        display.assigned_workflow_run_id = None


async def _ensure_display_short_codes(displays: list[LiveDisplay], db: AsyncSession) -> None:
    changed = False
    for display in displays:
        if not display.short_code:
            display.short_code = _new_display_short_code()
            changed = True
    if changed:
        await db.commit()


def _csv_safe(value) -> str:
    """Prevent spreadsheet formula execution in organizer-downloaded CSVs."""
    if value is None:
        return ""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    if text.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


async def _owned_display(display_id: str, identity: Identity, db: AsyncSession) -> LiveDisplay:
    display = await db.get(LiveDisplay, display_id)
    if not display or display.event_id != identity.event_id or (identity.org_id and display.org_id != identity.org_id):
        raise HTTPException(404, "Display not found")
    return display


async def _validate_assigned_activity(activity_id: str | None, event_id: str, org_id: str, db: AsyncSession) -> None:
    if not activity_id:
        return
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != event_id or (org_id and activity.org_id != org_id):
        raise HTTPException(422, "Assigned activity was not found")


async def _validate_assigned_session(session_id: str | None, event_id: str, org_id: str, db: AsyncSession) -> None:
    if not session_id:
        return
    session = await db.scalar(select(ProgramSession).where(
        ProgramSession.source_step_id == session_id,
        ProgramSession.event_id == event_id,
        ProgramSession.org_id == org_id,
    ))
    if not session or session.event_id != event_id or (org_id and session.org_id != org_id) or session.status != "published":
        raise HTTPException(422, "Assigned program session was not found")


def _merge_display_settings(display: LiveDisplay, patch) -> None:
    if patch is None:
        return
    values = patch.model_dump(mode="json", exclude_unset=True)
    display.settings = {**(display.settings or {}), **values}


def _apply_results_view(payload: dict, settings: dict) -> dict:
    """Apply display-only result ordering without changing activity data."""
    result = copy.deepcopy(payload)
    requested_ids = settings.get("results_question_ids") or []
    if requested_ids:
        by_id = {question.get("question_id"): question for question in result.get("questions", [])}
        result["questions"] = [by_id[question_id] for question_id in requested_ids if question_id in by_id]
    current_id = settings.get("results_question_id")
    if current_id and any(question.get("question_id") == current_id for question in result.get("questions", [])):
        result["current_question_id"] = current_id
    if settings.get("results_mode") == "all":
        questions = result.get("questions", [])
        answer_count = sum(int(question.get("response_count") or 0) for question in questions)
        participant_count = int(result.get("participant_count") or 0)
        capacity = participant_count * len(questions)
        result["response_count"] = answer_count
        result["activity_summary"] = {
            **(result.get("activity_summary") or {}),
            "question_count": len(questions),
            "response_count": answer_count,
            "response_rate": round(answer_count / capacity * 100) if capacity else 0,
        }
    return result


def _rehearsal_payload(payload: dict, participants: int) -> dict:
    """Create a deterministic display snapshot; never writes response rows."""
    result = copy.deepcopy(payload)
    words = ["connected", "inspired", "community", "energized", "hopeful", "creative"]
    for index, question in enumerate(result.get("questions", [])):
        question["response_count"] = participants
        option_ids = list((question.get("option_labels") or {}).keys())
        if option_ids:
            base, remainder = divmod(participants, len(option_ids))
            question["option_counts"] = {
                option_id: base + (1 if (option_index + index) % len(option_ids) < remainder else 0)
                for option_index, option_id in enumerate(option_ids)
            }
            question["ranking_scores"] = {
                option_id: (len(option_ids) - option_index) * max(1, participants // 2)
                for option_index, option_id in enumerate(option_ids)
            }
        question_type = question.get("question_type")
        if question_type in ("rating_5", "rating_10", "nps"):
            maximum = 5 if question_type == "rating_5" else 10
            question["average_rating"] = round(maximum * .82, 1)
            question["value_counts"] = {str(maximum): max(1, participants * 3 // 5), str(maximum - 1): max(1, participants * 2 // 5)}
        if question_type == "number":
            question["numeric_values"] = [20 + ((value * 7 + index * 3) % 60) for value in range(participants)]
        if question_type == "word_cloud":
            question["word_cloud"] = [{"word": word, "count": max(1, participants - word_index - index)} for word_index, word in enumerate(words)]
        if question_type in ("quadrant", "image_click"):
            question["points"] = [[((value * 37 + index * 11) % 100) / 100, ((value * 61 + index * 7) % 100) / 100] for value in range(participants)]
        question["response_timeline"] = [max(0, round(participants * weight)) for weight in (.05, .08, .12, .18, .2, .16, .1, .06, .03, .02)]
    question_count = len(result.get("questions", []))
    answer_count = participants * question_count
    result["participant_count"] = participants
    result["response_count"] = answer_count
    result["activity_summary"] = {
        "question_count": question_count,
        "participant_count": participants,
        "response_count": answer_count,
        "response_rate": 100,
        "completed_count": participants,
        "completion_rate": 100,
    }
    result["leaderboard"] = [
        {"participant_id": f"rehearsal-{index}", "display_name": f"Demo Guest {index + 1}", "score": 1000 - index * 85, "rank": index + 1}
        for index in range(min(participants, 5))
    ]
    result["room_pulse"] = {"energy": 88, "participation_percent": 100, "consensus_percent": 62, "sentiment": "Positive", "responses": participants}
    result.setdefault("display_config", {})["rehearsal_mode"] = True
    return result


@router.get("/settings", response_model=EventSettingsOut)
async def get_event_settings(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    row = await db.scalar(select(EngagementEventSettings).where(
        EngagementEventSettings.event_id == identity.event_id,
        EngagementEventSettings.org_id == identity.org_id,
    ))
    values = EventSettings(**(row.settings if row else {})).model_dump()
    return {**values, "updated_at": row.updated_at if row else None}


@router.put("/settings", response_model=EventSettingsOut)
async def update_event_settings(body: EventSettings, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    row = await db.scalar(select(EngagementEventSettings).where(
        EngagementEventSettings.event_id == identity.event_id,
        EngagementEventSettings.org_id == identity.org_id,
    ))
    if row is None:
        row = EngagementEventSettings(org_id=identity.org_id, event_id=identity.event_id, settings=body.model_dump())
        db.add(row)
    else:
        row.settings = body.model_dump()
    await db.commit()
    await db.refresh(row)
    return {**body.model_dump(), "updated_at": row.updated_at}


@router.get("/activities/{activity_id}/rules", response_model=list[RuleOut])
async def list_rules(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Activity not found")
    return (await db.execute(select(ActivityRule).where(ActivityRule.activity_id == activity_id))).scalars().all()


@router.post("/activities/{activity_id}/rules", response_model=RuleOut, status_code=201)
async def create_rule(activity_id: str, body: RuleCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Activity not found")
    ids = {q.id for q in activity.questions}
    if body.source_question_id not in ids or body.target_question_id not in ids or body.source_question_id == body.target_question_id:
        raise HTTPException(422, "Rules must reference two different questions in this activity")
    rule = ActivityRule(activity_id=activity_id, source_question_id=body.source_question_id, operator=body.operator, comparison_value=body.comparison_value, target_question_id=body.target_question_id, action=body.action)
    db.add(rule); await db.commit(); await db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    rule = await db.get(ActivityRule, rule_id)
    activity = await _fetch_activity(rule.activity_id, db) if rule else None
    if not rule or not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Rule not found")
    await db.delete(rule); await db.commit()


@router.get("/displays", response_model=list[DisplayOut])
async def list_displays(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    displays = list((await db.execute(select(LiveDisplay).where(
        LiveDisplay.event_id == identity.event_id,
        LiveDisplay.org_id == identity.org_id,
    ).order_by(LiveDisplay.created_at))).scalars().all())
    await _ensure_display_short_codes(displays, db)
    return displays


@router.post("/displays", response_model=DisplayOut, status_code=201)
async def create_display(body: DisplayCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    await _validate_assigned_activity(body.assigned_activity_id, identity.event_id, identity.org_id, db)
    await _validate_assigned_session(body.assigned_session_id, identity.event_id, identity.org_id, db)
    display = LiveDisplay(org_id=identity.org_id, event_id=identity.event_id, name=body.name, display_code=secrets.token_urlsafe(8), short_code=_new_display_short_code(), access_token=secrets.token_urlsafe(32), assigned_session_id=body.assigned_session_id, assigned_activity_id=body.assigned_activity_id, scene=body.scene, settings=body.settings.model_dump(mode="json", exclude_none=True))
    db.add(display); await db.commit(); await db.refresh(display)
    return display


@router.patch("/displays/{display_id}", response_model=DisplayOut)
async def update_display(display_id: str, body: DisplayUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    display = await _owned_display(display_id, identity, db)
    changes = body.model_dump(exclude_unset=True, exclude={"settings"})
    await _validate_assigned_activity(changes.get("assigned_activity_id"), identity.event_id, identity.org_id, db)
    if "assigned_session_id" in changes:
        await _validate_assigned_session(changes.get("assigned_session_id"), identity.event_id, identity.org_id, db)
    _take_manual_display_control(display, set(changes))
    for key, value in changes.items(): setattr(display, key, value)
    _merge_display_settings(display, body.settings)
    await db.commit(); await db.refresh(display)
    await publish_display(display.id, "display.changed", {"scene": display.scene})
    return display


@router.get("/control/displays", response_model=list[DisplayOut])
async def control_displays(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_capability(identity, "control")
    displays = list((await db.execute(select(LiveDisplay).where(
        LiveDisplay.event_id == identity.event_id,
        LiveDisplay.org_id == identity.org_id,
        LiveDisplay.status == "active",
    ).order_by(LiveDisplay.created_at))).scalars().all())
    await _ensure_display_short_codes(displays, db)
    return displays


@router.patch("/control/displays/{display_id}", response_model=DisplayOut)
async def control_display(display_id: str, body: DisplayControlUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_capability(identity, "control")
    display = await _owned_display(display_id, identity, db)
    changes = body.model_dump(exclude_unset=True, exclude={"settings"})
    await _validate_assigned_activity(changes.get("assigned_activity_id"), identity.event_id, identity.org_id, db)
    _take_manual_display_control(display, set(changes))
    for key, value in changes.items(): setattr(display, key, value)
    _merge_display_settings(display, body.settings)
    await db.commit(); await db.refresh(display)
    await publish_display(display.id, "display.changed", {"scene": display.scene})
    return display


@router.put("/control/displays/{display_id}/results", response_model=DisplayOut)
async def control_display_results(display_id: str, body: DisplayResultsControlIn, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Put one question or an ordered aggregate directly on a projector."""
    require_capability(identity, "control")
    display = await _owned_display(display_id, identity, db)
    activity = await _fetch_activity(body.activity_id, db)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Activity not found")
    active_ids = [question.id for question in activity.questions if question.status == "active"]
    if not active_ids:
        raise HTTPException(422, "This activity has no active questions to present")
    unknown = set(body.question_ids) - set(active_ids)
    if body.question_id and body.question_id not in active_ids:
        unknown.add(body.question_id)
    if unknown:
        raise HTTPException(422, "Results can only include active questions from this activity")
    selected_ids = list(dict.fromkeys(body.question_ids or active_ids))
    current_id = body.question_id or activity.config.get("current_question_id") or selected_ids[0]
    if current_id not in selected_ids:
        selected_ids.insert(0, current_id)
    settings = {
        **(display.settings or {}),
        "control_mode": "manual",
        "follow_activity": False,
        "results_mode": body.mode,
        "results_question_id": current_id,
        "results_question_ids": selected_ids,
        "results_frozen": body.freeze,
        "results_page": body.page,
        "results_auto_rotate": body.auto_rotate,
        "results_page_seconds": body.page_seconds,
        "rehearsal_mode": False,
    }
    if body.freeze:
        settings["results_snapshot"] = jsonable_encoder(await _display_payload(activity, db))
    else:
        settings["results_snapshot"] = None
    display.assigned_activity_id = activity.id
    display.assigned_workflow_run_id = None
    display.scene = "all_results" if body.mode == "all" else "results"
    display.settings = settings
    await db.commit(); await db.refresh(display)
    await publish_display(display.id, "display.changed", {"scene": display.scene, "results_mode": body.mode})
    return display


@router.put("/control/displays/{display_id}/rehearsal", response_model=DisplayOut)
async def control_display_rehearsal(display_id: str, body: DisplayRehearsalIn, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Preview realistic results without creating participants or responses."""
    require_capability(identity, "control")
    display = await _owned_display(display_id, identity, db)
    display.assigned_workflow_run_id = None
    if not body.enabled:
        display.scene = "join"
        display.settings = {
            **(display.settings or {}), "control_mode": "manual", "follow_activity": False,
            "rehearsal_mode": False, "results_frozen": False, "results_snapshot": None,
        }
    else:
        activity_id = body.activity_id or display.assigned_activity_id
        activity = await _fetch_activity(activity_id, db) if activity_id else None
        if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
            raise HTTPException(422, "Choose an activity before starting rehearsal")
        payload = _rehearsal_payload(await _display_payload(activity, db), body.participants)
        question_ids = [question["question_id"] for question in payload.get("questions", [])]
        display.assigned_activity_id = activity.id
        display.scene = "all_results"
        display.settings = {
            **(display.settings or {}), "control_mode": "manual", "follow_activity": False,
            "results_mode": "all", "results_question_ids": question_ids, "results_question_id": question_ids[0] if question_ids else None,
            "results_frozen": True, "results_snapshot": jsonable_encoder(payload), "results_page": 0,
            "results_auto_rotate": True, "results_page_seconds": 8, "rehearsal_mode": True,
        }
    await db.commit(); await db.refresh(display)
    await publish_display(display.id, "display.changed", {"scene": display.scene, "rehearsal_mode": bool(body.enabled)})
    return display


@router.post("/displays/{display_id}/rotate-token", response_model=DisplayOut)
async def rotate_display_token(display_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    display = await _owned_display(display_id, identity, db)
    display.access_token = secrets.token_urlsafe(32); await db.commit(); await db.refresh(display)
    return display


@router.delete("/displays/{display_id}", status_code=204)
async def delete_display(display_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    display = await _owned_display(display_id, identity, db)
    await db.delete(display); await db.commit()


@router.get("/live/{display_code}")
async def public_display(display_code: str, token: str = Query(...), client_id: str | None = Query(None), db: AsyncSession = Depends(get_db)):
    display = await db.scalar(select(LiveDisplay).where(LiveDisplay.display_code == display_code, LiveDisplay.access_token == token, LiveDisplay.status == "active"))
    if not display: raise HTTPException(404, "Display not found")
    if client_id:
        try:
            claimed = await claim_display(display.id, client_id)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        if not claimed:
            raise HTTPException(409, "This display already has a connected projector")
    # The public TV shell needs the owning event id to fetch the canonical
    # six-character join code from core. No org or organizer data is exposed.
    sessions = (await db.execute(
        select(ProgramSession).where(
            ProgramSession.event_id == display.event_id,
            ProgramSession.org_id == display.org_id,
            ProgramSession.status == "published",
        ).order_by(ProgramSession.starts_at.asc().nullslast(), ProgramSession.sort_order, ProgramSession.id)
    )).scalars().all()
    public_display_settings = {key: value for key, value in (display.settings or {}).items() if key != "results_snapshot"}
    payload = {
        "event_id": display.event_id,
        "display": {
            "id": display.id,
            "name": display.name,
            "scene": display.scene,
            "assigned_session_id": display.assigned_session_id,
            "settings": public_display_settings,
        },
        "activity": None,
        "workflow_run": None,
        "program_sessions": [
            {
                "id": session.id,
                "source_step_id": session.source_step_id,
                "title": session.title,
                "starts_at": session.starts_at,
                "ends_at": session.ends_at,
                "timezone": session.timezone,
                "room": session.room,
                "speaker": session.speaker,
            }
            for session in sessions
        ],
    }
    if display.assigned_activity_id:
        activity = await _fetch_activity(display.assigned_activity_id, db)
        if activity:
            settings = display.settings or {}
            if settings.get("results_frozen") and isinstance(settings.get("results_snapshot"), dict):
                activity_payload = settings["results_snapshot"]
            else:
                activity_payload = await _display_payload(activity, db)
            payload["activity"] = _apply_results_view(activity_payload, settings)
    if getattr(display, "assigned_workflow_run_id", None):
        # Import locally to avoid making existing display operations depend on
        # the optional workflow router at module-import time.
        from .workflows import _run_payload
        run = await db.get(WorkflowRun, display.assigned_workflow_run_id)
        if run and run.event_id == display.event_id and run.status in {"ready", "live", "paused"}:
            payload["workflow_run"] = await _run_payload(run, db, False)
    return payload


@router.get("/live-short/{short_code}")
async def public_short_display(short_code: str, client_id: str | None = Query(None), db: AsyncSession = Depends(get_db)):
    display = await db.scalar(select(LiveDisplay).where(
        LiveDisplay.short_code == short_code,
        LiveDisplay.status == "active",
    ))
    if not display:
        raise HTTPException(404, "Display not found")
    return await public_display(display.display_code, display.access_token, client_id, db)


@router.get("/activities/{activity_id}/export.csv")
async def export_activity(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id): raise HTTPException(404, "Activity not found")
    responses = (await db.execute(select(ParticipantResponse, ActivityQuestion.prompt, ActivityParticipant.display_name).join(ActivityQuestion, ActivityQuestion.id == ParticipantResponse.question_id).join(ActivityParticipant, ActivityParticipant.id == ParticipantResponse.participant_id).where(ParticipantResponse.activity_id == activity_id))).all()
    output = io.StringIO(); writer = csv.writer(output)
    writer.writerow(["response_id", "question", "participant", "answer", "score", "response_time_ms", "submitted_at"])
    truly_anonymous = bool(activity.config.get("anonymous"))
    for response, prompt, name in responses:
        writer.writerow([_csv_safe(response.id), _csv_safe(prompt), "Anonymous" if truly_anonymous else _csv_safe(name or "Guest"), _csv_safe(response.answer_value), response.score, response.response_time_ms, response.submitted_at.isoformat()])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{activity_id}-responses.csv"'})


@router.get("/activities/{activity_id}/responses", response_model=list[ResponseDetailOut])
async def response_details(activity_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    activity = await _fetch_activity(activity_id, db)
    if not activity or activity.event_id != identity.event_id or (identity.org_id and activity.org_id != identity.org_id):
        raise HTTPException(404, "Activity not found")
    rows = (await db.execute(
        select(ParticipantResponse, ActivityQuestion.prompt, ActivityParticipant.display_name)
        .join(ActivityQuestion, ActivityQuestion.id == ParticipantResponse.question_id)
        .join(ActivityParticipant, ActivityParticipant.id == ParticipantResponse.participant_id)
        .where(ParticipantResponse.activity_id == activity_id)
        .order_by(ParticipantResponse.submitted_at.desc())
        .limit(2000)
    )).all()
    output = []
    truly_anonymous = bool(activity.config.get("anonymous"))
    for response, prompt, name in rows:
        labels = list((await db.execute(
            select(QuestionOption.label)
            .join(ResponseOptionSelection, ResponseOptionSelection.option_id == QuestionOption.id)
            .where(ResponseOptionSelection.response_id == response.id)
            .order_by(ResponseOptionSelection.sequence)
        )).scalars().all())
        output.append(ResponseDetailOut(
            id=response.id,
            question_id=response.question_id,
            question_prompt=prompt,
            participant="Anonymous" if truly_anonymous else (name or "Guest"),
            anonymous=truly_anonymous,
            answer_value=response.answer_value,
            selected_options=labels,
            score=response.score,
            response_time_ms=response.response_time_ms,
            submitted_at=response.submitted_at,
        ))
    return output


@router.get("/analytics/export.csv")
async def export_event_analytics(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    activities = (await db.execute(select(EngagementActivity).where(
        EngagementActivity.event_id == identity.event_id,
        EngagementActivity.org_id == identity.org_id,
    ).order_by(EngagementActivity.created_at))).scalars().all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["activity", "type", "status", "participants", "responses", "q_and_a_questions", "response_rate_percent"])
    for activity in activities:
        participants = await db.scalar(select(func.count()).select_from(ActivityParticipant).where(ActivityParticipant.activity_id == activity.id)) or 0
        responses = await db.scalar(select(func.count()).select_from(ParticipantResponse).where(ParticipantResponse.activity_id == activity.id)) or 0
        qna_count = await db.scalar(select(func.count()).select_from(EngagementQnaQuestion).where(EngagementQnaQuestion.activity_id == activity.id)) or 0
        response_rate = 100 if activity.type == "q_and_a" and participants else round(responses / participants * 100) if participants else 0
        writer.writerow([_csv_safe(activity.title), activity.type, activity.status, participants, responses, qna_count, min(100, response_rate)])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="festio-live-event-analytics.csv"'})
