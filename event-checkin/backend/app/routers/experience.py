import csv
import html
import io
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import _org_role, is_org_manager, require_dashboard_access, require_event_admin, require_event_member
from ..database import get_db
from ..models import ConsentForm, ConsentSignature, Event, EventUser, ExperienceEvent, ExperienceStep, ExperienceWorkflow, FeedbackSubmission, Guest, GuestExperienceProgress, SeatingTable, TableGroup, TableGroupTable, User
from .seating import assign_next_seat, group_table_ids
from ..schemas import (
    ConsentFormOut,
    ConsentFormUpsert,
    ConsentSignatureCreate,
    ConsentSignatureOut,
    ExperienceEventOut,
    ExperienceNextStepOut,
    ExperienceProgressUpdate,
    ExperienceStepCreate,
    ExperienceStepOut,
    ExperienceStepReorder,
    ExperienceStepUpdate,
    ExperienceDashboardOut,
    ExperienceStepDashboardOut,
    ExperienceWorkflowClone,
    ExperienceWorkflowCreate,
    ExperienceWorkflowOut,
    ProgramSegmentImport,
    GuestConsentStateOut,
    GuestExperienceOut,
    GuestExperienceProgressOut,
    GuestJourneyGuestOut,
    GuestJourneyOut,
    GuestJourneyStepOut,
    GuestJourneyWorkflowOut,
    GuestProgramOut,
)
from ..services.experience import (
    active_workflow,
    archive_workflow,
    clone_workflow,
    create_default_workflow,
    create_workflow,
    dependencies_satisfied,
    _progress_start_time,
    initialize_progress,
    list_workflows,
    load_workflow,
    next_guest_steps,
    publish_workflow,
    sync_guest_progress,
    unarchive_workflow,
    unpublish_workflow,
)
from ..entitlements import assert_feature_allowed
from ..entitlements import can_use_paid_channels, last_credit_ledger_id, take_message_credit
from ..ratelimit import rate_limit
from ..timeutil import EVENT_TZ
from services.email_service import send_simple_email
from services import messaging
from services.credit_ledger import send_with_credit_ledger
from services.templates import build_context as build_template_context
from ..template_resolve import email_or_default as template_email_or_default, load_overrides
from ..services.festiome_outbox import queue_announcement
from ..services.program import feedback_availability, program_state

router = APIRouter()


def _assert_experience_plan(event: Event) -> None:
    assert_feature_allowed(event, "experience_enabled")


