from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import (
    Event,
    ConsentSignature,
    ExperienceEvent,
    ExperienceStep,
    ExperienceWorkflow,
    Guest,
    GuestExperienceProgress,
    GuestTag,
    GuestTagLink,
    GuestMenuChoice,
    ScanEvent,
    TicketType,
)


def default_step_specs(event: Event) -> list[dict]:
    """Build the conservative default workflow from features already enabled.

    The scanner/check-in path is not changed by this. These steps only describe
    the event's current operational flow and support progress backfill.
    """
    steps: list[dict] = []
    order = 10
    if event.is_paid:
        steps.append({
            "key": "check_in",
            "type": "check_in",
            "title": "Main check-in",
            "description": "Admit the guest using their QR code or manual check-in.",
            "sort_order": order,
            "required": True,
            "enabled": True,
        })
        order += 10
    if event.seating_enabled:
        steps.append({
            "key": "seating_assignment",
            "type": "seating_assignment",
            "title": "Seating assignment",
            "description": "Assign or confirm the guest's table and seat.",
            "sort_order": order,
            "required": True,
            "enabled": True,
        })
        order += 10
    if event.menu_enabled:
        steps.append({
            "key": "meal_selection",
            "type": "meal_selection",
            "title": "Meal selection",
            "description": "Capture the guest's meal choices.",
            "sort_order": order,
            "required": False,
            "enabled": True,
        })
        order += 10
    if event.checkout_enabled:
        steps.append({
            "key": "check_out",
            "type": "check_out",
            "title": "Check-out",
            "description": "Record the guest's exit by scanning their ticket/checkout QR.",
            "sort_order": order,
            "required": False,
            "enabled": True,
        })
    if not steps:
        steps.append({
            "key": "custom_welcome",
            "type": "custom",
            "title": "Welcome",
            "description": "A starter workflow step that can be renamed or replaced.",
            "sort_order": order,
            "required": False,
            "enabled": True,
        })
    return steps


async def load_workflow(workflow_id: str, db: AsyncSession) -> ExperienceWorkflow | None:
    return await db.scalar(
        select(ExperienceWorkflow)
        .options(selectinload(ExperienceWorkflow.steps))
        .where(ExperienceWorkflow.id == workflow_id)
    )


async def list_workflows(event_id: str, db: AsyncSession) -> list[ExperienceWorkflow]:
    rows = await db.execute(
        select(ExperienceWorkflow)
        .options(selectinload(ExperienceWorkflow.steps))
        .where(ExperienceWorkflow.event_id == event_id)
        .order_by(ExperienceWorkflow.version.desc(), ExperienceWorkflow.created_at.desc())
    )
    workflows = rows.scalars().all()
    for workflow in workflows:
        workflow.steps.sort(key=lambda s: (s.sort_order, s.title))
    return workflows


async def active_workflow(event_id: str, db: AsyncSession) -> ExperienceWorkflow | None:
    """Return the workflow used for runtime progress.

    Published versions are preferred over drafts. A default draft remains useful
    before publication, but should not hide a newer published workflow.
    """
    workflow = await db.scalar(
        select(ExperienceWorkflow)
        .where(ExperienceWorkflow.event_id == event_id, ExperienceWorkflow.status == "published")
        .order_by(ExperienceWorkflow.version.desc(), ExperienceWorkflow.created_at.desc())
        .limit(1)
    )
    if workflow:
        return await load_workflow(workflow.id, db)
    workflow = await db.scalar(
        select(ExperienceWorkflow)
        .where(
            ExperienceWorkflow.event_id == event_id,
            ExperienceWorkflow.is_default.is_(True),
            ExperienceWorkflow.status != "archived",
        )
        .order_by(ExperienceWorkflow.version.desc(), ExperienceWorkflow.created_at.desc())
        .limit(1)
    )
    return await load_workflow(workflow.id, db) if workflow else None


