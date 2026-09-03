"""Event-scoped administration and reconciliation for inbound email automation."""
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_event_admin
from ..config import settings
from ..database import get_db
from ..entitlements import assert_feature_allowed
from ..models import (
    Event,
    ExperienceStep,
    ExperienceWorkflow,
    Guest,
    InboundEmail,
    InboundEmailAutomation,
    User,
)
from ..schemas import (
    InboundEmailAutomationCreate,
    InboundEmailAutomationOut,
    InboundEmailAutomationUpdate,
    InboundEmailAuditOut,
    InboundEmailManualMatch,
    InboundEmailRevalidationOut,
    InboundEmailReviewOut,
)
from ..services.experience import ExperienceCompletionError, complete_guest_step
from ..services.inbound_email_outbox import process_email

router = APIRouter()


async def _event(event_id: str, db: AsyncSession) -> Event:
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if not event.experience_enabled:
        raise HTTPException(409, "Experience must be enabled for this event")
    assert_feature_allowed(event, "experience_enabled")
    return event


async def _event_step(event_id: str, step_id: str, db: AsyncSession) -> ExperienceStep:
    step = await db.scalar(
        select(ExperienceStep)
        .join(ExperienceWorkflow, ExperienceWorkflow.id == ExperienceStep.workflow_id)
        .where(ExperienceStep.id == step_id, ExperienceWorkflow.event_id == event_id)
    )
    if not step:
        raise HTTPException(422, "Experience step does not belong to this event")
    return step