def _progress_out(row: GuestExperienceProgress) -> GuestExperienceProgressOut:
    return GuestExperienceProgressOut(
        id=row.id,
        event_id=row.event_id,
        workflow_id=row.workflow_id,
        step_id=row.step_id,
        guest_id=row.guest_id,
        status=row.status,
        completed_at=row.completed_at,
        completed_by_user_id=row.completed_by_user_id,
        completed_by_source=row.completed_by_source,
        override_reason=row.override_reason,
        metadata=row.progress_metadata,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _next_step_out(step: ExperienceStep, row: GuestExperienceProgress | None) -> ExperienceNextStepOut:
    return ExperienceNextStepOut(
        step=ExperienceStepOut.model_validate(step),
        progress=_progress_out(row) if row else None,
    )


def _ensure_draft(workflow: ExperienceWorkflow) -> None:
    if workflow.status != "draft":
        raise HTTPException(409, "Published workflows are immutable. Clone it to make changes.")


def _assert_unique_step_keys(step_payloads: list[ExperienceStepCreate]) -> None:
    keys = [step.key for step in step_payloads]
    if len(keys) != len(set(keys)):
        raise HTTPException(400, "Step keys must be unique within a workflow")


async def _load_scoped_workflow(event_id: str, workflow_id: str, db: AsyncSession) -> ExperienceWorkflow:
    workflow = await load_workflow(workflow_id, db)
    if not workflow or workflow.event_id != event_id:
        raise HTTPException(404, "Workflow not found")
    workflow.steps.sort(key=lambda s: (s.sort_order, s.title))
    return workflow


async def _step_key_exists(
    workflow_id: str,
    key: str,
    db: AsyncSession,
    *,
    exclude_step_id: str | None = None,
) -> bool:
    conditions = [ExperienceStep.workflow_id == workflow_id, ExperienceStep.key == key]
    if exclude_step_id:
        conditions.append(ExperienceStep.id != exclude_step_id)
    return bool(await db.scalar(select(ExperienceStep.id).where(*conditions).limit(1)))


async def _ensure_runtime_operator(event_id: str, user: User, db: AsyncSession) -> Event:
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin:
        return event
    if await is_org_manager(user, event.org_id, db):
        return event
    assigned = await db.scalar(
        select(EventUser.id).where(EventUser.event_id == event_id, EventUser.user_id == user.id).limit(1)
    )
    if assigned:
        return event
    raise HTTPException(403, "You are not assigned to this event")


async def _runtime_role(event: Event, user: User, db: AsyncSession) -> str:
    if user.is_platform_superadmin:
        return "superadmin"
    role = await _org_role(user, event.org_id, db)
    if role in ("owner", "admin"):
        return role
    return "staff"


async def _ensure_step_permission(event: Event, step: ExperienceStep, user: User, db: AsyncSession) -> None:
    allowed = (step.config or {}).get("allowed_roles") or (step.config or {}).get("allowed_staff_roles")
    if not allowed:
        return
    if isinstance(allowed, str):
        allowed_roles = {allowed.lower()}
    else:
        allowed_roles = {str(role).lower() for role in allowed}
    role = await _runtime_role(event, user, db)
    if role == "superadmin" or role in allowed_roles or (role == "owner" and "admin" in allowed_roles):
        return
    raise HTTPException(403, f"This step can only be completed by: {', '.join(sorted(allowed_roles))}")


def _step_message(step: ExperienceStep, key: str) -> str:
    messages = ((step.config or {}).get("messages") or {})
    value = messages.get(key)
    return value.strip() if isinstance(value, str) else ""


def _room_assignment_config(step: ExperienceStep) -> dict:
    config = step.config or {}
    assignment = config.get("room_assignment") or config.get("assignment") or config
    if not isinstance(assignment, dict):
        assignment = config
    return assignment


def _room_assignment_scope(step: ExperienceStep) -> str:
    assignment = _room_assignment_config(step)
    raw = (
        assignment.get("assignment_scope")
        or assignment.get("scope")
        or assignment.get("key")
        or step.key
        or step.id
    )
    return str(raw).strip() or step.id


def _room_assignment_is_scoped(step: ExperienceStep) -> bool:
    assignment = _room_assignment_config(step)
    mode = str(assignment.get("mode") or assignment.get("assignment_mode") or "").strip().lower()
    if mode in {"scoped", "per_step", "per-session", "per_session", "per_room"}:
        return True
    return bool(assignment.get("scoped") or assignment.get("per_step") or assignment.get("assignment_scope") or assignment.get("scope"))


async def _configured_table_group(step: ExperienceStep, event_id: str, db: AsyncSession) -> TableGroup | None:
    assignment = _room_assignment_config(step)

    group_id = assignment.get("table_group_id") or assignment.get("group_id")
    if group_id:
        group = await db.get(TableGroup, group_id)
        if not group or group.event_id != event_id:
            raise HTTPException(409, "Configured room assignment table group was not found")
        return group

    group_name = assignment.get("table_group") or assignment.get("table_group_name") or assignment.get("group")
    if isinstance(group_name, str) and group_name.strip():
        cleaned = group_name.strip().lower()
        group = await db.scalar(
            select(TableGroup)
            .where(
                TableGroup.event_id == event_id,
                (func.lower(TableGroup.name) == cleaned) | (func.lower(TableGroup.tag) == cleaned),
            )
            .limit(1)
        )
        if not group:
            raise HTTPException(409, f"Configured room assignment group '{group_name}' was not found")
        return group
    return None


async def _scoped_room_occupancy(event_id: str, scope: str, db: AsyncSession) -> dict[str, set[int]]:
    rows = (await db.execute(
        select(GuestExperienceProgress.progress_metadata)
        .where(
            GuestExperienceProgress.event_id == event_id,
            GuestExperienceProgress.status == "completed",
        )
    )).scalars().all()
    occupied: dict[str, set[int]] = {}
    for metadata in rows:
        if not isinstance(metadata, dict):
            continue
        assignment = metadata.get("room_assignment")
        if not isinstance(assignment, dict):
            continue
        if str(assignment.get("assignment_scope") or assignment.get("scope") or "").strip() != scope:
            continue
        table_id = assignment.get("table_id")
        seat_number = assignment.get("seat_number")
        if not table_id or seat_number in (None, ""):
            continue
        try:
            seat = int(seat_number)
        except (TypeError, ValueError):
            continue
        occupied.setdefault(str(table_id), set()).add(seat)
    return occupied


async def _assign_scoped_room_for_step(
    event: Event,
    guest: Guest,
    step: ExperienceStep,
    db: AsyncSession,
    existing_metadata: dict | None = None,
) -> dict:
    existing_assignment = (existing_metadata or {}).get("room_assignment") if isinstance(existing_metadata, dict) else None
    scope = _room_assignment_scope(step)
    if isinstance(existing_assignment, dict) and str(existing_assignment.get("assignment_scope") or "").strip() == scope:
        return existing_assignment

    configured_group = await _configured_table_group(step, event.id, db)
    group = configured_group
    if not group and guest.assigned_table_group_id:
        group = await db.get(TableGroup, guest.assigned_table_group_id)
        if group and group.event_id != event.id:
            group = None

    table_query = select(SeatingTable).where(SeatingTable.event_id == event.id)
    if group:
        allowed_ids = await group_table_ids(group.id, db)
        if not allowed_ids:
            raise HTTPException(409, f"Table group '{group.name}' has no tables configured")
        table_query = table_query.where(SeatingTable.id.in_(allowed_ids))
    tables = (await db.execute(table_query.order_by(SeatingTable.sort_order, SeatingTable.name))).scalars().all()
    if not tables:
        raise HTTPException(409, "No seating tables are configured for room assignment")

    occupied = await _scoped_room_occupancy(event.id, scope, db)
    selected_table: SeatingTable | None = None
    selected_seat: int | None = None
    for table in tables:
        taken = occupied.get(table.id, set())
        for seat in range(1, table.capacity + 1):
            if seat not in taken:
                selected_table = table
                selected_seat = seat
                break
        if selected_table:
            break

    if not selected_table or selected_seat is None:
        label = f" for {group.name}" if group else ""
        raise HTTPException(409, f"No scoped room seats available{label}.")

    assignment = _room_assignment_config(step)
    room_name = assignment.get("room") or assignment.get("hall") or assignment.get("location")
    session = _session_config(step)
    return {
        "assignment_scope": scope,
        "assignment_mode": "scoped",
        "room": room_name or session.get("room") or None,
        "session_topic": session.get("topic") or None,
        "session_date": session.get("date") or None,
        "session_start_time": session.get("start_time") or None,
        "session_end_time": session.get("end_time") or None,
        "table_id": selected_table.id,
        "table_name": selected_table.name,
        "seat_number": str(selected_seat),
        "table_group_id": group.id if group else None,
        "table_group_name": group.name if group else None,
    }


async def _assign_room_for_step(
    event: Event,
    guest: Guest,
    step: ExperienceStep,
    db: AsyncSession,
    existing_metadata: dict | None = None,
) -> dict:
    if _room_assignment_is_scoped(step):
        return await _assign_scoped_room_for_step(event, guest, step, db, existing_metadata)

    table_count = await db.scalar(select(func.count(SeatingTable.id)).where(SeatingTable.event_id == event.id)) or 0
    if table_count == 0:
        raise HTTPException(409, "No seating tables are configured for room assignment")

    configured_group = await _configured_table_group(step, event.id, db)
    if configured_group and not guest.assigned_table_group_id:
        guest.assigned_table_group_id = configured_group.id

    error = await assign_next_seat(guest, db)
    if error:
        raise HTTPException(409, error)
    if not (guest.table_id and guest.seat_number):
        raise HTTPException(409, "No seat was assigned")

    if not guest.assigned_table_group_id:
        group_id = await db.scalar(
            select(TableGroupTable.table_group_id).where(TableGroupTable.table_id == guest.table_id).limit(1)
        )
        if group_id:
            guest.assigned_table_group_id = group_id

    table = await db.get(SeatingTable, guest.table_id)
    assigned_group = await db.get(TableGroup, guest.assigned_table_group_id) if guest.assigned_table_group_id else None
    return {
        "table_id": guest.table_id,
        "table_name": table.name if table else None,
        "seat_number": guest.seat_number,
        "table_group_id": assigned_group.id if assigned_group else None,
        "table_group_name": assigned_group.name if assigned_group else None,
    }


async def _queue_souvenir_completion_email(
    background_tasks: BackgroundTasks,
    event: Event,
    guest: Guest,
    step: ExperienceStep,
    db: AsyncSession,
) -> None:
    if not event.notify_email or not guest.email:
        return
    first_name = guest.first_name or "there"
    message = _step_message(step, "complete") or f"Your {step.title} has been marked complete for {event.name}."
    subject = f"{step.title} complete — {event.name}"
    body = (
        f"<p>Hi {html.escape(first_name)},</p>"
        f"<p>{html.escape(message)}</p>"
        f"<p>Thank you for attending {html.escape(event.name)}.</p>"
    )
    overrides = await load_overrides(event.id, db)
    ctx = build_template_context(event, guest, extras={
        "experience_step_title": step.title,
        "experience_step_message": message,
    })
    tmpl_subject, tmpl_body = template_email_or_default(overrides, "experience_souvenir_completion", ctx)
    if tmpl_body:
        subject = tmpl_subject or subject
        body = tmpl_body
    background_tasks.add_task(send_simple_email, guest.email, subject, body, event.id, None, guest.id, "experience_souvenir_completion")


async def _queue_room_assignment_email(
    background_tasks: BackgroundTasks,
    event: Event,
    guest: Guest,
    step: ExperienceStep,
    room_assignment: dict | None,
    db: AsyncSession,
) -> None:
    if not event.notify_email or not guest.email:
        return
    first_name = guest.first_name or "there"
    assignment = room_assignment or {}
    room = assignment.get("room")
    scope = assignment.get("assignment_scope")
    session_topic = assignment.get("session_topic")
    table_group_name = assignment.get("table_group_name")
    table_name = assignment.get("table_name")
    seat_number = assignment.get("seat_number")
    message = _step_message(step, "complete") or "Your room assignment is ready."
    details = []
    if session_topic:
        details.append(f"<li>Session: <strong>{html.escape(str(session_topic))}</strong></li>")
    if room:
        details.append(f"<li>Room: <strong>{html.escape(str(room))}</strong></li>")
    if scope and assignment.get("assignment_mode") == "scoped":
        details.append(f"<li>Assignment: <strong>{html.escape(str(scope))}</strong></li>")
    if table_group_name:
        details.append(f"<li>Group: <strong>{html.escape(str(table_group_name))}</strong></li>")
    if table_name:
        details.append(f"<li>Table: <strong>{html.escape(str(table_name))}</strong></li>")
    if seat_number:
        details.append(f"<li>Seat: <strong>{html.escape(str(seat_number))}</strong></li>")
    details_html = f"<ul>{''.join(details)}</ul>" if details else ""
    subject = f"Your room assignment — {event.name}"
    body = (
        f"<p>Hi {html.escape(first_name)},</p>"
        f"<p>{html.escape(message)}</p>"
        f"{details_html}"
        f"<p>Thank you for attending {html.escape(event.name)}.</p>"
    )
    overrides = await load_overrides(event.id, db)
    ctx = build_template_context(event, guest, extras={
        "experience_step_title": step.title,
        "experience_step_message": message,
        "room_name": room or "",
        "session_topic": session_topic or "",
        "table_group": table_group_name or "",
        "table_name": table_name or "",
        "seat_number": seat_number or "",
    })
    tmpl_subject, tmpl_body = template_email_or_default(overrides, "experience_room_assignment", ctx)
    if tmpl_body:
        subject = tmpl_subject or subject
        body = tmpl_body
    background_tasks.add_task(send_simple_email, guest.email, subject, body, event.id, None, guest.id, "experience_room_assignment")


async def _queue_session_attendance_email(
    background_tasks: BackgroundTasks,
    event: Event,
    guest: Guest,
    step: ExperienceStep,
    db: AsyncSession,
) -> None:
    if not event.notify_email or not guest.email:
        return
    session = _session_config(step)
    topic = session.get("topic") or step.title
    start = session.get("start_time") or ""
    end = session.get("end_time") or ""
    time_range = " - ".join([part for part in [start, end] if part])
    overrides = await load_overrides(event.id, db)
    ctx = build_template_context(event, guest, extras={
        "experience_step_title": step.title,
        "experience_step_message": _step_message(step, "complete") or f"Your attendance for {topic} has been recorded.",
        "session_topic": topic,
        "session_date": session.get("date") or "",
        "session_time": time_range,
        "session_room": session.get("room") or "",
        "session_speaker": session.get("speaker") or "",
    })
    subject, body = template_email_or_default(overrides, "experience_session_attendance", ctx)
    if body:
        background_tasks.add_task(send_simple_email, guest.email, subject or f"Session check-in recorded — {event.name}", body, event.id, None, guest.id, "experience_session_attendance")


def _session_config(step: ExperienceStep) -> dict:
    config = step.config or {}
    raw = (
        config.get("session")
        or config.get("session_details")
        or config.get("schedule")
        or config.get("session_config")
    )
    if not isinstance(raw, dict) and isinstance(config.get("sessions"), list) and config["sessions"]:
        raw = config["sessions"][0]
    if not isinstance(raw, dict):
        raw = {}
    session = {
        "topic": raw.get("topic") or raw.get("title") or raw.get("name") or "",
        "date": raw.get("date") or raw.get("session_date") or "",
        "start_time": raw.get("start_time") or raw.get("startTime") or raw.get("start") or "",
        "end_time": raw.get("end_time") or raw.get("endTime") or raw.get("end") or "",
        "room": raw.get("room") or raw.get("location") or raw.get("venue") or "",
        "speaker": raw.get("speaker") or raw.get("host") or raw.get("presenter") or "",
        "capacity": raw.get("capacity"),
        "checkin_window_minutes": raw.get("checkin_window_minutes") or raw.get("checkInWindowMinutes") or raw.get("checkin_window"),
    }
    return {key: value for key, value in session.items() if value not in (None, "")}


def _session_now() -> datetime:
    return datetime.now(EVENT_TZ)


def _parse_session_datetime(session: dict, time_key: str) -> datetime | None:
    date = str(session.get("date") or "").strip()
    time_value = str(session.get(time_key) or "").strip()
    if not date or not time_value:
        return None
    try:
        return datetime.fromisoformat(f"{date}T{time_value}").replace(tzinfo=EVENT_TZ)
    except ValueError:
        return None


def _session_check_in_window_minutes(session: dict) -> int | None:
    raw = session.get("checkin_window_minutes")
    if raw in (None, ""):
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise HTTPException(400, "Session check-in window must be a number of minutes")
    if value < 0:
        raise HTTPException(400, "Session check-in window cannot be negative")
    return value


def _assert_session_check_in_open(session: dict) -> None:
    window_minutes = _session_check_in_window_minutes(session)
    if window_minutes is None:
        return
    start_at = _parse_session_datetime(session, "start_time")
    if not start_at:
        return
    now = _session_now()
    opens_at = start_at - timedelta(minutes=window_minutes)
    if now < opens_at:
        raise HTTPException(
            409,
            f"Session check-in opens {window_minutes} minutes before start time.",
        )
    ends_at = _parse_session_datetime(session, "end_time")
    if ends_at and now > ends_at:
        raise HTTPException(409, "Session check-in is closed for this session.")


def _session_check_in_metadata(step: ExperienceStep, metadata: dict | None) -> dict:
    session = _session_config(step)
    if not any(str(value or "").strip() for value in session.values()):
        raise HTTPException(409, "Session attendance steps need session details before guests can be checked in")

    action = (metadata or {}).get("action")
    if action != "session_check_in":
        raise HTTPException(409, "Session attendance must be recorded as a session check-in")
    _assert_session_check_in_open(session)

    return {
        **(metadata or {}),
        "action": "session_check_in",
        "session_checked_in_at": datetime.utcnow().isoformat(),
        "session": {
            key: value
            for key, value in session.items()
            if value not in (None, "")
        },
    }


async def _experience_enabled_event(event_id: str, db: AsyncSession) -> Event:
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if not event.experience_enabled:
        raise HTTPException(404, "Experience workflow is not enabled for this event")
    return event


# ── Guest-facing surface (Guest Hub journey) ─────────────────────────────────
# Step types a guest may complete themselves from the Hub. Kept deliberately
# small: everything else stays staff-driven and is shown read-only.
GUEST_SELF_SERVICE_STEP_TYPES = {"consent", "feedback"}
_PENDING_STATUSES = {"not_started", "available", "failed"}


async def _guest_by_token(event_id: str, token: str, db: AsyncSession) -> Guest:
    """Resolve a guest from their invite_token or qr_token, scoped to the event.

    Mirrors the messaging-service Guest Hub auth so the same link that opens the
    Hub also authorises the journey view.
    """
    if not token:
        raise HTTPException(401, "Guest token required")
    guest = await db.scalar(
        select(Guest)
        .where(
            Guest.event_id == event_id,
            or_(Guest.invite_token == token, Guest.qr_token == token),
        )
        .limit(1)
    )
    if not guest:
        raise HTTPException(404, "Guest access not found")
    return guest


def _guest_display_name(guest: Guest) -> str:
    name = " ".join(part for part in (guest.first_name, guest.last_name) if part).strip()
    return name or "Guest"


def _guest_safe_step_metadata(step: ExperienceStep, row: GuestExperienceProgress | None) -> dict:
    if not row or not isinstance(row.progress_metadata, dict):
        return {}
    metadata = row.progress_metadata
    if step.type == "room_assignment":
        assignment = metadata.get("room_assignment")
        return {"room_assignment": assignment} if isinstance(assignment, dict) else {}
    if step.type == "session_attendance":
        safe = {}
        session = metadata.get("session")
        if isinstance(session, dict):
            safe["session"] = session
        checked_in_at = metadata.get("session_checked_in_at")
        if checked_in_at:
            safe["session_checked_in_at"] = checked_in_at
        return safe
    return {}


def _guest_step_out(step: ExperienceStep, row: GuestExperienceProgress | None) -> GuestJourneyStepOut:
    status = row.status if row else "available"
    self_service = step.type in GUEST_SELF_SERVICE_STEP_TYPES
    config = step.config or {}
    messages = config.get("messages") if isinstance(config.get("messages"), dict) else {}
    session = _session_config(step) if step.type == "session_attendance" else None
    return GuestJourneyStepOut(
        id=step.id,
        key=step.key,
        type=step.type,
        title=step.title,
        description=step.description,
        required=step.required,
        status=status,
        completed_at=row.completed_at if row else None,
        self_service=self_service,
        actionable=self_service and status in _PENDING_STATUSES,
        guest_message=messages.get("guest") or config.get("guest_message"),
        completion_message=messages.get("complete") or config.get("completion_message"),
        session=session or None,
        metadata=_guest_safe_step_metadata(step, row),
    )


async def _active_consent(event_id: str, db: AsyncSession) -> ConsentForm | None:
    return await db.scalar(
        select(ConsentForm)
        .where(ConsentForm.event_id == event_id, ConsentForm.is_active.is_(True))
        .order_by(ConsentForm.version.desc(), ConsentForm.created_at.desc())
        .limit(1)
    )


@router.get("/{event_id}/experience/workflows", response_model=list[ExperienceWorkflowOut])
async def workflows(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_member),
):
    return await list_workflows(event_id, db)


