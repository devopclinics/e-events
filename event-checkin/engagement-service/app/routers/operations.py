import csv
import io
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Identity, current_identity, require_admin, require_capability, require_staff
from ..database import get_db
from ..models import ActivityParticipant, ActivityQuestion, ActivityRule, EngagementActivity, EngagementEventSettings, EngagementQnaQuestion, LiveDisplay, ParticipantResponse, ProgramSession, QuestionOption, ResponseOptionSelection
from ..realtime import publish_display
from ..schemas import DisplayControlUpdate, DisplayCreate, DisplayOut, DisplayUpdate, EventSettings, EventSettingsOut, ResponseDetailOut, RuleCreate, RuleOut
from .activities import _fetch_activity
from .participate import _display_payload

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-operations"])


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
    return (await db.execute(select(LiveDisplay).where(
        LiveDisplay.event_id == identity.event_id,
        LiveDisplay.org_id == identity.org_id,
    ).order_by(LiveDisplay.created_at))).scalars().all()


@router.post("/displays", response_model=DisplayOut, status_code=201)
async def create_display(body: DisplayCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(identity)
    await _validate_assigned_activity(body.assigned_activity_id, identity.event_id, identity.org_id, db)
    await _validate_assigned_session(body.assigned_session_id, identity.event_id, identity.org_id, db)
    display = LiveDisplay(org_id=identity.org_id, event_id=identity.event_id, name=body.name, display_code=secrets.token_urlsafe(8), access_token=secrets.token_urlsafe(32), assigned_session_id=body.assigned_session_id, assigned_activity_id=body.assigned_activity_id, scene=body.scene, settings=body.settings.model_dump(mode="json", exclude_none=True))
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
    for key, value in changes.items(): setattr(display, key, value)
    _merge_display_settings(display, body.settings)
    await db.commit(); await db.refresh(display)
    await publish_display(display.id, "display.changed", {"scene": display.scene})
    return display


@router.get("/control/displays", response_model=list[DisplayOut])
async def control_displays(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_capability(identity, "control")
    return (await db.execute(select(LiveDisplay).where(
        LiveDisplay.event_id == identity.event_id,
        LiveDisplay.org_id == identity.org_id,
        LiveDisplay.status == "active",
    ).order_by(LiveDisplay.created_at))).scalars().all()


@router.patch("/control/displays/{display_id}", response_model=DisplayOut)
async def control_display(display_id: str, body: DisplayControlUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_capability(identity, "control")
    display = await _owned_display(display_id, identity, db)
    changes = body.model_dump(exclude_unset=True, exclude={"settings"})
    await _validate_assigned_activity(changes.get("assigned_activity_id"), identity.event_id, identity.org_id, db)
    for key, value in changes.items(): setattr(display, key, value)
    _merge_display_settings(display, body.settings)
    await db.commit(); await db.refresh(display)
    await publish_display(display.id, "display.changed", {"scene": display.scene})
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
async def public_display(display_code: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    display = await db.scalar(select(LiveDisplay).where(LiveDisplay.display_code == display_code, LiveDisplay.access_token == token, LiveDisplay.status == "active"))
    if not display: raise HTTPException(404, "Display not found")
    # The public TV shell needs the owning event id to fetch the canonical
    # six-character join code from core. No org or organizer data is exposed.
    sessions = (await db.execute(
        select(ProgramSession).where(
            ProgramSession.event_id == display.event_id,
            ProgramSession.org_id == display.org_id,
            ProgramSession.status == "published",
        ).order_by(ProgramSession.starts_at.asc().nullslast(), ProgramSession.sort_order, ProgramSession.id)
    )).scalars().all()
    payload = {
        "event_id": display.event_id,
        "display": {
            "id": display.id,
            "name": display.name,
            "scene": display.scene,
            "assigned_session_id": display.assigned_session_id,
            "settings": display.settings,
        },
        "activity": None,
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
        if activity: payload["activity"] = await _display_payload(activity, db)
    return payload


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