def _prefix(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    # RFC 5321 limits the complete mailbox local part to 64 octets. Reserve
    # one byte for "+" and 32 bytes for the 128-bit hex routing token.
    return (cleaned or "automation")[:31]


def _event_alias(value: str, prefix: str) -> str:
    """Return a readable routing alias that still fits the SMTP local part."""
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    max_length = 63 - len(prefix)  # prefix + '+' + alias <= 64 octets
    return (cleaned or "event")[:max_length].rstrip("-")


async def _unique_event_alias(event: Event, prefix: str, db: AsyncSession) -> str:
    base = _event_alias(event.name, prefix)
    candidate = base
    counter = 2
    while await db.scalar(select(InboundEmailAutomation.id).where(
        InboundEmailAutomation.inbound_token == candidate
    )):
        suffix = f"-{counter}"
        candidate = f"{base[:max(1, 63 - len(prefix) - len(suffix))].rstrip('-')}{suffix}"
        counter += 1
    return candidate


def _rules(rows) -> list[dict]:
    return [row.model_dump() if hasattr(row, "model_dump") else dict(row) for row in rows]


async def _stats(automation_id: str, db: AsyncSession) -> dict[str, int]:
    rows = (await db.execute(
        select(InboundEmail.processing_status, func.count(InboundEmail.id))
        .where(
            InboundEmail.automation_id == automation_id,
            InboundEmail.sender_status == "trusted",
        )
        .group_by(InboundEmail.processing_status)
    )).all()
    values = {str(status): int(count) for status, count in rows}
    values["received"] = sum(values.values())
    return values


async def _automation_out(row: InboundEmailAutomation, db: AsyncSession) -> InboundEmailAutomationOut:
    return InboundEmailAutomationOut(
        id=row.id,
        event_id=row.event_id,
        step_id=row.step_id,
        name=row.name,
        address_prefix=row.address_prefix,
        inbound_address=f"{row.address_prefix}+{row.inbound_token}@{settings.inbound_email_domain}",
        status=row.status,
        sender_rules=row.sender_rules or [],
        completion_rules=row.completion_rules or {"match": "all", "conditions": []},
        created_at=row.created_at,
        updated_at=row.updated_at,
        stats=await _stats(row.id, db),
    )


@router.get("/{event_id}/experience/inbound-automations", response_model=list[InboundEmailAutomationOut])
async def list_automations(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    await _event(event_id, db)
    rows = (await db.execute(
        select(InboundEmailAutomation)
        .where(InboundEmailAutomation.event_id == event_id)
        .order_by(InboundEmailAutomation.created_at.desc())
    )).scalars().all()
    return [await _automation_out(row, db) for row in rows]


@router.get("/{event_id}/experience/inbound-automations/audit", response_model=list[InboundEmailAuditOut])
async def list_inbound_audit(
    event_id: str,
    automation_id: str | None = None,
    status: str | None = None,
    trusted_only: bool = True,
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Return provider consent decisions for the organizer-facing audit.

    Rejected mail from unrelated senders remains retained for security evidence
    but is hidden by default so a mailbox forward cannot flood the consent UI.
    Administrators can explicitly request the full security audit.
    """
    await _event(event_id, db)
    limit = max(1, min(limit, 1000))
    query = (
        select(InboundEmail, InboundEmailAutomation, Guest, User)
        .outerjoin(InboundEmailAutomation, InboundEmailAutomation.id == InboundEmail.automation_id)
        .outerjoin(Guest, Guest.id == InboundEmail.matched_guest_id)
        .outerjoin(User, User.id == InboundEmail.reviewed_by_user_id)
        .where(InboundEmail.event_id == event_id)
    )
    if automation_id:
        query = query.where(InboundEmail.automation_id == automation_id)
    if status:
        query = query.where(InboundEmail.processing_status == status)
    if trusted_only:
        query = query.where(InboundEmail.sender_status == "trusted")
    rows = (await db.execute(
        query.order_by(InboundEmail.received_at.desc()).limit(limit)
    )).all()
    return [InboundEmailAuditOut(
        id=email.id,
        automation_id=email.automation_id,
        automation_name=automation.name if automation else None,
        guest_id=email.matched_guest_id,
        guest_name=(f"{guest.first_name} {guest.last_name or ''}".strip() if guest else None),
        guest_email=guest.email if guest else None,
        subject=email.subject,
        from_address=email.from_address,
        original_sender=email.original_sender,
        sanitized_excerpt=email.sanitized_excerpt,
        extracted_identifiers=email.extracted_identifiers,
        processing_status=email.processing_status,
        match_status=email.match_status,
        match_method=email.match_method,
        sender_status=email.sender_status,
        rule_status=email.rule_status,
        failure_code=email.failure_code,
        failure_reason=email.failure_reason,
        reviewer_name=reviewer.name if reviewer else None,
        received_at=email.received_at,
        processed_at=email.processed_at,
        reviewed_at=email.reviewed_at,
    ) for email, automation, guest, reviewer in rows]


@router.post(
    "/{event_id}/experience/inbound-automations/{automation_id}/revalidate",
    response_model=InboundEmailRevalidationOut,
)
async def revalidate_inbound_emails(
    event_id: str,
    automation_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Re-run retained, unresolved mail through the automation's current rules.

    The normal processor still enforces authenticated sender, completion-rule,
    and unique guest matching checks. Completed and administratively ignored
    records are immutable and are never replayed.
    """
    await _event(event_id, db)
    automation = await _owned_automation(event_id, automation_id, db)
    if automation.status != "active":
        raise HTTPException(409, "Activate the automation before revalidating received mail")
    rows = (await db.execute(
        select(InboundEmail)
        .where(
            InboundEmail.event_id == event_id,
            InboundEmail.automation_id == automation_id,
            InboundEmail.processing_status.in_([
                "received", "retrying", "failed", "untrusted", "invalid", "needs_review",
            ]),
        )
        .order_by(InboundEmail.received_at.asc())
        .with_for_update()
    )).scalars().all()
    outcomes: dict[str, int] = {}
    for email in rows:
        await process_email(db, email)
        outcomes[email.processing_status] = outcomes.get(email.processing_status, 0) + 1
        await db.commit()
    return InboundEmailRevalidationOut(revalidated=len(rows), outcomes=outcomes)


@router.post("/{event_id}/experience/inbound-automations", response_model=InboundEmailAutomationOut, status_code=201)
async def create_automation(
    event_id: str,
    data: InboundEmailAutomationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_event_admin),
):
    event = await _event(event_id, db)
    await _event_step(event_id, data.step_id, db)
    prefix = _prefix(data.address_prefix or data.name)
    row = InboundEmailAutomation(
        org_id=event.org_id,
        event_id=event.id,
        step_id=data.step_id,
        name=data.name,
        address_prefix=prefix,
        # Human-readable event routing alias. Sender authentication, configured
        # provider rules, completion rules, and event-isolated unique matching
        # remain the authorization boundary; collisions receive -2, -3, etc.
        inbound_token=await _unique_event_alias(event, prefix, db),
        status=data.status,
        sender_rules=_rules(data.sender_rules),
        completion_rules=data.completion_rules.model_dump(),
        created_by_user_id=user.id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return await _automation_out(row, db)


async def _owned_automation(event_id: str, automation_id: str, db: AsyncSession) -> InboundEmailAutomation:
    row = await db.scalar(
        select(InboundEmailAutomation).where(
            InboundEmailAutomation.id == automation_id,
            InboundEmailAutomation.event_id == event_id,
        )
    )
    if not row:
        raise HTTPException(404, "Inbound automation not found")
    return row


@router.patch("/{event_id}/experience/inbound-automations/{automation_id}", response_model=InboundEmailAutomationOut)
async def update_automation(
    event_id: str,
    automation_id: str,
    data: InboundEmailAutomationUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    await _event(event_id, db)
    row = await _owned_automation(event_id, automation_id, db)
    values = data.model_dump(exclude_unset=True)
    if "step_id" in values:
        await _event_step(event_id, values["step_id"], db)
    if "sender_rules" in values:
        values["sender_rules"] = _rules(data.sender_rules or [])
    if "completion_rules" in values:
        values["completion_rules"] = data.completion_rules.model_dump() if data.completion_rules else None
    for key, value in values.items():
        setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    return await _automation_out(row, db)


@router.delete("/{event_id}/experience/inbound-automations/{automation_id}", status_code=204)
async def pause_automation(
    event_id: str,
    automation_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    await _event(event_id, db)
    row = await _owned_automation(event_id, automation_id, db)
    row.status = "paused"
    await db.commit()
    return Response(status_code=204)


@router.get("/{event_id}/experience/inbound-automations/needs-review", response_model=list[InboundEmailReviewOut])
async def needs_review(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    await _event(event_id, db)
    return (await db.execute(
        select(InboundEmail)
        .where(
            InboundEmail.event_id == event_id,
            InboundEmail.processing_status == "needs_review",
            InboundEmail.sender_status == "trusted",
        )
        .order_by(InboundEmail.received_at.desc())
        .limit(250)
    )).scalars().all()


async def _review_email(event_id: str, inbound_email_id: str, db: AsyncSession) -> InboundEmail:
    row = await db.scalar(
        select(InboundEmail)
        .where(InboundEmail.id == inbound_email_id, InboundEmail.event_id == event_id)
        .with_for_update()
    )
    if not row:
        raise HTTPException(404, "Inbound email not found")
    return row


@router.post("/{event_id}/experience/inbound-automations/needs-review/{inbound_email_id}/match", response_model=InboundEmailReviewOut)
async def manually_match(
    event_id: str,
    inbound_email_id: str,
    data: InboundEmailManualMatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_event_admin),
):
    event = await _event(event_id, db)
    email = await _review_email(event_id, inbound_email_id, db)
    if email.processing_status != "needs_review":
        raise HTTPException(409, "Email is not awaiting review")
    if email.sender_status != "trusted" or email.rule_status != "passed":
        raise HTTPException(409, "Only trusted emails that passed completion rules can be matched")
    automation = await _owned_automation(event_id, email.automation_id or "", db)
    step = await _event_step(event_id, automation.step_id, db)
    guest = await db.get(Guest, data.guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    try:
        _, newly_completed = await complete_guest_step(
            db,
            event=event,
            guest=guest,
            step=step,
            source="inbound_email",
            actor_user_id=user.id,
            metadata={
                "automation_id": automation.id,
                "inbound_email_id": email.id,
                "resend_email_id": email.resend_email_id,
                "match_method": "manual",
                "processing_method": "manual",
            },
        )
    except ExperienceCompletionError as exc:
        raise HTTPException(409, str(exc)) from exc
    email.processing_status = "completed"
    email.match_status = "matched"
    email.matched_guest_id = guest.id
    email.match_method = "manual"
    email.processed_at = datetime.utcnow()
    email.reviewed_at = datetime.utcnow()
    email.reviewed_by_user_id = user.id
    email.failure_code = None
    email.failure_reason = None if newly_completed else "Step was already complete; no duplicate activity was created."
    await db.commit()
    await db.refresh(email)
    return email


@router.post("/{event_id}/experience/inbound-automations/needs-review/{inbound_email_id}/{action}", response_model=InboundEmailReviewOut)
async def resolve_review(
    event_id: str,
    inbound_email_id: str,
    action: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_event_admin),
):
    await _event(event_id, db)
    if action not in {"invalid", "ignore"}:
        raise HTTPException(404, "Unknown review action")
    email = await _review_email(event_id, inbound_email_id, db)
    if email.processing_status != "needs_review":
        raise HTTPException(409, "Email is not awaiting review")
    email.processing_status = "invalid" if action == "invalid" else "ignored"
    email.failure_code = "manually_invalid" if action == "invalid" else "manually_ignored"
    email.failure_reason = f"Marked {action} by staff."
    email.reviewed_by_user_id = user.id
    email.reviewed_at = datetime.utcnow()
    email.processed_at = datetime.utcnow()
    await db.commit()
    await db.refresh(email)
    return email