@router.get("/{event_id}/experience/dashboard", response_model=ExperienceDashboardOut)
async def experience_dashboard(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_member),
):
    await _experience_enabled_event(event_id, db)
    guest_total = await db.scalar(select(func.count(Guest.id)).where(Guest.event_id == event_id)) or 0
    workflow = await active_workflow(event_id, db)
    if not workflow:
        return ExperienceDashboardOut(event_id=event_id, guest_total=guest_total)

    await initialize_progress(event_id, workflow.id, db)
    await db.commit()
    loaded = await load_workflow(workflow.id, db)
    if not loaded:
        return ExperienceDashboardOut(event_id=event_id, guest_total=guest_total)
    loaded.steps.sort(key=lambda s: (s.sort_order, s.title))

    rows = (await db.execute(
        select(
            GuestExperienceProgress.step_id,
            GuestExperienceProgress.status,
            func.count(GuestExperienceProgress.id),
        )
        .where(GuestExperienceProgress.workflow_id == workflow.id)
        .group_by(GuestExperienceProgress.step_id, GuestExperienceProgress.status)
    )).all()
    counts: dict[str, dict[str, int]] = {}
    for step_id, status, count in rows:
        counts.setdefault(step_id, {})[status] = int(count)

    step_stats: list[ExperienceStepDashboardOut] = []
    completed_total = 0
    progress_total = 0
    statuses = ["not_started", "available", "blocked", "completed", "skipped", "failed", "overridden"]
    for step in loaded.steps:
        c = counts.get(step.id, {})
        total = sum(c.get(status, 0) for status in statuses)
        completed = c.get("completed", 0) + c.get("skipped", 0) + c.get("overridden", 0)
        completed_total += completed
        progress_total += total
        step_stats.append(ExperienceStepDashboardOut(
            step_id=step.id,
            key=step.key,
            type=step.type,
            title=step.title,
            sort_order=step.sort_order,
            required=step.required,
            enabled=step.enabled,
            not_started=c.get("not_started", 0),
            available=c.get("available", 0),
            blocked=c.get("blocked", 0),
            completed=c.get("completed", 0),
            skipped=c.get("skipped", 0),
            failed=c.get("failed", 0),
            overridden=c.get("overridden", 0),
            total=total,
            completion_rate=round((completed / total) * 100, 1) if total else 0,
        ))

    return ExperienceDashboardOut(
        event_id=event_id,
        workflow=loaded,
        guest_total=guest_total,
        step_count=len(loaded.steps),
        completed_total=completed_total,
        progress_total=progress_total,
        completion_rate=round((completed_total / progress_total) * 100, 1) if progress_total else 0,
        steps=step_stats,
    )


@router.get("/{event_id}/experience/audit", response_model=list[ExperienceEventOut])
async def experience_audit(
    event_id: str,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_member),
):
    capped = max(1, min(limit, 500))
    rows = (await db.execute(
        select(ExperienceEvent)
        .where(ExperienceEvent.event_id == event_id)
        .order_by(ExperienceEvent.occurred_at.desc())
        .limit(capped)
    )).scalars().all()
    return rows


@router.get("/{event_id}/experience/analytics")
async def experience_analytics(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_member),
):
    await _experience_enabled_event(event_id, db)
    workflow = await active_workflow(event_id, db)
    guest_total = await db.scalar(select(func.count(Guest.id)).where(Guest.event_id == event_id)) or 0
    if not workflow:
        return {
            "event_id": event_id,
            "guest_total": guest_total,
            "workflow": None,
            "bottlenecks": [],
            "consent": {"signed": 0, "total": guest_total, "rate": 0},
            "overrides": [],
            "staff_throughput": [],
            "step_timing": [],
        }
    await initialize_progress(event_id, workflow.id, db)
    await db.commit()
    loaded = await load_workflow(workflow.id, db)
    if not loaded:
        raise HTTPException(404, "Workflow not found")
    steps = sorted(loaded.steps, key=lambda s: (s.sort_order, s.title))
    progress = (await db.execute(
        select(GuestExperienceProgress).where(GuestExperienceProgress.workflow_id == workflow.id)
    )).scalars().all()
    by_step: dict[str, list[GuestExperienceProgress]] = {}
    for row in progress:
        by_step.setdefault(row.step_id, []).append(row)

    bottlenecks = []
    step_timing = []
    for step in steps:
        rows = by_step.get(step.id, [])
        total = len(rows)
        completed = sum(1 for r in rows if r.status in ("completed", "skipped", "overridden"))
        blocked = sum(1 for r in rows if r.status in ("blocked", "failed"))
        open_count = max(total - completed, 0)
        completion_rate = round((completed / total) * 100, 1) if total else 0
        completed_rows = [(r, _progress_start_time(r)) for r in rows if r.completed_at]
        completed_rows = [(r, started_at) for r, started_at in completed_rows if started_at]
        avg_minutes = None
        if completed_rows:
            total_seconds = sum(max((r.completed_at - started_at).total_seconds(), 0) for r, started_at in completed_rows)
            avg_minutes = round(total_seconds / len(completed_rows) / 60, 1)
        bottlenecks.append({
            "step_id": step.id,
            "key": step.key,
            "title": step.title,
            "type": step.type,
            "total": total,
            "open": open_count,
            "blocked": blocked,
            "completion_rate": completion_rate,
        })
        step_timing.append({
            "step_id": step.id,
            "title": step.title,
            "average_minutes_to_complete": avg_minutes,
            "timing_basis": "started_at_metadata" if avg_minutes is not None else "not_collected",
        })
    bottlenecks.sort(key=lambda row: (row["completion_rate"], -row["open"]))

    consent_signed = await db.scalar(
        select(func.count(ConsentSignature.id)).where(ConsentSignature.event_id == event_id)
    ) or 0
    override_rows = (await db.execute(
        select(GuestExperienceProgress)
        .where(
            GuestExperienceProgress.workflow_id == workflow.id,
            GuestExperienceProgress.status == "overridden",
        )
        .order_by(GuestExperienceProgress.updated_at.desc())
        .limit(100)
    )).scalars().all()
    step_by_id = {step.id: step for step in steps}
    overrides = [{
        "guest_id": row.guest_id,
        "step_id": row.step_id,
        "step_title": step_by_id.get(row.step_id).title if step_by_id.get(row.step_id) else row.step_id,
        "reason": row.override_reason,
        "completed_by_user_id": row.completed_by_user_id,
        "updated_at": row.updated_at,
    } for row in override_rows]

    throughput_rows = (await db.execute(
        select(
            GuestExperienceProgress.completed_by_user_id,
            GuestExperienceProgress.completed_by_source,
            func.count(GuestExperienceProgress.id),
        )
        .where(
            GuestExperienceProgress.workflow_id == workflow.id,
            GuestExperienceProgress.status.in_(["completed", "skipped", "overridden"]),
        )
        .group_by(GuestExperienceProgress.completed_by_user_id, GuestExperienceProgress.completed_by_source)
    )).all()
    staff_throughput = [{
        "user_id": user_id,
        "source": source or "system",
        "completed": int(count),
    } for user_id, source, count in throughput_rows]

    return {
        "event_id": event_id,
        "guest_total": guest_total,
        "workflow": ExperienceWorkflowOut.model_validate(loaded),
        "bottlenecks": bottlenecks,
        "consent": {
            "signed": consent_signed,
            "total": guest_total,
            "rate": round((consent_signed / guest_total) * 100, 1) if guest_total else 0,
        },
        "overrides": overrides,
        "staff_throughput": staff_throughput,
        "step_timing": step_timing,
    }