async def step_applies_to_guest(step: ExperienceStep, guest: Guest, db: AsyncSession) -> bool:
    """Evaluate the small, explicit condition language used by Experience steps.

    Supported keys:
      - is_vip / guest_is_vip: boolean
      - rsvp_status: string or list of strings
      - ticket_type_id: string or list of strings
      - ticket_type / ticket_type_name: string or list of names
      - guest_tags_include: any matching tag name or id
      - guest_tags_all: all listed tag names/ids must match
      - guest_tags_exclude: none of the listed tag names/ids may match
    Unknown keys are ignored so older drafts do not break when new condition
    fields are introduced later.
    """
    conditions = step.conditions or {}
    if not isinstance(conditions, dict) or not conditions:
        return True

    def values(raw) -> set[str]:
        if raw is None:
            return set()
        if isinstance(raw, list):
            return {str(v).strip().lower() for v in raw if str(v).strip()}
        return {str(raw).strip().lower()} if str(raw).strip() else set()

    vip_expected = conditions.get("is_vip", conditions.get("guest_is_vip"))
    if vip_expected is not None and bool(guest.is_vip) != bool(vip_expected):
        return False

    rsvp_values = values(conditions.get("rsvp_status"))
    if rsvp_values and (guest.rsvp_status or "").lower() not in rsvp_values:
        return False

    ticket_ids = values(conditions.get("ticket_type_id"))
    if ticket_ids and (guest.ticket_type_id or "").lower() not in ticket_ids:
        return False

    ticket_names = values(conditions.get("ticket_type") or conditions.get("ticket_type_name"))
    if ticket_names:
        if not guest.ticket_type_id:
            return False
        ticket = await db.get(TicketType, guest.ticket_type_id)
        if not ticket or (ticket.name or "").lower() not in ticket_names:
            return False

    tag_conditions = (
        conditions.get("guest_tags_include"),
        conditions.get("guest_tags_all"),
        conditions.get("guest_tags_exclude"),
    )
    if any(v is not None for v in tag_conditions):
        tag_rows = (await db.execute(
            select(GuestTag.id, GuestTag.name)
            .join(GuestTagLink, GuestTagLink.tag_id == GuestTag.id)
            .where(GuestTagLink.guest_id == guest.id)
        )).all()
        guest_tags = {str(tag_id).lower() for tag_id, _ in tag_rows}
        guest_tags.update((name or "").lower() for _, name in tag_rows)

        include = values(conditions.get("guest_tags_include"))
        if include and not include.intersection(guest_tags):
            return False

        all_tags = values(conditions.get("guest_tags_all"))
        if all_tags and not all_tags.issubset(guest_tags):
            return False

        exclude = values(conditions.get("guest_tags_exclude"))
        if exclude and exclude.intersection(guest_tags):
            return False

    return True


def dependency_keys(step: ExperienceStep) -> set[str]:
    config = step.config or {}
    raw = (
        config.get("depends_on")
        or config.get("depends_on_steps")
        or config.get("depends_on_keys")
        or config.get("prerequisites")
    )
    if not raw:
        return set()
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return set()
    return {str(value).strip() for value in raw if str(value).strip()}


def dependencies_satisfied(
    step: ExperienceStep,
    steps_by_key_or_id: dict[str, ExperienceStep],
    progress_by_step_id: dict[str, GuestExperienceProgress],
) -> bool:
    deps = dependency_keys(step)
    if not deps:
        return True
    complete_statuses = {"completed", "skipped", "overridden"}
    for dep in deps:
        dep_step = steps_by_key_or_id.get(dep)
        if not dep_step:
            return False
        dep_progress = progress_by_step_id.get(dep_step.id)
        if not dep_progress or dep_progress.status not in complete_statuses:
            return False
    return True


def should_block_souvenir_until_consent(
    step: ExperienceStep,
    steps: list[ExperienceStep],
    consent_signed: bool,
) -> bool:
    """Souvenir/gift handoff should happen after guest consent when a consent
    step exists in the same workflow. This keeps older workflows safe even if
    they were created before explicit dependency config was added.
    """
    if consent_signed or step.type != "souvenir":
        return False
    if dependency_keys(step):
        return False
    return any(s.enabled and s.type == "consent" and s.id != step.id for s in steps)


