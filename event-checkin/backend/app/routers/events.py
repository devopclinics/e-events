from datetime import datetime
import os
import uuid as _uuid
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Event, EventUser, Guest, Membership, Organization, RSVPQuestion, User
from ..schemas import (
    EventCreate, EventUpdate, EventOut, EventMemberOut, AssignUserRequest,
    OrgMemberInvite, OrgMemberOut, MemberRoleUpdate, UserOut, EventSourceUpdate,
    InviteSettingsUpdate, RSVPQuestionCreate, RSVPQuestionUpdate, RSVPQuestionOut,
    BroadcastRequest, BroadcastResult,
    ManualInviteRequest, ManualInviteResult,
)
from ..auth import require_admin, require_event_admin, get_current_user, _org_role
from ..entitlements import can_use_paid_channels, take_message_credit
from .guests import import_from_source_url, import_warning_summary, _normalize_phone
from services import messaging
from services.email_service import send_manual_invite_email, send_broadcast_email

UPLOADS_DIR = "/app/uploads"
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB

router = APIRouter()

VALID_STATUSES = {"draft", "active", "ended"}
STATUS_TRANSITIONS = {
    "draft":  {"active"},
    "active": {"ended"},
    "ended":  {"active"},   # allow reopen
}


async def _get_accessible_event(event_id: str, user: User, db: AsyncSession) -> Event:
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin:
        return event
    # Tenant isolation: caller must belong to the event's org. 404 (not 403) so
    # we don't leak that an event exists in another tenant.
    if await _org_role(user, event.org_id, db) is None:
        raise HTTPException(404, "Event not found")
    return event


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.post("", response_model=EventOut, status_code=201)
async def create_event(
    data: EventCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    # New events belong to the caller's organization (where they own/admin).
    org_id = await db.scalar(
        select(Membership.org_id)
        .where(
            Membership.user_id == current_user.id,
            Membership.role.in_(["owner", "admin"]),
        )
        .order_by(Membership.created_at)
        .limit(1)
    )
    if not org_id:
        raise HTTPException(403, "You don't belong to an organization")
    event = Event(**data.model_dump(), org_id=org_id)
    db.add(event)
    await db.flush()
    # Auto-assign creator so they appear in their own event member list
    db.add(EventUser(event_id=event.id, user_id=current_user.id))

    # Consume a pending trial grant (from an approved TrialRequest made before
    # the org had any event) — apply it to this first event, then clear it.
    org = await db.get(Organization, org_id)
    if org and (org.trial_tier or org.trial_credits):
        from ..billing import get_plan, apply_purchase
        if org.trial_tier:
            plan = await get_plan(db, org.trial_tier)
            if plan:
                apply_purchase(event, plan)
        if org.trial_credits:
            event.message_credits = (event.message_credits or 0) + int(org.trial_credits)
        org.trial_tier = None
        org.trial_credits = None

    await db.commit()
    await db.refresh(event)
    return event


@router.get("", response_model=list[EventOut])
async def list_events(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Platform superadmin sees everything; everyone else only their org's events.
    if current_user.is_platform_superadmin:
        result = await db.execute(select(Event).order_by(Event.created_at.desc()))
    else:
        result = await db.execute(
            select(Event)
            .join(Membership, Membership.org_id == Event.org_id)
            .where(Membership.user_id == current_user.id)
            .order_by(Event.created_at.desc())
        )
    return result.scalars().all()


@router.get("/{event_id}", response_model=EventOut)
async def get_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _get_accessible_event(event_id, current_user, db)


@router.put("/{event_id}", response_model=EventOut)
async def update_event(
    event_id: str,
    data: EventUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(event, field, value)
    await db.commit()
    await db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
async def delete_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    await db.delete(event)
    await db.commit()


# ── Status ────────────────────────────────────────────────────────────────────

@router.patch("/{event_id}/status", response_model=EventOut)
async def change_status(
    event_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    new_status = body.get("status", "")
    if new_status not in VALID_STATUSES:
        raise HTTPException(400, f"status must be one of: {', '.join(VALID_STATUSES)}")

    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    allowed = STATUS_TRANSITIONS.get(event.status, set())
    if new_status not in allowed:
        raise HTTPException(400, f"Cannot move from '{event.status}' to '{new_status}'")

    event.status = new_status
    await db.commit()
    await db.refresh(event)
    return event


# ── Team (user assignment) ─────────────────────────────────────────────────────

@router.get("/{event_id}/members", response_model=list[EventMemberOut])
async def list_members(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    result = await db.execute(
        select(EventUser, User)
        .join(User, EventUser.user_id == User.id)
        .where(EventUser.event_id == event_id)
        .order_by(EventUser.assigned_at)
    )
    rows = result.all()
    return [
        EventMemberOut(id=eu.id, user=UserOut.model_validate(u), assigned_at=eu.assigned_at, can_reassign_seats=eu.can_reassign_seats, can_manage_menu=eu.can_manage_menu)
        for eu, u in rows
    ]


@router.post("/{event_id}/members", response_model=EventMemberOut, status_code=201)
async def assign_member(
    event_id: str,
    body: AssignUserRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    user = await db.get(User, body.user_id)
    if not user:
        raise HTTPException(404, "User not found")

    # The user must already be a member of this event's organization.
    is_member = await db.scalar(
        select(Membership.id).where(
            Membership.org_id == event.org_id, Membership.user_id == body.user_id
        )
    )
    if not is_member:
        raise HTTPException(400, "Add this person to your team first, then assign them to the event.")

    existing = await db.scalar(
        select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == body.user_id)
    )
    if existing:
        raise HTTPException(409, "User is already assigned to this event")

    eu = EventUser(event_id=event_id, user_id=body.user_id)
    db.add(eu)
    await db.commit()
    await db.refresh(eu)
    return EventMemberOut(id=eu.id, user=UserOut.model_validate(user), assigned_at=eu.assigned_at, can_reassign_seats=eu.can_reassign_seats, can_manage_menu=eu.can_manage_menu)


# ── Organization team (members of the event's org) ──────────────────────────────

@router.get("/{event_id}/org-members", response_model=list[OrgMemberOut])
async def list_org_members(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Everyone in this event's organization — the pool you can assign from."""
    event = await db.get(Event, event_id)
    rows = (await db.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.org_id == event.org_id)
        .order_by(Membership.role, User.name)
    )).all()
    return [OrgMemberOut(user=UserOut.model_validate(u), role=m.role) for m, u in rows]


@router.put("/{event_id}/org-members/{user_id}")
async def set_org_member_role(
    event_id: str,
    user_id: str,
    body: MemberRoleUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Change a teammate's role in this event's organization (owner/admin/staff)."""
    event = await db.get(Event, event_id)
    membership = await db.scalar(
        select(Membership).where(Membership.org_id == event.org_id, Membership.user_id == user_id)
    )
    if not membership:
        raise HTTPException(404, "That person isn't a member of this organization")
    membership.role = body.role
    await db.commit()
    return {"ok": True, "role": membership.role}


@router.post("/{event_id}/org-members", response_model=OrgMemberOut, status_code=201)
async def invite_org_member(
    event_id: str,
    body: OrgMemberInvite,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Add a teammate to this event's org by email. If they don't have an account
    yet, a placeholder is created and linked when they first sign in with that
    email. Re-inviting an existing member updates their role."""
    event = await db.get(Event, event_id)
    email = body.email.lower().strip()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user:
        user = User(name=(body.name or email.split("@")[0]), email=email, role="official")
        db.add(user)
        await db.flush()

    membership = await db.scalar(
        select(Membership).where(Membership.org_id == event.org_id, Membership.user_id == user.id)
    )
    if membership:
        membership.role = body.role
    else:
        db.add(Membership(org_id=event.org_id, user_id=user.id, role=body.role))
    await db.commit()
    await db.refresh(user)
    return OrgMemberOut(user=UserOut.model_validate(user), role=body.role)


@router.put("/{event_id}/source", response_model=EventOut)
async def update_event_source(
    event_id: str,
    body: EventSourceUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if body.source_url is not None:
        event.source_url = body.source_url.strip() or None
        # Clear last error/warning on URL change so the UI doesn't show a stale message.
        event.source_last_error = None
        event.source_last_warning = None
    if body.source_sync_interval_seconds is not None:
        # Clamp to a sane range; OneDrive is happy at 60s but reject sub-15s.
        event.source_sync_interval_seconds = max(15, min(body.source_sync_interval_seconds, 3600))
    await db.commit()
    await db.refresh(event)
    return event


@router.post("/{event_id}/sync-now")
async def sync_event_now(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if not event.source_url:
        raise HTTPException(400, "No source URL configured for this event")
    try:
        result = await import_from_source_url(event.source_url, event_id, db)
        event.source_last_sync_at = datetime.utcnow()
        event.source_last_error = None
        event.source_last_warning = import_warning_summary(result)
        await db.commit()
        return {
            **result,
            "source_last_sync_at": event.source_last_sync_at.isoformat() + "Z",
        }
    except HTTPException as e:
        event.source_last_error = e.detail
        event.source_last_sync_at = datetime.utcnow()
        await db.commit()
        raise


@router.delete("/{event_id}/members/{user_id}", status_code=204)
async def remove_member(
    event_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    eu = await db.scalar(
        select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == user_id)
    )
    if not eu:
        raise HTTPException(404, "Assignment not found")
    await db.delete(eu)
    await db.commit()


# ── Feature toggles ───────────────────────────────────────────────────────────

@router.post("/{event_id}/messaging/test")
async def send_test_message(
    event_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Fire a single test message to verify provider creds + delivery.
    Body: {channel: 'sms'|'whatsapp', phone: '<E.164 or US 10-digit>'}"""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    channel = (body.get("channel") or "").lower()
    if channel not in ("sms", "whatsapp"):
        raise HTTPException(400, "channel must be 'sms' or 'whatsapp'")
    phone = _normalize_phone(body.get("phone") or "")
    if not phone:
        raise HTTPException(400, "Phone format not recognised. Use E.164 or US 10-digit.")
    ticket_url = f"{event.checkin_base_url.rstrip('/')}/scan/test"
    try:
        if channel == "sms":
            await messaging.send_invite_sms(
                phone=phone, first_name="EventQR",
                event_name=f"{event.name} (TEST)",
                ticket_url=ticket_url, event_date=event.event_date,
            )
        else:
            await messaging.send_invite_whatsapp(
                phone=phone, first_name="EventQR",
                event_name=f"{event.name} (TEST)",
                ticket_url=ticket_url, event_date=event.event_date,
            )
    except Exception as e:
        raise HTTPException(500, f"Send failed: {e}")
    return {"ok": True, "channel": channel, "to": phone}


@router.patch("/{event_id}/features", response_model=EventOut)
async def toggle_features(
    event_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    # Seating, menu, logistics, registry & venue access are paid-plan features.
    if (body.get("seating_enabled") or body.get("menu_enabled") or body.get("logistics_enabled")
            or body.get("registry_enabled") or body.get("venue_access_enabled")) and not event.is_paid:
        raise HTTPException(402, "This feature requires an Event Pass — upgrade this event first.")
    if "seating_enabled" in body:
        event.seating_enabled = bool(body["seating_enabled"])
    if "menu_enabled" in body:
        event.menu_enabled = bool(body["menu_enabled"])
    if "logistics_enabled" in body:
        event.logistics_enabled = bool(body["logistics_enabled"])
    if "venue_access_enabled" in body:
        event.venue_access_enabled = bool(body["venue_access_enabled"])
    if "registry_enabled" in body:
        event.registry_enabled = bool(body["registry_enabled"])
        # Mint the public registry token on first enable.
        if event.registry_enabled and not event.registry_token:
            event.registry_token = str(_uuid.uuid4())
    for k in ("notify_email", "notify_sms", "notify_whatsapp"):
        if k in body:
            setattr(event, k, bool(body[k]))
    await db.commit()
    await db.refresh(event)
    return event


# ── Invite page settings ──────────────────────────────────────────────────────

@router.put("/{event_id}/invite-settings", response_model=EventOut)
async def update_invite_settings(
    event_id: str,
    data: InviteSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(event, field, value)
    await db.commit()
    await db.refresh(event)
    return event


# ── RSVP questions (admin CRUD) ───────────────────────────────────────────────

@router.get("/{event_id}/rsvp-questions", response_model=list[RSVPQuestionOut])
async def list_rsvp_questions(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    result = await db.execute(
        select(RSVPQuestion)
        .where(RSVPQuestion.event_id == event_id)
        .order_by(RSVPQuestion.sort_order)
    )
    return result.scalars().all()


@router.post("/{event_id}/rsvp-questions", response_model=RSVPQuestionOut, status_code=201)
async def create_rsvp_question(
    event_id: str,
    data: RSVPQuestionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    q = RSVPQuestion(event_id=event_id, **data.model_dump())
    db.add(q)
    await db.commit()
    await db.refresh(q)
    return q


@router.put("/{event_id}/rsvp-questions/{question_id}", response_model=RSVPQuestionOut)
async def update_rsvp_question(
    event_id: str,
    question_id: str,
    data: RSVPQuestionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    q = await db.get(RSVPQuestion, question_id)
    if not q or q.event_id != event_id:
        raise HTTPException(404, "Question not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(q, field, value)
    await db.commit()
    await db.refresh(q)
    return q


@router.delete("/{event_id}/rsvp-questions/{question_id}", status_code=204)
async def delete_rsvp_question(
    event_id: str,
    question_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    q = await db.get(RSVPQuestion, question_id)
    if not q or q.event_id != event_id:
        raise HTTPException(404, "Question not found")
    await db.delete(q)
    await db.commit()


# ── Broadcast ─────────────────────────────────────────────────────────────────

@router.post("/{event_id}/broadcast", response_model=BroadcastResult)
async def broadcast_message(
    event_id: str,
    data: BroadcastRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Send a free-text message to a subset of guests via SMS and/or WhatsApp."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    if not data.message.strip():
        raise HTTPException(400, "message cannot be empty")

    # Entitlement gate: SMS/WhatsApp require a paid event; email is always allowed.
    channels = list(data.channels)
    if not can_use_paid_channels(event):
        dropped = [c for c in channels if c in ("sms", "whatsapp")]
        channels = [c for c in channels if c == "email"]
        if not channels:
            raise HTTPException(
                402,
                "Sending SMS/WhatsApp requires an Event Pass. Upgrade this event, "
                "or broadcast by email.",
            )
        data = data.model_copy(update={"channels": channels})
        _ = dropped  # (silently dropped paid channels; email still sent)

    q = select(Guest).where(Guest.event_id == event_id)
    if data.target == "admitted":
        q = q.where(Guest.admitted == True)  # noqa: E712
    elif data.target == "not_admitted":
        q = q.where(Guest.admitted == False)  # noqa: E712
    elif data.target in ("confirmed", "declined", "no_reply"):
        status = {"confirmed": "confirmed", "declined": "declined", "no_reply": "invited"}[data.target]
        q = q.where(Guest.rsvp_status == status)

    guests = (await db.execute(q)).scalars().all()

    want_email = "email" in data.channels
    want_phone = "sms" in data.channels or "whatsapp" in data.channels

    queued = skipped_no_contact = skipped_no_consent = skipped_no_credits = 0

    for guest in guests:
        sent_any = False
        credit_blocked = False

        if want_email and guest.email:
            background_tasks.add_task(
                send_broadcast_email,
                email=guest.email,
                first_name=guest.first_name,
                message=data.message,
                event_name=event.name,
            )
            sent_any = True

        if guest.phone:
            if "sms" in data.channels and guest.sms_consent:
                if take_message_credit(event):
                    background_tasks.add_task(
                        messaging.send_broadcast_sms,
                        phone=guest.phone,
                        first_name=guest.first_name,
                        message=data.message,
                    )
                    sent_any = True
                else:
                    credit_blocked = True
            if "whatsapp" in data.channels and guest.whatsapp_consent:
                if take_message_credit(event):
                    background_tasks.add_task(
                        messaging.send_broadcast_whatsapp,
                        phone=guest.phone,
                        first_name=guest.first_name,
                        message=data.message,
                    )
                    sent_any = True
                else:
                    credit_blocked = True

        if sent_any:
            queued += 1
        elif credit_blocked:
            skipped_no_credits += 1
        elif (want_email and guest.email) or (want_phone and guest.phone):
            # Had a usable contact method but consent blocked every channel.
            skipped_no_consent += 1
        else:
            # No email and/or no phone for the channels selected.
            skipped_no_contact += 1

    await db.commit()  # persist message-credit decrements
    return BroadcastResult(
        queued=queued,
        skipped_no_contact=skipped_no_contact,
        skipped_no_consent=skipped_no_consent,
        skipped_no_credits=skipped_no_credits,
    )


# ── Manual invites ────────────────────────────────────────────────────────────

@router.post("/{event_id}/send-invites", response_model=ManualInviteResult)
async def send_manual_invites(
    event_id: str,
    data: ManualInviteRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Send a personal invite link to one or more recipients by email/phone."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if not data.recipients:
        raise HTTPException(400, "No recipients provided")

    invite_url = f"{event.checkin_base_url.rstrip('/')}/e/{event_id}"
    paid_channels = can_use_paid_channels(event)

    sent = skipped = 0
    errors: list[str] = []

    for r in data.recipients:
        name = r.name.strip() or "Guest"
        dispatched = False

        if "email" in data.channels and r.email:
            background_tasks.add_task(
                send_manual_invite_email,
                name=name,
                email=str(r.email),
                invite_url=invite_url,
                event_name=event.name,
                event_date=event.event_date,
                invite_message=event.invite_message,
            )
            dispatched = True

        if r.phone and paid_channels:
            phone = _normalize_phone(r.phone.strip())
            if phone is None:
                errors.append(f"{name}: invalid phone '{r.phone}'")
            else:
                if "sms" in data.channels and take_message_credit(event):
                    background_tasks.add_task(
                        messaging.send_manual_invite_sms,
                        phone=phone,
                        name=name,
                        event_name=event.name,
                        invite_url=invite_url,
                    )
                    dispatched = True
                if "whatsapp" in data.channels and take_message_credit(event):
                    background_tasks.add_task(
                        messaging.send_manual_invite_whatsapp,
                        phone=phone,
                        name=name,
                        event_name=event.name,
                        invite_url=invite_url,
                    )
                    dispatched = True

        if dispatched:
            sent += 1
        else:
            skipped += 1

    await db.commit()  # persist message-credit decrements
    return ManualInviteResult(sent=sent, skipped=skipped, errors=errors)


# ── Cover image upload ────────────────────────────────────────────────────────

@router.post("/{event_id}/upload-cover")
async def upload_cover_image(
    event_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Upload a cover/banner image for the invite page. Stored in /app/uploads/."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, f"Unsupported file type '{file.content_type}'. Use JPEG, PNG, WebP or GIF.")

    data = await file.read()
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(413, "Image too large — maximum 10 MB.")

    # Derive extension from content type
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}.get(file.content_type, "jpg")
    filename = f"{event_id}-cover-{_uuid.uuid4().hex[:8]}.{ext}"
    dir_path = os.path.join(UPLOADS_DIR, "events")
    os.makedirs(dir_path, exist_ok=True)
    file_path = os.path.join(dir_path, filename)

    with open(file_path, "wb") as f:
        f.write(data)

    url = f"/api/uploads/events/{filename}"
    event.invite_cover_image = url
    await db.commit()
    await db.refresh(event)
    return {"url": url, "event": event}


@router.delete("/{event_id}/upload-cover", response_model=EventOut)
async def delete_cover_image(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Remove the cover image from an event."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if event.invite_cover_image:
        # Best-effort delete the file
        path = os.path.join(UPLOADS_DIR, event.invite_cover_image.lstrip("/api/uploads/"))
        try:
            os.remove(path)
        except OSError:
            pass
        event.invite_cover_image = None
        await db.commit()
        await db.refresh(event)
    return event
