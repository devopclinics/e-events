from datetime import datetime
import html as _html
import logging
import os
import re
import secrets
import uuid as _uuid
import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, func, select, update
from ..database import get_db
from ..models import BroadcastLog, Event, EventUser, EventUserSection, ExperienceStep, ExperienceWorkflow, FestioMeOutbox, Guest, MenuCategory, MenuItem, Membership, MessageTemplate, Organization, Payment, PlatformSettings, PricingPlan, RSVPQuestion, TableGroup, TicketType, User
from ..schemas import (
    EventCreate, EventDuplicateIn, EventUpdate, EventOut, EventMemberOut, AssignUserRequest,
    OrgMemberInvite, OrgMemberOut, MemberRoleUpdate, UserOut, EventSourceUpdate,
    InviteSettingsUpdate, RSVPQuestionCreate, RSVPQuestionUpdate, RSVPQuestionOut,
    BroadcastRequest, BroadcastResult,
    ManualInviteRequest, ManualInviteResult, MenuEventOut,
)
from ..schemas import ActiveToggle
from ..auth import require_admin, require_event_admin, get_current_user, _org_role
from ..config import settings
from ..organization_entitlements import assert_can_create_event, assert_event_configuration_allowed, pass_is_active, snapshot_new_event
from ..entitlements import assert_feature_allowed, can_use_paid_channels, grant_message_credits, last_credit_ledger_id, record_free_send, reserve_message_credit
from .guests import import_from_source_url, import_warning_summary, _normalize_phone
from services import messaging
from services.credit_ledger import send_with_credit_ledger
from services.email_service import send_manual_invite_email, send_broadcast_email, send_simple_email
from services.outbound_safety import recipient_allowed
from ..template_resolve import load_overrides, channel_text, channel_text_or_default, email_override
from services.templates import build_context as build_template_context
from .. import storage
from ..services.festiome_outbox import queue_announcement
from ..services import post_event_message

UPLOADS_DIR = "/app/uploads"
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB

_IMAGE_SIGNATURES = {
    "image/jpeg": lambda value: value.startswith(b"\xff\xd8\xff"),
    "image/png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/webp": lambda value: len(value) >= 12 and value.startswith(b"RIFF") and value[8:12] == b"WEBP",
    "image/gif": lambda value: value.startswith((b"GIF87a", b"GIF89a")),
}


def _detected_image_type(data: bytes) -> str | None:
    return next((mime for mime, matches in _IMAGE_SIGNATURES.items() if matches(data)), None)

router = APIRouter()

# Event-code alphabet: uppercase, no confusable characters (0 O 1 I L).
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
# Canonical public base for guest-facing links (QR scan, invite, RSVP, hub).
# Driven by PUBLIC_BASE_URL so staging emits staging links and prod emits prod
# links; defaults to the production host when unset. The browser hardcodes a
# base and may send a stale one, so the backend is AUTHORITATIVE: any
# Festio-managed host below is rewritten to this canonical base at write time.
FESTIO_PUBLIC_BASE_URL = (settings.public_base_url or "https://festio.events").rstrip("/")
LEGACY_PUBLIC_BASE_URLS = {
    "https://events.vsgs.io", "http://events.vsgs.io",
    "https://festio.events", "http://festio.events",
    "https://staging.festio.events", "http://staging.festio.events",
}


_MD_LINK_RE = re.compile(r'\[([^\[\]]+)\]\((\S+?)\)')
_MD_BOLD_RE = re.compile(r'\*\*([^\n*]+)\*\*')
_BARE_URL_RE = re.compile(r'https?://\S+')


def _broadcast_message_html(message: str) -> str:
    """Minimal Markdown -> HTML for the free-text broadcast message: **bold**,
    [text](url) links, bare URLs, and `* `/`- ` bullet lines. Escapes the raw
    text first so no literal HTML/script can be injected — every tag in the
    output is one we generate here. SMS/WhatsApp/MMS keep the plain-text
    original (those channels can't render HTML anyway)."""
    escaped = _html.escape(message)

    # Markdown links first, stashed behind placeholders so the bare-URL pass
    # below doesn't re-wrap a URL that's already inside an href we just built.
    links: list[str] = []

    def _stash_link(m: re.Match) -> str:
        text, url = m.group(1), m.group(2)
        if not url.startswith(("http://", "https://", "mailto:")):
            return m.group(0)
        links.append(f'<a href="{url}">{text}</a>')
        return f"\x00LINK{len(links) - 1}\x00"

    escaped = _MD_LINK_RE.sub(_stash_link, escaped)
    escaped = _BARE_URL_RE.sub(lambda m: f'<a href="{m.group(0)}">{m.group(0)}</a>', escaped)
    escaped = _MD_BOLD_RE.sub(r"<strong>\1</strong>", escaped)
    for i, anchor in enumerate(links):
        escaped = escaped.replace(f"\x00LINK{i}\x00", anchor)

    # Block-level: blank-line-separated paragraphs, with `* `/`- ` lines
    # collected into a <ul>.
    html_parts: list[str] = []
    para_lines: list[str] = []
    list_items: list[str] = []

    def flush_para():
        if para_lines:
            html_parts.append("<p>" + "<br>".join(para_lines) + "</p>")
            para_lines.clear()

    def flush_list():
        if list_items:
            html_parts.append("<ul>" + "".join(f"<li>{it}</li>" for it in list_items) + "</ul>")
            list_items.clear()

    for line in escaped.split("\n"):
        stripped = line.strip()
        if stripped.startswith("* ") or stripped.startswith("- "):
            flush_para()
            list_items.append(stripped[2:].strip())
        elif stripped == "":
            flush_para()
            flush_list()
        else:
            flush_list()
            para_lines.append(line)
    flush_para()
    flush_list()

    return "".join(html_parts)


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