@router.get("/{event_id}/experience/export.csv")
async def experience_export(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_member),
):
    await _experience_enabled_event(event_id, db)
    workflow = await active_workflow(event_id, db)
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    await initialize_progress(event_id, workflow.id, db)
    await db.commit()
    guests = (await db.execute(select(Guest).where(Guest.event_id == event_id))).scalars().all()
    progress_rows = (await db.execute(
        select(GuestExperienceProgress)
        .where(GuestExperienceProgress.workflow_id == workflow.id)
    )).scalars().all()
    progress_by_guest_step = {(p.guest_id, p.step_id): p for p in progress_rows}

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([
        "guest_id", "first_name", "last_name", "email", "phone",
        "workflow", "workflow_version", "step_key", "step_title", "step_type",
        "status", "completed_at", "completed_by_source", "override_reason",
    ])
    steps = sorted(workflow.steps, key=lambda s: (s.sort_order, s.title))
    for guest in guests:
        for step in steps:
            progress = progress_by_guest_step.get((guest.id, step.id))
            writer.writerow([
                guest.id,
                guest.first_name,
                guest.last_name or "",
                guest.email or "",
                guest.phone or "",
                workflow.name,
                workflow.version,
                step.key,
                step.title,
                step.type,
                progress.status if progress else "available",
                progress.completed_at.isoformat() if progress and progress.completed_at else "",
                progress.completed_by_source if progress else "",
                progress.override_reason if progress else "",
            ])
    return Response(
        content=out.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="experience-progress.csv"'},
    )


@router.get("/{event_id}/experience/consent-form", response_model=ConsentFormOut | None)
async def get_consent_form(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_member),
):
    return await db.scalar(
        select(ConsentForm)
        .where(ConsentForm.event_id == event_id, ConsentForm.is_active.is_(True))
        .order_by(ConsentForm.version.desc(), ConsentForm.created_at.desc())
        .limit(1)
    )