def _progress_start_time(row: GuestExperienceProgress) -> datetime | None:
    metadata = row.progress_metadata or {}
    if not isinstance(metadata, dict):
        return None
    raw = metadata.get("started_at") or metadata.get("available_at")
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw
    if isinstance(raw, str):
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None
    return None


async def create_default_workflow(event: Event, db: AsyncSession, *, actor_user_id: str | None) -> ExperienceWorkflow:
    existing = await db.scalar(
        select(ExperienceWorkflow)
        .where(ExperienceWorkflow.event_id == event.id, ExperienceWorkflow.is_default.is_(True))
        .order_by(ExperienceWorkflow.version.desc())
        .limit(1)
    )
    if existing:
        workflow = await load_workflow(existing.id, db)
        if workflow:
            return workflow

    latest_version = await db.scalar(
        select(ExperienceWorkflow.version)
        .where(ExperienceWorkflow.event_id == event.id)
        .order_by(ExperienceWorkflow.version.desc())
        .limit(1)
    )
    workflow = ExperienceWorkflow(
        event_id=event.id,
        name="Default Experience",
        status="draft",
        version=(latest_version or 0) + 1,
        is_default=True,
        created_by=actor_user_id,
    )
    db.add(workflow)
    await db.flush()
    for spec in default_step_specs(event):
        db.add(ExperienceStep(workflow_id=workflow.id, **spec))
    db.add(ExperienceEvent(
        event_id=event.id,
        workflow_id=workflow.id,
        actor_user_id=actor_user_id,
        event_type="workflow_created",
        source="admin",
        payload={"kind": "default"},
    ))
    event.experience_enabled = True
    await db.flush()
    await initialize_progress(event.id, workflow.id, db)
    await db.commit()
    loaded = await load_workflow(workflow.id, db)
    return loaded or workflow


async def next_workflow_version(event_id: str, db: AsyncSession) -> int:
    latest_version = await db.scalar(
        select(ExperienceWorkflow.version)
        .where(ExperienceWorkflow.event_id == event_id)
        .order_by(ExperienceWorkflow.version.desc())
        .limit(1)
    )
    return (latest_version or 0) + 1


async def create_workflow(
    event: Event,
    db: AsyncSession,
    *,
    name: str,
    step_specs: list[dict],
    actor_user_id: str | None,
) -> ExperienceWorkflow:
    workflow = ExperienceWorkflow(
        event_id=event.id,
        name=name,
        status="draft",
        version=await next_workflow_version(event.id, db),
        is_default=False,
        created_by=actor_user_id,
    )
    db.add(workflow)
    await db.flush()
    for i, spec in enumerate(step_specs):
        payload = dict(spec)
        payload.setdefault("sort_order", (i + 1) * 10)
        db.add(ExperienceStep(workflow_id=workflow.id, **payload))
    db.add(ExperienceEvent(
        event_id=event.id,
        workflow_id=workflow.id,
        actor_user_id=actor_user_id,
        event_type="workflow_created",
        source="admin",
        payload={"kind": "custom"},
    ))
    await db.commit()
    loaded = await load_workflow(workflow.id, db)
    return loaded or workflow


async def clone_workflow(
    workflow: ExperienceWorkflow,
    db: AsyncSession,
    *,
    name: str | None,
    actor_user_id: str | None,
) -> ExperienceWorkflow:
    clone = ExperienceWorkflow(
        event_id=workflow.event_id,
        name=name or f"{workflow.name} copy",
        status="draft",
        version=await next_workflow_version(workflow.event_id, db),
        is_default=False,
        created_by=actor_user_id,
    )
    db.add(clone)
    await db.flush()
    for step in sorted(workflow.steps, key=lambda s: (s.sort_order, s.title)):
        db.add(ExperienceStep(
            workflow_id=clone.id,
            key=step.key,
            type=step.type,
            title=step.title,
            description=step.description,
            sort_order=step.sort_order,
            required=step.required,
            enabled=step.enabled,
            conditions=step.conditions,
            config=step.config,
        ))
    db.add(ExperienceEvent(
        event_id=workflow.event_id,
        workflow_id=clone.id,
        actor_user_id=actor_user_id,
        event_type="workflow_cloned",
        source="admin",
        payload={"source_workflow_id": workflow.id},
    ))
    await db.commit()
    loaded = await load_workflow(clone.id, db)
    return loaded or clone