VALID_STATUSES = {"draft", "active", "ended", "archived"}
STATUS_TRANSITIONS = {
    "draft":  {"active", "archived"},
    # Draft is the planning / RSVP state.  It deliberately keeps public RSVP
    # available while every staff and self check-in route stays disabled.
    "active": {"draft", "ended", "archived"},
    # A final end closes public RSVP, but an admin can reopen the event if a
    # status was chosen by mistake or post-event work is still required.
    "ended":  {"draft", "active", "archived"},
    # Archived is purely an organizer-side declutter state — it adds no new
    # gating on any public/guest surface (ticketing, FestioHub, RSVP, etc.);
    # those already gate on "ended" independently where that matters. The
    # only way out is back to draft, mirroring how ended -> draft works.
    "archived": {"draft"},
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


async def _event_out_for_user(event: Event, user: User, db: AsyncSession) -> EventOut:
    """Serialize an event with access derived for this event, not the account."""
    role = await _org_role(user, event.org_id, db)
    eu = None
    if not user.is_platform_superadmin:
        eu = await db.scalar(select(EventUser).where(
            EventUser.event_id == event.id, EventUser.user_id == user.id
        ))
    if user.is_platform_superadmin:
        access_role, access_level, can_manage, can_view_guests, can_manage_guests = "platform_admin", "edit", True, True, True
    elif role in ("owner", "admin"):
        access_role, access_level, can_manage, can_view_guests, can_manage_guests = "org_admin", "edit", True, True, True
    elif eu and eu.event_role == "manager":
        access_role = "event_manager"
        access_level = eu.access_level or "edit"
        can_manage, can_view_guests, can_manage_guests = True, True, True
    else:
        access_role, access_level = "official", "view"
        can_manage = False
        can_manage_guests = bool(eu and eu.can_manage_guests)
        can_view_guests = bool(eu and (eu.can_view_guests or eu.can_manage_guests))
    org = await db.get(Organization, event.org_id)
    redesign_accessible = user.is_platform_superadmin or (
        org is not None and org.redesign_cohort != "legacy_only"
    )
    org_cohort = org.redesign_cohort if org is not None else "legacy_only"
    return EventOut.model_validate(event).model_copy(update={
        "my_access_role": access_role,
        "my_access_level": access_level,
        "my_can_manage_event": can_manage,
        "my_can_view_guests": can_view_guests,
        "my_can_manage_guests": can_manage_guests,
        "my_redesign_accessible": redesign_accessible,
        "my_redesign_cohort": org_cohort,
    })


# ── CRUD ──────────────────────────────────────────────────────────────────────

async def _notify_operators_new_event(event_id: str, event_name: str, org_name: str, creator_name: str, creator_email: str) -> None:
    """Platform-operator visibility: there is no other signal today when an
    event is created anywhere on the platform, and Console → Overview shows
    no creation date. Fires to every current is_platform_superadmin — new
    operators added later start receiving these automatically, no config.

    Fire-and-forget background task: any failure here (mail provider down,
    DB hiccup) must never surface to the organizer whose event already
    committed successfully, so every step is caught and logged, not raised.
    """
    try:
        from ..database import AsyncSessionLocal
        from services.email_service import send_simple_email
        async with AsyncSessionLocal() as db:
            emails = (await db.execute(select(User.email).where(User.is_platform_superadmin.is_(True)))).scalars().all()
        body = (
            f"<p>A new event was created on Festio.</p>"
            f"<p><strong>Event:</strong> {event_name}<br>"
            f"<strong>Organization:</strong> {org_name}<br>"
            f"<strong>Created by:</strong> {creator_name} ({creator_email})</p>"
        )
        for email in emails:
            if email:
                await send_simple_email(email, f"New event: {event_name}", body, message_kind="operator_new_event")
    except Exception:
        logging.getLogger(__name__).exception("Failed to notify operators of new event %s", event_id)


@router.post("", response_model=EventOut, status_code=201)
async def create_event(
    data: EventCreate,
    background_tasks: BackgroundTasks,
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
    org = await db.scalar(select(Organization).where(Organization.id == org_id).with_for_update())
    if not org:
        raise HTTPException(404, "Organization not found")
    # V2 uses the current organization pass; the legacy historical-paid-event
    # rule remains available only while the staging rollout flag is disabled.
    if settings.organization_entitlements_v2:
        existing_event_count = await db.scalar(
            select(func.count()).select_from(Event).where(Event.org_id == org_id)
        ) or 0
        assert_can_create_event(org, int(existing_event_count), is_superadmin=current_user.is_platform_superadmin)
    elif not current_user.is_platform_superadmin:
        has_paid_event = await db.scalar(
            select(Event.id).where(Event.org_id == org_id, Event.is_paid.is_(True)).limit(1)
        )
        org = await db.get(Organization, org_id)
        has_pending_trial = bool(org and (org.trial_tier or org.trial_credits))
        if not has_paid_event and not has_pending_trial:
            existing_event_count = await db.scalar(
                select(func.count()).select_from(Event).where(Event.org_id == org_id)
            )
            if existing_event_count:
                raise HTTPException(
                    402,
                    "Free accounts can create 1 event. Buy an Event Pass on your existing event to create additional events.",
                )
    payload = data.model_dump()
    payload["checkin_base_url"] = _normalize_public_base_url(payload.get("checkin_base_url"))
    # notify_sms/notify_whatsapp are non-nullable columns (default True) — drop
    # them when the caller left them unset so the column default applies,
    # instead of passing an explicit None that would violate NOT NULL.
    for key in ("notify_sms", "notify_whatsapp"):
        if payload.get(key) is None:
            payload.pop(key, None)
    event = Event(**payload, org_id=org_id)
    if settings.organization_entitlements_v2:
        snapshot_new_event(event, org)
        assert_event_configuration_allowed(event, org)
        if not current_user.is_platform_superadmin and not org.event_pass_tier:
            org.free_event_used = True
    event.event_code = await unique_event_code(db)
    event.rsvp_token = event.rsvp_token or str(_uuid.uuid4())
    db.add(event)
    await db.flush()
    # Auto-assign creator so they appear in their own event member list
    db.add(EventUser(event_id=event.id, user_id=current_user.id))

    # Consume a pending trial grant (from an approved TrialRequest made before
    # the org had any event) — apply it to this first event, then clear it.
    if org:
        event.org_addon_overrides = dict(org.addon_overrides or {}) or None
    addon_plans = (await db.execute(select(PricingPlan).where(PricingPlan.kind == "addon"))).scalars().all()
    event.platform_addon_overrides = {plan.key: bool(plan.active) for plan in addon_plans} or None
    platform_policy = await db.get(PlatformSettings, "singleton")
    event.addon_promo_until = platform_policy.addon_promo_until if platform_policy else None
    trial_granted_to_org = False
    if org and (org.trial_tier or org.trial_credits):
        from ..billing import get_plan, apply_purchase, apply_organization_purchase
        from ..organization_entitlements import grant_message_units
        if org.trial_tier:
            plan = await get_plan(db, org.trial_tier)
            if plan:
                if settings.organization_entitlements_v2:
                    apply_organization_purchase(org, plan)
                    trial_granted_to_org = True
                else:
                    apply_purchase(event, plan)
        if org.trial_credits:
            if settings.organization_entitlements_v2:
                grant_message_units(org, int(org.trial_credits))
                trial_granted_to_org = True
            else:
                grant_message_credits(event, int(org.trial_credits), reason="trial_grant")
        org.trial_tier = None
        org.trial_credits = None
        if trial_granted_to_org:
            # Re-snapshot: the org pass activated after the initial snapshot
            # above, so the event's legacy fallback fields must catch up too.
            snapshot_new_event(event, org)

    await db.commit()
    if trial_granted_to_org:
        from .. import entitlements
        await entitlements.reload_addon_policy_cache(db)
    await db.refresh(event)
    background_tasks.add_task(
        _notify_operators_new_event, event.id, event.name,
        org.name if org else "", current_user.name, current_user.email,
    )
    from ..services.marketing_client import ingest_marketing_lead
    background_tasks.add_task(
        ingest_marketing_lead, current_user, stage="event_created",
        event_type=event.event_type, guest_count=event.guest_cap,
    )
    return event


# Configuration/template fields safe to carry into a duplicate. Deliberately
# an allowlist, not a denylist — this model has 150+ columns including
# billing state, credit counters, cached FestioMe links, and live sync
# tokens, none of which a "reusable template" duplicate should inherit.
# Identity fields (org_id/name/dates/timezone/venue/etc.) are handled
# separately below via the same construction create_event() uses.
_DUPLICATE_TEMPLATE_FIELDS = [
    # feature toggles — each is still gated by entitlements at request time,
    # so copying the flag doesn't grant anything the new event hasn't paid for
    "seating_enabled", "menu_enabled", "logistics_enabled", "registry_enabled", "registry_message",
    "venue_access_enabled", "experience_enabled", "live_program_enabled", "planner_enabled",
    "festiome_addon_enabled", "partner_pairing_enabled", "speaker_enabled", "partner_enabled", "reminders_enabled",
    "enforce_table_groups", "seating_term", "seat_term", "seat_assignment_order", "section_mode_enabled",
    "manual_checkin_enabled", "self_checkin_enabled", "checkout_enabled", "walk_in_enabled",
    # notifications — includes platform-superadmin blocks, which must carry
    # over so duplication can't be used to dodge a compliance/abuse block
    "notify_email", "notify_mms", "channel_policy",
    "blocked_messaging_channels", "blocked_comm_features", "notify_rsvp_responses",
    "post_event_thankyou_enabled", "post_event_thankyou_delay_hours", "post_event_thankyou_audience",
    # RSVP / invite configuration
    "rsvp_enabled", "invite_theme", "invite_message", "invite_cover_image",
    "rsvp_collect_phone", "rsvp_collect_email", "rsvp_email_required", "rsvp_phone_required",
    "rsvp_invitee_email_required", "rsvp_invitee_phone_required", "rsvp_allow_duplicate_emails",
    "invite_mode", "event_time_tbd", "rsvp_require_approval",
    "rsvp_multi_invitee_enabled", "rsvp_multi_invitee_limit", "rsvp_multi_invitee_limit_rules",
    "rsvp_category_seating_rules", "rsvp_invitee_type_options", "rsvp_invitee_age_options",
    "rsvp_invitee_contact_exempt_types",
    "invite_countdown_enabled", "invite_capacity_bar_enabled", "invite_share_enabled",
    "invite_add_to_calendar_enabled", "rsvp_confetti_enabled",
]

DESIGN_URL = os.getenv("DESIGN_SERVICE_URL", "http://design-service:8010").rstrip("/")
DESIGN_TOKEN = os.getenv("DESIGN_INTERNAL_TOKEN", "")


async def _clone_design(source_event_id: str, new_event_id: str, org_id: str) -> None:
    """Best-effort: copy Design Studio branding (theme/wording/asset/page
    config) onto the new event and publish it immediately, so the duplicate
    looks identical out of the box instead of starting on the stock default.
    Never raises — a design-service hiccup must not fail the duplicate
    itself, same policy as design_proxy.py's degrade-gracefully approach."""
    headers = {"X-Internal-Token": DESIGN_TOKEN}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            source = await client.get(f"{DESIGN_URL}/api/v1/design/events/{source_event_id}", headers=headers)
            if source.status_code != 200:
                return
            data = source.json()
            was_published = bool(data.get("is_published"))
            body = {
                "selected_template_id": data.get("selected_template_id"),
                "selected_flyer_template_id": data.get("selected_flyer_template_id"),
                "theme_config": data.get("theme_config") or {},
                "wording_config": data.get("wording_config") or {},
                "asset_config": data.get("asset_config") or {},
                "page_config": data.get("page_config") or {},
            }
            put = await client.put(f"{DESIGN_URL}/api/v1/design/events/{new_event_id}", json=body,
                                    headers={**headers, "X-Org-Id": org_id})
            if put.status_code == 200 and was_published:
                await client.post(f"{DESIGN_URL}/api/v1/design/events/{new_event_id}/publish", headers=headers)
    except httpx.RequestError:
        logging.getLogger(__name__).warning("Design clone skipped for duplicate of %s (design-service unreachable)", source_event_id)


@router.post("/{event_id}/duplicate", response_model=EventOut, status_code=201)
async def duplicate_event(
    event_id: str,
    body: EventDuplicateIn,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    """Clone an event's configuration (RSVP settings, invite display, custom
    questions, ticket types, menu, table groups, message-template overrides,
    branding) into a brand-new event on the same org. Guests, RSVPs, scan
    history, orders, and billing state never carry over — this creates a
    reusable template, not a copy of the live event."""
    source = await db.get(Event, event_id)
    if not source:
        raise HTTPException(404, "Event not found")

    org_id = source.org_id
    org = await db.scalar(select(Organization).where(Organization.id == org_id).with_for_update())
    if not org:
        raise HTTPException(404, "Organization not found")
    if settings.organization_entitlements_v2:
        existing_event_count = await db.scalar(
            select(func.count()).select_from(Event).where(Event.org_id == org_id)
        ) or 0
        assert_can_create_event(org, int(existing_event_count), is_superadmin=current_user.is_platform_superadmin)
    elif not current_user.is_platform_superadmin:
        has_paid_event = await db.scalar(
            select(Event.id).where(Event.org_id == org_id, Event.is_paid.is_(True)).limit(1)
        )
        if not has_paid_event:
            existing_event_count = await db.scalar(
                select(func.count()).select_from(Event).where(Event.org_id == org_id)
            )
            if existing_event_count:
                raise HTTPException(
                    402,
                    "Free accounts can create 1 event. Buy an Event Pass on your existing event to create additional events.",
                )

    new_event = Event(
        org_id=org_id,
        name=(body.name or f"{source.name} (Copy)").strip()[:255],
        couples_name=source.couples_name,
        event_type=source.event_type,
        attendance_mode=source.attendance_mode,
        event_date=body.event_date,
        event_end_date=body.event_end_date,
        timezone=source.timezone or "UTC",
        description=source.description,
        checkin_base_url=source.checkin_base_url,
        venue_name=source.venue_name, venue_address=source.venue_address,
        hotel_name=source.hotel_name, hotel_address=source.hotel_address,
        admission_note=source.admission_note,
        notify_sms=source.notify_sms, notify_whatsapp=source.notify_whatsapp,
        rsvp_capacity=source.rsvp_capacity,
    )
    if settings.organization_entitlements_v2:
        snapshot_new_event(new_event, org)
        if not current_user.is_platform_superadmin and not org.event_pass_tier:
            org.free_event_used = True
    for field in _DUPLICATE_TEMPLATE_FIELDS:
        setattr(new_event, field, getattr(source, field))
    new_event.event_code = await unique_event_code(db)
    new_event.rsvp_token = str(_uuid.uuid4())
    db.add(new_event)
    await db.flush()
    db.add(EventUser(event_id=new_event.id, user_id=current_user.id))

    # RSVP questions — self-referential depends_on_question_id must be
    # remapped to the *new* question ids, not carried over from the source.
    questions = (await db.execute(
        select(RSVPQuestion).where(RSVPQuestion.event_id == event_id).order_by(RSVPQuestion.sort_order)
    )).scalars().all()
    id_map: dict[str, RSVPQuestion] = {}
    pairs = []
    for q in questions:
        new_q = RSVPQuestion(
            event_id=new_event.id, question=q.question, question_type=q.question_type,
            options=q.options, is_required=q.is_required, sort_order=q.sort_order,
            depends_on_value=q.depends_on_value,
        )
        db.add(new_q)
        id_map[q.id] = new_q
        pairs.append((q, new_q))
    await db.flush()
    for old_q, new_q in pairs:
        if old_q.depends_on_question_id and old_q.depends_on_question_id in id_map:
            new_q.depends_on_question_id = id_map[old_q.depends_on_question_id].id

    # Ticket types — allowed_zone_ids references Venue Access zones, which are
    # event-scoped and not duplicated here, so it's cleared rather than left
    # dangling; the organizer re-picks zones on the new event if needed.
    ticket_types = (await db.execute(
        select(TicketType).where(TicketType.event_id == event_id)
    )).scalars().all()
    for t in ticket_types:
        db.add(TicketType(
            event_id=new_event.id, name=t.name, color=t.color, description=t.description,
            capacity=t.capacity, allowed_zone_ids=None, sort_order=t.sort_order, is_active=t.is_active,
        ))

    # Menu categories + items
    categories = (await db.execute(
        select(MenuCategory).where(MenuCategory.event_id == event_id)
    )).scalars().all()
    for c in categories:
        new_c = MenuCategory(
            event_id=new_event.id, name=c.name, day_label=c.day_label, display_only=c.display_only,
            sort_order=c.sort_order, selection_type=c.selection_type, min_selections=c.min_selections,
            max_selections=c.max_selections, is_required=c.is_required,
        )
        db.add(new_c)
        await db.flush()
        items = (await db.execute(select(MenuItem).where(MenuItem.category_id == c.id))).scalars().all()
        for item in items:
            db.add(MenuItem(category_id=new_c.id, event_id=new_event.id, name=item.name, description=item.description))

    # Table groups — structure/labels only; physical table↔group assignments
    # are venue-specific and usually don't carry over to a new venue.
    groups = (await db.execute(
        select(TableGroup).where(TableGroup.event_id == event_id).order_by(TableGroup.sort_order)
    )).scalars().all()
    for g in groups:
        db.add(TableGroup(event_id=new_event.id, name=g.name, tag=g.tag, description=g.description, sort_order=g.sort_order))

    # Per-event message template overrides
    templates = (await db.execute(
        select(MessageTemplate).where(MessageTemplate.event_id == event_id)
    )).scalars().all()
    for t in templates:
        db.add(MessageTemplate(
            event_id=new_event.id, template_key=t.template_key, subject=t.subject,
            email_body=t.email_body, sms_body=t.sms_body, whatsapp_body=t.whatsapp_body, mms_body=t.mms_body,
        ))

    await db.commit()
    await db.refresh(new_event)

    org = await db.get(Organization, org_id)
    background_tasks.add_task(
        _notify_operators_new_event, new_event.id, new_event.name,
        org.name if org else "", current_user.name, current_user.email,
    )
    await _clone_design(event_id, new_event.id, org_id)
    return new_event


@router.get("", response_model=list[EventOut])
async def list_events(
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # `status` is optional and additive — omitted, this returns every event
    # exactly as before (the topbar EventSwitcher relies on that). Passed, it
    # filters server-side rather than shipping every event to the browser
    # (the Events list page's tabs use this).
    if status is not None and status not in VALID_STATUSES:
        raise HTTPException(400, f"status must be one of: {', '.join(VALID_STATUSES)}")
    # Platform superadmin sees everything; everyone else only their org's events.
    if current_user.is_platform_superadmin:
        q = select(Event).order_by(Event.created_at.desc())
        if status is not None:
            q = q.where(Event.status == status)
        result = await db.execute(q)
    else:
        managed_q = (
            select(Event)
            .join(Membership, Membership.org_id == Event.org_id)
            .join(Organization, Organization.id == Event.org_id)
            .where(
                Membership.user_id == current_user.id,
                Membership.role.in_(["owner", "admin"]),
                Organization.is_active.is_(True),
            )
            .order_by(Event.created_at.desc())
        )
        assigned_q = (
            select(Event)
            .join(EventUser, EventUser.event_id == Event.id)
            .join(Organization, Organization.id == Event.org_id)
            .where(EventUser.user_id == current_user.id, Organization.is_active.is_(True))
            .order_by(Event.created_at.desc())
        )
        if status is not None:
            managed_q = managed_q.where(Event.status == status)
            assigned_q = assigned_q.where(Event.status == status)
        managed = (await db.execute(managed_q)).scalars().all()
        assigned = (await db.execute(assigned_q)).scalars().all()
        seen, rows = set(), []
        for event in [*managed, *assigned]:
            if event.id not in seen:
                seen.add(event.id)
                rows.append(event)
        return [await _event_out_for_user(event, current_user, db) for event in rows]
    return [await _event_out_for_user(event, current_user, db) for event in result.scalars().all()]


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
    event = await _get_accessible_event(event_id, current_user, db)
    return await _event_out_for_user(event, current_user, db)


@router.put("/{event_id}", response_model=EventOut)
async def update_event(
    event_id: str,
    data: EventUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    previous_date = event.event_date
    previous_venue = event.venue_name
    previous_timezone = event.timezone
    # Preserve explicit nulls for nullable fields so the editor can clear a
    # previously saved end date, venue, hotel, note, or description.  Omitted
    # fields remain unchanged.
    payload = data.model_dump(exclude_unset=True)
    for required_field in ("name", "event_date", "timezone", "checkin_base_url"):
        if payload.get(required_field) is None:
            payload.pop(required_field, None)
    if "checkin_base_url" in payload:
        payload["checkin_base_url"] = _normalize_public_base_url(payload.get("checkin_base_url"))
    if settings.organization_entitlements_v2:
        org = await db.get(Organization, event.org_id)
        proposed_capacity = payload.get("rsvp_capacity", event.rsvp_capacity)
        proposed_sms = payload.get("notify_sms", event.notify_sms)
        proposed_whatsapp = payload.get("notify_whatsapp", event.notify_whatsapp)
        prospective = type("EventConfiguration", (), {
            "rsvp_capacity": proposed_capacity,
            "notify_sms": proposed_sms,
            "notify_whatsapp": proposed_whatsapp,
        })()
        for field, value in payload.items():
            setattr(prospective, field, value)
        assert_event_configuration_allowed(prospective, org)
    for field, value in payload.items():
        setattr(event, field, value)
    if event.event_date != previous_date or event.timezone != previous_timezone:
        from ..services.reminders import recompute_fire_times
        await recompute_fire_times(event, db)
    if event.event_date != previous_date or event.venue_name != previous_venue:
        when = event.event_date.strftime("%A, %B %d at %I:%M %p")
        venue = f" at {event.venue_name}" if event.venue_name else ""
        await queue_announcement(
            db,
            event_id=event.id,
            title="Event schedule updated",
            body=f"{event.name} is scheduled for {when}{venue}.",
            kind="schedule",
            source_ref=f"event-schedule:{datetime.utcnow().isoformat(timespec='microseconds')}",
        )
    await db.commit()
    await db.refresh(event)
    from ..services.marketing_client import ingest_marketing_lead
    await ingest_marketing_lead(
        current_user, stage="event_created", event_type=event.event_type,
        guest_count=event.guest_cap,
    )
    return event


@router.delete("/{event_id}", status_code=204)
async def delete_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    await db.execute(delete(FestioMeOutbox).where(FestioMeOutbox.event_id == event_id))
    # Detach payments (org-level financial audit records) so the FK doesn't
    # block deletion — any event with an initiated checkout was undeletable.
    await db.execute(update(Payment).where(Payment.event_id == event_id).values(event_id=None))
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
    if settings.organization_entitlements_v2 and new_status == "active":
        org = await db.get(Organization, event.org_id)
        assert_event_configuration_allowed(event, org, activating=True)

    # Optional optimistic-concurrency guard: the redesign UI sends back the
    # updated_at it last saw, so a second operator's stale status change
    # (e.g. clicking "Activate" on a screen left open while someone else
    # already moved the event to "ended") is rejected instead of silently
    # applied over a lifecycle transition someone else already made.
    # Omitted by callers that don't track it, so this is additive.
    if_unmodified_since = body.get("if_unmodified_since")
    if if_unmodified_since:
        expected = datetime.fromisoformat(if_unmodified_since.replace("Z", "+00:00")).replace(tzinfo=None)
        if event.updated_at and event.updated_at != expected:
            raise HTTPException(409, "This event was changed by another operator. Refresh and try again.")

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
            can_view_guests=eu.can_view_guests,
            can_manage_guests=eu.can_manage_guests,
            can_view_planner=eu.can_view_planner,
            can_manage_planner_tasks=eu.can_manage_planner_tasks,
            can_manage_planner_budget=eu.can_manage_planner_budget,
            can_manage_planner_vendors=eu.can_manage_planner_vendors,
            can_manage_planner_documents=eu.can_manage_planner_documents,
            can_manage_planner_runsheet=eu.can_manage_planner_runsheet,
            event_role=eu.event_role,
            access_level=eu.access_level,
            section_group_ids=sections_by_eu.get(eu.id, []),
            updated_at=eu.updated_at,
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
        can_view_guests=eu.can_view_guests,
        can_manage_guests=eu.can_manage_guests,
        can_view_planner=eu.can_view_planner,
        can_manage_planner_tasks=eu.can_manage_planner_tasks,
        can_manage_planner_budget=eu.can_manage_planner_budget,
        can_manage_planner_vendors=eu.can_manage_planner_vendors,
        can_manage_planner_documents=eu.can_manage_planner_documents,
        can_manage_planner_runsheet=eu.can_manage_planner_runsheet,
        event_role=eu.event_role,
        access_level=eu.access_level,
        updated_at=eu.updated_at,
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
    messaging.set_event_context(event.id)
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
                ticket_url=ticket_url, event_date=event.event_date, event_timezone=event.timezone,
            )
        else:
            await messaging.send_invite_whatsapp(
                phone=phone, first_name="Festio",
                event_name=f"{event.name} (TEST)",
                ticket_url=ticket_url, event_date=event.event_date, event_timezone=event.timezone,
            )
    except Exception as e:
        raise HTTPException(500, f"Send failed: {e}")
    return {"ok": True, "channel": channel, "to": phone}


# Automated lifecycle flows the routing policy applies to. Manual sends where the
# organizer already picks channels (registry / host broadcast) are excluded — only
# the superadmin block constrains those.
_POLICY_FLOWS = {"invite", "admission", "reminder", "approval", "logistics"}
_POLICY_CHANNELS = {"email", "sms", "whatsapp", "mms"}


@router.put("/{event_id}/channel-policy", response_model=EventOut)
async def set_channel_policy(
    event_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_event_admin),
):
    """Per-flow channel priority (cost control). Body: {flow: [ordered channels]}.
    Unknown flows/channels are ignored; an empty map clears the policy (legacy
    'send on all enabled channels')."""
    event = await _get_accessible_event(event_id, user, db)
    policy: dict[str, list[str]] = {}
    for flow, channels in (body or {}).items():
        if flow not in _POLICY_FLOWS or not isinstance(channels, list):
            continue
        ordered = [c for c in channels if c in _POLICY_CHANNELS]
        # preserve order, drop dupes
        seen: list[str] = []
        for c in ordered:
            if c not in seen:
                seen.append(c)
        if seen:
            policy[flow] = seen
    event.channel_policy = policy or None
    await db.commit()
    await db.refresh(event)
    return EventOut.model_validate(event)


@router.patch("/{event_id}/features", response_model=EventOut)
async def toggle_features(
    event_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if settings.organization_entitlements_v2 and (body.get("notify_sms") or body.get("notify_whatsapp")):
        org = await db.get(Organization, event.org_id)
        if not org or not pass_is_active(org):
            raise HTTPException(402, "Free events are email-only. Buy an Event Pass to enable SMS or WhatsApp.")
    for feature in (
        "seating_enabled", "menu_enabled", "logistics_enabled", "registry_enabled",
        "venue_access_enabled", "partner_pairing_enabled", "experience_enabled", "live_program_enabled",
        "section_mode_enabled", "festiome_addon_enabled", "planner_enabled",
        "speaker_enabled", "partner_enabled", "reminders_enabled",
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
    if "live_program_enabled" in body:
        # Live Program is an Experience add-on. Enabling it is deliberately
        # non-invasive; it only exposes timed agenda data and starts the clock
        # from now so old announcements are never replayed.
        enable = bool(body["live_program_enabled"])
        if enable and not event.experience_enabled:
            raise HTTPException(400, "Enable Experience before enabling Live Program")
        event.live_program_enabled = enable
        event.live_program_enabled_at = datetime.utcnow() if enable else None
    if "festiome_addon_enabled" in body:
        # Turning the add-on off only revokes the offering; the cached remote
        # link state (festiome_enabled/id/url) is left intact so re-enabling
        # does not require re-provisioning through the FestioMe service.
        event.festiome_addon_enabled = bool(body["festiome_addon_enabled"])
    if "planner_enabled" in body:
        event.planner_enabled = bool(body["planner_enabled"])
    if "partner_pairing_enabled" in body:
        event.partner_pairing_enabled = bool(body["partner_pairing_enabled"])
    if "registry_enabled" in body:
        event.registry_enabled = bool(body["registry_enabled"])
        # Mint the public registry token on first enable.
        if event.registry_enabled and not event.registry_token:
            event.registry_token = str(_uuid.uuid4())
    if "speaker_enabled" in body:
        event.speaker_enabled = bool(body["speaker_enabled"])
        if event.speaker_enabled and not event.speaker_token:
            event.speaker_token = str(_uuid.uuid4())
    if "speaker_show_before_rsvp" in body:
        event.speaker_show_before_rsvp = bool(body["speaker_show_before_rsvp"])
    if "partner_enabled" in body:
        event.partner_enabled = bool(body["partner_enabled"])
        if event.partner_enabled and not event.partner_token:
            event.partner_token = str(_uuid.uuid4())
    if "reminders_enabled" in body:
        event.reminders_enabled = bool(body["reminders_enabled"])
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
    if "checkout_enabled" in body:
        event.checkout_enabled = bool(body["checkout_enabled"])
    for k in ("notify_email", "notify_sms", "notify_whatsapp", "notify_rsvp_responses", "post_event_thankyou_enabled"):
        if k in body:
            setattr(event, k, bool(body[k]))
    if "post_event_thankyou_delay_hours" in body:
        hours = int(body["post_event_thankyou_delay_hours"])
        if hours < 0 or hours > 24 * 30:
            raise HTTPException(400, "post_event_thankyou_delay_hours must be between 0 and 720")
        event.post_event_thankyou_delay_hours = hours
    if "post_event_thankyou_audience" in body:
        audience = body["post_event_thankyou_audience"]
        if audience not in ("admitted", "confirmed", "all"):
            raise HTTPException(400, "post_event_thankyou_audience must be admitted, confirmed, or all")
        event.post_event_thankyou_audience = audience
    if "seating_term" in body:
        term = (body["seating_term"] or "").strip()
        if len(term) > 30:
            raise HTTPException(400, "seating_term must be 30 characters or fewer")
        event.seating_term = term or None
    if "seat_term" in body:
        term = (body["seat_term"] or "").strip()
        if len(term) > 30:
            raise HTTPException(400, "seat_term must be 30 characters or fewer")
        event.seat_term = term or None
    if "seat_assignment_order" in body:
        order = body["seat_assignment_order"]
        if order not in ("sequential", "random"):
            raise HTTPException(400, "seat_assignment_order must be 'sequential' or 'random'")
        event.seat_assignment_order = order
    await db.commit()
    await db.refresh(event)
    if any(bool(body.get(feature)) for feature in ("seating_enabled", "menu_enabled", "logistics_enabled", "registry_enabled", "venue_access_enabled", "experience_enabled", "festiome_addon_enabled", "planner_enabled", "speaker_enabled", "partner_enabled", "reminders_enabled")):
        from ..services.marketing_client import ingest_marketing_lead
        await ingest_marketing_lead(current_user, stage="activated", event_type=event.event_type)
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


@router.patch("/{event_id}/walk-in-group-choice", response_model=EventOut)
async def set_walk_in_group_choice(event_id: str, body: dict, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    """Toggle whether staff can pick any table group per walk-in, instead of
    always using the single default. Body: {enabled: bool}."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    event.walk_in_group_choice_enabled = bool(body.get("enabled"))
    await db.commit()
    await db.refresh(event)
    return event


@router.patch("/{event_id}/default-guest-group", response_model=EventOut)
async def set_default_guest_group(
    event_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Route known guests with no table/group into this group at check-in."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    gid = body.get("table_group_id") or None
    if gid:
        grp = await db.get(TableGroup, gid)
        if not grp or grp.event_id != event_id:
            raise HTTPException(404, "Table group not found for this event")
    event.default_guest_table_group_id = gid
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
        if field == "rsvp_category_seating_rules":
            seating = {}
            for key, mapping in (value or {}).items():
                label = str(key or "").strip()
                if not label or not isinstance(mapping, dict):
                    continue
                sub = str(mapping.get("submitter") or "").strip()
                inv = str(mapping.get("invitee") or "").strip()
                entry = {}
                if sub:
                    entry["submitter"] = sub
                if inv:
                    entry["invitee"] = inv
                if entry:
                    seating[label] = entry
            value = seating or None
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
    admin_user: User = Depends(require_event_admin),
):
    """Send a free-text message to a subset of guests via SMS, WhatsApp and/or MMS."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    messaging.set_event_context(event.id)

    if not data.message.strip():
        raise HTTPException(400, "message cannot be empty")

    contextual = data.message_type in {"feedback", "experience_stage"}
    if contextual and data.extra_recipients:
        raise HTTPException(400, "Feedback and Experience messages can only be sent to guests on this event")
    if contextual and not event.experience_enabled:
        raise HTTPException(404, "Experience workflow is not enabled for this event")

    experience_step = None
    if contextual:
        if not data.experience_step_id:
            raise HTTPException(400, "experience_step_id is required for this message type")
        experience_step = (await db.execute(
            select(ExperienceStep)
            .join(ExperienceWorkflow, ExperienceWorkflow.id == ExperienceStep.workflow_id)
            .where(
                ExperienceStep.id == data.experience_step_id,
                ExperienceWorkflow.event_id == event_id,
                ExperienceWorkflow.status == "published",
                ExperienceStep.enabled.is_(True),
            )
        )).scalars().first()
        if not experience_step:
            raise HTTPException(404, "Live Experience step not found")
        if data.message_type == "feedback" and experience_step.type != "feedback":
            raise HTTPException(400, "The selected Experience step is not a feedback form")
        if data.message_type == "experience_stage" and experience_step.type == "feedback":
            raise HTTPException(400, "Choose a non-feedback Experience stage")

    # Entitlement gate: SMS/WhatsApp/MMS require a paid event; email is always allowed.
    channels = list(data.channels)
    if not can_use_paid_channels(event):
        dropped = [c for c in channels if c in ("sms", "whatsapp", "mms")]
        channels = [c for c in channels if c == "email"]
        if not channels:
            raise HTTPException(
                402,
                "Sending SMS/WhatsApp/MMS requires an Event Pass. Upgrade this event, "
                "or broadcast by email.",
            )
        data = data.model_copy(update={"channels": channels})
        _ = dropped  # (silently dropped paid channels; email still sent)

    # MMS needs its own tier flag, a configured provider, and an image to attach.
    if "mms" in channels:
        if not (event.notify_mms and messaging.mms_ready()):
            channels = [c for c in channels if c != "mms"]
            data = data.model_copy(update={"channels": channels})
        elif not data.mms_media_url or not data.mms_media_url.lower().startswith("https://"):
            raise HTTPException(400, "MMS requires an mms_media_url using HTTPS")

    if data.target == "feedback_nonresponders":
        if data.message_type != "feedback" or not experience_step:
            raise HTTPException(400, "feedback_nonresponders requires a feedback message and live feedback form")
        from .experience import _feedback_nonresponders
        _, _, guests = await _feedback_nonresponders(event_id, experience_step.id, db)
    elif data.target == "none" and not data.guest_ids:
        # Only the typed-in / specifically-selected recipients — no guest segment.
        guests = []
    else:
        q = select(Guest).where(Guest.event_id == event_id)
        if data.guest_ids:
            q = q.where(Guest.id.in_(data.guest_ids))
        elif data.target == "admitted":
            q = q.where(Guest.admitted == True)  # noqa: E712
        elif data.target == "not_admitted":
            q = q.where(Guest.admitted == False)  # noqa: E712
        elif data.target in ("confirmed", "declined", "no_reply"):
            status = {"confirmed": "confirmed", "declined": "declined", "no_reply": "invited"}[data.target]
            q = q.where(Guest.rsvp_status == status)
        guests = (await db.execute(q)).scalars().all()

    if not guests and not data.extra_recipients:
        raise HTTPException(400, "No recipients matched")

    want_email = "email" in data.channels
    want_phone = "sms" in data.channels or "whatsapp" in data.channels or "mms" in data.channels

    # Staging/E2E recipient safety must reject the request before background
    # tasks, usage logs, or message credits are created. Provider-boundary
    # checks remain as defense in depth for every other outbound path.
    recipients_to_check: list[tuple[str, str]] = []
    for guest in guests:
        if want_email and guest.email:
            recipients_to_check.append(("email", guest.email))
        if guest.phone:
            recipients_to_check.extend(
                (channel, guest.phone)
                for channel in data.channels
                if channel in ("sms", "whatsapp", "mms")
            )
    for recipient in data.extra_recipients:
        if want_email and recipient.email:
            recipients_to_check.append(("email", str(recipient.email)))
        if recipient.phone:
            recipients_to_check.extend(
                (channel, recipient.phone)
                for channel in data.channels
                if channel in ("sms", "whatsapp", "mms")
            )
    if any(not recipient_allowed(channel, value) for channel, value in recipients_to_check):
        raise HTTPException(403, "One or more recipients are blocked by the environment outbound-safety policy")

    # Customizable-template overrides for the broadcast message (if any). When a
    # channel has no override we fall through to the default send_broadcast_* path.
    overrides = await load_overrides(event_id, db)

    def _guest_pass_link(guest: Guest) -> str:
        if not guest.invite_token:
            guest.invite_token = str(_uuid.uuid4())
        base = _normalize_public_base_url(event.checkin_base_url)
        if data.message_type == "feedback":
            return f"{base}/r/{guest.invite_token}?focus=feedback#guest-hub"
        return f"{base}/r/{guest.invite_token}#guest-hub"

    def _message_for_guest(guest: Guest) -> tuple[str, str]:
        if not contextual:
            return data.message, ""
        link = _guest_pass_link(guest)
        return f"{data.message.rstrip()}\n{link}", link

    def _message_subject() -> str:
        if data.subject and data.subject.strip():
            return data.subject.strip()[:200]
        if data.message_type == "thank_you":
            return f"Thank you — {event.name}"
        if data.message_type == "feedback":
            return f"Share your feedback — {event.name}"
        if data.message_type == "experience_stage" and experience_step:
            return f"{experience_step.title} — {event.name}"
        return f"Update — {event.name}"

    message_subject = _message_subject()

    # Plain text as typed — safe for SMS/WhatsApp/MMS. Email receives the same
    # personalized content converted to safe, clickable HTML per guest.
    def _ctx(guest, message):
        return build_template_context(event, guest, extras={"message": message})

    def _email_ctx(guest, message):
        return build_template_context(event, guest, extras={"message": _broadcast_message_html(message)})

    queued = skipped_no_contact = skipped_no_consent = skipped_no_credits = 0
    # Per-channel breakdown for BroadcastLog/usage reporting — the aggregate
    # counters above stay exactly as before (same semantics, same values).
    channel_counts = {ch: {"queued": 0, "skipped_no_contact": 0, "skipped_no_consent": 0, "skipped_no_credits": 0}
                       for ch in ("email", "sms", "whatsapp", "mms")}

    email_blocked = "email" in (event.blocked_messaging_channels or [])
    for guest in guests:
        guest_message, guest_link = _message_for_guest(guest)
        guest_email_message = _broadcast_message_html(guest_message)
        sent_any = False
        credit_blocked = False

        if want_email:
            if guest.email and not email_blocked:
                subj, body = email_override(overrides, "broadcast", _email_ctx(guest, guest_message))
                if body is not None:
                    background_tasks.add_task(
                        send_simple_email, guest.email,
                        subj or message_subject, body, event.id, None, guest.id, f"broadcast_{data.message_type}",
                    )
                elif data.message_type != "general" or data.subject:
                    greeting = _html.escape(guest.first_name or "there")
                    background_tasks.add_task(
                        send_simple_email, guest.email, message_subject,
                        f"<p>Hi <strong>{greeting}</strong>,</p>{guest_email_message}",
                        event.id, None, guest.id, f"broadcast_{data.message_type}",
                    )
                else:
                    background_tasks.add_task(
                        send_broadcast_email,
                        email=guest.email,
                        guest_id=guest.id,
                        first_name=guest.first_name, message=guest_message,
                        event_name=event.name,
                        event_id=event.id,
                    )
                # Broadcast email isn't credit-metered — log it at zero cost so
                # it still shows up in usage reports.
                record_free_send(event, "email", reason="broadcast", guest_id=guest.id)
                channel_counts["email"]["queued"] += 1
                sent_any = True
            else:
                channel_counts["email"]["skipped_no_contact"] += 1

        if "sms" in data.channels:
            if not guest.phone:
                channel_counts["sms"]["skipped_no_contact"] += 1
            elif not guest.sms_consent:
                channel_counts["sms"]["skipped_no_consent"] += 1
            elif await reserve_message_credit(event, "sms", db=db, reason="broadcast", guest_id=guest.id):
                sms_text = channel_text(overrides, "broadcast", "sms", _ctx(guest, guest_message))
                if sms_text is not None:
                    background_tasks.add_task(send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_custom_sms, phone=guest.phone, body=sms_text)
                else:
                    background_tasks.add_task(
                        send_with_credit_ledger,
                        last_credit_ledger_id(event),
                        messaging.send_broadcast_sms,
                        phone=guest.phone,
                        first_name=guest.first_name,
                        message=guest_message,
                    )
                channel_counts["sms"]["queued"] += 1
                sent_any = True
            else:
                channel_counts["sms"]["skipped_no_credits"] += 1
                credit_blocked = True

        if "whatsapp" in data.channels:
            if not guest.phone:
                channel_counts["whatsapp"]["skipped_no_contact"] += 1
            elif not guest.whatsapp_consent:
                channel_counts["whatsapp"]["skipped_no_consent"] += 1
            elif await reserve_message_credit(event, "whatsapp", db=db, reason="broadcast", guest_id=guest.id):
                wa_text = channel_text(overrides, "broadcast", "whatsapp", _ctx(guest, guest_message))
                # Freeform content can only initiate WhatsApp via an approved
                # generic announcement template; falls back to free text
                # (session-only) when that template isn't configured.
                background_tasks.add_task(
                    send_with_credit_ledger,
                    last_credit_ledger_id(event),
                    messaging.send_announcement_whatsapp,
                    phone=guest.phone,
                    first_name=guest.first_name,
                    event_name=event.name,
                    message=wa_text if wa_text is not None else guest_message,
                    ticket_url=guest_link or f"{event.checkin_base_url.rstrip('/')}/scan/{guest.qr_token}",
                )
                channel_counts["whatsapp"]["queued"] += 1
                sent_any = True
            else:
                channel_counts["whatsapp"]["skipped_no_credits"] += 1
                credit_blocked = True

        if "mms" in data.channels:
            if not guest.phone:
                channel_counts["mms"]["skipped_no_contact"] += 1
            elif not guest.sms_consent:
                channel_counts["mms"]["skipped_no_consent"] += 1
            elif await reserve_message_credit(event, "mms", db=db, reason="broadcast", guest_id=guest.id):
                mms_text = channel_text_or_default(overrides, "broadcast", "mms", _ctx(guest, guest_message))
                background_tasks.add_task(
                    send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_mms,
                    phone=guest.phone, body=mms_text or guest_message, media_url=data.mms_media_url,
                )
                channel_counts["mms"]["queued"] += 1
                sent_any = True
            else:
                channel_counts["mms"]["skipped_no_credits"] += 1
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

    # Typed-in recipients who aren't on the guest list — same template/overrides,
    # no consent flags to check since the organizer entered them directly here.
    for r in data.extra_recipients:
        name = r.name.strip()
        ctx = build_template_context(event, None, extras={"message": data.message, "guest_first_name": name})
        email_ctx = build_template_context(event, None, extras={"message": _broadcast_message_html(data.message), "guest_first_name": name})
        sent_any = False
        credit_blocked = False
        phone = _normalize_phone(r.phone.strip()) if r.phone else None

        if want_email:
            if r.email and not email_blocked:
                subj, body = email_override(overrides, "broadcast", email_ctx)
                if body is not None:
                    background_tasks.add_task(
                        send_simple_email, str(r.email),
                        subj or message_subject, body, event.id, None, None, f"broadcast_{data.message_type}",
                    )
                else:
                    background_tasks.add_task(
                        send_broadcast_email,
                        email=str(r.email), guest_id=None,
                        first_name=name, message=data.message, event_name=event.name, event_id=event.id,
                    )
                record_free_send(event, "email", reason="broadcast")
                channel_counts["email"]["queued"] += 1
                sent_any = True
            else:
                channel_counts["email"]["skipped_no_contact"] += 1

        if "sms" in data.channels:
            if not phone:
                channel_counts["sms"]["skipped_no_contact"] += 1
            elif await reserve_message_credit(event, "sms", db=db, reason="broadcast"):
                sms_text = channel_text(overrides, "broadcast", "sms", ctx)
                if sms_text is not None:
                    background_tasks.add_task(send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_custom_sms, phone=phone, body=sms_text)
                else:
                    background_tasks.add_task(
                        send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_broadcast_sms,
                        phone=phone, first_name=name, message=data.message,
                    )
                channel_counts["sms"]["queued"] += 1
                sent_any = True
            else:
                channel_counts["sms"]["skipped_no_credits"] += 1
                credit_blocked = True

        if "whatsapp" in data.channels:
            if not phone:
                channel_counts["whatsapp"]["skipped_no_contact"] += 1
            elif await reserve_message_credit(event, "whatsapp", db=db, reason="broadcast"):
                wa_text = channel_text(overrides, "broadcast", "whatsapp", ctx)
                background_tasks.add_task(
                    send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_announcement_whatsapp,
                    phone=phone, first_name=name, event_name=event.name,
                    message=wa_text if wa_text is not None else data.message,
                    ticket_url="",
                )
                channel_counts["whatsapp"]["queued"] += 1
                sent_any = True
            else:
                channel_counts["whatsapp"]["skipped_no_credits"] += 1
                credit_blocked = True

        if "mms" in data.channels:
            if not phone:
                channel_counts["mms"]["skipped_no_contact"] += 1
            elif await reserve_message_credit(event, "mms", db=db, reason="broadcast"):
                mms_text = channel_text_or_default(overrides, "broadcast", "mms", ctx)
                background_tasks.add_task(
                    send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_mms,
                    phone=phone, body=mms_text or data.message, media_url=data.mms_media_url,
                )
                channel_counts["mms"]["queued"] += 1
                sent_any = True
            else:
                channel_counts["mms"]["skipped_no_credits"] += 1
                credit_blocked = True

        if sent_any:
            queued += 1
        elif credit_blocked:
            skipped_no_credits += 1
        else:
            skipped_no_contact += 1

    log = BroadcastLog(
        id=str(_uuid.uuid4()),
        org_id=event.org_id,
        event_id=event.id,
        sent_by_user_id=admin_user.id,
        message=data.message,
        target=data.target,
        channels=data.channels,
        channel_counts=channel_counts,
        queued=queued,
        skipped_no_contact=skipped_no_contact,
        skipped_no_consent=skipped_no_consent,
        skipped_no_credits=skipped_no_credits,
        mms_media_url=data.mms_media_url,
    )
    db.add(log)
    await db.commit()  # persist message-credit decrements + broadcast log
    return BroadcastResult(
        queued=queued,
        skipped_no_contact=skipped_no_contact,
        skipped_no_consent=skipped_no_consent,
        skipped_no_credits=skipped_no_credits,
        broadcast_log_id=log.id,
    )


@router.post("/{event_id}/post-event-thankyou/test-send")
async def test_send_post_event_thankyou(
    event_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Send the real post-event thank-you/feedback message to one real guest,
    right now — for verifying it before relying on the automatic per-event
    send. Body: {guest_id}. Does not require the toggle to be on, and does not
    mark the event as sent (that's the automatic trigger's own guard)."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    guest_id = (data or {}).get("guest_id")
    if not guest_id:
        raise HTTPException(400, "guest_id is required")
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found for this event")
    sent = await post_event_message.send_to_guest(event, guest, db)
    await db.commit()  # persist message-credit decrements + minted invite_token
    if not sent:
        raise HTTPException(
            400,
            "Nothing was sent — this guest has no deliverable channel (missing "
            "email/phone, consent, or the event doesn't have paid SMS/WhatsApp).",
        )
    return {"ok": True, "channels_sent": sent}


@router.post("/{event_id}/post-event-thankyou/send-now")
async def send_now_post_event_thankyou(
    event_id: str,
    data: dict | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_event_admin),
):
    """Send the post-event thank-you/feedback message to the whole configured
    audience right now, instead of waiting for event_end_date + delay_hours.
    Marks the event as sent so the automatic poller doesn't also send it
    later — a manual send-now and the automatic one are mutually exclusive.

    Body: {force: bool} — required to resend once already sent (e.g. testing,
    or a real resend after fixing the template/audience); the frontend makes
    the admin confirm this explicitly rather than silently allowing repeats."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if event.post_event_thankyou_sent_at and not (data or {}).get("force"):
        raise HTTPException(
            400,
            f"Already sent {event.post_event_thankyou_sent_at.isoformat()} — pass force=true to send again.",
        )
    sent = await post_event_message.send_for_event(event, db)
    event.post_event_thankyou_sent_at = datetime.utcnow()
    await db.commit()
    return {"ok": True, "messages_sent": sent}


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
    messaging.set_event_context(event.id)
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
                event_timezone=event.timezone,
            )
            dispatched = True

        if r.phone and paid_channels:
            phone = _normalize_phone(r.phone.strip())
            if phone is None:
                errors.append(f"{name}: invalid phone '{r.phone}'")
            else:
                if "sms" in data.channels and await reserve_message_credit(event, "sms", db=db, reason="manual_invite"):
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
                if "whatsapp" in data.channels and await reserve_message_credit(event, "whatsapp", db=db, reason="manual_invite"):
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

    detected_type = _detected_image_type(data)
    if detected_type != file.content_type:
        if detected_type:
            actual = detected_type.removeprefix("image/").replace("jpeg", "jpg")
            supplied = (file.filename or "the selected file").rsplit(".", 1)[-1].lower()
            raise HTTPException(
                400,
                f"This file contains {actual.upper()} image data but is named .{supplied}. "
                f"Rename or export it as .{actual} and try again.",
            )
        raise HTTPException(400, "This is not a valid JPEG, PNG, WebP, or GIF image. Export it again and retry.")

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
