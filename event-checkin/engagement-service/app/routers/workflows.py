"""Reusable Experience Workflow orchestration for Festio Live.

This module coordinates existing activities/questions. It intentionally does
not duplicate response, moderation, analytics, display-security, or SSE code.
"""
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Identity, current_identity, require_admin, require_capability, require_staff
from ..config import settings
from ..database import get_db
from ..models import (
    ActivityQuestion, EngagementActivity, ExperienceTemplate, ExperienceWorkflow,
    LiveDisplay, ModerationItem, ParticipantResponse, QuestionOption, ResponseOptionSelection,
    WorkflowRevision, WorkflowRun, WorkflowRunEvent, WorkflowStep,
)
from ..pptx_export import render_workflow_pptx
from ..ratelimit import enforce_rate_limit
from ..wordcloud import word_cloud
from ..realtime import publish_display, publish_run
from ..metrics import WORKFLOW_TRANSITIONS
from ..workflow_schemas import (
    ReorderIn, RunCommand, RunCreate, StepCreate, StepOut, StepUpdate,
    TemplateCreate, WorkflowCreate, WorkflowOut, WorkflowUpdate,
)

router = APIRouter(prefix="/api/engagement/v1", tags=["experience-workflows"])


def _enabled() -> None:
    if not settings.experience_workflows_enabled:
        raise HTTPException(404, "Experience workflows are not enabled")


def _owned(row, identity: Identity, label: str):
    if not row or row.event_id != identity.event_id or (identity.org_id and row.org_id != identity.org_id):
        raise HTTPException(404, f"{label} not found")
    return row


async def _workflow(workflow_id: str, identity: Identity, db: AsyncSession, lock: bool = False):
    query = select(ExperienceWorkflow).where(ExperienceWorkflow.id == workflow_id)
    if lock:
        query = query.with_for_update()
    return _owned(await db.scalar(query), identity, "Workflow")


async def _draft_steps(workflow_id: str, db: AsyncSession):
    return (await db.execute(select(WorkflowStep).where(
        WorkflowStep.workflow_id == workflow_id, WorkflowStep.revision_id.is_(None),
    ).order_by(WorkflowStep.sequence))).scalars().all()


def _step_payload(step: WorkflowStep, *, presenter: bool = False) -> dict:
    result = {
        "id": step.id, "sequence": step.sequence, "step_type": step.step_type,
        "title": step.title, "subtitle": step.subtitle, "config": step.config or {},
        "linked_activity_id": step.linked_activity_id,
        "linked_question_id": step.linked_question_id,
        "duration_seconds": step.duration_seconds, "auto_advance": step.auto_advance,
        "status": step.status,
    }
    if presenter:
        result["presenter_notes"] = step.presenter_notes
    return result


async def _validate_links(body, identity: Identity, db: AsyncSession) -> None:
    if body.linked_activity_id:
        activity = await db.get(EngagementActivity, body.linked_activity_id)
        _owned(activity, identity, "Linked activity")
    if body.linked_question_id:
        question = await db.get(ActivityQuestion, body.linked_question_id)
        activity = await db.get(EngagementActivity, question.activity_id) if question else None
        _owned(activity, identity, "Linked question")
        if body.linked_activity_id and question.activity_id != body.linked_activity_id:
            raise HTTPException(422, "Linked question does not belong to the linked activity")


def _validate_step_config(step_type: str, config: dict | None) -> None:
    """Configured media is rendered by public browsers, so only HTTPS sources
    are accepted. The server never fetches the URL and configured text remains
    plain React content rather than executable HTML.
    """
    if step_type != "video" or not config:
        return
    for key in ("video_url", "poster_url", "captions_url"):
        value = config.get(key)
        if value and urlparse(value).scheme != "https":
            raise HTTPException(422, f"{key} must use HTTPS")


async def _workflow_out(workflow: ExperienceWorkflow, db: AsyncSession) -> dict:
    steps = await _draft_steps(workflow.id, db)
    return {**WorkflowOut.model_validate(workflow).model_dump(), "steps": [StepOut.model_validate(step) for step in steps]}


