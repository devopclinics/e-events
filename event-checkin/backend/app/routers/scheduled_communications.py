"""Organizer API for the unified Guest Communication scheduler."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_paid_event_admin, require_paid_event_member
from ..database import get_db
from ..models import Event, ExperienceStep, ExperienceWorkflow, ScheduledCommunication, ScheduledCommunicationDelivery, User
from ..schemas import (
    ScheduledCommunicationCreate,
    ScheduledCommunicationOut,
    ScheduledCommunicationUpdate,
)
from ..services.scheduled_communications import (
    compute_scheduled_for,
    estimated_recipients,
    replace_frozen_audience,
    scheduled_local_iso,
)

router = APIRouter()
_EDITABLE = {"draft", "scheduled", "paused"}


def _enforce_consent_audience(row) -> None:
    """Consent reminders must always re-check completion at delivery time."""
    if row.communication_type == "consent_reminder":
        row.audience_type = "consent_incomplete"
        row.audience_mode = "dynamic"


async def _event(event_id: str, db: AsyncSession) -> Event:
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return event


async def _row(event_id: str, communication_id: str, db: AsyncSession) -> ScheduledCommunication:
    row = await db.get(ScheduledCommunication, communication_id)
    if not row or row.event_id != event_id:
        raise HTTPException(404, "Scheduled communication not found")
    return row


async def _step_offset(
    db: AsyncSession,
    event_id: str,
    anchor: str | None,
    anchor_step_id: str | None,
) -> int | None:
    if anchor != "experience_step":
        return None
    if not anchor_step_id:
        raise HTTPException(422, "Choose an Experience program session")
    offset = await db.scalar(
        select(ExperienceStep.starts_offset_seconds)
        .join(ExperienceWorkflow, ExperienceWorkflow.id == ExperienceStep.workflow_id)
        .where(
            ExperienceStep.id == anchor_step_id,
            ExperienceWorkflow.event_id == event_id,
            ExperienceStep.enabled.is_(True),
            ExperienceStep.is_segment.is_(True),
        )
    )
    if offset is None:
        raise HTTPException(422, "The selected Experience session is unavailable or has no start time")
    return int(offset)


def _validate_content(data) -> None:
    if not data.channels:
        raise HTTPException(422, "Choose at least one delivery channel")
    if data.communication_type in {"invitation", "rsvp_reminder"}:
        return
    if "email" in data.channels and not (data.email_body or "").strip():
        raise HTTPException(422, "Add an email message or remove the email channel")
    if "sms" in data.channels and not (data.sms_body or "").strip():
        raise HTTPException(422, "Add an SMS message or remove the SMS channel")
    if "whatsapp" in data.channels and not (data.whatsapp_body or "").strip():
        raise HTTPException(422, "Add a WhatsApp message or remove the WhatsApp channel")
    if "mms" in data.channels:
        if not (data.mms_body or "").strip():
            raise HTTPException(422, "Add an MMS message or remove the MMS channel")
        if not (data.mms_media_url or "").lower().startswith("https://"):
            raise HTTPException(422, "MMS requires an HTTPS image URL")


async def _out(db: AsyncSession, row: ScheduledCommunication) -> ScheduledCommunicationOut:
    return ScheduledCommunicationOut(
        id=row.id,
        event_id=row.event_id,
        name=row.name,
        communication_type=row.communication_type,
        trigger_type=row.trigger_type,
        anchor=row.anchor,
        anchor_step_id=row.anchor_step_id,
        offset_minutes=row.offset_minutes,
        scheduled_for_utc=row.scheduled_for_utc,
        scheduled_at_local=scheduled_local_iso(row),
        timezone=row.timezone,
        channels=row.channels or [],
        audience_type=row.audience_type,
        audience_mode=row.audience_mode,
        subject=row.subject,
        email_body=row.email_body,
        sms_body=row.sms_body,
        whatsapp_body=row.whatsapp_body,
        mms_body=row.mms_body,
        mms_media_url=row.mms_media_url,
        status=row.status,
        recipients_estimated=await estimated_recipients(db, row),
        recipients_targeted=row.recipients_targeted,
        recipients_sent=row.recipients_sent,
        recipients_failed=row.recipients_failed,
        last_error=row.last_error,
        claimed_at=row.claimed_at,
        sent_at=row.sent_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/{event_id}/communications/scheduled", response_model=list[ScheduledCommunicationOut])
async def list_scheduled_communications(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_member),
):
    await _event(event_id, db)
    rows = list((await db.scalars(select(ScheduledCommunication).where(
        ScheduledCommunication.event_id == event_id,
    ).order_by(ScheduledCommunication.scheduled_for_utc, ScheduledCommunication.created_at))).all())
    return [await _out(db, row) for row in rows]


@router.post("/{event_id}/communications/scheduled", response_model=ScheduledCommunicationOut, status_code=201)
async def create_scheduled_communication(
    event_id: str,
    data: ScheduledCommunicationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_paid_event_admin),
):
    event = await _event(event_id, db)
    _validate_content(data)
    scheduled_for = compute_scheduled_for(
        event,
        trigger_type=data.trigger_type,
        scheduled_at_local=data.scheduled_at_local,
        anchor=data.anchor,
        anchor_offset_seconds=await _step_offset(db, event_id, data.anchor, data.anchor_step_id),
        offset_minutes=data.offset_minutes,
    )
    row = ScheduledCommunication(
        event_id=event_id,
        name=data.name.strip(),
        communication_type=data.communication_type,
        trigger_type=data.trigger_type,
        anchor=data.anchor if data.trigger_type == "relative" else None,
        anchor_step_id=(
            data.anchor_step_id
            if data.trigger_type == "relative" and data.anchor == "experience_step" else None
        ),
        offset_minutes=data.offset_minutes if data.trigger_type == "relative" else None,
        scheduled_for_utc=scheduled_for,
        timezone=event.timezone or "UTC",
        channels=data.channels,
        audience_type=data.audience_type,
        audience_mode=data.audience_mode,
        subject=data.subject,
        email_body=data.email_body,
        sms_body=data.sms_body,
        whatsapp_body=data.whatsapp_body,
        mms_body=data.mms_body,
        mms_media_url=data.mms_media_url,
        status=data.status,
        created_by=user.id,
    )
    _enforce_consent_audience(row)
    db.add(row)
    await db.flush()
    await replace_frozen_audience(db, row)
    await db.commit()
    await db.refresh(row)
    return await _out(db, row)


@router.put("/{event_id}/communications/scheduled/{communication_id}", response_model=ScheduledCommunicationOut)
async def update_scheduled_communication(
    event_id: str,
    communication_id: str,
    data: ScheduledCommunicationUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
):
    event = await _event(event_id, db)
    row = await _row(event_id, communication_id, db)
    if row.status not in _EDITABLE:
        raise HTTPException(409, "Only draft, scheduled, or paused communications can be edited")
    changes = data.model_dump(exclude_unset=True)
    scheduled_at_local = changes.pop("scheduled_at_local", None)
    for key, value in changes.items():
        setattr(row, key, value)
    _enforce_consent_audience(row)
    _validate_content(row)
    timing_changed = bool(scheduled_at_local) or any(
        key in changes for key in ("trigger_type", "anchor", "anchor_step_id", "offset_minutes")
    )
    if timing_changed:
        row.scheduled_for_utc = compute_scheduled_for(
            event,
            trigger_type=row.trigger_type,
            scheduled_at_local=scheduled_at_local or scheduled_local_iso(row),
            anchor=row.anchor,
            anchor_offset_seconds=await _step_offset(db, event_id, row.anchor, row.anchor_step_id),
            offset_minutes=row.offset_minutes,
        )
    if row.trigger_type == "absolute":
        row.anchor = None
        row.anchor_step_id = None
        row.offset_minutes = None
    elif row.anchor != "experience_step":
        row.anchor_step_id = None
    row.timezone = event.timezone or "UTC"
    if "audience_type" in changes or "audience_mode" in changes:
        await replace_frozen_audience(db, row)
    await db.commit()
    await db.refresh(row)
    return await _out(db, row)


@router.post("/{event_id}/communications/scheduled/{communication_id}/pause", response_model=ScheduledCommunicationOut)
async def pause_scheduled_communication(
    event_id: str,
    communication_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
):
    row = await _row(event_id, communication_id, db)
    if row.status != "scheduled":
        raise HTTPException(409, "Only a scheduled communication can be paused")
    row.status = "paused"
    await db.commit()
    await db.refresh(row)
    return await _out(db, row)


@router.post("/{event_id}/communications/scheduled/{communication_id}/resume", response_model=ScheduledCommunicationOut)
async def resume_scheduled_communication(
    event_id: str,
    communication_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
):
    row = await _row(event_id, communication_id, db)
    if row.status not in {"draft", "paused"}:
        raise HTTPException(409, "Only a draft or paused communication can be scheduled")
    row.status = "scheduled"
    await db.commit()
    await db.refresh(row)
    return await _out(db, row)


@router.post("/{event_id}/communications/scheduled/{communication_id}/send-now", response_model=ScheduledCommunicationOut)
async def send_scheduled_communication_now(
    event_id: str,
    communication_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
):
    row = await _row(event_id, communication_id, db)
    if row.status not in _EDITABLE:
        raise HTTPException(409, "This communication can no longer be sent")
    row.scheduled_for_utc = datetime.utcnow()
    row.status = "scheduled"
    await db.commit()
    await db.refresh(row)
    return await _out(db, row)


@router.post("/{event_id}/communications/scheduled/{communication_id}/cancel", response_model=ScheduledCommunicationOut)
async def cancel_scheduled_communication(
    event_id: str,
    communication_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
):
    row = await _row(event_id, communication_id, db)
    if row.status not in _EDITABLE:
        raise HTTPException(409, "Only an unsent communication can be cancelled")
    row.status = "cancelled"
    await db.commit()
    await db.refresh(row)
    return await _out(db, row)


@router.post("/{event_id}/communications/scheduled/{communication_id}/retry", response_model=ScheduledCommunicationOut)
async def retry_scheduled_communication(
    event_id: str,
    communication_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
):
    row = await _row(event_id, communication_id, db)
    if row.status not in {"failed", "partial"}:
        raise HTTPException(409, "Only failed or partially sent communications can be retried")
    row.status = "scheduled"
    row.scheduled_for_utc = datetime.utcnow()
    row.claimed_at = None
    row.sent_at = None
    row.last_error = None
    # The sender skips successful delivery rows and retries only the failed
    # recipients, preserving idempotency and the original audit trail.
    await db.commit()
    await db.refresh(row)
    return await _out(db, row)


@router.get("/{event_id}/communications/scheduled/{communication_id}/deliveries")
async def scheduled_communication_deliveries(
    event_id: str,
    communication_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_member),
):
    await _row(event_id, communication_id, db)
    rows = list((await db.scalars(select(ScheduledCommunicationDelivery).where(
        ScheduledCommunicationDelivery.communication_id == communication_id,
    ).order_by(ScheduledCommunicationDelivery.created_at))).all())
    return [{
        "guest_id": row.guest_id,
        "status": row.status,
        "channels_sent": row.channels_sent or [],
        "error": row.error,
        "sent_at": row.sent_at,
    } for row in rows]
