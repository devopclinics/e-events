"""Public invite & RSVP router — no authentication required.

Endpoints:
  GET  /api/invite/{event_id}              — public event page data + questions
  POST /api/invite/{event_id}/rsvp         — open-mode self-registration → QR
  GET  /api/invite/link/{rsvp_token}       — public event page by share token
  POST /api/invite/link/{rsvp_token}/rsvp  — open-mode self-registration by token
  GET  /api/invite/token/{invite_token}    — personalised (closed-mode) page
  POST /api/invite/token/{invite_token}/rsvp — invited guest confirms / declines
"""
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, Guest, RSVPAnswer, RSVPQuestion, Shipment, GuestShipment, TableGroup, TicketType
from ..schemas import (
    InviteGuestPrefill, InvitePageOut, InviteTokenPageOut,
    InviteShippingOut, InviteShipmentNeed, ShippingAddressUpdate,
    RSVPConfirm, RSVPSubmit, RSVPTokenSubmit,
)
from services import messaging
from services.credit_ledger import send_with_credit_ledger
from services.email_service import send_invite_email
from ..template_resolve import load_overrides
from .guests import _normalize_phone
from ..entitlements import assert_within_guest_cap, can_use_paid_channels, last_credit_ledger_id, take_message_credit
from ..services.festiome_outbox import queue_guest_sync

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


async def _get_public_event_by_rsvp_token(rsvp_token: str, db: AsyncSession) -> Event:
    event = (await db.execute(
        select(Event).where(Event.rsvp_token == rsvp_token).limit(1)
    )).scalar_one_or_none()
    if not event:
        raise HTTPException(404, "RSVP link not found")
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


async def _pre_shipments(event: Event, db: AsyncSession) -> list[Shipment]:
    """Auto-add pre-event shipments for a logistics-enabled event. These drive
    shipping-address + size collection on the public RSVP page. Curated
    shipments (auto_add=False) are excluded so they stay admin-managed."""
    if not event.logistics_enabled:
        return []
    return list((await db.execute(
        select(Shipment)
        .where(
            Shipment.event_id == event.id,
            Shipment.phase == "pre",
            Shipment.auto_add.is_(True),
        )
        .order_by(Shipment.created_at)
    )).scalars().all())


async def _invite_shipping(event: Event, db: AsyncSession) -> InviteShippingOut | None:
    shipments = await _pre_shipments(event, db)
    if not shipments:
        return None
    import json as _json
    needs = []
    for s in shipments:
        opts = None
        if s.size_options:
            try:
                opts = _json.loads(s.size_options)
            except Exception:
                opts = None
        needs.append(InviteShipmentNeed(
            shipment_id=s.id, name=s.name,
            collect_size=s.collect_size, size_options=opts,
        ))
    return InviteShippingOut(collect_address=True, shipments=needs)


async def _save_shipping(
    guest: Guest, event: Event,
    shipping_address: ShippingAddressUpdate | None,
    sizes: dict[str, str], db: AsyncSession,
) -> None:
    """Persist a guest's shipping address and ensure a GuestShipment line exists
    on each pre-event shipment (with their chosen size). No-op without logistics."""
    shipments = await _pre_shipments(event, db)
    if not shipments:
        return
    if shipping_address is not None:
        for k, v in shipping_address.model_dump(exclude_unset=True).items():
            setattr(guest, k, (v.strip() if isinstance(v, str) else v) or None)
    valid_ids = {s.id for s in shipments}
    for s in shipments:
        chosen = (sizes.get(s.id) or "").strip() or None
        line = await db.scalar(
            select(GuestShipment).where(
                GuestShipment.shipment_id == s.id, GuestShipment.guest_id == guest.id
            )
        )
        if line:
            if chosen:
                line.size = chosen
        else:
            db.add(GuestShipment(shipment_id=s.id, guest_id=guest.id, size=chosen))


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
        venue_name=event.venue_name,
        venue_address=event.venue_address,
        hotel_name=event.hotel_name,
        hotel_address=event.hotel_address,
        admission_note=event.admission_note,
        rsvp_token=event.rsvp_token,
        invite_theme=event.invite_theme,
        invite_message=event.invite_message,
        invite_cover_image=event.invite_cover_image,
        rsvp_enabled=event.rsvp_enabled,
        experience_enabled=event.experience_enabled,
        rsvp_collect_phone=event.rsvp_collect_phone,
        rsvp_collect_email=event.rsvp_collect_email,
        rsvp_allow_duplicate_emails=event.rsvp_allow_duplicate_emails,
        rsvp_capacity=event.rsvp_capacity,
        invite_mode=event.invite_mode,
        rsvp_deadline=event.rsvp_deadline,
        rsvp_multi_invitee_enabled=event.rsvp_multi_invitee_enabled,
        rsvp_multi_invitee_limit=event.rsvp_multi_invitee_limit,
        rsvp_multi_invitee_limit_rules=event.rsvp_multi_invitee_limit_rules,
        rsvp_count=count,
        deadline_passed=_deadline_passed(event),
        questions=list(questions),
        shipping=await _invite_shipping(event, db),
        registry_enabled=event.registry_enabled,
        registry_token=event.registry_token,
    )


