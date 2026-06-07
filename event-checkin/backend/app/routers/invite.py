"""Public invite & RSVP router — no authentication required.

Endpoints:
  GET  /api/invite/{event_id}              — public event page data + questions
  POST /api/invite/{event_id}/rsvp         — open-mode self-registration → QR
  GET  /api/invite/token/{invite_token}    — personalised (closed-mode) page
  POST /api/invite/token/{invite_token}/rsvp — invited guest confirms / declines
"""
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, Guest, RSVPAnswer, RSVPQuestion
from ..schemas import (
    InviteGuestPrefill, InvitePageOut, InviteTokenPageOut,
    RSVPConfirm, RSVPSubmit, RSVPTokenSubmit,
)
from services import messaging
from services.email_service import send_invite_email
from .guests import _normalize_phone
from ..entitlements import assert_within_guest_cap

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


def _deadline_passed(event: Event) -> bool:
    return event.rsvp_deadline is not None and datetime.utcnow() >= event.rsvp_deadline


async def _require_questions_answered(
    event_id: str, answers: dict[str, str], db: AsyncSession
) -> None:
    """Reject the submission if any required question is missing/blank.
    For boolean questions either 'yes' or 'no' counts as answered."""
    required = (await db.execute(
        select(RSVPQuestion).where(
            RSVPQuestion.event_id == event_id,
            RSVPQuestion.is_required.is_(True),
        )
    )).scalars().all()
    for q in required:
        if not (answers.get(q.id) or "").strip():
            raise HTTPException(422, f"Please answer: {q.question}")


async def _save_answers(
    guest_id: str, event_id: str, answers: dict[str, str], db: AsyncSession,
    *, replace: bool = False,
) -> None:
    """Persist answers, ignoring question IDs not belonging to this event.
    When replace=True, existing answers for the guest are cleared first
    (used when a guest re-submits via their personalised link)."""
    if replace:
        existing = (await db.execute(
            select(RSVPAnswer).where(RSVPAnswer.guest_id == guest_id)
        )).scalars().all()
        for a in existing:
            await db.delete(a)
    if not answers:
        return
    valid = set((await db.execute(
        select(RSVPQuestion.id).where(
            RSVPQuestion.event_id == event_id,
            RSVPQuestion.id.in_(list(answers.keys())),
        )
    )).scalars().all())
    for qid, ans in answers.items():
        if qid in valid:
            db.add(RSVPAnswer(guest_id=guest_id, question_id=qid, answer=ans))


async def _invite_page_out(event: Event, db: AsyncSession) -> InvitePageOut:
    questions = (await db.execute(
        select(RSVPQuestion)
        .where(RSVPQuestion.event_id == event.id)
        .order_by(RSVPQuestion.sort_order)
    )).scalars().all()
    count = await _rsvp_count(event.id, db)
    return InvitePageOut(
        id=event.id,
        name=event.name,
        couples_name=event.couples_name,
        event_date=event.event_date,
        description=event.description,
        invite_theme=event.invite_theme,
        invite_message=event.invite_message,
        invite_cover_image=event.invite_cover_image,
        rsvp_enabled=event.rsvp_enabled,
        rsvp_collect_phone=event.rsvp_collect_phone,
        rsvp_collect_email=event.rsvp_collect_email,
        rsvp_capacity=event.rsvp_capacity,
        invite_mode=event.invite_mode,
        rsvp_deadline=event.rsvp_deadline,
        rsvp_count=count,
        deadline_passed=_deadline_passed(event),
        questions=list(questions),
    )


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
    return await _invite_page_out(event, db)


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

    # Closed events are invitation-only — guests must use their personal link.
    if event.invite_mode == "closed":
        raise HTTPException(
            403,
            "This event is by invitation only — please use the personal invite "
            "link sent to you.",
        )

    if _deadline_passed(event):
        raise HTTPException(410, "RSVP has closed for this event")

    # Capacity guard (host-set RSVP cap and plan entitlement cap)
    count = await _rsvp_count(event_id, db)
    if event.rsvp_capacity is not None and count >= event.rsvp_capacity:
        raise HTTPException(409, "Sorry — this event is at capacity")
    assert_within_guest_cap(event, count)

    await _require_questions_answered(event_id, data.answers, db)

    email = data.email.lower().strip() if data.email else None

    # Duplicate guard (only when email is provided). Use .first() rather than
    # scalar_one_or_none(): a synced guest list can legitimately already hold
    # multiple rows for the same email (repeated sheet imports), and
    # scalar_one_or_none() raises MultipleResultsFound in that case → 500.
    if email:
        existing = (await db.execute(
            select(Guest.id)
            .where(Guest.event_id == event_id, Guest.email == email)
            .limit(1)
        )).first()
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

    # When the event requires approval, self-registrations land as "pending":
    # no ticket is issued until a planner approves. Otherwise confirm instantly.
    needs_approval = event.rsvp_require_approval
    now = datetime.utcnow()

    guest = Guest(
        event_id=event_id,
        first_name=data.first_name.strip(),
        last_name=data.last_name.strip(),
        email=email,
        phone=phone,
        qr_generated_at=None if needs_approval else now,
        # invite_sent_at marks that we've delivered their ticket — set it here for
        # instant confirmations so self-registrations count as "invited" in stats.
        invite_sent_at=None if needs_approval else now,
        rsvp_status="pending" if needs_approval else "confirmed",
        rsvp_responded_at=now,
    )
    db.add(guest)
    await db.flush()

    await _save_answers(guest.id, event_id, data.answers, db)

    await db.commit()
    await db.refresh(guest)

    if needs_approval:
        return RSVPConfirm(
            id=guest.id,
            qr_token=guest.qr_token,
            first_name=guest.first_name,
            last_name=guest.last_name,
            rsvp_status="pending",
            message="RSVP received! The host will confirm your spot and email your ticket.",
        )

    # Approved automatically — fire the ticket in the background.
    _send_rsvp_invite(background_tasks, event, guest)
    return RSVPConfirm(
        id=guest.id,
        qr_token=guest.qr_token,
        first_name=guest.first_name,
        last_name=guest.last_name,
        rsvp_status="confirmed",
        message="RSVP confirmed! Check your email for your ticket.",
    )


