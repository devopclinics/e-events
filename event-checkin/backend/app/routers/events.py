from datetime import datetime
import os
import secrets
import uuid as _uuid
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Event, EventUser, EventUserSection, Guest, Membership, Organization, RSVPQuestion, TableGroup, User
from ..schemas import (
    EventCreate, EventUpdate, EventOut, EventMemberOut, AssignUserRequest,
    OrgMemberInvite, OrgMemberOut, MemberRoleUpdate, UserOut, EventSourceUpdate,
    InviteSettingsUpdate, RSVPQuestionCreate, RSVPQuestionUpdate, RSVPQuestionOut,
    BroadcastRequest, BroadcastResult,
    ManualInviteRequest, ManualInviteResult, MenuEventOut,
)
from ..schemas import ActiveToggle
from ..auth import require_admin, require_event_admin, get_current_user, _org_role
from ..entitlements import assert_feature_allowed, can_use_paid_channels, grant_message_credits, last_credit_ledger_id, take_message_credit
from .guests import import_from_source_url, import_warning_summary, _normalize_phone
from services import messaging
from services.credit_ledger import send_with_credit_ledger
from services.email_service import send_manual_invite_email, send_broadcast_email, send_simple_email
from ..template_resolve import load_overrides, channel_text, email_override
from services.templates import build_context as build_template_context
from .. import storage

UPLOADS_DIR = "/app/uploads"
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB

router = APIRouter()

# Event-code alphabet: uppercase, no confusable characters (0 O 1 I L).
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
FESTIO_PUBLIC_BASE_URL = "https://festio.events"
LEGACY_PUBLIC_BASE_URLS = {"https://events.vsgs.io", "http://events.vsgs.io"}


def _gen_code(n: int = 8) -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(n))


async def unique_event_code(db: AsyncSession) -> str:
    """A code not already used by another event (retries on the rare collision)."""
    for _ in range(10):
        code = _gen_code()
        if not await db.scalar(select(Event.id).where(Event.event_code == code)):
            return code
    return _gen_code(10)  # extremely unlikely fallback


def _normalize_public_base_url(value: str | None) -> str:
    base = (value or "").strip().rstrip("/")
    if not base or base in LEGACY_PUBLIC_BASE_URLS:
        return FESTIO_PUBLIC_BASE_URL
    return base


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
    payload = data.model_dump()
    payload["checkin_base_url"] = _normalize_public_base_url(payload.get("checkin_base_url"))
    event = Event(**payload, org_id=org_id)
    event.event_code = await unique_event_code(db)
    event.rsvp_token = event.rsvp_token or str(_uuid.uuid4())
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
            grant_message_credits(event, int(org.trial_credits), reason="trial_grant")
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
        managed = (await db.execute(
            select(Event)
            .join(Membership, Membership.org_id == Event.org_id)
            .join(Organization, Organization.id == Event.org_id)
            .where(
                Membership.user_id == current_user.id,
                Membership.role.in_(["owner", "admin"]),
                Organization.is_active.is_(True),
            )
            .order_by(Event.created_at.desc())
        )).scalars().all()
        assigned = (await db.execute(
            select(Event)
            .join(EventUser, EventUser.event_id == Event.id)
            .join(Organization, Organization.id == Event.org_id)
            .where(EventUser.user_id == current_user.id, Organization.is_active.is_(True))
            .order_by(Event.created_at.desc())
        )).scalars().all()
        seen, rows = set(), []
        for event in [*managed, *assigned]:
            if event.id not in seen:
                seen.add(event.id)
                rows.append(event)
        return rows
    return result.scalars().all()