def _send_rsvp_invite(
    background_tasks: BackgroundTasks,
    event: Event,
    guest: Guest,
    overrides: dict | None = None,
) -> None:
    """Fan out invite notifications across the channels enabled on this event.
    SMS/WhatsApp require a paid event and consume one message credit each;
    email is always allowed. Caller must commit to persist credit decrements."""
    ticket_url = f"{event.checkin_base_url.rstrip('/')}/scan/{guest.qr_token}"
    hub_url = (
        f"{event.checkin_base_url.rstrip('/')}/r/{guest.invite_token}#guest-hub"
        if guest.invite_token else None
    )
    paid_channels = can_use_paid_channels(event)
    ov = (overrides or {}).get("ticket_qr")

    if event.notify_email and guest.email:
        background_tasks.add_task(
            send_invite_email,
            {"first_name": guest.first_name, "last_name": guest.last_name,
             "email": guest.email, "qr_token": guest.qr_token, "event_id": event.id,
             "guest_id": guest.id, "message_kind": "invitation"},
            event.name, event.couples_name, event.checkin_base_url,
            event.event_date,
            event.seating_enabled, event.menu_enabled, event.partner_pairing_enabled,
            ov.subject if ov else None, ov.email_body if ov else None,
            event.venue_name, event.venue_address, event.admission_note,
            event.invite_cover_image,
            hub_url=hub_url,
        )

    if paid_channels and event.notify_sms and guest.phone and guest.sms_consent and take_message_credit(event, "sms"):
        background_tasks.add_task(
            send_with_credit_ledger,
            last_credit_ledger_id(event),
            messaging.send_invite_sms,
            phone=guest.phone, first_name=guest.first_name,
            event_name=event.name, ticket_url=ticket_url,
            event_date=event.event_date,
        )

    if paid_channels and event.notify_whatsapp and guest.phone and guest.whatsapp_consent and take_message_credit(event, "whatsapp"):
        background_tasks.add_task(
            send_with_credit_ledger,
            last_credit_ledger_id(event),
            messaging.send_invite_whatsapp,
            phone=guest.phone, first_name=guest.first_name,
            event_name=event.name, ticket_url=ticket_url,
            event_date=event.event_date,
        )


def _split_invitee_name(full_name: str, first_name: str = "", last_name: str = "") -> tuple[str, str]:
    first = (first_name or "").strip()
    last = (last_name or "").strip()
    if first or last:
        return first or full_name.strip(), last
    parts = [p for p in (full_name or "").strip().split() if p]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _type_key(value: str | None) -> str:
    return (value or "").strip().lower()


async def _default_group_for_invitee(event_id: str, guest_type: str | None, db: AsyncSession) -> str | None:
    key = _type_key(guest_type)
    wanted = "FAMILY"
    if any(term in key for term in ("vip", "dignitary", "honour", "honor", "chairman", "guest of honour", "guest of honor")):
        wanted = "VIP"
    elif any(term in key for term in ("teacher", "staff", "school", "official", "volunteer")):
        wanted = "STAFF"
    group = await db.scalar(
        select(TableGroup)
        .where(TableGroup.event_id == event_id, func.lower(TableGroup.tag) == wanted.lower())
        .limit(1)
    )
    return group.id if group else None