@router.get("/workflows")
async def list_workflows(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_staff(identity)
    rows = (await db.execute(select(ExperienceWorkflow).where(
        ExperienceWorkflow.event_id == identity.event_id,
        ExperienceWorkflow.org_id == identity.org_id,
        ExperienceWorkflow.status != "archived",
    ).order_by(ExperienceWorkflow.updated_at.desc()))).scalars().all()
    counts = dict((await db.execute(select(WorkflowStep.workflow_id, func.count()).where(
        WorkflowStep.revision_id.is_(None), WorkflowStep.status == "active",
    ).group_by(WorkflowStep.workflow_id))).all())
    return [{**WorkflowOut.model_validate(row).model_dump(exclude={"steps"}), "step_count": counts.get(row.id, 0)} for row in rows]


@router.post("/workflows", status_code=201)
async def create_workflow(body: WorkflowCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_admin(identity)
    row = ExperienceWorkflow(org_id=identity.org_id, event_id=identity.event_id, created_by=identity.subject, **body.model_dump())
    db.add(row); await db.commit(); await db.refresh(row)
    return await _workflow_out(row, db)


@router.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_staff(identity)
    return await _workflow_out(await _workflow(workflow_id, identity, db), db)


@router.get("/workflows/{workflow_id}/active-run")
async def get_active_workflow_run(workflow_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Restore presenter state after navigation, refresh, or an accidental Back.
    The browser is never the authority for whether a run still exists.
    """
    _enabled(); require_capability(identity, "control")
    workflow = await _workflow(workflow_id, identity, db)
    run = await db.scalar(select(WorkflowRun).where(
        WorkflowRun.workflow_id == workflow.id,
        WorkflowRun.status.in_(("ready", "live", "paused")),
    ).order_by(WorkflowRun.updated_at.desc()))
    return {"run": await _run_payload(run, db, True) if run else None}


@router.patch("/workflows/{workflow_id}")
async def update_workflow(workflow_id: str, body: WorkflowUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_admin(identity)
    row = await _workflow(workflow_id, identity, db, lock=True)
    if row.draft_version != body.expected_version:
        raise HTTPException(409, "Workflow changed in another tab; reload before saving")
    for key, value in body.model_dump(exclude_unset=True, exclude={"expected_version"}).items():
        setattr(row, key, value)
    row.draft_version += 1
    await db.commit(); await db.refresh(row)
    return await _workflow_out(row, db)


@router.post("/workflows/{workflow_id}/steps", status_code=201)
async def create_step(workflow_id: str, body: StepCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_admin(identity)
    workflow = await _workflow(workflow_id, identity, db, lock=True)
    await _validate_links(body, identity, db)
    _validate_step_config(body.step_type, body.config)
    steps = await _draft_steps(workflow.id, db)
    sequence = body.sequence if body.sequence is not None else len(steps)
    if sequence < len(steps):
        # Shift from the end so the partial unique index is never violated.
        for step in reversed(steps[sequence:]):
            step.sequence += 1
        await db.flush()
    values = body.model_dump(exclude={"sequence"})
    step = WorkflowStep(workflow_id=workflow.id, revision_id=None, sequence=sequence, **values)
    db.add(step); workflow.draft_version += 1
    await db.commit(); await db.refresh(step)
    return StepOut.model_validate(step)


@router.patch("/workflows/{workflow_id}/steps/{step_id}")
async def update_step(workflow_id: str, step_id: str, body: StepUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_admin(identity)
    workflow = await _workflow(workflow_id, identity, db, lock=True)
    step = await db.scalar(select(WorkflowStep).where(
        WorkflowStep.id == step_id, WorkflowStep.workflow_id == workflow.id, WorkflowStep.revision_id.is_(None),
    ))
    if not step: raise HTTPException(404, "Step not found")
    prospective = type("Links", (), {
        "linked_activity_id": body.linked_activity_id if "linked_activity_id" in body.model_fields_set else step.linked_activity_id,
        "linked_question_id": body.linked_question_id if "linked_question_id" in body.model_fields_set else step.linked_question_id,
    })()
    await _validate_links(prospective, identity, db)
    next_type = body.step_type if "step_type" in body.model_fields_set else step.step_type
    next_config = body.config if "config" in body.model_fields_set else step.config
    _validate_step_config(next_type, next_config)
    for key, value in body.model_dump(exclude_unset=True).items(): setattr(step, key, value)
    if step.auto_advance and not step.duration_seconds:
        raise HTTPException(422, "Auto-advance requires a duration")
    workflow.draft_version += 1
    await db.commit(); await db.refresh(step)
    return StepOut.model_validate(step)


@router.put("/workflows/{workflow_id}/steps/order")
async def reorder_steps(workflow_id: str, body: ReorderIn, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_admin(identity)
    workflow = await _workflow(workflow_id, identity, db, lock=True)
    if workflow.draft_version != body.expected_version:
        raise HTTPException(409, "Workflow changed in another tab; reload before reordering")
    steps = await _draft_steps(workflow.id, db)
    if len(set(body.step_ids)) != len(body.step_ids) or set(body.step_ids) != {step.id for step in steps}:
        raise HTTPException(422, "Order must include every draft step exactly once")
    by_id = {step.id: step for step in steps}
    # Temporary negative namespace avoids transient unique collisions.
    for index, step in enumerate(steps): step.sequence = -index - 1
    await db.flush()
    for index, step_id in enumerate(body.step_ids): by_id[step_id].sequence = index
    workflow.draft_version += 1
    await db.commit()
    return {"step_ids": body.step_ids, "draft_version": workflow.draft_version}


@router.delete("/workflows/{workflow_id}/steps/{step_id}", status_code=204)
async def delete_step(workflow_id: str, step_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_admin(identity)
    workflow = await _workflow(workflow_id, identity, db, lock=True)
    step = await db.scalar(select(WorkflowStep).where(WorkflowStep.id == step_id, WorkflowStep.workflow_id == workflow.id, WorkflowStep.revision_id.is_(None)))
    if not step: raise HTTPException(404, "Step not found")
    await db.delete(step); await db.flush()
    remaining = await _draft_steps(workflow.id, db)
    for index, item in enumerate(remaining): item.sequence = index
    workflow.draft_version += 1
    await db.commit()


@router.post("/workflows/{workflow_id}/publish")
async def publish_workflow(workflow_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_admin(identity)
    workflow = await _workflow(workflow_id, identity, db, lock=True)
    drafts = [step for step in await _draft_steps(workflow.id, db) if step.status == "active"]
    if not drafts: raise HTTPException(422, "Add at least one active step before publishing")
    number = (await db.scalar(select(func.max(WorkflowRevision.revision_number)).where(WorkflowRevision.workflow_id == workflow.id)) or 0) + 1
    revision = WorkflowRevision(workflow_id=workflow.id, revision_number=number, name=workflow.name, description=workflow.description, theme=workflow.theme, published_by=identity.subject)
    db.add(revision); await db.flush()
    for draft in drafts:
        db.add(WorkflowStep(
            workflow_id=workflow.id, revision_id=revision.id, sequence=draft.sequence,
            step_type=draft.step_type, title=draft.title, subtitle=draft.subtitle,
            config=draft.config, linked_activity_id=draft.linked_activity_id,
            linked_question_id=draft.linked_question_id, duration_seconds=draft.duration_seconds,
            auto_advance=draft.auto_advance, presenter_notes=draft.presenter_notes, status="active",
        ))
    workflow.current_revision_id = revision.id; workflow.status = "ready"
    await db.commit()
    return {"workflow_id": workflow.id, "revision_id": revision.id, "revision_number": number}


async def _run_steps(run: WorkflowRun, db: AsyncSession):
    return (await db.execute(select(WorkflowStep).where(
        WorkflowStep.revision_id == run.revision_id, WorkflowStep.status == "active",
    ).order_by(WorkflowStep.sequence))).scalars().all()


async def _comparison_data(step: WorkflowStep, db: AsyncSession) -> dict | None:
    """Percentage-point change using each question's actual denominator."""
    question_a = (step.config or {}).get("question_a_id")
    question_b = (step.config or {}).get("question_b_id")
    if not question_a or not question_b:
        return None
    found = (await db.execute(select(ActivityQuestion.id).where(ActivityQuestion.id.in_((question_a, question_b))))).scalars().all()
    if len(found) != 2:
        return None
    options = (await db.execute(select(QuestionOption).where(QuestionOption.question_id.in_((question_a, question_b))).order_by(QuestionOption.sequence))).scalars().all()
    option_by_id = {option.id: option for option in options}
    selections = (await db.execute(
        select(ParticipantResponse.question_id, ResponseOptionSelection.option_id)
        .join(ResponseOptionSelection, ResponseOptionSelection.response_id == ParticipantResponse.id)
        .where(ParticipantResponse.question_id.in_((question_a, question_b)))
    )).all()
    denominators = dict((await db.execute(
        select(ParticipantResponse.question_id, func.count(func.distinct(ParticipantResponse.id)))
        .where(ParticipantResponse.question_id.in_((question_a, question_b)))
        .group_by(ParticipantResponse.question_id)
    )).all())
    counts = {question_a: {}, question_b: {}}
    for question_id, option_id in selections:
        option = option_by_id.get(option_id)
        if option:
            key = " ".join(option.label.lower().split())
            counts[question_id][key] = counts[question_id].get(key, 0) + 1
    labels, seen = [], set()
    for option in options:
        key = " ".join(option.label.lower().split())
        if key not in seen:
            labels.append((key, option.label)); seen.add(key)
    rows = []
    for key, label in labels:
        before = round(counts[question_a].get(key, 0) * 100 / denominators[question_a], 1) if denominators.get(question_a) else 0
        after = round(counts[question_b].get(key, 0) * 100 / denominators[question_b], 1) if denominators.get(question_b) else 0
        rows.append({"label": label, "before": before, "after": after, "change": round(after - before, 1)})
    return {"rows": rows, "before_responses": denominators.get(question_a, 0), "after_responses": denominators.get(question_b, 0)}


async def _big_number_data(step: WorkflowStep, db: AsyncSession) -> dict | None:
    """Combine several already-answered questions into one story beat.

    Each configured metric picks a question and sums the percent of one or
    more of its options (e.g. "several people" + "one person" -> "have
    someone"). Denominators are each question's own actual response count,
    matching how `_comparison_data` handles before/after.
    """
    metrics_config = (step.config or {}).get("metrics") or []
    question_ids = [metric["question_id"] for metric in metrics_config if metric.get("question_id")]
    if not question_ids:
        return None
    options = (await db.execute(select(QuestionOption).where(QuestionOption.question_id.in_(question_ids)))).scalars().all()
    option_by_id = {option.id: option for option in options}
    selections = (await db.execute(
        select(ParticipantResponse.question_id, ResponseOptionSelection.option_id)
        .join(ResponseOptionSelection, ResponseOptionSelection.response_id == ParticipantResponse.id)
        .where(ParticipantResponse.question_id.in_(question_ids))
    )).all()
    denominators = dict((await db.execute(
        select(ParticipantResponse.question_id, func.count(func.distinct(ParticipantResponse.id)))
        .where(ParticipantResponse.question_id.in_(question_ids))
        .group_by(ParticipantResponse.question_id)
    )).all())
    counts: dict[str, dict[str, int]] = {}
    for question_id, option_id in selections:
        option = option_by_id.get(option_id)
        if option:
            key = " ".join(option.label.lower().split())
            counts.setdefault(question_id, {})
            counts[question_id][key] = counts[question_id].get(key, 0) + 1
    metrics = []
    for metric in metrics_config:
        question_id = metric.get("question_id")
        wanted = {" ".join(label.lower().split()) for label in metric.get("option_labels", [])}
        denominator = denominators.get(question_id, 0)
        matched = sum(count for key, count in counts.get(question_id, {}).items() if key in wanted)
        percent = round(matched * 100 / denominator, 1) if denominator else 0
        metrics.append({"value": f"{percent:g}%", "label": metric.get("label", ""), "response_count": denominator})
    return {"metrics": metrics}


async def _activity_scene_data(step: WorkflowStep, db: AsyncSession) -> dict | None:
    if not step.linked_activity_id:
        return None
    question = await db.get(ActivityQuestion, step.linked_question_id) if step.linked_question_id else await db.scalar(
        select(ActivityQuestion).where(ActivityQuestion.activity_id == step.linked_activity_id, ActivityQuestion.status == "active").order_by(ActivityQuestion.sequence)
    )
    if not question:
        return None
    options = (await db.execute(select(QuestionOption).where(QuestionOption.question_id == question.id).order_by(QuestionOption.sequence))).scalars().all()
    data = {"question_id": question.id, "options": [{"id": option.id, "label": option.label, **(option.config or {})} for option in options]}
    if step.step_type in {"poll", "multi_select", "rating", "word_cloud", "ranking"}:
        data["response_count"] = await db.scalar(
            select(func.count()).select_from(ParticipantResponse).where(ParticipantResponse.question_id == question.id)
        ) or 0
    if step.step_type in {"poll", "multi_select", "rating", "poll_results", "ranking", "diagram"}:
        counts = dict((await db.execute(
            select(ResponseOptionSelection.option_id, func.count())
            .join(ParticipantResponse, ParticipantResponse.id == ResponseOptionSelection.response_id)
            .where(ParticipantResponse.question_id == question.id)
            .group_by(ResponseOptionSelection.option_id)
        )).all())
        denominator = await db.scalar(select(func.count()).select_from(ParticipantResponse).where(ParticipantResponse.question_id == question.id)) or 0
        data["response_count"] = denominator
        data["results"] = [{"label": option.label, "count": counts.get(option.id, 0), "percent": round(counts.get(option.id, 0) * 100 / denominator, 1) if denominator else 0} for option in options]
    if step.step_type == "word_cloud":
        approved = (await db.execute(select(ModerationItem.content).where(
            ModerationItem.question_id == question.id, ModerationItem.status == "approved",
        ))).scalars().all()
        data["words"] = word_cloud(list(approved))
        data["response_count"] = len(approved)
    return data


async def _step_data(step: WorkflowStep, db: AsyncSession) -> dict | None:
    """Shared by the live run payload and the standalone step-preview route
    (used by the PPTX exporter) so the two never drift apart."""
    if step.step_type == "comparison":
        return await _comparison_data(step, db)
    if step.step_type == "big_number":
        return await _big_number_data(step, db)
    if step.linked_activity_id:
        return await _activity_scene_data(step, db)
    return None


async def _display_phase(step: WorkflowStep, db: AsyncSession) -> str | None:
    if not step.linked_question_id:
        return None
    question = await db.get(ActivityQuestion, step.linked_question_id)
    if question and question.live_state in {"results_visible", "answer_revealed"}:
        return "results"
    return None


def _elapsed(run: WorkflowRun) -> int:
    elapsed = run.elapsed_before_pause_seconds or 0
    if run.status == "live" and run.started_at:
        anchor = run.paused_at or run.started_at
        elapsed += max(0, int((datetime.now(timezone.utc) - anchor).total_seconds()))
    return elapsed


async def _run_payload(run: WorkflowRun, db: AsyncSession, presenter: bool) -> dict:
    steps = await _run_steps(run, db)
    current_index = next((i for i, step in enumerate(steps) if step.id == run.current_step_id), -1)
    current = steps[current_index] if current_index >= 0 else None
    following = steps[current_index + 1] if 0 <= current_index < len(steps) - 1 else None
    current_payload = _step_payload(current, presenter=presenter) if current else None
    revision = await db.get(WorkflowRevision, run.revision_id)
    now = datetime.now(timezone.utc)
    timer_remaining = run.timer_paused_remaining_seconds
    timer_status = "ready"
    if run.timer_ends_at:
        timer_remaining = max(0, int((run.timer_ends_at - now).total_seconds() + .999))
        timer_status = "complete" if timer_remaining == 0 else "running"
    elif run.timer_paused_remaining_seconds is not None:
        timer_status = "paused" if run.timer_started_at else "ready"
    runtime = {
        **(run.runtime_state or {}), "server_now": now, "step_started_at": run.step_started_at,
        "timer": {"status": timer_status, "remaining_seconds": timer_remaining,
                  "ends_at": run.timer_ends_at, "started_at": run.timer_started_at},
    }
    if current_payload:
        current_payload["runtime"] = runtime
        current_payload["theme"] = revision.theme if revision else {}
    if current_payload and current:
        current_payload["data"] = await _step_data(current, db)
        phase = await _display_phase(current, db)
        if phase:
            current_payload["display_phase"] = phase
    return {
        "id": run.id, "workflow_id": run.workflow_id, "revision_id": run.revision_id,
        "event_id": run.event_id, "display_id": run.display_id, "status": run.status,
        "current_step_id": run.current_step_id, "active_activity_id": run.active_activity_id,
        "active_question_id": run.active_question_id, "state_version": run.state_version,
        "started_at": run.started_at, "paused_at": run.paused_at, "completed_at": run.completed_at,
        "elapsed_seconds": _elapsed(run),
        "server_now": now, "runtime": runtime,
        "current_step": current_payload,
        "next_step": _step_payload(following, presenter=presenter) if following else None,
        "steps": [_step_payload(step, presenter=presenter) for step in steps] if presenter else [],
    }


async def _activate_step(run: WorkflowRun, target: WorkflowStep | None, db: AsyncSession) -> None:
    """Open exactly one existing interaction; close the one being left."""
    previous_activity_id = run.active_activity_id
    previous_question_id = run.active_question_id
    if previous_question_id:
        previous_question = await db.get(ActivityQuestion, previous_question_id)
        if previous_question and previous_question.live_state == "open":
            previous_question.live_state = "closed"
    if previous_activity_id:
        previous_activity = await db.get(EngagementActivity, previous_activity_id)
        if previous_activity and previous_activity.status == "live":
            previous_activity.status = "closed"
            previous_activity.config = {**(previous_activity.config or {}), "current_question_id": None}
    interactive = bool(target and target.step_type in {"poll", "multi_select", "rating", "word_cloud", "ranking"})
    run.active_activity_id = target.linked_activity_id if interactive else None
    resolved_question = None
    if run.active_activity_id:
        activity = await db.get(EngagementActivity, run.active_activity_id)
        if activity:
            activity.status = "live"
        # The Builder only exposes "Linked activity" — target.linked_question_id is
        # never set from that UI. Resolve the activity's question the same way
        # _activity_scene_data does (which is what the presenter/display already
        # show), so the activated question actually matches what's on screen.
        resolved_question = await db.get(ActivityQuestion, target.linked_question_id) if target.linked_question_id else await db.scalar(
            select(ActivityQuestion).where(
                ActivityQuestion.activity_id == run.active_activity_id, ActivityQuestion.status == "active",
            ).order_by(ActivityQuestion.sequence)
        )
    run.active_question_id = resolved_question.id if resolved_question else None
    run.step_started_at = datetime.now(timezone.utc) if target else None
    run.timer_started_at = None
    run.timer_ends_at = None
    run.timer_paused_remaining_seconds = target.duration_seconds if target and target.step_type in {"countdown", "game"} else None
    run.runtime_state = {}
    if resolved_question:
        resolved_question.live_state = "open"
        activity = await db.get(EngagementActivity, run.active_activity_id)
        if activity:
            activity.config = {
                **(activity.config or {}),
                "current_question_id": resolved_question.id,
                "display_scene": "responding",
            }


@router.post("/workflows/{workflow_id}/runs", status_code=201)
async def create_run(workflow_id: str, body: RunCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_capability(identity, "control")
    workflow = await _workflow(workflow_id, identity, db)
    if not workflow.current_revision_id: raise HTTPException(422, "Publish the workflow before starting a run")
    display = None
    if body.display_id:
        # Serialize claims on a projector. Without locking the display row,
        # two different workflow requests can both observe it as available and
        # leave one physical screen attached to two active realtime channels.
        display = _owned(await db.scalar(select(LiveDisplay).where(
            LiveDisplay.id == body.display_id,
        ).with_for_update()), identity, "Display")
        conflicting_run = await db.scalar(select(WorkflowRun).where(
            WorkflowRun.display_id == display.id,
            WorkflowRun.workflow_id != workflow.id,
            WorkflowRun.status.in_(("ready", "live", "paused")),
        ).limit(1))
        if conflicting_run:
            raise HTTPException(409, "Display is already assigned to another active workflow; complete that workflow before reusing this display")
    # A prior run (rehearsal left open, a stale browser tab, a page refresh
    # mid-presentation) never gets marked complete on its own, so it would
    # otherwise sit as "live"/"paused" indefinitely — current_guest_run()
    # picks the most-recently-updated live/paused run for the event, which
    # becomes ambiguous with more than one candidate, and any activity/question
    # that stale run had open never gets closed. Close out every other
    # live/paused run for this workflow before starting the new one, so at
    # most one run is ever active and guests can't land on a stale one.
    stale_runs = (await db.execute(select(WorkflowRun).where(
        WorkflowRun.workflow_id == workflow.id, WorkflowRun.status.in_(("ready", "live", "paused")),
    ))).scalars().all()
    for stale in stale_runs:
        await _activate_step(stale, None, db)
        stale.status = "completed"
        stale.completed_at = datetime.now(timezone.utc)
        if stale.display_id:
            stale_display = await db.get(LiveDisplay, stale.display_id)
            if stale_display and stale_display.assigned_workflow_run_id == stale.id:
                stale_display.assigned_workflow_run_id = None
    run = WorkflowRun(workflow_id=workflow.id, revision_id=workflow.current_revision_id, org_id=workflow.org_id, event_id=workflow.event_id, display_id=body.display_id, public_token=secrets.token_urlsafe(32), started_by=identity.subject)
    db.add(run); await db.flush()
    if display: display.assigned_workflow_run_id = run.id
    await db.commit(); await db.refresh(run)
    return {**await _run_payload(run, db, True), "public_token": run.public_token}


@router.get("/runs/{run_id}")
async def get_run(run_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_capability(identity, "control")
    return await _run_payload(_owned(await db.get(WorkflowRun, run_id), identity, "Run"), db, True)


@router.post("/runs/{run_id}/commands")
async def command_run(run_id: str, body: RunCommand, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_capability(identity, "control")
    existing = await db.scalar(select(WorkflowRunEvent).where(WorkflowRunEvent.run_id == run_id, WorkflowRunEvent.idempotency_key == body.idempotency_key))
    if existing:
        run = _owned(await db.get(WorkflowRun, run_id), identity, "Run")
        return await _run_payload(run, db, True)
    run = _owned(await db.scalar(select(WorkflowRun).where(WorkflowRun.id == run_id).with_for_update()), identity, "Run")
    if run.state_version != body.expected_version:
        raise HTTPException(409, "Run changed; refresh presenter state")
    steps = await _run_steps(run, db)
    if not steps: raise HTTPException(422, "Published revision has no steps")
    index = next((i for i, step in enumerate(steps) if step.id == run.current_step_id), -1)
    previous_id = run.current_step_id
    now = datetime.now(timezone.utc)
    target = None
    if body.action == "start":
        if run.status != "ready": raise HTTPException(409, "Only a ready run can start")
        run.status = "live"; run.started_at = now; target = steps[0]
    elif body.action in ("next", "previous", "jump"):
        if run.status not in ("live", "paused"): raise HTTPException(409, "Run is not active")
        if body.action == "next": target = steps[min(len(steps) - 1, index + 1)]
        elif body.action == "previous": target = steps[max(0, index - 1)]
        else:
            target = next((step for step in steps if step.id == body.step_id), None)
            if not target: raise HTTPException(422, "Jump target is not in this run")
    elif body.action == "pause":
        if run.status != "live": raise HTTPException(409, "Only a live run can pause")
        run.elapsed_before_pause_seconds = _elapsed(run); run.status = "paused"; run.paused_at = now
        if run.timer_ends_at:
            run.timer_paused_remaining_seconds = max(0, int((run.timer_ends_at - now).total_seconds() + .999))
            run.timer_ends_at = None
    elif body.action == "resume":
        if run.status != "paused": raise HTTPException(409, "Only a paused run can resume")
        run.status = "live"; run.started_at = now; run.paused_at = None
        if run.timer_paused_remaining_seconds is not None and run.current_step_id:
            current = steps[index] if index >= 0 else None
            if current and current.step_type in {"countdown", "game"}:
                run.timer_started_at = now
                run.timer_ends_at = now + timedelta(seconds=run.timer_paused_remaining_seconds)
                run.timer_paused_remaining_seconds = None
    elif body.action == "complete":
        if run.status not in ("live", "paused"): raise HTTPException(409, "Run is not active")
        run.elapsed_before_pause_seconds = _elapsed(run); run.status = "completed"; run.completed_at = now
        await _activate_step(run, None, db)
        if run.display_id:
            display = await db.get(LiveDisplay, run.display_id)
            if display and display.assigned_workflow_run_id == run.id:
                display.assigned_workflow_run_id = None
    elif body.action.startswith("timer_"):
        current = steps[index] if index >= 0 else None
        if not current or current.step_type not in {"countdown", "game"}:
            raise HTTPException(422, "The current step does not have a presenter timer")
        duration = current.duration_seconds or 180
        if body.action == "timer_start":
            run.timer_started_at = now
            run.timer_ends_at = now + timedelta(seconds=duration)
            run.timer_paused_remaining_seconds = None
        elif body.action == "timer_reset":
            run.timer_started_at = None
            run.timer_ends_at = None
            run.timer_paused_remaining_seconds = duration
        elif body.action == "timer_pause":
            if not run.timer_ends_at: raise HTTPException(409, "Timer is not running")
            run.timer_paused_remaining_seconds = max(0, int((run.timer_ends_at - now).total_seconds() + .999))
            run.timer_ends_at = None
        elif body.action == "timer_resume":
            remaining = run.timer_paused_remaining_seconds
            if remaining is None: raise HTTPException(409, "Timer is not paused")
            run.timer_started_at = now
            run.timer_ends_at = now + timedelta(seconds=remaining)
            run.timer_paused_remaining_seconds = None
        else:
            extra = body.seconds or 30
            if run.timer_ends_at: run.timer_ends_at += timedelta(seconds=extra)
            else: run.timer_paused_remaining_seconds = (run.timer_paused_remaining_seconds or 0) + extra
    elif body.action.startswith("video_"):
        current = steps[index] if index >= 0 else None
        if not current or current.step_type != "video": raise HTTPException(422, "The current step is not a video")
        run.runtime_state = {
            **(run.runtime_state or {}), "media_command": body.action.removeprefix("video_"),
            "media_command_id": secrets.token_urlsafe(10), "media_issued_at": now.isoformat(),
        }
    elif body.action in {"reveal_results", "reopen_voting"}:
        current = steps[index] if index >= 0 else None
        if not current or current.step_type not in {"poll", "multi_select", "rating", "ranking"} or not run.active_question_id:
            raise HTTPException(422, "The current step is not an active poll")
        question = await db.get(ActivityQuestion, run.active_question_id)
        activity = await db.get(EngagementActivity, run.active_activity_id)
        if body.action == "reveal_results":
            question.live_state = "results_visible"
        else:
            question.live_state = "open"
            if activity: activity.status = "live"
    if target:
        run.current_step_id = target.id
        await _activate_step(run, target, db)
    run.state_version += 1
    db.add(WorkflowRunEvent(run_id=run.id, event_type=f"workflow.{body.action}", actor_id=identity.subject, from_step_id=previous_id, to_step_id=run.current_step_id, idempotency_key=body.idempotency_key, payload={"state_version": run.state_version}))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
    await db.refresh(run)
    payload = await _run_payload(run, db, True)
    WORKFLOW_TRANSITIONS.labels(body.action).inc()
    await publish_run(run.id, f"workflow.{body.action}", payload)
    if run.display_id: await publish_display(run.display_id, "workflow.changed", {"run_id": run.id, "state_version": run.state_version})
    return payload


@router.get("/runs/{run_id}/public")
async def public_run(run_id: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    _enabled()
    run = await db.scalar(select(WorkflowRun).where(WorkflowRun.id == run_id, WorkflowRun.public_token == token))
    if not run: raise HTTPException(404, "Run not found")
    return await _run_payload(run, db, False)


@router.get("/events/current-run")
async def current_guest_run(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled()
    run = await db.scalar(select(WorkflowRun).where(
        WorkflowRun.event_id == identity.event_id, WorkflowRun.status.in_(("live", "paused")),
    ).order_by(WorkflowRun.updated_at.desc()))
    if not run: return {"run": None}
    return {"run": {**await _run_payload(run, db, False), "public_token": run.public_token}}


@router.get("/workflows/{workflow_id}/audit")
async def workflow_audit(workflow_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_staff(identity)
    workflow = await _workflow(workflow_id, identity, db)
    events = (await db.execute(select(WorkflowRunEvent).join(WorkflowRun).where(
        WorkflowRun.workflow_id == workflow.id,
    ).order_by(WorkflowRunEvent.created_at.desc()).limit(500))).scalars().all()
    return [{"id": item.id, "run_id": item.run_id, "event_type": item.event_type, "actor_id": item.actor_id, "from_step_id": item.from_step_id, "to_step_id": item.to_step_id, "payload": item.payload, "created_at": item.created_at} for item in events]


async def _published_steps(workflow: ExperienceWorkflow, db: AsyncSession) -> list[WorkflowStep]:
    if not workflow.current_revision_id:
        raise HTTPException(422, "Publish the workflow first")
    return (await db.execute(select(WorkflowStep).where(
        WorkflowStep.workflow_id == workflow.id, WorkflowStep.revision_id == workflow.current_revision_id,
        WorkflowStep.status == "active",
    ).order_by(WorkflowStep.sequence))).scalars().all()


def _mint_preview_token(identity: Identity) -> str:
    """A short-lived token for the exporter's own headless browser to fetch
    the step-preview route with -- same claim shape current_identity()
    verifies, scoped to this staff member's own event/org/role."""
    now = datetime.now(timezone.utc)
    claims = {
        "sub": f"pptx-export:{identity.subject}", "event_id": identity.event_id, "org_id": identity.org_id,
        "role": identity.role, "identity_kind": "staff", "aud": "engagement", "iss": "guesthub",
        "iat": int(now.timestamp()), "exp": int((now + timedelta(minutes=10)).timestamp()),
    }
    return jwt.encode(claims, settings.internal_service_token, algorithm="HS256")


@router.get("/workflows/{workflow_id}/steps/{step_id}/preview")
async def preview_step(workflow_id: str, step_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """One step's current render payload, computed straight from the
    database. Deliberately independent of WorkflowRun/LiveDisplay: this is
    what the PPTX exporter's headless browser fetches per slide, and reusing
    the run machinery for that would mean generating a deck could knock an
    actively-presenting run back to whichever step got jumped to for the
    screenshot -- or an organizer restarting that run mid-export could
    corrupt the deck. Neither state machine ever touches the other."""
    _enabled(); require_capability(identity, "control")
    workflow = await _workflow(workflow_id, identity, db)
    if not workflow.current_revision_id:
        raise HTTPException(422, "Publish the workflow before previewing steps")
    step = await db.scalar(select(WorkflowStep).where(
        WorkflowStep.id == step_id, WorkflowStep.workflow_id == workflow.id,
        WorkflowStep.revision_id == workflow.current_revision_id,
    ))
    if not step:
        raise HTTPException(404, "Step not found in the published revision")
    revision = await db.get(WorkflowRevision, workflow.current_revision_id)
    payload = _step_payload(step, presenter=True)
    payload["theme"] = revision.theme if revision else {}
    payload["data"] = await _step_data(step, db)
    phase = await _display_phase(step, db)
    if phase:
        payload["display_phase"] = phase
    return payload


@router.post("/workflows/{workflow_id}/export.pptx")
async def export_workflow_pptx(workflow_id: str, request: Request, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_capability(identity, "control")
    # A headless browser walking the whole workflow is by far the heaviest
    # thing this service does; cap it well below the concurrency guard in
    # pptx_export.py so a caller gets a rate-limit message, not a 503 race.
    await enforce_rate_limit(request, "export_pptx", f"{identity.subject}:{workflow_id}", limit=3, window=600)
    workflow = await _workflow(workflow_id, identity, db)
    steps = await _published_steps(workflow, db)
    if not steps:
        raise HTTPException(422, "This workflow has no active steps to export")
    token = _mint_preview_token(identity)
    pptx_bytes = await render_workflow_pptx(settings.internal_display_base_url, workflow.id, token, steps)
    filename = re.sub(r"[^A-Za-z0-9]+", "_", workflow.name).strip("_") or "festio-live-experience"
    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}.pptx"'},
    )


@router.post("/workflows/{workflow_id}/template", status_code=201)
async def save_template(workflow_id: str, body: TemplateCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_admin(identity)
    workflow = await _workflow(workflow_id, identity, db)
    steps = await _draft_steps(workflow.id, db)
    definition = {"theme": workflow.theme, "steps": [{**_step_payload(step), "linked_activity_id": None, "linked_question_id": None} for step in steps]}
    row = ExperienceTemplate(org_id=identity.org_id, created_by=identity.subject, definition=definition, **body.model_dump())
    db.add(row); await db.commit(); await db.refresh(row)
    return {"id": row.id, "name": row.name, "description": row.description, "category": row.category, "definition": row.definition}


@router.get("/templates")
async def list_templates(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _enabled(); require_staff(identity)
    rows = (await db.execute(select(ExperienceTemplate).where(
        ExperienceTemplate.status == "active",
        (ExperienceTemplate.org_id == identity.org_id) | ExperienceTemplate.org_id.is_(None),
    ).order_by(ExperienceTemplate.name))).scalars().all()
    return [{"id": row.id, "name": row.name, "description": row.description, "category": row.category, "definition": row.definition} for row in rows]
