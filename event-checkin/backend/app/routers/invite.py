"""Public invite & RSVP router — no authentication required.

Endpoints:
  GET  /api/invite/{event_id}         — public event page data + questions
  POST /api/invite/{event_id}/rsvp    — guest self-registers and gets a QR
"""
import logging
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, Guest, RSVPAnswer, RSVPQuestion
from ..schemas import InvitePageOut, RSVPConfirm, RSVPSubmit
from services import messaging
from services.email_service import send_invite_email
from .guests import _normalize_phone

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_public_event(event_id: str, db: AsyncSession) -> Event:
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if event.status == "ended":
        raise HTTPException(410, "This event has ended")
    return event


async def _rsvp_count(event_id: str, db: AsyncSession) -> int:
    return await db.scalar(
        select(func.count()).where(Guest.event_id == event_id)
    ) or 0


def _send_rsvp_invite(
    background_tasks: BackgroundTasks,
    event: Event,
    guest: Guest,
) -> None:
    """Fan out invite notifications across the channels enabled on this event."""
    ticket_url = f"{event.checkin_base_url.rstrip('/')}/scan/{guest.qr_token}"

    if event.notify_email and guest.email:
        background_tasks.add_task(
            send_invite_email,
            {"first_name": guest.first_name, "last_name": guest.last_name,
             "email": guest.email, "qr_token": guest.qr_token},
            event.name, event.couples_name, event.checkin_base_url,
            event.event_date,
            event.seating_enabled, event.menu_enabled,
        )

    if event.notify_sms and guest.phone and guest.sms_consent:
        background_tasks.add_task(
            messaging.send_invite_sms,
            phone=guest.phone, first_name=guest.first_name,
            event_name=event.name, ticket_url=ticket_url,
            event_date=event.event_date,
        )

    if event.notify_whatsapp and guest.phone and guest.whatsapp_consent:
        background_tasks.add_task(
            messaging.send_invite_whatsapp,
            phone=guest.phone, first_name=guest.first_name,
            event_name=event.name, ticket_url=ticket_url,
            event_date=event.event_date,
        )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/{event_id}", response_model=InvitePageOut)
async def get_invite_page(event_id: str, db: AsyncSession = Depends(get_db)):
    """Return the public event page — theme, copy, questions, capacity status."""
    event = await _get_public_event(event_id, db)

    questions = (await db.execute(
        select(RSVPQuestion)
        .where(RSVPQuestion.event_id == event_id)
        .order_by(RSVPQuestion.sort_order)
    )).scalars().all()

    count = await _rsvp_count(event_id, db)

    return InvitePageOut(
        id=event.id,
        name=event.name,
        couples_name=event.couples_name,
        event_date=event.event_date,
        description=event.description,
        invite_theme=event.invite_theme,
        invite_message=event.invite_message,
        rsvp_enabled=event.rsvp_enabled,
        rsvp_collect_phone=event.rsvp_collect_phone,
        rsvp_capacity=event.rsvp_capacity,
        rsvp_count=count,
        questions=list(questions),
    )


@router.post("/{event_id}/rsvp", response_model=RSVPConfirm, status_code=201)
async def submit_rsvp(
    event_id: str,
    data: RSVPSubmit,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Self-service RSVP: creates a guest record, generates a QR token, and
    fires invite notifications via the existing email/SMS/WhatsApp pipeline."""
    event = await _get_public_event(event_id, db)

    if not event.rsvp_enabled:
        raise HTTPException(400, "RSVP is not open for this event")

    # Capacity guard
    if event.rsvp_capacity is not None:
        count = await _rsvp_count(event_id, db)
        if count >= event.rsvp_capacity:
            raise HTTPException(409, "Sorry — this event is at capacity")

    email = data.email.lower().strip()

    # Duplicate guard
    existing = (await db.execute(
        select(Guest).where(Guest.event_id == event_id, Guest.email == email)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "You've already RSVP'd for this event")

    # Validate / normalise phone
    phone: str | None = None
    if data.phone and data.phone.strip():
        phone = _normalize_phone(data.phone.strip())
        if phone is None:
            raise HTTPException(
                422,
                "Phone format not recognised. Use E.164 (e.g. +18327941707) or US 10-digit.",
            )

    guest = Guest(
        event_id=event_id,
        first_name=data.first_name.strip(),
        last_name=data.last_name.strip(),
        email=email,
        phone=phone,
        qr_generated_at=datetime.utcnow(),
    )
    db.add(guest)
    await db.flush()

    # Validate that supplied question IDs belong to this event
    if data.answers:
        q_ids = list(data.answers.keys())
        valid_qs = (await db.execute(
            select(RSVPQuestion.id)
            .where(RSVPQuestion.event_id == event_id, RSVPQuestion.id.in_(q_ids))
        )).scalars().all()
        valid_set = set(valid_qs)
        for qid, ans in data.answers.items():
            if qid not in valid_set:
                continue  # silently ignore unknown question IDs
            db.add(RSVPAnswer(guest_id=guest.id, question_id=qid, answer=ans))

    await db.commit()
    await db.refresh(guest)

    # Fire invite notifications in the background
    _send_rsvp_invite(background_tasks, event, guest)

    return RSVPConfirm(
        id=guest.id,
        qr_token=guest.qr_token,
        first_name=guest.first_name,
        last_name=guest.last_name,
        message="RSVP confirmed! Check your email for your ticket.",
    )