@router.get("/me/menu-events", response_model=list[MenuEventOut])
async def my_menu_events(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Events whose menu/orders this user may view — used to gate the Kitchen
    page and its 'Menu' nav link. Owner/admin see their orgs' menu events;
    staff see only events where they were granted can_manage_menu."""
    base = select(Event).where(Event.menu_enabled.is_(True), Event.is_paid.is_(True))
    if user.is_platform_superadmin:
        rows = (await db.execute(base.order_by(Event.created_at.desc()))).scalars().all()
    else:
        mgr = (await db.execute(
            base.join(Membership, Membership.org_id == Event.org_id)
            .where(Membership.user_id == user.id, Membership.role.in_(["owner", "admin"])))).scalars().all()
        staff = (await db.execute(
            base.join(EventUser, EventUser.event_id == Event.id)
            .where(
                EventUser.user_id == user.id,
                (EventUser.can_manage_menu.is_(True)) | (EventUser.event_role == "manager"),
            ))).scalars().all()
        seen, rows = set(), []
        for e in [*mgr, *staff]:
            if e.id not in seen:
                seen.add(e.id); rows.append(e)
    return [MenuEventOut.model_validate(e) for e in rows]


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
    payload = data.model_dump(exclude_none=True)
    if "checkin_base_url" in payload:
        payload["checkin_base_url"] = _normalize_public_base_url(payload.get("checkin_base_url"))
    for field, value in payload.items():
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
    # Batch-load each member's allowed sections (empty list = all sections).
    sections_by_eu: dict[str, list[str]] = {}
    for eu_id, tg_id in await db.execute(
        select(EventUserSection.event_user_id, EventUserSection.table_group_id)
        .where(EventUserSection.event_user_id.in_([eu.id for eu, _ in rows] or [""]))
    ):
        sections_by_eu.setdefault(eu_id, []).append(tg_id)
    return [
        EventMemberOut(
            id=eu.id,
            user=UserOut.model_validate(u),
            assigned_at=eu.assigned_at,
            can_reassign_seats=eu.can_reassign_seats,
            can_manage_menu=eu.can_manage_menu,
            can_view_dashboard=eu.can_view_dashboard,
            event_role=eu.event_role,
            access_level=eu.access_level,
            section_group_ids=sections_by_eu.get(eu.id, []),
        )
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
    return EventMemberOut(
        id=eu.id,
        user=UserOut.model_validate(user),
        assigned_at=eu.assigned_at,
        can_reassign_seats=eu.can_reassign_seats,
        can_manage_menu=eu.can_manage_menu,
        can_view_dashboard=eu.can_view_dashboard,
        event_role=eu.event_role,
        access_level=eu.access_level,
    )


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
    if body.source_url or body.source_sync_enabled:
        assert_feature_allowed(event, "source_sync")
    if body.source_url is not None:
        event.source_url = body.source_url.strip() or None
        # Clear last error/warning on URL change so the UI doesn't show a stale message.
        event.source_last_error = None
        event.source_last_warning = None
    if body.source_sync_interval_seconds is not None:
        # Clamp to a sane range; OneDrive is happy at 60s but reject sub-15s.
        event.source_sync_interval_seconds = max(15, min(body.source_sync_interval_seconds, 3600))
    if body.source_sync_enabled is not None:
        event.source_sync_enabled = body.source_sync_enabled
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
    assert_feature_allowed(event, "source_sync")
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
    await db.execute(EventUserSection.__table__.delete().where(EventUserSection.event_user_id == eu.id))
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
                phone=phone, first_name="Festio",
                event_name=f"{event.name} (TEST)",
                ticket_url=ticket_url, event_date=event.event_date,
            )
        else:
            await messaging.send_invite_whatsapp(
                phone=phone, first_name="Festio",
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
    for feature in (
        "seating_enabled", "menu_enabled", "logistics_enabled", "registry_enabled",
        "venue_access_enabled", "partner_pairing_enabled", "experience_enabled",
        "section_mode_enabled",
    ):
        if body.get(feature):
            assert_feature_allowed(event, feature)
    if "seating_enabled" in body:
        event.seating_enabled = bool(body["seating_enabled"])
    if "menu_enabled" in body:
        event.menu_enabled = bool(body["menu_enabled"])
    if "logistics_enabled" in body:
        event.logistics_enabled = bool(body["logistics_enabled"])
    if "venue_access_enabled" in body:
        enable = bool(body["venue_access_enabled"])
        # Entry rules (zone scanning) and Section scanning both drive the scanner,
        # but on different paths: Entry rules own the QR/gate path (and skip
        # seating), Section scanning routes walk-in/manual check-ins into a table
        # group. Running both at once seats some guests and not others depending
        # on how they were scanned — incoherent. Keep them mutually exclusive.
        if enable and event.section_mode_enabled:
            raise HTTPException(
                400,
                "Turn off Section scanning first — Entry rules and Section scanning "
                "drive the scanner differently and can't run on the same event.",
            )
        event.venue_access_enabled = enable
    if "experience_enabled" in body:
        event.experience_enabled = bool(body["experience_enabled"])
    if "partner_pairing_enabled" in body:
        event.partner_pairing_enabled = bool(body["partner_pairing_enabled"])
    if "registry_enabled" in body:
        event.registry_enabled = bool(body["registry_enabled"])
        # Mint the public registry token on first enable.
        if event.registry_enabled and not event.registry_token:
            event.registry_token = str(_uuid.uuid4())
    if "section_mode_enabled" in body:
        enable = bool(body["section_mode_enabled"])
        if enable:
            # Mutually exclusive with Entry rules / Venue access (see note above).
            if event.venue_access_enabled:
                raise HTTPException(
                    400,
                    "Turn off Entry rules (Venue access) first — Entry rules and "
                    "Section scanning drive the scanner differently and can't run "
                    "on the same event.",
                )
            # Only meaningful with table groups to use as sections.
            from ..models import TableGroup
            has_group = (await db.execute(
                select(TableGroup.id).where(TableGroup.event_id == event_id).limit(1)
            )).first()
            if not has_group:
                raise HTTPException(
                    400, "Add at least one table group before enabling section mode."
                )
        event.section_mode_enabled = enable
    for k in ("notify_email", "notify_sms", "notify_whatsapp", "notify_rsvp_responses"):
        if k in body:
            setattr(event, k, bool(body[k]))
    await db.commit()
    await db.refresh(event)
    return event


@router.patch("/{event_id}/walk-in", response_model=EventOut)
async def set_walk_in(event_id: str, body: dict, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    """Enable/disable door walk-in registration. Body: {active: bool}."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if body.get("active"):
        assert_feature_allowed(event, "manual_checkin_enabled")
    event.walk_in_enabled = bool(body.get("active"))
    await db.commit()
    await db.refresh(event)
    return event


@router.patch("/{event_id}/walk-in-group", response_model=EventOut)
async def set_walk_in_group(event_id: str, body: dict, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    """Set the table group walk-ins are auto-assigned to. Body: {table_group_id}."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    gid = body.get("table_group_id") or None
    if gid:
        from ..models import TableGroup
        grp = await db.get(TableGroup, gid)
        if not grp or grp.event_id != event_id:
            raise HTTPException(404, "Table group not found for this event")
    event.walk_in_table_group_id = gid
    await db.commit()
    await db.refresh(event)
    return event


@router.patch("/{event_id}/self-checkin", response_model=EventOut)
async def toggle_self_checkin(
    event_id: str,
    body: ActiveToggle,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if body.active:
        assert_feature_allowed(event, "self_checkin_enabled")
    event.self_checkin_enabled = bool(body.active)
    if event.self_checkin_enabled and not event.event_code:
        event.event_code = await unique_event_code(db)
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
    if not event.rsvp_token:
        event.rsvp_token = str(_uuid.uuid4())
    synced_limit_rules = None
    for field, value in data.model_dump(exclude_none=True).items():
        if field == "rsvp_multi_invitee_limit":
            value = max(0, min(int(value), 100))
        if field == "rsvp_multi_invitee_limit_rules":
            rules = {}
            for key, limit in (value or {}).items():
                label = str(key or "").strip()
                if not label:
                    continue
                rules[label] = max(0, min(int(limit or 0), 100))
            value = rules or None
            synced_limit_rules = value
        setattr(event, field, value)
    if synced_limit_rules:
        category = await db.scalar(
            select(RSVPQuestion)
            .where(RSVPQuestion.event_id == event.id, RSVPQuestion.question == "Invitation category")
            .limit(1)
        )
        if not category:
            category = RSVPQuestion(
                event_id=event.id,
                question="Invitation category",
                question_type="select",
                is_required=True,
                sort_order=15,
            )
            db.add(category)
        import json as _json
        category.question_type = "select"
        category.options = _json.dumps(list(synced_limit_rules.keys()))
        category.is_required = True
        category.sort_order = min(category.sort_order or 15, 15)
    await db.commit()
    await db.refresh(event)
    return event


@router.post("/{event_id}/rsvp-link", response_model=EventOut)
async def generate_rsvp_link(
    event_id: str,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Mint or rotate the open RSVP share token for this event."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if not event.rsvp_token or bool((body or {}).get("regenerate")):
        event.rsvp_token = str(_uuid.uuid4())
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

    # Customizable-template overrides for the broadcast message (if any). When a
    # channel has no override we fall through to the default send_broadcast_* path.
    overrides = await load_overrides(event_id, db)

    def _ctx(guest):
        return build_template_context(event, guest, extras={"message": data.message})

    queued = skipped_no_contact = skipped_no_consent = skipped_no_credits = 0

    for guest in guests:
        sent_any = False
        credit_blocked = False

        if want_email and guest.email:
            subj, body = email_override(overrides, "broadcast", _ctx(guest))
            if body is not None:
                background_tasks.add_task(
                    send_simple_email, guest.email,
                    subj or f"Update — {event.name}", body, event.id, None, guest.id, "broadcast",
                )
            else:
                background_tasks.add_task(
                    send_broadcast_email,
                    email=guest.email,
                    first_name=guest.first_name,
                    message=data.message,
                    event_name=event.name,
                    event_id=event.id,
                )
            sent_any = True

        if guest.phone:
            if "sms" in data.channels and guest.sms_consent:
                if take_message_credit(event, "sms", reason="broadcast", guest_id=guest.id):
                    sms_text = channel_text(overrides, "broadcast", "sms", _ctx(guest))
                    if sms_text is not None:
                        background_tasks.add_task(send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_custom_sms, phone=guest.phone, body=sms_text)
                    else:
                        background_tasks.add_task(
                            send_with_credit_ledger,
                            last_credit_ledger_id(event),
                            messaging.send_broadcast_sms,
                            phone=guest.phone,
                            first_name=guest.first_name,
                            message=data.message,
                        )
                    sent_any = True
                else:
                    credit_blocked = True
            if "whatsapp" in data.channels and guest.whatsapp_consent:
                if take_message_credit(event, "whatsapp", reason="broadcast", guest_id=guest.id):
                    wa_text = channel_text(overrides, "broadcast", "whatsapp", _ctx(guest))
                    if wa_text is not None:
                        background_tasks.add_task(send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_custom_whatsapp, phone=guest.phone, body=wa_text)
                    else:
                        background_tasks.add_task(
                            send_with_credit_ledger,
                            last_credit_ledger_id(event),
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

    if not event.rsvp_token:
        event.rsvp_token = str(_uuid.uuid4())
        await db.flush()
    invite_url = f"{event.checkin_base_url.rstrip('/')}/rsvp/{event.rsvp_token}"
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
                event_id=event.id,
            )
            dispatched = True

        if r.phone and paid_channels:
            phone = _normalize_phone(r.phone.strip())
            if phone is None:
                errors.append(f"{name}: invalid phone '{r.phone}'")
            else:
                if "sms" in data.channels and take_message_credit(event, "sms", reason="manual_invite"):
                    background_tasks.add_task(
                        send_with_credit_ledger,
                        last_credit_ledger_id(event),
                        messaging.send_manual_invite_sms,
                        phone=phone,
                        name=name,
                        event_name=event.name,
                        invite_url=invite_url,
                    )
                    dispatched = True
                if "whatsapp" in data.channels and take_message_credit(event, "whatsapp", reason="manual_invite"):
                    background_tasks.add_task(
                        send_with_credit_ledger,
                        last_credit_ledger_id(event),
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

    url = storage.save(f"events/{filename}", data, file.content_type)
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
        # Best-effort delete the file (local disk or S3, depending on backend).
        storage.delete(storage.subpath_from_url(event.invite_cover_image))
        event.invite_cover_image = None
        await db.commit()
        await db.refresh(event)
    return event