async def _ticket_type_for_invitee(event_id: str, guest_type: str | None, db: AsyncSession) -> str | None:
    key = _type_key(guest_type)
    desired = "Invited Guest"
    if any(term in key for term in ("vip", "dignitary", "honour", "honor", "chairman", "guest of honour", "guest of honor")):
        desired = "VIP/Dignitary"
    elif any(term in key for term in ("teacher", "staff", "school", "official", "volunteer")):
        desired = "School/Staff"
    elif "parent" in key or "guardian" in key:
        desired = "Parent/Guardian"
    ticket = await db.scalar(
        select(TicketType)
        .where(TicketType.event_id == event_id, func.lower(TicketType.name) == desired.lower())
        .limit(1)
    )
    return ticket.id if ticket else None


async def _multi_invitee_limit_for_submission(
    event: Event,
    answers: dict[str, str],
    db: AsyncSession,
) -> tuple[int, str | None]:
    default_raw_limit = event.rsvp_multi_invitee_limit if event.rsvp_multi_invitee_limit is not None else 10
    default_limit = max(0, min(int(default_raw_limit), 100))
    rules = event.rsvp_multi_invitee_limit_rules or {}
    if not rules:
        return default_limit, None

    question_ids = list(answers.keys())
    if not question_ids:
        return default_limit, None
    answered_questions = (await db.execute(
        select(RSVPQuestion.id, RSVPQuestion.question).where(
            RSVPQuestion.event_id == event.id,
            RSVPQuestion.id.in_(question_ids),
        )
    )).all()

    candidates: list[str] = []
    for qid, question in answered_questions:
        label = (question or "").strip()
        answer = (answers.get(qid) or "").strip()
        if answer:
            candidates.extend([answer, f"{label}: {answer}"])

    normalized_rules = {
        _type_key(label): max(0, min(int(limit or 0), 100))
        for label, limit in rules.items()
        if str(label or "").strip()
    }
    for candidate in candidates:
        limit = normalized_rules.get(_type_key(candidate))
        if limit is not None:
            return limit, candidate

    return default_limit, None