async def publish_workflow(workflow: ExperienceWorkflow, event: Event, db: AsyncSession, *, actor_user_id: str | None):
    workflow.status = "published"
    event.experience_enabled = True
    db.add(ExperienceEvent(
        event_id=workflow.event_id,
        workflow_id=workflow.id,
        actor_user_id=actor_user_id,
        event_type="workflow_published",
        source="admin",
        payload={"version": workflow.version},
    ))
    await db.flush()
    await initialize_progress(event.id, workflow.id, db)
    await db.commit()
    loaded = await load_workflow(workflow.id, db)
    return loaded or workflow


async def unpublish_workflow(workflow: ExperienceWorkflow, event: Event, db: AsyncSession, *, actor_user_id: str | None):
    workflow.status = "draft"
    db.add(ExperienceEvent(
        event_id=workflow.event_id,
        workflow_id=workflow.id,
        actor_user_id=actor_user_id,
        event_type="workflow_unpublished",
        source="admin",
        payload={"version": workflow.version},
    ))
    still_published = await db.scalar(
        select(ExperienceWorkflow.id)
        .where(
            ExperienceWorkflow.event_id == workflow.event_id,
            ExperienceWorkflow.id != workflow.id,
            ExperienceWorkflow.status == "published",
        )
        .limit(1)
    )
    if not still_published:
        event.experience_enabled = False
    await db.commit()
    loaded = await load_workflow(workflow.id, db)
    return loaded or workflow


async def archive_workflow(workflow: ExperienceWorkflow, event: Event, db: AsyncSession, *, actor_user_id: str | None):
    was_published = workflow.status == "published"
    workflow.status = "archived"
    db.add(ExperienceEvent(
        event_id=workflow.event_id,
        workflow_id=workflow.id,
        actor_user_id=actor_user_id,
        event_type="workflow_archived",
        source="admin",
        payload={"version": workflow.version, "was_published": was_published},
    ))
    if was_published:
        event.experience_enabled = False
    await db.commit()
    loaded = await load_workflow(workflow.id, db)
    return loaded or workflow


async def unarchive_workflow(workflow: ExperienceWorkflow, db: AsyncSession, *, actor_user_id: str | None):
    workflow.status = "draft"
    db.add(ExperienceEvent(
        event_id=workflow.event_id,
        workflow_id=workflow.id,
        actor_user_id=actor_user_id,
        event_type="workflow_unarchived",
        source="admin",
        payload={"version": workflow.version},
    ))
    await db.commit()
    loaded = await load_workflow(workflow.id, db)
    return loaded or workflow