@router.put("/{event_id}/experience/consent-form", response_model=ConsentFormOut)
async def save_consent_form(
    event_id: str,
    data: ConsentFormUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _assert_experience_plan(event)
    form = await db.scalar(
        select(ConsentForm)
        .where(ConsentForm.event_id == event_id, ConsentForm.is_active.is_(True))
        .order_by(ConsentForm.version.desc(), ConsentForm.created_at.desc())
        .limit(1)
    )
    if form:
        form.is_active = False
    latest_version = await db.scalar(
        select(ConsentForm.version)
        .where(ConsentForm.event_id == event_id)
        .order_by(ConsentForm.version.desc())
        .limit(1)
    )
    form = ConsentForm(
        event_id=event_id,
        title=data.title,
        body=data.body,
        require_signature=data.require_signature,
        version=(latest_version or 0) + 1,
        created_by=current_user.id,
    )
    db.add(form)
    await db.commit()
    await db.refresh(form)
    return form


@router.delete("/{event_id}/experience/consent-form")
async def disable_consent_form(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    form = await _active_consent(event_id, db)
    if not form:
        return {"disabled": False, "message": "Consent form is already disabled"}
    form.is_active = False
    workflow = await active_workflow(event_id, db)
    consent_step = next((step for step in (workflow.steps if workflow else []) if step.type == "consent" and step.enabled), None)
    if workflow:
        db.add(ExperienceEvent(
            event_id=event_id,
            workflow_id=workflow.id,
            step_id=consent_step.id if consent_step else None,
            actor_user_id=current_user.id,
            event_type="consent_form_disabled",
            source="admin",
            payload={"form_id": form.id, "form_version": form.version},
        ))
    await db.commit()
    return {"disabled": True, "form_id": form.id}


@router.get("/{event_id}/experience/consent-signatures", response_model=list[ConsentSignatureOut])
async def list_consent_signatures(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_member),
):
    rows = (await db.execute(
        select(ConsentSignature)
        .where(ConsentSignature.event_id == event_id)
        .order_by(ConsentSignature.signed_at.desc())
    )).scalars().all()
    return rows


@router.post("/{event_id}/experience/default-workflow", response_model=ExperienceWorkflowOut, status_code=201)
async def default_workflow(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _assert_experience_plan(event)
    return await create_default_workflow(event, db, actor_user_id=current_user.id)


@router.post("/{event_id}/experience/workflows", response_model=ExperienceWorkflowOut, status_code=201)
async def create_custom_workflow(
    event_id: str,
    data: ExperienceWorkflowCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _assert_experience_plan(event)
    _assert_unique_step_keys(data.steps)
    return await create_workflow(
        event,
        db,
        name=data.name,
        step_specs=[step.model_dump() for step in data.steps],
        actor_user_id=current_user.id,
    )


@router.get("/{event_id}/experience/workflows/{workflow_id}", response_model=ExperienceWorkflowOut)
async def workflow_detail(
    event_id: str,
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_member),
):
    return await _load_scoped_workflow(event_id, workflow_id, db)


@router.delete("/{event_id}/experience/workflows/{workflow_id}", status_code=204)
async def delete_workflow(
    event_id: str,
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _assert_experience_plan(event)
    workflow = await _load_scoped_workflow(event_id, workflow_id, db)
    if workflow.status != "draft":
        raise HTTPException(409, "Only draft workflows can be deleted. Archive published or historical workflows instead.")
    event = await db.get(Event, event_id)
    await db.execute(delete(GuestExperienceProgress).where(GuestExperienceProgress.workflow_id == workflow.id))
    await db.execute(delete(ExperienceEvent).where(ExperienceEvent.workflow_id == workflow.id))
    await db.delete(workflow)
    remaining_runtime_workflow = await db.scalar(
        select(ExperienceWorkflow.id)
        .where(
            ExperienceWorkflow.event_id == event_id,
            ExperienceWorkflow.id != workflow.id,
            (
                (ExperienceWorkflow.status == "published")
                | (
                    (ExperienceWorkflow.is_default.is_(True))
                    & (ExperienceWorkflow.status != "archived")
                )
            ),
        )
        .limit(1)
    )
    if event and not remaining_runtime_workflow:
        event.experience_enabled = False
    await db.commit()


@router.post("/{event_id}/experience/workflows/{workflow_id}/steps", response_model=ExperienceStepOut, status_code=201)
async def create_step(
    event_id: str,
    workflow_id: str,
    data: ExperienceStepCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _assert_experience_plan(event)
    workflow = await _load_scoped_workflow(event_id, workflow_id, db)
    _ensure_draft(workflow)
    if await _step_key_exists(workflow.id, data.key, db):
        raise HTTPException(409, "A step with this key already exists in the workflow")
    step = ExperienceStep(workflow_id=workflow.id, **data.model_dump())
    db.add(step)
    await db.commit()
    await db.refresh(step)
    return step


@router.post("/{event_id}/experience/workflows/{workflow_id}/program/import", response_model=list[ExperienceStepOut], status_code=201)
async def import_program_segments(
    event_id: str,
    workflow_id: str,
    data: ProgramSegmentImport,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Bulk-create agenda steps in a draft only; publishing remains explicit."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _assert_experience_plan(event)
    workflow = await _load_scoped_workflow(event_id, workflow_id, db)
    _ensure_draft(workflow)
    requested = [item.key for item in data.items]
    if len(requested) != len(set(requested)):
        raise HTTPException(422, "Program item keys must be unique")
    existing = {step.key for step in workflow.steps}
    conflict = next((key for key in requested if key in existing), None)
    if conflict:
        raise HTTPException(409, f"A step with key '{conflict}' already exists")
    created = []
    order = max([step.sort_order for step in workflow.steps] or [0]) + 10
    for item in data.items:
        config = {"program": {"category": item.category} if item.category else {}}
        if item.announce:
            config["announce"] = {
                "enabled": True,
                **({"title": item.announcement_title} if item.announcement_title else {}),
                **({"body": item.announcement_body} if item.announcement_body else {}),
            }
        step = ExperienceStep(
            workflow_id=workflow.id, key=item.key, type="custom", title=item.title,
            description=item.description, sort_order=order, required=False, enabled=True,
            is_segment=True, starts_offset_seconds=item.starts_offset_seconds,
            duration_seconds=item.duration_seconds, config=config,
        )
        order += 10
        db.add(step)
        created.append(step)
    await db.commit()
    for step in created:
        await db.refresh(step)
    return created


@router.put("/{event_id}/experience/workflows/{workflow_id}/steps/{step_id}", response_model=ExperienceStepOut)
async def update_step(
    event_id: str,
    workflow_id: str,
    step_id: str,
    data: ExperienceStepUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _assert_experience_plan(event)
    workflow = await _load_scoped_workflow(event_id, workflow_id, db)
    _ensure_draft(workflow)
    step = await db.get(ExperienceStep, step_id)
    if not step or step.workflow_id != workflow.id:
        raise HTTPException(404, "Step not found")
    payload = data.model_dump(exclude_unset=True)
    if "key" in payload and await _step_key_exists(workflow.id, payload["key"], db, exclude_step_id=step.id):
        raise HTTPException(409, "A step with this key already exists in the workflow")
    for field, value in payload.items():
        setattr(step, field, value)
    await db.commit()
    await db.refresh(step)
    return step


@router.delete("/{event_id}/experience/workflows/{workflow_id}/steps/{step_id}", status_code=204)
async def delete_step(
    event_id: str,
    workflow_id: str,
    step_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _assert_experience_plan(event)
    workflow = await _load_scoped_workflow(event_id, workflow_id, db)
    _ensure_draft(workflow)
    step = await db.get(ExperienceStep, step_id)
    if not step or step.workflow_id != workflow.id:
        raise HTTPException(404, "Step not found")
    deleted_refs = {step.id, step.key}
    for other in workflow.steps:
        if other.id == step.id:
            continue
        config = dict(other.config or {})
        changed = False
        for key in ("depends_on", "depends_on_steps", "depends_on_keys", "prerequisites"):
            raw = config.get(key)
            if not raw:
                continue
            values = raw if isinstance(raw, list) else [raw]
            kept = [value for value in values if str(value) not in deleted_refs]
            if len(kept) != len(values):
                changed = True
                if kept:
                    config[key] = kept
                else:
                    config.pop(key, None)
        if changed:
            other.config = config or None

    await db.execute(delete(GuestExperienceProgress).where(GuestExperienceProgress.step_id == step.id))
    await db.execute(
        delete(ExperienceEvent).where(
            ExperienceEvent.event_id == event_id,
            ExperienceEvent.workflow_id == workflow.id,
            ExperienceEvent.step_id == step.id,
        )
    )
    await db.delete(step)
    await db.commit()


@router.post("/{event_id}/experience/workflows/{workflow_id}/steps/reorder", response_model=ExperienceWorkflowOut)
async def reorder_steps(
    event_id: str,
    workflow_id: str,
    data: ExperienceStepReorder,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    workflow = await _load_scoped_workflow(event_id, workflow_id, db)
    _ensure_draft(workflow)
    current_ids = {step.id for step in workflow.steps}
    requested_ids = set(data.step_ids)
    if len(data.step_ids) != len(requested_ids) or requested_ids != current_ids:
        raise HTTPException(400, "Reorder must include each workflow step exactly once")
    steps_by_id = {step.id: step for step in workflow.steps}
    for index, step_id in enumerate(data.step_ids):
        steps_by_id[step_id].sort_order = (index + 1) * 10
    await db.commit()
    return await _load_scoped_workflow(event_id, workflow_id, db)


@router.post("/{event_id}/experience/workflows/{workflow_id}/publish", response_model=ExperienceWorkflowOut)
async def publish(
    event_id: str,
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _assert_experience_plan(event)
    workflow = await _load_scoped_workflow(event_id, workflow_id, db)
    if workflow.status != "draft":
        raise HTTPException(409, "Only draft workflows can be published")
    if not any(step.enabled for step in workflow.steps):
        raise HTTPException(400, "A workflow must have at least one enabled step before publishing")
    existing_published = await db.scalar(
        select(ExperienceWorkflow)
        .where(
            ExperienceWorkflow.event_id == event_id,
            ExperienceWorkflow.id != workflow.id,
            ExperienceWorkflow.status == "published",
        )
        .limit(1)
    )
    if existing_published:
        raise HTTPException(409, f"Unpublish '{existing_published.name}' before publishing another workflow")
    published = await publish_workflow(workflow, event, db, actor_user_id=current_user.id)
    queue_announcement(
        db,
        event_id=event_id,
        title="Experience updated",
        body=f"{workflow.name} is now available for {event.name}.",
        kind="experience",
        source_ref=f"workflow-published:{workflow.id}:v{workflow.version}",
    )
    await db.commit()
    return published


@router.post("/{event_id}/experience/workflows/{workflow_id}/unpublish", response_model=ExperienceWorkflowOut)
async def unpublish(
    event_id: str,
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    workflow = await _load_scoped_workflow(event_id, workflow_id, db)
    if workflow.status != "published":
        raise HTTPException(409, "Only published workflows can be unpublished")
    return await unpublish_workflow(workflow, event, db, actor_user_id=current_user.id)


@router.post("/{event_id}/experience/workflows/{workflow_id}/archive", response_model=ExperienceWorkflowOut)
async def archive(
    event_id: str,
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    workflow = await _load_scoped_workflow(event_id, workflow_id, db)
    if workflow.status == "archived":
        raise HTTPException(409, "Workflow is already archived")
    return await archive_workflow(workflow, event, db, actor_user_id=current_user.id)


@router.post("/{event_id}/experience/workflows/{workflow_id}/unarchive", response_model=ExperienceWorkflowOut)
async def unarchive(
    event_id: str,
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    workflow = await _load_scoped_workflow(event_id, workflow_id, db)
    if workflow.status != "archived":
        raise HTTPException(409, "Only archived workflows can be unarchived")
    return await unarchive_workflow(workflow, db, actor_user_id=current_user.id)


@router.post(
    "/{event_id}/experience/workflows/{workflow_id}/clone",
    response_model=ExperienceWorkflowOut,
    status_code=201,
)
async def clone(
    event_id: str,
    workflow_id: str,
    data: ExperienceWorkflowClone,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    workflow = await _load_scoped_workflow(event_id, workflow_id, db)
    return await clone_workflow(workflow, db, name=data.name, actor_user_id=current_user.id)


@router.get("/{event_id}/experience/guests/{guest_id}", response_model=GuestExperienceOut)
async def guest_experience(
    event_id: str,
    guest_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_member),
):
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    await _experience_enabled_event(event_id, db)
    workflow = await active_workflow(event_id, db)
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    await sync_guest_progress(event_id, guest_id, db)
    await db.commit()
    loaded = await load_workflow(workflow.id, db)
    if not loaded:
        raise HTTPException(404, "Workflow not found")
    progress = (await db.execute(
        select(GuestExperienceProgress)
        .where(
            GuestExperienceProgress.workflow_id == workflow.id,
            GuestExperienceProgress.guest_id == guest_id,
        )
    )).scalars().all()
    step_order = {step.id: i for i, step in enumerate(sorted(loaded.steps, key=lambda s: (s.sort_order, s.title)))}
    progress.sort(key=lambda p: step_order.get(p.step_id, 10_000))
    return GuestExperienceOut(
        guest_id=guest_id,
        workflow=loaded,
        progress=[_progress_out(row) for row in progress],
    )


@router.get("/{event_id}/experience/guests/{guest_id}/next-steps", response_model=list[ExperienceNextStepOut])
async def guest_next_steps(
    event_id: str,
    guest_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_member),
):
    await _ensure_runtime_operator(event_id, current_user, db)
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    rows = await next_guest_steps(event_id, guest_id, db)
    await db.commit()
    return [_next_step_out(step, progress) for step, progress in rows]


@router.put(
    "/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
    response_model=GuestExperienceProgressOut,
)
async def update_guest_step_progress(
    event_id: str,
    guest_id: str,
    step_id: str,
    data: ExperienceProgressUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_member),
):
    event = await _ensure_runtime_operator(event_id, current_user, db)
    if not event.experience_enabled:
        raise HTTPException(403, "Experience workflow is not enabled for this event")
    workflow = await active_workflow(event_id, db)
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    step = next((s for s in workflow.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(404, "Step not found")
    await _ensure_step_permission(event, step, current_user, db)
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    await sync_guest_progress(event_id, guest_id, db)

    progress = await db.scalar(
        select(GuestExperienceProgress)
        .where(
            GuestExperienceProgress.workflow_id == workflow.id,
            GuestExperienceProgress.step_id == step_id,
            GuestExperienceProgress.guest_id == guest_id,
        )
    )
    if not progress:
        progress = GuestExperienceProgress(
            event_id=event_id,
            workflow_id=workflow.id,
            step_id=step_id,
            guest_id=guest_id,
            status="available",
        )
        db.add(progress)

    was_completed = progress.status == "completed"

    if data.status in ("completed", "skipped"):
        progress_rows = (await db.execute(
            select(GuestExperienceProgress)
            .where(
                GuestExperienceProgress.workflow_id == workflow.id,
                GuestExperienceProgress.guest_id == guest_id,
            )
        )).scalars().all()
        progress_by_step_id = {row.step_id: row for row in progress_rows}
        progress_by_step_id[progress.step_id] = progress
        steps_by_key_or_id = {value: item for item in workflow.steps for value in (item.id, item.key)}
        if not dependencies_satisfied(step, steps_by_key_or_id, progress_by_step_id):
            raise HTTPException(409, "This step is blocked until its required prior steps are complete")

    metadata = data.metadata
    if data.status == "completed" and step.type == "room_assignment":
        existing_metadata = progress.progress_metadata if isinstance(progress.progress_metadata, dict) else None
        room_assignment = await _assign_room_for_step(event, guest, step, db, existing_metadata)
        metadata = {**(metadata or {}), "room_assignment": room_assignment}
    if data.status == "completed" and step.type == "session_attendance":
        metadata = _session_check_in_metadata(step, metadata)

    progress.status = data.status
    progress.override_reason = data.override_reason
    progress.progress_metadata = metadata
    if data.status in ("completed", "skipped", "overridden"):
        from datetime import datetime
        progress.completed_at = progress.completed_at or datetime.utcnow()
        progress.completed_by_user_id = current_user.id
        progress.completed_by_source = "admin" if current_user.role == "admin" else "staff"
    elif data.status in ("available", "blocked", "failed"):
        progress.completed_at = None
        progress.completed_by_user_id = None
        progress.completed_by_source = None

    db.add(ExperienceEvent(
        event_id=event_id,
        workflow_id=workflow.id,
        step_id=step.id,
        guest_id=guest.id,
        actor_user_id=current_user.id,
        event_type={
            "completed": "step_completed",
            "skipped": "step_skipped",
            "failed": "step_failed",
            "overridden": "override_applied",
        }.get(data.status, "step_updated"),
        source="admin" if current_user.role == "admin" else "staff",
        payload={"status": data.status, "override_reason": data.override_reason, "metadata": metadata or {}},
    ))
    await db.commit()
    await db.refresh(progress)
    if data.status == "completed" and step.type == "souvenir" and not was_completed:
        await _queue_souvenir_completion_email(background_tasks, event, guest, step, db)
    if data.status == "completed" and step.type == "room_assignment" and not was_completed:
        await _queue_room_assignment_email(background_tasks, event, guest, step, (metadata or {}).get("room_assignment"), db)
    if data.status == "completed" and step.type == "session_attendance" and not was_completed:
        await _queue_session_attendance_email(background_tasks, event, guest, step, db)
    return _progress_out(progress)


# ── Guest-facing endpoints (token auth, no staff login) ──────────────────────

@router.get("/{event_id}/experience/me", response_model=GuestJourneyOut)
async def my_experience(
    event_id: str,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """The signed-in guest's own journey: ordered steps with status, the pending
    next-steps, and consent state. Safe to call for any event — returns
    ``experience_enabled=False`` when the feature is off so the Hub can simply
    hide the section."""
    guest = await _guest_by_token(event_id, token, db)
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    guest_out = GuestJourneyGuestOut(
        id=guest.id, name=_guest_display_name(guest), rsvp_status=guest.rsvp_status,
    )
    consent_form = await _active_consent(event_id, db)
    consent_state = None
    if consent_form:
        signed = await db.scalar(
            select(ConsentSignature)
            .where(
                ConsentSignature.event_id == event_id,
                ConsentSignature.form_id == consent_form.id,
                ConsentSignature.guest_id == guest.id,
            )
            .limit(1)
        )
        consent_state = GuestConsentStateOut(
            required=bool(consent_form.require_signature),
            signed=bool(signed),
            signed_at=signed.signed_at if signed else None,
            form=ConsentFormOut.model_validate(consent_form),
        )

    if not event.experience_enabled:
        return GuestJourneyOut(experience_enabled=False, guest=guest_out, consent=consent_state)

    workflow = await active_workflow(event_id, db)
    if not workflow:
        return GuestJourneyOut(experience_enabled=True, guest=guest_out, consent=consent_state)

    # next_guest_steps() syncs progress off the guest's current state (admitted,
    # seat, meal choice, consent signature) before returning the pending set.
    next_rows = await next_guest_steps(event_id, guest.id, db)
    await db.commit()

    loaded = await load_workflow(workflow.id, db)
    if not loaded:
        return GuestJourneyOut(experience_enabled=True, guest=guest_out, consent=consent_state)
    progress_by_step = {
        row.step_id: row
        for row in (await db.execute(
            select(GuestExperienceProgress).where(
                GuestExperienceProgress.workflow_id == loaded.id,
                GuestExperienceProgress.guest_id == guest.id,
            )
        )).scalars().all()
    }
    consent_signed = bool(consent_state and consent_state.signed)
    # With the Live Program on, timed segments render in the program section —
    # repeating all of them in the activity checklist buried the few actionable
    # steps under dozens of agenda cards (and inflated "N/M done").
    hide_segments = bool(event.live_program_enabled)
    steps_sorted = sorted(
        (s for s in loaded.steps if s.enabled and not (hide_segments and s.is_segment)),
        key=lambda s: (s.sort_order, s.title),
    )
    steps_out = [_guest_step_out(step, progress_by_step.get(step.id)) for step in steps_sorted]
    # A guest can sign consent from the Hub before check-in, so the workflow may
    # still hold the consent step "blocked" behind earlier steps. Once signed,
    # present it as done in the guest's own view so the timeline and the consent
    # card agree.
    if consent_signed:
        for s in steps_out:
            if s.type == "consent" and s.status not in ("completed", "overridden"):
                s.status = "completed"
                s.actionable = False
    next_out = [
        _guest_step_out(step, row)
        for step, row in next_rows
        if not (hide_segments and step.is_segment)
    ]
    completed = sum(1 for s in steps_out if s.status in ("completed", "overridden"))

    return GuestJourneyOut(
        experience_enabled=True,
        guest=guest_out,
        workflow=GuestJourneyWorkflowOut(id=loaded.id, name=loaded.name, version=loaded.version),
        steps=steps_out,
        next_steps=next_out,
        consent=consent_state,
        program=GuestProgramOut(**(await program_state(event, loaded, db))),
        completed_count=completed,
        total_count=len(steps_out),
    )


@router.post(
    "/{event_id}/experience/me/consent/sign",
    response_model=ConsentSignatureOut,
    status_code=201,
)
async def sign_my_consent(
    event_id: str,
    data: ConsentSignatureCreate,
    request: Request,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """A guest signs the event's active consent form from the Hub. Idempotent:
    re-signing returns the existing signature. Marks the consent step complete."""
    guest = await _guest_by_token(event_id, token, db)
    event = await db.get(Event, event_id)
    if not event or not event.experience_enabled:
        raise HTTPException(404, "Experience workflow is not enabled for this event")
    form = await _active_consent(event_id, db)
    if not form:
        raise HTTPException(404, "No consent form is active for this event")

    existing = await db.scalar(
        select(ConsentSignature)
        .where(ConsentSignature.form_id == form.id, ConsentSignature.guest_id == guest.id)
        .limit(1)
    )
    if existing:
        return existing

    signature = ConsentSignature(
        event_id=event_id,
        form_id=form.id,
        guest_id=guest.id,
        signer_name=data.signer_name,
        signature_text=data.signature_text,
        ip_address=(request.client.host if request.client else None),
        user_agent=(request.headers.get("user-agent") or "")[:500] or None,
    )
    db.add(signature)
    await db.flush()

    # Reflect the new signature into workflow progress (completes the consent step).
    await sync_guest_progress(event_id, guest.id, db, source="guest")
    workflow = await active_workflow(event_id, db)
    if workflow:
        consent_step = next((s for s in workflow.steps if s.type == "consent"), None)
        db.add(ExperienceEvent(
            event_id=event_id,
            workflow_id=workflow.id,
            step_id=consent_step.id if consent_step else None,
            guest_id=guest.id,
            event_type="consent_signed",
            source="guest",
            payload={"form_id": form.id, "form_version": form.version},
        ))
    await db.commit()
    await db.refresh(signature)
    return signature


# ── Feedback Experience step ────────────────────────────────────────────────

_FEEDBACK_TYPES = {"rating", "nps", "single_choice", "multi_choice", "yes_no", "text"}


def _feedback_questions(step: ExperienceStep) -> list[dict]:
    raw = (step.config or {}).get("feedback") or {}
    questions = raw.get("questions") if isinstance(raw, dict) else []
    return [q for q in (questions or []) if isinstance(q, dict) and q.get("id") and q.get("prompt")]


def _parse_feedback_time(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except (TypeError, ValueError):
        return None


def _feedback_availability(step: ExperienceStep) -> dict:
    feedback = (step.config or {}).get("feedback") or {}
    now = datetime.utcnow()
    opens_at = _parse_feedback_time(feedback.get("opens_at"))
    closes_at = _parse_feedback_time(feedback.get("closes_at"))
    configured = str(feedback.get("status") or "open").lower()
    if configured == "closed":
        status = "closed"
    elif opens_at and now < opens_at:
        status = "scheduled"
    elif closes_at and now > closes_at:
        status = "closed"
    else:
        status = "open"
    return {"status": status, "open": status == "open", "opens_at": opens_at, "closes_at": closes_at}


async def _feedback_audience_allows(step: ExperienceStep, guest: Guest, db: AsyncSession) -> bool:
    feedback = (step.config or {}).get("feedback") or {}
    audience = feedback.get("audience", "all") if isinstance(feedback, dict) else "all"
    if audience == "checked_in":
        return bool(guest.admitted)
    if audience in {"session", "session_attendees"}:
        target = str(feedback.get("session_step_id") or "")
        if not target:
            target_key = str(feedback.get("session_step_key") or "")
            if target_key:
                target = str(await db.scalar(select(ExperienceStep.id).where(
                    ExperienceStep.workflow_id == step.workflow_id, ExperienceStep.key == target_key
                ).limit(1)) or "")
        if not target:
            return False
        status = await db.scalar(select(GuestExperienceProgress.status).where(
            GuestExperienceProgress.guest_id == guest.id,
            GuestExperienceProgress.step_id == target,
            GuestExperienceProgress.status.in_(["completed", "overridden"]),
        ).limit(1))
        return bool(status)
    return True


def _question_visible(question: dict, answers: dict) -> bool:
    condition = question.get("show_if")
    if not isinstance(condition, dict) or not condition.get("question_id"):
        return True
    actual = answers.get(str(condition["question_id"]))
    expected = condition.get("value")
    if isinstance(actual, list):
        return str(expected) in [str(v) for v in actual]
    return str(actual).lower() == str(expected).lower()


def _validate_feedback_answers(questions: list[dict], answers: dict) -> dict:
    if not isinstance(answers, dict):
        raise HTTPException(422, "Feedback answers must be an object")
    cleaned = {}
    for question in questions:
        qid = str(question["id"])
        kind = str(question.get("type") or "text")
        if kind not in _FEEDBACK_TYPES:
            raise HTTPException(422, f"Unsupported feedback question type: {kind}")
        if not _question_visible(question, answers):
            continue
        value = answers.get(qid)
        missing = value is None or value == [] or (isinstance(value, str) and not value.strip())
        if question.get("required") and missing:
            raise HTTPException(422, f"Please answer: {question['prompt']}")
        if missing:
            continue
        if kind == "rating":
            try: value = int(value)
            except (TypeError, ValueError): raise HTTPException(422, f"Invalid rating for: {question['prompt']}")
            if value < 1 or value > 5: raise HTTPException(422, "Ratings must be between 1 and 5")
        elif kind == "nps":
            try: value = int(value)
            except (TypeError, ValueError): raise HTTPException(422, f"Invalid score for: {question['prompt']}")
            if value < 0 or value > 10: raise HTTPException(422, "Recommendation scores must be between 0 and 10")
        elif kind == "yes_no":
            value = str(value).lower()
            if value not in {"yes", "no"}: raise HTTPException(422, "Yes/No answers must be yes or no")
        elif kind == "single_choice":
            value = str(value).strip()
            if value not in [str(v) for v in (question.get("options") or [])]:
                raise HTTPException(422, f"Invalid choice for: {question['prompt']}")
        elif kind == "multi_choice":
            if not isinstance(value, list):
                raise HTTPException(422, f"Select one or more choices for: {question['prompt']}")
            allowed = [str(v) for v in (question.get("options") or [])]
            value = list(dict.fromkeys(str(v).strip() for v in value if str(v).strip()))
            if any(v not in allowed for v in value):
                raise HTTPException(422, f"Invalid choice for: {question['prompt']}")
        else:
            value = str(value).strip()[:5000]
        cleaned[qid] = value
    return cleaned


@router.get("/{event_id}/experience/me/feedback")
async def my_feedback(event_id: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    guest = await _guest_by_token(event_id, token, db)
    event = await _experience_enabled_event(event_id, db)
    workflow = await active_workflow(event_id, db)
    if not workflow:
        return {"forms": []}
    loaded = await load_workflow(workflow.id, db)
    forms = []
    for step in sorted((loaded.steps if loaded else []), key=lambda s: (s.sort_order, s.title)):
        questions = _feedback_questions(step)
        if step.type != "feedback" or not step.enabled or not questions or not await _feedback_audience_allows(step, guest, db):
            continue
        program_window = await feedback_availability(event, loaded, db, step.id)
        if program_window["controlled"] and not program_window["open"]:
            continue
        existing = await db.scalar(select(FeedbackSubmission).where(
            FeedbackSubmission.step_id == step.id, FeedbackSubmission.guest_id == guest.id
        ).limit(1))
        feedback = (step.config or {}).get("feedback") or {}
        availability = _feedback_availability(step)
        allow_edit = bool(feedback.get("allow_edit"))
        forms.append({
            "step_id": step.id, "title": step.title, "description": step.description,
            "questions": questions, "anonymous": bool(feedback.get("anonymous")),
            "submitted": bool(existing), "submitted_at": existing.submitted_at if existing else None,
            "answers": existing.answers if existing else {},
            **availability, "allow_edit": allow_edit,
            "can_edit": bool(existing and allow_edit and availability["open"]),
            "program_window": program_window["window"],
        })
    return {"event_id": event.id, "forms": forms}


@router.post("/{event_id}/experience/me/feedback", status_code=201)
async def submit_my_feedback(
    event_id: str, data: dict, token: str = Query(...), db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit(limit=12, window=60, scope="feedback_submit", key="event_id")),
):
    guest = await _guest_by_token(event_id, token, db)
    await _experience_enabled_event(event_id, db)
    workflow = await active_workflow(event_id, db)
    step_id = str(data.get("step_id") or "")
    step = await db.get(ExperienceStep, step_id)
    if not workflow or not step or step.workflow_id != workflow.id or step.type != "feedback" or not step.enabled:
        raise HTTPException(404, "Feedback form not found")
    if not await _feedback_audience_allows(step, guest, db):
        raise HTTPException(403, "This feedback form is not available for this guest")
    loaded = await load_workflow(workflow.id, db)
    program_window = await feedback_availability(await _experience_enabled_event(event_id, db), loaded or workflow, db, step.id)
    if program_window["controlled"] and not program_window["open"]:
        raise HTTPException(409, "This feedback form is not open")
    questions = _feedback_questions(step)
    answers = _validate_feedback_answers(questions, data.get("answers") or {})
    feedback = (step.config or {}).get("feedback") or {}
    availability = _feedback_availability(step)
    if not availability["open"]:
        raise HTTPException(409, "This feedback form is not open")
    submission = await db.scalar(select(FeedbackSubmission).where(
        FeedbackSubmission.step_id == step.id, FeedbackSubmission.guest_id == guest.id
    ).limit(1))
    was_existing = bool(submission)
    if submission:
        if not feedback.get("allow_edit"):
            raise HTTPException(409, "This feedback response has already been submitted")
        submission.answers = answers
        submission.question_snapshot = questions
        submission.updated_at = datetime.utcnow()
    else:
        submission = FeedbackSubmission(
            event_id=event_id, workflow_id=workflow.id, step_id=step.id, guest_id=guest.id,
            answers=answers, question_snapshot=questions, anonymous=bool(feedback.get("anonymous")),
        )
        db.add(submission)
    await db.flush()
    progress = await db.scalar(select(GuestExperienceProgress).where(
        GuestExperienceProgress.step_id == step.id, GuestExperienceProgress.guest_id == guest.id
    ).limit(1))
    if not progress:
        progress = GuestExperienceProgress(
            event_id=event_id, workflow_id=workflow.id, step_id=step.id, guest_id=guest.id,
        )
        db.add(progress)
    progress.status = "completed"
    progress.completed_at = datetime.utcnow()
    progress.completed_by_source = "guest"
    progress.progress_metadata = {"feedback_submission_id": submission.id}
    db.add(ExperienceEvent(
        event_id=event_id, workflow_id=workflow.id, step_id=step.id, guest_id=guest.id,
        event_type="feedback_updated" if was_existing else "feedback_submitted", source="guest", payload={"anonymous": bool(feedback.get("anonymous"))},
    ))
    await db.commit()
    await db.refresh(submission)
    return {"id": submission.id, "step_id": step.id, "submitted_at": submission.submitted_at}


def _feedback_aggregates(questions: list[dict], responses: list[dict]) -> list[dict]:
    aggregates = []
    for question in questions:
        qid = str(question["id"])
        kind = str(question.get("type") or "text")
        values = [r["answers"].get(qid) for r in responses if r["answers"].get(qid) not in (None, "", [])]
        item = {"question_id": qid, "prompt": question["prompt"], "type": kind, "answer_count": len(values)}
        if kind in {"rating", "nps"}:
            numeric = [float(v) for v in values if isinstance(v, (int, float)) or str(v).replace(".", "", 1).isdigit()]
            item["average"] = round(sum(numeric) / len(numeric), 2) if numeric else None
            item["distribution"] = {str(n): sum(1 for v in numeric if int(v) == n) for n in range(1 if kind == "rating" else 0, 6 if kind == "rating" else 11)}
            if kind == "nps" and numeric:
                promoters = sum(1 for v in numeric if v >= 9)
                detractors = sum(1 for v in numeric if v <= 6)
                item.update({
                    "nps": round((promoters - detractors) * 100 / len(numeric)),
                    "promoters": promoters,
                    "passives": len(numeric) - promoters - detractors,
                    "detractors": detractors,
                })
        elif kind in {"single_choice", "multi_choice", "yes_no"}:
            options = [str(v) for v in question.get("options") or []]
            if kind == "yes_no": options = ["yes", "no"]
            flat = [str(choice) for value in values for choice in (value if isinstance(value, list) else [value])]
            item["distribution"] = {option: flat.count(option) for option in options}
        elif kind == "text":
            item["comments"] = [str(v) for v in values]
        aggregates.append(item)
    return aggregates


async def _feedback_results_data(
    event_id: str, db: AsyncSession, *, search: str = "", admitted: bool | None = None,
    submitted_from: datetime | None = None, submitted_to: datetime | None = None,
    guest_role: str = "", ticket_type_id: str = "", table_group_id: str = "",
) -> dict:
    workflow = await active_workflow(event_id, db)
    if not workflow:
        return {"forms": []}
    loaded = await load_workflow(workflow.id, db)
    forms = []
    for step in sorted((loaded.steps if loaded else []), key=lambda s: (s.sort_order, s.title)):
        questions = _feedback_questions(step)
        if step.type != "feedback" or not questions:
            continue
        query = (select(FeedbackSubmission, Guest).join(Guest, Guest.id == FeedbackSubmission.guest_id)
            .where(FeedbackSubmission.event_id == event_id, FeedbackSubmission.step_id == step.id))
        if admitted is not None: query = query.where(Guest.admitted == admitted)
        if guest_role: query = query.where(Guest.rsvp_guest_type == guest_role)
        if ticket_type_id: query = query.where(Guest.ticket_type_id == ticket_type_id)
        if table_group_id: query = query.where(Guest.assigned_table_group_id == table_group_id)
        if submitted_from: query = query.where(FeedbackSubmission.submitted_at >= submitted_from)
        if submitted_to: query = query.where(FeedbackSubmission.submitted_at <= submitted_to)
        if search:
            needle = f"%{search.strip()}%"
            query = query.where(or_(Guest.first_name.ilike(needle), Guest.last_name.ilike(needle), Guest.email.ilike(needle)))
        rows = (await db.execute(query.order_by(FeedbackSubmission.submitted_at.desc()))).all()
        responses = [{
            "id": submission.id,
            "guest_name": None if submission.anonymous else _guest_display_name(guest),
            "submitted_at": submission.submitted_at,
            "answers": submission.answers,
        } for submission, guest in rows]
        guest_query = select(Guest).where(Guest.event_id == event_id)
        if admitted is not None: guest_query = guest_query.where(Guest.admitted == admitted)
        if guest_role: guest_query = guest_query.where(Guest.rsvp_guest_type == guest_role)
        if ticket_type_id: guest_query = guest_query.where(Guest.ticket_type_id == ticket_type_id)
        if table_group_id: guest_query = guest_query.where(Guest.assigned_table_group_id == table_group_id)
        if search:
            needle = f"%{search.strip()}%"
            guest_query = guest_query.where(or_(Guest.first_name.ilike(needle), Guest.last_name.ilike(needle), Guest.email.ilike(needle)))
        guests = (await db.scalars(guest_query)).all()
        eligible_count = 0
        for guest in guests:
            if await _feedback_audience_allows(step, guest, db):
                eligible_count += 1
        response_count = len(responses)
        feedback = (step.config or {}).get("feedback") or {}
        forms.append({
            "step_id": step.id, "title": step.title, "questions": questions,
            "audience": feedback.get("audience", "all"), "availability": _feedback_availability(step),
            "eligible_count": eligible_count, "response_count": response_count,
            "response_rate": round(response_count * 100 / eligible_count, 1) if eligible_count else 0,
            "aggregates": _feedback_aggregates(questions, responses), "responses": responses,
        })
    return {"workflow_id": workflow.id, "forms": forms}


@router.get("/{event_id}/experience/feedback/results")
async def feedback_results(
    event_id: str, search: str = Query("", max_length=120), admitted: bool | None = Query(None),
    submitted_from: datetime | None = Query(None), submitted_to: datetime | None = Query(None),
    guest_role: str = Query("", max_length=120), ticket_type_id: str = Query("", max_length=36), table_group_id: str = Query("", max_length=36),
    db: AsyncSession = Depends(get_db), _: User = Depends(require_dashboard_access),
):
    await _experience_enabled_event(event_id, db)
    return await _feedback_results_data(event_id, db, search=search, admitted=admitted, submitted_from=submitted_from, submitted_to=submitted_to,
        guest_role=guest_role, ticket_type_id=ticket_type_id, table_group_id=table_group_id)


@router.get("/{event_id}/experience/feedback/export.csv")
async def feedback_export(
    event_id: str, search: str = Query("", max_length=120), admitted: bool | None = Query(None),
    submitted_from: datetime | None = Query(None), submitted_to: datetime | None = Query(None),
    guest_role: str = Query("", max_length=120), ticket_type_id: str = Query("", max_length=36), table_group_id: str = Query("", max_length=36),
    db: AsyncSession = Depends(get_db), _: User = Depends(require_dashboard_access),
):
    await _experience_enabled_event(event_id, db)
    data = await _feedback_results_data(event_id, db, search=search, admitted=admitted, submitted_from=submitted_from, submitted_to=submitted_to,
        guest_role=guest_role, ticket_type_id=ticket_type_id, table_group_id=table_group_id)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["form", "guest", "submitted_at", "question", "answer"])
    for form in data["forms"]:
        prompts = {str(q["id"]): q["prompt"] for q in form["questions"]}
        for response in form["responses"]:
            for qid, answer in response["answers"].items():
                writer.writerow([form["title"], response["guest_name"] or "Anonymous", response["submitted_at"], prompts.get(str(qid), qid), answer])
    return Response(
        content=out.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="feedback-{event_id}.csv"'},
    )


async def _feedback_nonresponders(event_id: str, step_id: str, db: AsyncSession) -> tuple[Event, ExperienceStep, list[Guest]]:
    event = await _experience_enabled_event(event_id, db)
    workflow = await active_workflow(event_id, db)
    step = await db.get(ExperienceStep, step_id)
    if not workflow or not step or step.workflow_id != workflow.id or step.type != "feedback":
        raise HTTPException(404, "Feedback form not found")
    submitted_ids = set((await db.scalars(select(FeedbackSubmission.guest_id).where(
        FeedbackSubmission.event_id == event_id, FeedbackSubmission.step_id == step_id
    ))).all())
    guests = (await db.scalars(select(Guest).where(Guest.event_id == event_id).order_by(Guest.last_name, Guest.first_name))).all()
    eligible = [g for g in guests if g.id not in submitted_ids and await _feedback_audience_allows(step, g, db)]
    return event, step, eligible


def _feedback_reminder_preview(event: Event, guests: list[Guest], channels: list[str]) -> dict:
    supported = [c for c in channels if c in {"email", "sms", "whatsapp"}]
    deliverable = {
        "email": sum(1 for g in guests if event.notify_email and g.email),
        "sms": sum(1 for g in guests if event.notify_sms and g.phone and g.sms_consent),
        "whatsapp": sum(1 for g in guests if event.notify_whatsapp and g.phone and g.whatsapp_consent),
    }
    paid = can_use_paid_channels(event)
    credits = sum(deliverable[c] for c in supported if c in {"sms", "whatsapp"}) if paid else 0
    return {
        "nonresponders": len(guests), "channels": supported,
        "deliverable": {c: deliverable[c] for c in supported},
        "paid_channels_available": paid, "credits_required": credits,
        "credits_available": event.message_credits or 0,
    }


@router.get("/{event_id}/experience/feedback/{step_id}/reminders/preview")
async def feedback_reminder_preview(
    event_id: str, step_id: str, channels: str = Query("email"),
    db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin),
):
    event, _, guests = await _feedback_nonresponders(event_id, step_id, db)
    return _feedback_reminder_preview(event, guests, [c.strip().lower() for c in channels.split(",")])


@router.post("/{event_id}/experience/feedback/{step_id}/reminders")
async def send_feedback_reminders(
    event_id: str, step_id: str, data: dict, background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin),
):
    event, step, guests = await _feedback_nonresponders(event_id, step_id, db)
    channels = [str(c).lower() for c in (data.get("channels") or ["email"]) if str(c).lower() in {"email", "sms", "whatsapp"}]
    if not channels:
        raise HTTPException(422, "Choose at least one reminder channel")
    subject = str(data.get("subject") or f"Share your feedback about {event.name}")[:200]
    message = str(data.get("message") or f"Please take a moment to share your feedback about {event.name}.").strip()[:1500]
    queued = {"email": 0, "sms": 0, "whatsapp": 0}
    paid = can_use_paid_channels(event)
    for guest in guests:
        token = guest.invite_token or guest.qr_token
        link = f"{event.checkin_base_url.rstrip('/')}/r/{token}#feedback"
        personalized = f"{message}\n{link}"
        if "email" in channels and event.notify_email and guest.email:
            body = f"<p>Hi {html.escape(guest.first_name)},</p><p>{html.escape(message)}</p><p><a href=\"{html.escape(link)}\">Open feedback</a></p>"
            background_tasks.add_task(send_simple_email, guest.email, subject, body, event.id, None, guest.id, "feedback_reminder")
            queued["email"] += 1
        if "sms" in channels and paid and event.notify_sms and guest.phone and guest.sms_consent:
            if take_message_credit(event, "sms", reason="feedback_reminder", guest_id=guest.id):
                background_tasks.add_task(send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_broadcast_sms,
                    phone=guest.phone, first_name=guest.first_name, message=personalized)
                queued["sms"] += 1
        if "whatsapp" in channels and paid and event.notify_whatsapp and guest.phone and guest.whatsapp_consent:
            if take_message_credit(event, "whatsapp", reason="feedback_reminder", guest_id=guest.id):
                background_tasks.add_task(send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_broadcast_whatsapp,
                    phone=guest.phone, first_name=guest.first_name, message=personalized)
                queued["whatsapp"] += 1
    db.add(ExperienceEvent(
        event_id=event_id, workflow_id=step.workflow_id, step_id=step.id,
        event_type="feedback_reminders_queued", source="admin",
        payload={"channels": channels, "queued": queued, "nonresponders": len(guests)},
    ))
    await db.commit()
    return {"nonresponders": len(guests), "queued": queued, "credits_remaining": event.message_credits or 0}


@router.post("/{event_id}/experience/feedback/prepare-draft")
async def prepare_feedback_draft(
    event_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_event_admin),
):
    """Clone the live workflow and safely convert the legacy reminder in the draft only."""
    workflow = await active_workflow(event_id, db)
    if not workflow:
        raise HTTPException(404, "No published Experience workflow found")
    loaded = await load_workflow(workflow.id, db)
    clone = await clone_workflow(loaded or workflow, db, name=f"{workflow.name} — feedback draft", actor_user_id=user.id)
    target = next((s for s in clone.steps if s.type == "feedback"), None)
    if not target:
        target = next((s for s in clone.steps if "feedback" in f"{s.key} {s.title}".lower()), None)
    if target:
        target.type = "feedback"
        config = dict(target.config or {})
        config["owner"] = "guest"
        config["feedback"] = {
            "audience": "checked_in", "anonymous": False, "status": "open", "allow_edit": True,
            "questions": [
                {"id": "overall_rating", "type": "rating", "prompt": "How would you rate your overall experience?", "required": True},
                {"id": "recommend", "type": "nps", "prompt": "How likely are you to recommend this event?", "required": True},
                {"id": "comments", "type": "text", "prompt": "What should we keep or improve?", "required": False},
            ],
        }
        target.config = config
    else:
        db.add(ExperienceStep(
            workflow_id=clone.id, key="feedback_prompt", type="feedback", title="Feedback",
            description="Invite attendees to share feedback after the event.", sort_order=9990,
            required=False, enabled=True, config={"owner": "guest", "feedback": {
                "audience": "checked_in", "anonymous": False, "status": "open", "allow_edit": True,
                "questions": [
                    {"id": "overall_rating", "type": "rating", "prompt": "How would you rate your overall experience?", "required": True},
                    {"id": "comments", "type": "text", "prompt": "What should we keep or improve?", "required": False},
                ],
            }},
        ))
    await db.commit()
    return ExperienceWorkflowOut.model_validate(await load_workflow(clone.id, db))