async def _submit_multi_invitee_rsvp(
    event: Event,
    data: RSVPSubmit,
    background_tasks: BackgroundTasks,
    db: AsyncSession,
) -> RSVPConfirm:
    limit, matched_limit_rule = await _multi_invitee_limit_for_submission(event, data.answers, db)
    if matched_limit_rule and "guest" in _type_key(matched_limit_rule) and any(term in _type_key(matched_limit_rule) for term in ("individual", "single")):
        limit = 0
    raw_invitees = [i for i in (data.invitees or []) if (i.full_name or i.first_name or i.last_name or i.email or i.phone)]
    if len(raw_invitees) > limit:
        suffix = f" for {matched_limit_rule}" if matched_limit_rule else " per submission"
        if limit <= 0:
            raise HTTPException(422, f"This RSVP accepts the submitter only{suffix}.")
        raise HTTPException(422, f"This RSVP accepts the submitter plus up to {limit} invited guest{'s' if limit != 1 else ''}{suffix}.")

    await _require_questions_answered(event.id, data.answers, db)

    count = await _rsvp_count(event.id, db)
    total_new_guests = 1 + len(raw_invitees)
    if event.rsvp_capacity is not None and count + total_new_guests > event.rsvp_capacity:
        raise HTTPException(409, "Sorry — this event does not have enough remaining spots for all invitees.")
    assert_within_guest_cap(event, count, adding=total_new_guests)

    submitter_email = data.email.lower().strip() if data.email else None
    if event.rsvp_collect_email and not submitter_email:
        raise HTTPException(422, "Submitter email is required.")
    submitter_phone = None
    if data.phone and data.phone.strip():
        submitter_phone = _normalize_phone(data.phone.strip())
        if submitter_phone is None:
            raise HTTPException(422, "Submitter phone format not recognised.")

    normalized_invitees = []
    dup_filters = []
    seen_contacts: set[str] = set()
    if submitter_email and not event.rsvp_allow_duplicate_emails:
        seen_contacts.add(submitter_email)
        dup_filters.append(Guest.email == submitter_email)
    if submitter_phone:
        seen_contacts.add(submitter_phone)
        dup_filters.append(Guest.phone == submitter_phone)
    for invitee in raw_invitees:
        first, last = _split_invitee_name(invitee.full_name, invitee.first_name, invitee.last_name)
        if not first.strip():
            raise HTTPException(422, "Every invitee needs a name.")
        email = invitee.email.lower().strip() if invitee.email else None
        if event.rsvp_collect_email and not email:
            raise HTTPException(422, f"Email is required for {first} {last}".strip())
        phone = None
        if invitee.phone and invitee.phone.strip():
            phone = _normalize_phone(invitee.phone.strip())
            if phone is None:
                raise HTTPException(422, f"Phone format not recognised for {first} {last}".strip())
        contact_keys = []
        if email and not event.rsvp_allow_duplicate_emails:
            contact_keys.append(email)
        if phone:
            contact_keys.append(phone)
        for contact_key in contact_keys:
            if contact_key in seen_contacts:
                raise HTTPException(409, f"Duplicate invitee contact: {contact_key}")
            seen_contacts.add(contact_key)
        if email and not event.rsvp_allow_duplicate_emails:
            dup_filters.append(Guest.email == email)
        if phone:
            dup_filters.append(Guest.phone == phone)
        normalized_invitees.append((invitee, first.strip(), last.strip(), email, phone))

    if dup_filters:
        existing = (await db.execute(
            select(Guest.email, Guest.phone)
            .where(Guest.event_id == event.id, or_(*dup_filters))
            .limit(1)
        )).first()
        if existing:
            raise HTTPException(409, "One or more invitees already exists on this event.")

    needs_approval = event.rsvp_require_approval
    now = datetime.utcnow()
    submitter_name = f"{data.first_name.strip()} {data.last_name.strip()}".strip()
    submitter_guest_type = (matched_limit_rule or "Main invited guest").strip()
    submitter_group_id = await _default_group_for_invitee(event.id, submitter_guest_type, db)
    submitter_ticket_type_id = await _ticket_type_for_invitee(event.id, submitter_guest_type, db)
    submitter_is_vip = any(term in _type_key(submitter_guest_type) for term in ("vip", "dignitary", "honour", "honor", "chairman"))
    created: list[Guest] = []

    submitter_guest = Guest(
        event_id=event.id,
        first_name=data.first_name.strip(),
        last_name=data.last_name.strip(),
        email=submitter_email,
        phone=submitter_phone,
        sms_consent=bool(data.sms_consent and submitter_phone),
        invite_token=str(uuid.uuid4()),
        qr_generated_at=None if needs_approval else now,
        invite_sent_at=None if needs_approval else now,
        rsvp_status="pending" if needs_approval else "confirmed",
        rsvp_responded_at=now,
        assigned_table_group_id=submitter_group_id,
        ticket_type_id=submitter_ticket_type_id,
        is_vip=submitter_is_vip,
        rsvp_guest_type=submitter_guest_type,
        rsvp_relationship="Self",
    )
    db.add(submitter_guest)
    await db.flush()
    submitter_guest.rsvp_submitter_guest_id = submitter_guest.id
    await _save_answers(submitter_guest.id, event.id, data.answers, db)
    created.append(submitter_guest)

    for invitee, first, last, email, phone in normalized_invitees:
        guest_type = (invitee.guest_type or "").strip() or "Invited Guest"
        group_id = await _default_group_for_invitee(event.id, guest_type, db)
        ticket_type_id = await _ticket_type_for_invitee(event.id, guest_type, db)
        is_vip = any(term in _type_key(guest_type) for term in ("vip", "dignitary", "honour", "honor", "chairman"))
        guest = Guest(
            event_id=event.id,
            first_name=first,
            last_name=last,
            email=email,
            phone=phone,
            sms_consent=False,
            invite_token=str(uuid.uuid4()),
            qr_generated_at=None if needs_approval else now,
            invite_sent_at=None if needs_approval else now,
            rsvp_status="pending" if needs_approval else "confirmed",
            rsvp_responded_at=now,
            assigned_table_group_id=group_id,
            ticket_type_id=ticket_type_id,
            is_vip=is_vip,
            rsvp_submitter_guest_id=submitter_guest.id,
            rsvp_submitter_name=submitter_name or None,
            rsvp_submitter_email=submitter_email,
            rsvp_submitter_phone=submitter_phone,
            rsvp_relationship=(invitee.relationship or "").strip() or None,
            rsvp_guest_type=guest_type,
            rsvp_notes=(invitee.notes or "").strip() or None,
        )
        db.add(guest)
        await db.flush()
        await _save_answers(guest.id, event.id, data.answers, db)
        created.append(guest)

    for created_guest in created:
        queue_guest_sync(db, created_guest, event=event)
    await db.commit()
    overrides = await load_overrides(event.id, db)
    guest_count_text = (
        f"{submitter_guest.first_name} plus {len(raw_invitees)} invited guest{'s' if len(raw_invitees) != 1 else ''}"
        if raw_invitees
        else submitter_guest.first_name
    )
    if needs_approval:
        if event.notify_rsvp_responses:
            from .guests import dispatch_simple_notice
            for guest in created:
                dispatch_simple_notice(background_tasks, event, guest, "approval_pending", overrides)
            await db.commit()
        return RSVPConfirm(
            id=created[0].id,
            qr_token=created[0].qr_token,
            invite_token=created[0].invite_token,
            first_name=submitter_guest.first_name,
            last_name=submitter_guest.last_name,
            rsvp_status="pending",
            message=f"RSVP received for {guest_count_text}. The host will review and issue QR passes after approval.",
        )

    for guest in created:
        await db.refresh(guest)
        if event.notify_rsvp_responses:
            from .guests import dispatch_simple_notice
            dispatch_simple_notice(background_tasks, event, guest, "rsvp_confirmation", overrides)
        _send_rsvp_invite(background_tasks, event, guest, overrides)
    await db.commit()
    return RSVPConfirm(
        id=created[0].id,
        qr_token=created[0].qr_token,
        invite_token=created[0].invite_token,
        first_name=submitter_guest.first_name,
        last_name=submitter_guest.last_name,
        rsvp_status="confirmed",
        message=f"RSVP confirmed for {guest_count_text}. QR passes have been issued.",
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/{event_id}", response_model=InvitePageOut)
async def get_invite_page(event_id: str, db: AsyncSession = Depends(get_db)):
    """Return the public event page — theme, copy, questions, capacity status."""
    event = await _get_public_event(event_id, db)
    return await _invite_page_out(event, db)


@router.get("/link/{rsvp_token}", response_model=InvitePageOut)
async def get_invite_page_by_link(rsvp_token: str, db: AsyncSession = Depends(get_db)):
    """Return the public event page through the unguessable RSVP share link."""
    event = await _get_public_event_by_rsvp_token(rsvp_token, db)
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

    if event.rsvp_multi_invitee_enabled:
        return await _submit_multi_invitee_rsvp(event, data, background_tasks, db)

    # Capacity guard (host-set RSVP cap and plan entitlement cap)
    count = await _rsvp_count(event_id, db)
    if event.rsvp_capacity is not None and count >= event.rsvp_capacity:
        raise HTTPException(409, "Sorry — this event is at capacity")
    assert_within_guest_cap(event, count)

    await _require_questions_answered(event_id, data.answers, db)

    email = data.email.lower().strip() if data.email else None
    if event.rsvp_collect_email and not email:
        raise HTTPException(422, "Email is required.")

    # Validate / normalise phone first, so we can de-dupe on it too.
    phone: str | None = None
    if data.phone and data.phone.strip():
        phone = _normalize_phone(data.phone.strip())
        if phone is None:
            raise HTTPException(
                422,
                "Phone format not recognised. Use E.164 (e.g. +18327941707) or US 10-digit.",
            )

    # Duplicate guard: block a repeat RSVP from the same email OR phone, so a
    # guest can't keep submitting (and re-triggering their ticket). Uses .first()
    # (not scalar_one_or_none) because a synced sheet can legitimately hold
    # multiple rows for one contact. With neither email nor phone the submission
    # is anonymous — the page-side "already RSVP'd" guard covers the common
    # re-submit there.
    dup_filters = []
    if email and not event.rsvp_allow_duplicate_emails:
        dup_filters.append(Guest.email == email)
    if phone:
        dup_filters.append(Guest.phone == phone)
    if dup_filters:
        existing = (await db.execute(
            select(Guest.id)
            .where(Guest.event_id == event_id, or_(*dup_filters))
            .limit(1)
        )).first()
        if existing:
            raise HTTPException(409, "You've already RSVP'd for this event")

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
        sms_consent=bool(data.sms_consent and phone),
        # Give self-registrations a personal token up front so their Guest Hub
        # link (/r/{invite_token}) works on any device — not just the browser
        # that RSVP'd. Bulk-invited guests already get one when invited.
        invite_token=str(uuid.uuid4()),
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
    await _save_shipping(guest, event, data.shipping_address, data.sizes, db)

    queue_guest_sync(db, guest, event=event)
    await db.commit()
    await db.refresh(guest)

    if needs_approval:
        if event.notify_rsvp_responses:
            from .guests import dispatch_simple_notice
            dispatch_simple_notice(
                background_tasks, event, guest,
                "approval_pending", await load_overrides(event.id, db),
            )
            await db.commit()
        return RSVPConfirm(
            id=guest.id,
            qr_token=guest.qr_token,
            invite_token=guest.invite_token,
            first_name=guest.first_name,
            last_name=guest.last_name,
            rsvp_status="pending",
            message="RSVP received! The host will confirm your spot and email your ticket.",
        )

    # Approved automatically — fire the ticket in the background.
    if event.notify_rsvp_responses:
        from .guests import dispatch_simple_notice
        dispatch_simple_notice(
            background_tasks, event, guest,
            "rsvp_confirmation", await load_overrides(event.id, db),
        )
    _send_rsvp_invite(background_tasks, event, guest, await load_overrides(event.id, db))
    await db.commit()  # persist any message-credit decrements
    return RSVPConfirm(
        id=guest.id,
        qr_token=guest.qr_token,
        invite_token=guest.invite_token,
        first_name=guest.first_name,
        last_name=guest.last_name,
        rsvp_status="confirmed",
        message="RSVP confirmed! Check your email for your ticket.",
    )


@router.post("/link/{rsvp_token}/rsvp", response_model=RSVPConfirm, status_code=201)
async def submit_rsvp_by_link(
    rsvp_token: str,
    data: RSVPSubmit,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Self-service RSVP through the unguessable public share link."""
    event = await _get_public_event_by_rsvp_token(rsvp_token, db)
    return await submit_rsvp(event.id, data, background_tasks, db)


# ── Personalised (closed-mode) invite links ─────────────────────────────────

async def _get_guest_by_token(invite_token: str, db: AsyncSession) -> tuple[Guest, Event]:
    guest = (await db.execute(
        select(Guest)
        .where((Guest.invite_token == invite_token) | (Guest.qr_token == invite_token))
        .limit(1)
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
            sms_consent=bool(guest.sms_consent),
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
    guest.sms_consent = bool(data.sms_consent and guest.phone)

    guest.rsvp_status = data.status
    guest.rsvp_responded_at = datetime.utcnow()
    queue_guest_sync(db, guest, event=event)
    await _save_answers(guest.id, event.id, data.answers, db, replace=True)
    if data.status == "confirmed":
        await _save_shipping(guest, event, data.shipping_address, data.sizes, db)

    if data.status == "confirmed":
        if not guest.qr_generated_at:
            guest.qr_generated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(guest)
        if event.notify_rsvp_responses:
            from .guests import dispatch_simple_notice
            dispatch_simple_notice(
                background_tasks, event, guest,
                "rsvp_confirmation", await load_overrides(event.id, db),
            )
        # Issue the ticket now that they've confirmed.
        _send_rsvp_invite(background_tasks, event, guest, await load_overrides(event.id, db))
        await db.commit()  # persist any message-credit decrements
        message = "You're confirmed! Check your email for your ticket."
    else:
        # Guest declined — send the decline-confirmation template (email + SMS),
        # but only if the organizer opted in (off by default → stays silent).
        if event.notify_rsvp_responses:
            from .guests import dispatch_simple_notice
            dispatch_simple_notice(background_tasks, event, guest, "rsvp_decline", await load_overrides(event.id, db))
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
