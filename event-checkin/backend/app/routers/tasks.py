"""Per-event to-do management (Gatsby gap-backlog item: 'Tasks'). Visible and
editable by any staff member on the event — team coordination, not guest data
— so every route uses require_event_member rather than a guest-specific guard.

Also exposes a cross-event "my tasks" aggregation (mine_router, mounted at
/api/tasks/mine) reusing the exact same event-access scoping as GET /api/events
(events.py:list_events) so a staff member never sees a task from an event they
can't otherwise see.
"""
import uuid as _uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, EventUser, Membership, Organization, Subtask, Task, TaskActivity, TaskAttachment, User
from ..schemas import (
    TaskCreate, TaskOut, MyTaskOut, TaskCommentCreate, TaskActivityOut,
    SubtaskCreate, SubtaskUpdate, SubtaskOut, TaskAttachmentOut,
)
from ..auth import require_event_member, get_current_user
from .. import storage
from services.email_service import send_simple_email

router = APIRouter()
mine_router = APIRouter()

_STATUS_RANK = {"open": 0, "in_progress": 1, "done": 2}
_STATUS_LABEL = {"open": "Open", "in_progress": "In Progress", "done": "Done"}

# Broader than the image-only event-cover upload (events.py) since a task
# attachment is more often a document than a photo.
ALLOWED_ATTACHMENT_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv", "text/plain",
}
MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024  # 10 MB, same cap as the cover-image upload


async def _log_activity(db: AsyncSession, task_id: str, user: User | None, kind: str, body: str) -> None:
    db.add(TaskActivity(task_id=task_id, user_id=user.id if user else None, kind=kind, body=body))
    await db.commit()


def _sort_key(t: dict):
    return (_STATUS_RANK.get(t["status"], 0), t["due_date"] is None, t["due_date"] or datetime.max, t["sort_order"])


async def _assignee_names(event_id: str, db: AsyncSession) -> dict[str, str]:
    rows = (await db.execute(
        select(User.id, User.name)
        .join(EventUser, EventUser.user_id == User.id)
        .where(EventUser.event_id == event_id)
    )).all()
    return dict(rows)