async def initialize_progress(event_id: str, workflow_id: str, db: AsyncSession) -> None:
    workflow = await load_workflow(workflow_id, db)
    if not workflow:
        return
    guests = (await db.execute(select(Guest).where(Guest.event_id == event_id))).scalars().all()
    existing_pairs = {
        (guest_id, step_id)
        for guest_id, step_id in (await db.execute(
            select(GuestExperienceProgress.guest_id, GuestExperienceProgress.step_id)
            .where(GuestExperienceProgress.workflow_id == workflow_id)
        )).all()
    }
    meal_guest_ids = set((await db.execute(
        select(GuestMenuChoice.guest_id).join(Guest, Guest.id == GuestMenuChoice.guest_id)
        .where(Guest.event_id == event_id)
    )).scalars().all())
    checked_out_guest_ids = set((await db.execute(
        select(ScanEvent.guest_id).where(
            ScanEvent.event_id == event_id,
            ScanEvent.zone_id.is_(None),
            ScanEvent.direction == "out",
            ScanEvent.denied.is_(False),
        )
    )).scalars().all())
    now = datetime.utcnow()
    for guest in guests:
        progress_by_step_id: dict[str, GuestExperienceProgress] = {}
        steps = sorted(workflow.steps, key=lambda s: (s.sort_order, s.title))
        steps_by_key_or_id = {value: step for step in steps for value in (step.id, step.key)}
        for step in steps:
            if (guest.id, step.id) in existing_pairs:
                continue
            status = "available"
            completed_at = None
            completed_by_source = None
            metadata = None
            if not await step_applies_to_guest(step, guest, db):
                status = "skipped"
                completed_at = now
                completed_by_source = "system"
                metadata = {"condition_skipped": True}
            elif not dependencies_satisfied(step, steps_by_key_or_id, progress_by_step_id):
                status = "blocked"
                metadata = {"blocked_by": sorted(dependency_keys(step))}
            if status != "skipped" and step.type == "check_in" and guest.admitted:
                status = "completed"
                completed_at = guest.admitted_at or now
                completed_by_source = "system"
            elif step.type == "seating_assignment" and guest.table_id and guest.seat_number:
                status = "completed"
                completed_at = now
                completed_by_source = "system"
            elif step.type == "meal_selection" and guest.id in meal_guest_ids:
                status = "completed"
                completed_at = now
                completed_by_source = "system"
            elif step.type == "check_out" and guest.id in checked_out_guest_ids:
                status = "completed"
                completed_at = now
                completed_by_source = "system"
            progress = GuestExperienceProgress(
                event_id=event_id,
                workflow_id=workflow_id,
                step_id=step.id,
                guest_id=guest.id,
                status=status,
                completed_at=completed_at,
                completed_by_source=completed_by_source,
                progress_metadata=metadata,
            )
            db.add(progress)
            progress_by_step_id[step.id] = progress