# ── Personalised (closed-mode) invite links ─────────────────────────────────

async def _get_guest_by_token(invite_token: str, db: AsyncSession) -> tuple[Guest, Event]:
    guest = (await db.execute(
        select(Guest).where(Guest.invite_token == invite_token).limit(1)
    )).scalar_one_or_none()
    if not guest:
        raise HTTPException(404, "Invite not found")
    event = await db.get(Event, guest.event_id)
    if not event or event.status == "ended":
        raise HTTPException(410, "This event has ended")
    return guest, event


@router.get("/token/{invite_token}", response_model=InviteTokenPageOut)
async def get_invite_token_page(invite_token: str, db: AsyncSession = Depends(get_db)):
    """Personalised invite page for a single guest (closed mode)."""
    guest, event = await _get_guest_by_token(invite_token, db)
    return InviteTokenPageOut(
        event=await _invite_page_out(event, db),
        guest=InviteGuestPrefill(
            first_name=guest.first_name,
            last_name=guest.last_name,
            email=guest.email,
            phone=guest.phone,
            rsvp_status=guest.rsvp_status,
            email_locked=bool(guest.email),
            phone_locked=False,
        ),
        deadline_passed=_deadline_passed(event),
        already_responded=guest.rsvp_status in ("confirmed", "declined"),
    )


@router.post("/token/{invite_token}/rsvp", response_model=RSVPConfirm)
async def submit_invite_token_rsvp(
    invite_token: str,
    data: RSVPTokenSubmit,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """An invited guest confirms or declines via their personal link. The token
    binds to exactly one guest row, so it can only ever update that guest —
    a forwarded link can't register anyone new. Editable until the deadline."""
    guest, event = await _get_guest_by_token(invite_token, db)

    if _deadline_passed(event):
        raise HTTPException(410, "RSVP has closed for this event")

    if data.status == "confirmed":
        await _require_questions_answered(event.id, data.answers, db)

    # Identity: name/phone may be corrected; email is never editable here.
    if data.first_name and data.first_name.strip():
        guest.first_name = data.first_name.strip()
    if data.last_name and data.last_name.strip():
        guest.last_name = data.last_name.strip()
    if data.phone and data.phone.strip():
        phone = _normalize_phone(data.phone.strip())
        if phone is None:
            raise HTTPException(
                422,
                "Phone format not recognised. Use E.164 (e.g. +18327941707) or US 10-digit.",
            )
        guest.phone = phone

    guest.rsvp_status = data.status
    guest.rsvp_responded_at = datetime.utcnow()
    await _save_answers(guest.id, event.id, data.answers, db, replace=True)

    if data.status == "confirmed":
        if not guest.qr_generated_at:
            guest.qr_generated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(guest)
        # Issue the ticket now that they've confirmed.
        _send_rsvp_invite(background_tasks, event, guest)
        message = "You're confirmed! Check your email for your ticket."
    else:
        await db.commit()
        await db.refresh(guest)
        message = "Thanks for letting us know — we'll miss you!"

    return RSVPConfirm(
        id=guest.id,
        qr_token=guest.qr_token,
        first_name=guest.first_name,
        last_name=guest.last_name,
        rsvp_status=guest.rsvp_status,
        message=message,
    )