def _task_out(task: Task, names: dict[str, str]) -> dict:
    overdue = bool(
        task.status != "done" and task.due_date and task.due_date < datetime.utcnow()
    )
    return {
        "id": task.id, "event_id": task.event_id, "title": task.title, "notes": task.notes,
        "planner_milestone_id": task.planner_milestone_id,
        "planner_vendor_id": task.planner_vendor_id, "priority": task.priority,
        "assignee_user_id": task.assignee_user_id,
        "assignee_name": names.get(task.assignee_user_id) if task.assignee_user_id else None,
        "due_date": task.due_date, "status": task.status, "overdue": overdue,
        "sort_order": task.sort_order, "completed_at": task.completed_at, "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


async def _get_assignee(event_id: str, assignee_user_id: str | None, db: AsyncSession) -> User | None:
    """Validates the assignee is actually on the event's team and returns them
    (for the assignment-notification email); raises 404 if not."""
    if assignee_user_id is None:
        return None
    row = (await db.execute(
        select(User).join(EventUser, EventUser.user_id == User.id)
        .where(EventUser.event_id == event_id, EventUser.user_id == assignee_user_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Assignee is not a team member on this event")
    return row


async def _ensure_planner_task_manager(event_id: str, actor: User, db: AsyncSession) -> None:
    """Planner-linked tasks retain Planner's narrower mutation policy even
    though they are stored in the shared task engine."""
    if actor.is_platform_superadmin:
        return
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    membership = (await db.execute(select(Membership).where(
        Membership.org_id == event.org_id, Membership.user_id == actor.id,
        Membership.role.in_(["owner", "admin"]),
    ))).scalar_one_or_none()
    if membership:
        return
    assignment = (await db.execute(select(EventUser).where(
        EventUser.event_id == event_id, EventUser.user_id == actor.id,
    ))).scalar_one_or_none()
    if assignment and (assignment.event_role == "manager" or assignment.can_manage_planner_tasks):
        return
    raise HTTPException(403, "Planner task management permission required")


async def _ensure_task_mutation_allowed(task: Task, actor: User, db: AsyncSession) -> None:
    if task.planner_milestone_id:
        await _ensure_planner_task_manager(task.event_id, actor, db)


def _notify_assignee(background_tasks: BackgroundTasks, event: Event, task: Task, assignee: User) -> None:
    due_str = f" (due {task.due_date.strftime('%b %d, %Y')})" if task.due_date else ""
    task_link = f"{event.checkin_base_url.rstrip('/')}/admin?event={event.id}&tab=tasks"
    body = (
        f"<p>Hi {assignee.name},</p>"
        f"<p>You've been assigned a task on <strong>{event.name}</strong>:</p>"
        f"<p><strong>{task.title}</strong>{due_str}</p>"
        + (f"<p>{task.notes}</p>" if task.notes else "")
        + f'<p><a href="{task_link}">View this task</a></p>'
    )
    background_tasks.add_task(
        send_simple_email, assignee.email, f"New task on {event.name}: {task.title}", body,
        event.id, None, None, "task_assigned",
    )


async def _accessible_event_ids(user: User, db: AsyncSession) -> list[str]:
    """Same scoping as GET /api/events (events.py:list_events) — superadmin
    sees all; everyone else sees events they manage (org owner/admin) or are
    explicitly assigned to (EventUser), in an active org."""
    if user.is_platform_superadmin:
        return [row[0] for row in (await db.execute(select(Event.id))).all()]
    managed = (await db.execute(
        select(Event.id)
        .join(Membership, Membership.org_id == Event.org_id)
        .join(Organization, Organization.id == Event.org_id)
        .where(
            Membership.user_id == user.id,
            Membership.role.in_(["owner", "admin"]),
            Organization.is_active.is_(True),
        )
    )).scalars().all()
    assigned = (await db.execute(
        select(Event.id)
        .join(EventUser, EventUser.event_id == Event.id)
        .join(Organization, Organization.id == Event.org_id)
        .where(EventUser.user_id == user.id, Organization.is_active.is_(True))
    )).scalars().all()
    return list({*managed, *assigned})


@router.get("/{event_id}/tasks", response_model=list[TaskOut])
async def list_tasks(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_member)):
    tasks = (await db.execute(select(Task).where(Task.event_id == event_id))).scalars().all()
    names = await _assignee_names(event_id, db)
    out = [_task_out(t, names) for t in tasks]
    out.sort(key=_sort_key)
    return out


@router.get("/{event_id}/tasks/assignees")
async def list_task_assignees(
    event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_member),
):
    """Small event-scoped directory for assignment pickers.

    Unlike the team administration endpoint this intentionally works for every
    event member; it exposes only the id/name/email needed to assign work.
    """
    rows = (await db.execute(
        select(User.id, User.name, User.email)
        .join(EventUser, EventUser.user_id == User.id)
        .where(EventUser.event_id == event_id)
        .order_by(User.name)
    )).all()
    return [{"id": row.id, "name": row.name, "email": row.email} for row in rows]


@router.post("/{event_id}/tasks", response_model=TaskOut, status_code=201)
async def create_task(
    event_id: str, data: TaskCreate, background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "title is required")
    assignee = await _get_assignee(event_id, data.assignee_user_id, db)
    if data.planner_milestone_id:
        await _ensure_planner_task_manager(event_id, actor, db)
    task = Task(
        event_id=event_id, title=title, notes=data.notes, assignee_user_id=data.assignee_user_id,
        due_date=data.due_date, sort_order=data.sort_order or 0,
        planner_milestone_id=data.planner_milestone_id,
        planner_vendor_id=data.planner_vendor_id, priority=data.priority,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    body = f"Created this task{f', assigned to {assignee.name}' if assignee else ''}."
    await _log_activity(db, task.id, actor, "system", body)
    if assignee:
        _notify_assignee(background_tasks, event, task, assignee)
    names = await _assignee_names(event_id, db)
    return _task_out(task, names)


@router.put("/{event_id}/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    event_id: str, task_id: str, data: TaskCreate, background_tasks: BackgroundTasks,
    if_unmodified_since: datetime | None = None,
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member),
):
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    if task.planner_milestone_id or data.planner_milestone_id:
        await _ensure_planner_task_manager(event_id, actor, db)
    # Optional optimistic-concurrency guard: the redesign UI sends back the
    # updated_at it last saw, so a stale edit (someone else changed the task
    # first — most importantly its assignee) is rejected instead of silently
    # overwritten. Omitted by callers that don't track it (legacy UI), so this
    # is additive, not a behavior change for existing clients.
    if if_unmodified_since is not None and task.updated_at != if_unmodified_since:
        raise HTTPException(409, "This task was changed by another operator. Refresh and try again.")
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "title is required")
    assignee = await _get_assignee(event_id, data.assignee_user_id, db)
    previous_assignee_id = task.assignee_user_id
    task.title = title
    task.notes = data.notes
    task.planner_milestone_id = data.planner_milestone_id
    task.planner_vendor_id = data.planner_vendor_id
    task.priority = data.priority
    task.assignee_user_id = data.assignee_user_id
    task.due_date = data.due_date
    if data.sort_order is not None:
        task.sort_order = data.sort_order
    await db.commit()
    await db.refresh(task)
    if data.assignee_user_id != previous_assignee_id:
        body = f"Reassigned to {assignee.name}." if assignee else "Unassigned."
        await _log_activity(db, task.id, actor, "system", body)
    if assignee and assignee.id != previous_assignee_id:
        event = await db.get(Event, event_id)
        _notify_assignee(background_tasks, event, task, assignee)
    names = await _assignee_names(event_id, db)
    return _task_out(task, names)


async def _set_status(event_id: str, task_id: str, status: str, db: AsyncSession, actor: User) -> Task:
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    await _ensure_task_mutation_allowed(task, actor, db)
    previous_status = task.status
    task.status = status
    task.completed_at = datetime.utcnow() if status == "done" else None
    await db.commit()
    await db.refresh(task)
    if status != previous_status:
        await _log_activity(db, task.id, actor, "system", f"Moved this from {_STATUS_LABEL[previous_status]} to {_STATUS_LABEL[status]}.")
    return task


@router.post("/{event_id}/tasks/{task_id}/start", response_model=TaskOut)
async def start_task(event_id: str, task_id: str, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    task = await _set_status(event_id, task_id, "in_progress", db, actor)
    names = await _assignee_names(event_id, db)
    return _task_out(task, names)


@router.post("/{event_id}/tasks/{task_id}/complete", response_model=TaskOut)
async def complete_task(event_id: str, task_id: str, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    task = await _set_status(event_id, task_id, "done", db, actor)
    names = await _assignee_names(event_id, db)
    return _task_out(task, names)


@router.post("/{event_id}/tasks/{task_id}/reopen", response_model=TaskOut)
async def reopen_task(event_id: str, task_id: str, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    task = await _set_status(event_id, task_id, "open", db, actor)
    names = await _assignee_names(event_id, db)
    return _task_out(task, names)


@router.delete("/{event_id}/tasks/{task_id}", status_code=204)
async def delete_task(event_id: str, task_id: str, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    await _ensure_task_mutation_allowed(task, actor, db)
    await db.execute(delete(TaskActivity).where(TaskActivity.task_id == task_id))
    await db.execute(delete(Subtask).where(Subtask.task_id == task_id))
    await db.delete(task)
    await db.commit()


async def _activity_out(activity: TaskActivity, names: dict[str, str]) -> dict:
    return {
        "id": activity.id, "kind": activity.kind, "body": activity.body,
        "user_name": names.get(activity.user_id) if activity.user_id else None,
        "created_at": activity.created_at,
    }


@router.get("/{event_id}/tasks/{task_id}/activity", response_model=list[TaskActivityOut])
async def list_task_activity(event_id: str, task_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_member)):
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    rows = (await db.execute(
        select(TaskActivity).where(TaskActivity.task_id == task_id).order_by(TaskActivity.created_at.asc())
    )).scalars().all()
    # Activity authors can be org owners/admins acting via require_event_member
    # without an EventUser row, so resolve names directly rather than reusing
    # _assignee_names (which is scoped to EventUser-assignable staff only).
    author_ids = {a.user_id for a in rows if a.user_id}
    names = dict((await db.execute(select(User.id, User.name).where(User.id.in_(author_ids)))).all()) if author_ids else {}
    return [await _activity_out(a, names) for a in rows]


@router.post("/{event_id}/tasks/{task_id}/comments", response_model=TaskActivityOut, status_code=201)
async def add_task_comment(
    event_id: str, task_id: str, data: TaskCommentCreate,
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member),
):
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    await _ensure_task_mutation_allowed(task, actor, db)
    body = data.body.strip()
    if not body:
        raise HTTPException(400, "body is required")
    activity = TaskActivity(task_id=task_id, user_id=actor.id, kind="comment", body=body)
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return await _activity_out(activity, {actor.id: actor.name})


@router.get("/{event_id}/tasks/{task_id}/subtasks", response_model=list[SubtaskOut])
async def list_subtasks(event_id: str, task_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_member)):
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    rows = (await db.execute(
        select(Subtask).where(Subtask.task_id == task_id).order_by(Subtask.sort_order, Subtask.created_at)
    )).scalars().all()
    return rows


@router.post("/{event_id}/tasks/{task_id}/subtasks", response_model=SubtaskOut, status_code=201)
async def create_subtask(
    event_id: str, task_id: str, data: SubtaskCreate,
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member),
):
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    await _ensure_task_mutation_allowed(task, actor, db)
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "title is required")
    count = await db.scalar(select(func.count()).where(Subtask.task_id == task_id)) or 0
    subtask = Subtask(task_id=task_id, title=title, sort_order=count)
    db.add(subtask)
    await db.commit()
    await db.refresh(subtask)
    await _log_activity(db, task_id, actor, "system", f"Added subtask: {title}")
    return subtask