async def sync_guest_progress(
    event_id: str,
    guest_id: str,
    db: AsyncSession,
    *,
    source: str = "system",
    actor_user_id: str | None = None,
) -> None:
    """Reflect current guest state into workflow progress rows.

    This is deliberately conservative: it completes only step types that map to
    existing source-of-truth fields. Custom steps remain staff/admin controlled.
    """
    event = await db.get(Event, event_id)
    if not event or not event.experience_enabled:
        return
    workflow = await active_workflow(event_id, db)
    if not workflow:
        return
    workflow.steps.sort(key=lambda s: (s.sort_order, s.title))
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        return

    existing = {
        row.step_id: row
        for row in (await db.execute(
            select(GuestExperienceProgress)
            .where(
                GuestExperienceProgress.workflow_id == workflow.id,
                GuestExperienceProgress.guest_id == guest_id,
            )
        )).scalars().all()
    }
    meal_has_choice = bool(await db.scalar(
        select(GuestMenuChoice.id)
        .where(GuestMenuChoice.guest_id == guest_id)
        .limit(1)
    ))
    consent_signed = bool(await db.scalar(
        select(ConsentSignature.id)
        .where(
            ConsentSignature.event_id == event_id,
            ConsentSignature.guest_id == guest_id,
        )
        .limit(1)
    ))
    checked_out = bool(await db.scalar(
        select(ScanEvent.id)
        .where(
            ScanEvent.event_id == event_id,
            ScanEvent.guest_id == guest_id,
            ScanEvent.zone_id.is_(None),
            ScanEvent.direction == "out",
            ScanEvent.denied.is_(False),
        )
        .limit(1)
    ))
    now = datetime.utcnow()
    steps = sorted((s for s in workflow.steps if s.enabled), key=lambda s: (s.sort_order, s.title))
    steps_by_key_or_id = {value: step for step in steps for value in (step.id, step.key)}

    for step in steps:
        if not step.enabled:
            continue
        progress = existing.get(step.id)
        applies = await step_applies_to_guest(step, guest, db)
        if not progress:
            progress = GuestExperienceProgress(
                event_id=event_id,
                workflow_id=workflow.id,
                step_id=step.id,
                guest_id=guest_id,
                status="available" if applies else "skipped",
                completed_at=None if applies else now,
                completed_by_source=None if applies else "system",
                progress_metadata=None if applies else {"condition_skipped": True},
            )
            db.add(progress)
            existing[step.id] = progress

        if not applies:
            if progress.status != "skipped" or not (progress.progress_metadata or {}).get("condition_skipped"):
                progress.status = "skipped"
                progress.completed_at = progress.completed_at or now
                progress.completed_by_user_id = None
                progress.completed_by_source = "system"
                progress.progress_metadata = {**(progress.progress_metadata or {}), "condition_skipped": True}
            continue

        if applies and progress.status == "skipped" and (progress.progress_metadata or {}).get("condition_skipped"):
            metadata = dict(progress.progress_metadata or {})
            metadata.pop("condition_skipped", None)
            progress.status = "available"
            progress.completed_at = None
            progress.completed_by_source = None
            progress.progress_metadata = metadata or None

        implicit_consent_block = should_block_souvenir_until_consent(step, steps, consent_signed)
        deps_ok = dependencies_satisfied(step, steps_by_key_or_id, existing) and not implicit_consent_block
        if not deps_ok and progress.status not in ("completed", "skipped", "overridden"):
            progress.status = "blocked"
            progress.completed_at = None
            progress.completed_by_user_id = None
            progress.completed_by_source = None
            progress.progress_metadata = {
                **(progress.progress_metadata or {}),
                "blocked_by": sorted(dependency_keys(step) or ({"consent"} if implicit_consent_block else set())),
            }
            continue
        if deps_ok and progress.status == "blocked":
            metadata = dict(progress.progress_metadata or {})
            metadata.pop("blocked_by", None)
            progress.status = "available"
            progress.progress_metadata = metadata or None

        if progress.status in ("completed", "skipped", "overridden"):
            continue

        should_complete = (
            (step.type == "check_in" and guest.admitted)
            or (step.type == "seating_assignment" and bool(guest.table_id and guest.seat_number))
            or (step.type == "meal_selection" and meal_has_choice)
            or (step.type == "consent" and consent_signed)
            or (step.type == "check_out" and checked_out)
        )
        if should_complete:
            progress.status = "completed"
            progress.completed_at = progress.completed_at or now
            progress.completed_by_user_id = actor_user_id
            progress.completed_by_source = source
            db.add(ExperienceEvent(
                event_id=event_id,
                workflow_id=workflow.id,
                step_id=step.id,
                guest_id=guest_id,
                actor_user_id=actor_user_id,
                event_type="step_completed",
                source=source,
                payload={"step_type": step.type},
            ))


async def next_guest_steps(
    event_id: str,
    guest_id: str,
    db: AsyncSession,
) -> list[tuple[ExperienceStep, GuestExperienceProgress | None]]:
    event = await db.get(Event, event_id)
    if not event or not event.experience_enabled:
        return []
    workflow = await active_workflow(event_id, db)
    if not workflow:
        return []
    await sync_guest_progress(event_id, guest_id, db)
    rows = {
        row.step_id: row
        for row in (await db.execute(
            select(GuestExperienceProgress)
            .where(
                GuestExperienceProgress.workflow_id == workflow.id,
                GuestExperienceProgress.guest_id == guest_id,
            )
        )).scalars().all()
    }
    pending_statuses = {"not_started", "available", "failed"}
    steps = sorted((s for s in workflow.steps if s.enabled), key=lambda s: (s.sort_order, s.title))
    pending: list[tuple[ExperienceStep, GuestExperienceProgress | None]] = []
    for step in steps:
        progress = rows.get(step.id)
        status = progress.status if progress else "available"
        if status in pending_statuses:
            pending.append((step, progress))
    pending.sort(key=lambda item: (0 if item[0].required else 1, item[0].sort_order, item[0].title))
    return pending