@router.patch("/{event_id}/tasks/{task_id}/subtasks/{subtask_id}", response_model=SubtaskOut)
async def update_subtask(
    event_id: str, task_id: str, subtask_id: str, data: SubtaskUpdate,
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member),
):
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    await _ensure_task_mutation_allowed(task, actor, db)
    subtask = await db.get(Subtask, subtask_id)
    if not subtask or subtask.task_id != task_id:
        raise HTTPException(404, "Subtask not found")
    if data.title is not None:
        title = data.title.strip()
        if not title:
            raise HTTPException(400, "title is required")
        subtask.title = title
    if data.status is not None and data.status != subtask.status:
        if data.status not in _STATUS_LABEL:
            raise HTTPException(400, "status must be one of: open, in_progress, done")
        previous_status = subtask.status
        subtask.status = data.status
        await db.commit()
        await _log_activity(
            db, task_id, actor, "system",
            f"Moved subtask \"{subtask.title}\" from {_STATUS_LABEL[previous_status]} to {_STATUS_LABEL[data.status]}.",
        )
        await db.refresh(subtask)
        return subtask
    await db.commit()
    await db.refresh(subtask)
    return subtask


@router.delete("/{event_id}/tasks/{task_id}/subtasks/{subtask_id}", status_code=204)
async def delete_subtask(
    event_id: str, task_id: str, subtask_id: str,
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member),
):
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    await _ensure_task_mutation_allowed(task, actor, db)
    subtask = await db.get(Subtask, subtask_id)
    if not subtask or subtask.task_id != task_id:
        raise HTTPException(404, "Subtask not found")
    title = subtask.title
    await db.delete(subtask)
    await db.commit()
    await _log_activity(db, task_id, actor, "system", f"Removed subtask: {title}")


async def _attachment_out(attachment: TaskAttachment, names: dict[str, str]) -> dict:
    return {
        "id": attachment.id, "task_id": attachment.task_id, "filename": attachment.filename,
        "url": attachment.url, "content_type": attachment.content_type, "size_bytes": attachment.size_bytes,
        "uploaded_by_name": names.get(attachment.uploaded_by_user_id) if attachment.uploaded_by_user_id else None,
        "created_at": attachment.created_at,
    }


@router.get("/{event_id}/tasks/{task_id}/attachments", response_model=list[TaskAttachmentOut])
async def list_task_attachments(event_id: str, task_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_member)):
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    rows = (await db.execute(
        select(TaskAttachment).where(TaskAttachment.task_id == task_id).order_by(TaskAttachment.created_at.desc())
    )).scalars().all()
    author_ids = {a.uploaded_by_user_id for a in rows if a.uploaded_by_user_id}
    names = dict((await db.execute(select(User.id, User.name).where(User.id.in_(author_ids)))).all()) if author_ids else {}
    return [await _attachment_out(a, names) for a in rows]


@router.post("/{event_id}/tasks/{task_id}/attachments", response_model=TaskAttachmentOut, status_code=201)
async def upload_task_attachment(
    event_id: str, task_id: str, file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member),
):
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    await _ensure_task_mutation_allowed(task, actor, db)
    if file.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(400, f"Unsupported file type '{file.content_type}'.")
    data = await file.read()
    if len(data) > MAX_ATTACHMENT_SIZE:
        raise HTTPException(413, "File too large — maximum 10 MB.")

    original_name = file.filename or "attachment"
    ext = original_name.rsplit(".", 1)[-1] if "." in original_name else "bin"
    stored_name = f"{task_id}-{_uuid.uuid4().hex[:8]}.{ext}"
    url = storage.save(f"tasks/{stored_name}", data, file.content_type)

    attachment = TaskAttachment(
        task_id=task_id, filename=original_name, url=url, content_type=file.content_type,
        size_bytes=len(data), uploaded_by_user_id=actor.id,
    )
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)
    await _log_activity(db, task_id, actor, "system", f"Attached {original_name}.")
    return await _attachment_out(attachment, {actor.id: actor.name})


@router.delete("/{event_id}/tasks/{task_id}/attachments/{attachment_id}", status_code=204)
async def delete_task_attachment(
    event_id: str, task_id: str, attachment_id: str,
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member),
):
    task = await db.get(Task, task_id)
    if not task or task.event_id != event_id:
        raise HTTPException(404, "Task not found")
    await _ensure_task_mutation_allowed(task, actor, db)
    attachment = await db.get(TaskAttachment, attachment_id)
    if not attachment or attachment.task_id != task_id:
        raise HTTPException(404, "Attachment not found")
    storage.delete(storage.subpath_from_url(attachment.url))
    filename = attachment.filename
    await db.delete(attachment)
    await db.commit()
    await _log_activity(db, task_id, actor, "system", f"Removed attachment: {filename}")


@mine_router.get("/tasks/mine", response_model=list[MyTaskOut])
async def list_my_tasks(
    assignment: str = "mine",  # mine | others | all
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every task across every event the caller can see (same scoping as
    GET /api/events), optionally filtered to their own / others' / all."""
    event_ids = await _accessible_event_ids(user, db)
    if not event_ids:
        return []
    query = select(Task, Event.name).join(Event, Event.id == Task.event_id).where(Task.event_id.in_(event_ids))
    if assignment == "mine":
        query = query.where(Task.assignee_user_id == user.id)
    elif assignment == "others":
        query = query.where(Task.assignee_user_id.isnot(None), Task.assignee_user_id != user.id)
    rows = (await db.execute(query)).all()

    names: dict[str, str] = {}
    for eid in {task.event_id for task, _ in rows}:
        names.update(await _assignee_names(eid, db))

    out = []
    for task, event_name in rows:
        item = _task_out(task, names)
        item["event_name"] = event_name
        out.append(item)
    out.sort(key=_sort_key)
    return out
