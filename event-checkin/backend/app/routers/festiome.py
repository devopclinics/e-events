"""GuestHub's narrow, failure-contained contract with FestioMe."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_paid_event_admin
from ..database import get_db
from ..models import Event, EventUser, FestioMeOutbox, Guest, User
from ..services.festiome_client import (
    FestioMeClient,
    FestioMeUnavailable,
    get_festiome_client,
)
from ..services.festiome_outbox import guest_is_festiome_eligible, queue_announcement, queue_guest_sync
from ..entitlements import can_use_paid_channels, last_credit_ledger_id, take_message_credit
from services import messaging
from services.credit_ledger import send_with_credit_ledger
from services.email_service import send_broadcast_email
from ..ratelimit import rate_limit


router = APIRouter()


async def _push_event_staff(db: AsyncSession, event: Event, client: FestioMeClient) -> int:
    """Provision the event's assigned staff into the FestioMe group up front, so
    organizers see them in the roster without waiting for each staffer to log in
    (FestioMe token exchange also provisions them, but only on their own login).

    Best-effort and failure-contained: a FestioMe outage never fails the caller.
    Managers map to moderators; other staff to members. Org owners/admins still
    resolve to group admins when they authenticate.
    """
    if not client.configured:
        return 0
    rows = (await db.execute(
        select(EventUser, User).join(User, User.id == EventUser.user_id)
        .where(EventUser.event_id == event.id)
    )).all()
    pushed = 0
    for event_user, staff in rows:
        role = "moderator" if event_user.event_role == "manager" else "member"
        try:
            result = await client.upsert_user(
                event.id, subject=staff.firebase_uid or staff.id,
                name=staff.name, email=staff.email, role=role,
            )
        except FestioMeUnavailable:
            break
        if not result.get("ignored"):
            pushed += 1
    return pushed


def _require_festiome_addon(event: Event) -> None:
    """FestioMe is a paid add-on. Every endpoint requires the event to have
    opted in via PATCH /events/{id}/features, which is itself plan-gated on
    `festiome_addon_enabled`. This mirrors the logistics/registry/access guards.
    """
    if "festiome" in (event.blocked_comm_features or []):
        raise HTTPException(403, "FestioMe has been disabled for this event by Festio.")
    if not event.festiome_addon_enabled:
        raise HTTPException(400, "FestioMe is not enabled for this event")


class FestioMeStatus(BaseModel):
    configured: bool
    available: bool
    enabled: bool
    festiome_id: str | None = None
    name: str | None = None
    open_url: str | None = None
    detail: str | None = None


class GuestPassExchange(BaseModel):
    pass_token: str = Field(min_length=20, max_length=200)


class FestioMeGuestSession(BaseModel):
    token: str
    expires_at: str
    open_url: str | None = None


class AnnouncementRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=10000)
    kind: str = Field(default="event", pattern="^(event|schedule|experience|urgent)$")
    urgent: bool = False
    escalation_channels: list[Literal["email", "sms", "mms", "whatsapp"]] = Field(default_factory=list)
    escalation_media_url: str | None = Field(default=None, max_length=2048)


class OutboxStatus(BaseModel):
    pending: int = 0
    retry: int = 0
    failed: int = 0
    delivered: int = 0


class SubGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)
    join_policy: Literal["closed", "request", "open"] = "request"
    visibility: Literal["listed", "unlisted"] = "listed"
    rules: str = Field(default="", max_length=10000)


class SubGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    join_policy: Literal["closed", "request", "open"] | None = None
    visibility: Literal["listed", "unlisted"] | None = None
    rules: str | None = Field(default=None, max_length=10000)
    archived: bool | None = None


class JoinRequestDecision(BaseModel):
    role: Literal["moderator", "member", "readonly"] = "member"


@router.get("/{event_id}/festiome/status", response_model=FestioMeStatus)
async def festiome_status(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
    client: FestioMeClient = Depends(get_festiome_client),
):
    """Report FestioMe state without making GuestHub health depend on it.

    This is a read-only status probe the Admin UI polls to decide whether to show
    the enable/open affordance, so it must NOT hard-fail on the add-on gate — it
    reports `enabled=False` when the add-on is off instead of 400ing.
    """
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if not event.festiome_addon_enabled:
        return FestioMeStatus(
            configured=client.configured, available=False, enabled=False,
            detail="The FestioMe add-on is not enabled for this event.",
        )
    if not client.configured:
        return FestioMeStatus(
            configured=False, available=False, enabled=False,
            detail="FestioMe integration is not configured.",
        )
    try:
        link = await client.event_status(event_id)
    except FestioMeUnavailable:
        return FestioMeStatus(
            configured=True, available=False, enabled=event.festiome_enabled,
            festiome_id=event.festiome_id, open_url=event.festiome_open_url,
            detail="FestioMe is temporarily unavailable. GuestHub is unaffected.",
        )
    event.festiome_enabled = link.enabled
    event.festiome_id = link.festiome_id
    event.festiome_open_url = link.open_url
    event.festiome_last_error = None
    await db.commit()
    return FestioMeStatus(
        configured=True,
        available=True,
        enabled=link.enabled,
        festiome_id=link.festiome_id,
        name=link.name,
        open_url=link.open_url,
    )


@router.post("/{event_id}/festiome/enable", response_model=FestioMeStatus)
async def enable_festiome(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_paid_event_admin),
    client: FestioMeClient = Depends(get_festiome_client),
):
    """Idempotently enable FestioMe for an event through the service API."""
    event = await db.get(Event, event_id)
    if not event:  # require_paid_event_admin normally handles this first.
        raise HTTPException(404, "Event not found")
    _require_festiome_addon(event)
    if not client.configured:
        raise HTTPException(503, "FestioMe integration is not configured")
    try:
        link = await client.enable_for_event(
            external_event_ref=event.id,
            external_org_ref=event.org_id,
            name=event.name,
            owner_subject=user.firebase_uid or user.id,
            owner_name=user.name,
            owner_email=user.email,
        )
    except FestioMeUnavailable as exc:
        # This failure is confined to the explicit enable action. No event state
        # is changed, so it is safe for the organizer to retry.
        raise HTTPException(503, str(exc)) from exc
    event.festiome_enabled = link.enabled
    event.festiome_id = link.festiome_id
    event.festiome_open_url = link.open_url
    event.festiome_last_error = None
    # Initial membership sync is durable and non-blocking. FestioMe may go down
    # immediately after provisioning without affecting this request or GuestHub.
    guests = (await db.execute(select(Guest).where(Guest.event_id == event_id))).scalars().all()
    revision = f"enable:{link.festiome_id}:{datetime.utcnow().isoformat(timespec='microseconds')}"
    for guest in guests:
        queue_guest_sync(db, guest, event=event, revision=revision)
    await db.commit()
    await _push_event_staff(db, event, client)
    return FestioMeStatus(
        configured=True,
        available=True,
        enabled=link.enabled,
        festiome_id=link.festiome_id,
        name=link.name,
        open_url=link.open_url,
    )


@router.post("/{event_id}/festiome/guest-token", response_model=FestioMeGuestSession)
async def exchange_guest_pass(
    event_id: str,
    data: GuestPassExchange,
    db: AsyncSession = Depends(get_db),
    client: FestioMeClient = Depends(get_festiome_client),
    _: None = Depends(rate_limit(limit=120, window=60, scope="festiome_guest_token", key="event_id")),
):
    """Exchange an eligible guest pass for a scoped FestioMe session.

    Confirmed guests are eligible. For events with no RSVP step, imported
    invitees are eligible as well. The pass itself is never forwarded or
    persisted by FestioMe; declined, pending, deleted, and cross-event passes
    are rejected.
    """
    guest = await db.scalar(
        select(Guest).where(Guest.event_id == event_id, Guest.qr_token == data.pass_token).limit(1)
    )
    if not guest:
        raise HTTPException(404, "Eligible guest pass not found")
    event = await db.get(Event, event_id)
    if not event or event.status == "ended":
        raise HTTPException(410, "This event has ended")
    if not guest_is_festiome_eligible(guest, event):
        raise HTTPException(404, "Eligible guest pass not found")
    _require_festiome_addon(event)
    if not client.configured:
        raise HTTPException(503, "FestioMe integration is not configured")
    try:
        session = await client.guest_token(
            event_id,
            guest_ref=guest.id,
            name=f"{guest.first_name} {guest.last_name}".strip(),
            email=guest.email,
        )
        link = await client.event_status(event_id)
    except FestioMeUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    return FestioMeGuestSession(
        token=session["token"], expires_at=str(session["expires_at"]), open_url=link.open_url,
    )


@router.post("/{event_id}/festiome/sync-guests", status_code=202)
async def reconcile_festiome_guests(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
    client: FestioMeClient = Depends(get_festiome_client),
):
    """Queue a full idempotent membership reconciliation for an event, and push
    assigned staff into the group so they appear in the roster immediately."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _require_festiome_addon(event)
    guests = (await db.execute(select(Guest).where(Guest.event_id == event_id))).scalars().all()
    revision = f"reconcile:{datetime.utcnow().isoformat(timespec='microseconds')}"
    for guest in guests:
        queue_guest_sync(db, guest, event=event, revision=revision)
    await db.commit()
    staff = await _push_event_staff(db, event, client)
    return {"queued": len(guests), "staff_synced": staff}


@router.post("/{event_id}/festiome/announcements", status_code=202)
async def publish_festiome_announcement(
    event_id: str,
    data: AnnouncementRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _require_festiome_addon(event)
    row = queue_announcement(
        db, event_id=event_id, title=data.title.strip(), body=data.body.strip(),
        kind=data.kind, urgent=data.urgent,
    )
    escalation_queued = 0
    if data.escalation_channels:
        if not data.urgent:
            raise HTTPException(400, "External escalation is only available for urgent announcements")
        paid_escalations = set(data.escalation_channels) & {"sms", "mms", "whatsapp"}
        if paid_escalations and not can_use_paid_channels(event):
            raise HTTPException(402, "SMS/MMS/WhatsApp escalation requires an Event Pass")
        if "mms" in data.escalation_channels and not data.escalation_media_url:
            raise HTTPException(400, "MMS escalation requires escalation_media_url")
        if data.escalation_media_url and not data.escalation_media_url.lower().startswith("https://"):
            raise HTTPException(400, "escalation_media_url must use HTTPS")
        all_guests = (await db.execute(select(Guest).where(Guest.event_id == event_id))).scalars().all()
        guests = [guest for guest in all_guests if guest_is_festiome_eligible(guest, event)]
        escalation_text = f"{data.title.strip()}: {data.body.strip()}"
        for guest in guests:
            if "email" in data.escalation_channels and guest.email:
                background_tasks.add_task(
                    send_broadcast_email,
                    email=guest.email,
                    first_name=guest.first_name,
                    message=escalation_text,
                    event_name=event.name,
                    event_id=event.id,
                )
                escalation_queued += 1
            if not guest.phone:
                continue
            if "sms" in data.escalation_channels and guest.sms_consent:
                if take_message_credit(event, "sms", reason="festiome_urgent", guest_id=guest.id):
                    background_tasks.add_task(
                        send_with_credit_ledger, last_credit_ledger_id(event),
                        messaging.send_custom_sms, phone=guest.phone, body=escalation_text,
                    )
                    escalation_queued += 1
            if "mms" in data.escalation_channels and guest.sms_consent:
                if take_message_credit(event, "mms", reason="festiome_urgent", guest_id=guest.id):
                    background_tasks.add_task(
                        send_with_credit_ledger, last_credit_ledger_id(event),
                        messaging.send_mms, phone=guest.phone, body=escalation_text,
                        media_url=data.escalation_media_url,
                    )
                    escalation_queued += 1
            if "whatsapp" in data.escalation_channels and guest.whatsapp_consent:
                if take_message_credit(event, "whatsapp", reason="festiome_urgent", guest_id=guest.id):
                    # Freeform urgent notice → approved announcement template
                    # (falls back to session-only free text if unconfigured).
                    background_tasks.add_task(
                        send_with_credit_ledger, last_credit_ledger_id(event),
                        messaging.send_announcement_whatsapp,
                        phone=guest.phone, first_name=guest.first_name,
                        event_name=event.name, message=escalation_text,
                        ticket_url=f"{event.checkin_base_url.rstrip('/')}/scan/{guest.qr_token}",
                    )
                    escalation_queued += 1
    await db.commit()
    return {"queued": True, "command_id": row.id, "escalation_queued": escalation_queued}


@router.get("/{event_id}/festiome/sync-status", response_model=OutboxStatus)
async def festiome_sync_status(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _require_festiome_addon(event)
    rows = (await db.execute(
        select(FestioMeOutbox.status, func.count(FestioMeOutbox.id))
        .where(FestioMeOutbox.event_id == event_id)
        .group_by(FestioMeOutbox.status)
    )).all()
    return OutboxStatus(**{status: count for status, count in rows if status in OutboxStatus.model_fields})


# ── Organizer group management ───────────────────────────────────────────────
# Sub-groups and join-request moderation, gated behind the paid FestioMe add-on.
# These proxy to FestioMe's internal admin API so any event admin can manage
# groups without holding a personal FestioMe login.

async def _gated_event(db: AsyncSession, event_id: str, client: FestioMeClient) -> Event:
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    _require_festiome_addon(event)
    if not client.configured:
        raise HTTPException(503, "FestioMe integration is not configured")
    return event


@router.get("/{event_id}/festiome/groups")
async def list_festiome_groups(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
    client: FestioMeClient = Depends(get_festiome_client),
):
    event = await _gated_event(db, event_id, client)
    try:
        return await client.list_subgroups(event.id)
    except FestioMeUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/{event_id}/festiome/groups", status_code=201)
async def create_festiome_group(
    event_id: str,
    data: SubGroupCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
    client: FestioMeClient = Depends(get_festiome_client),
):
    event = await _gated_event(db, event_id, client)
    try:
        return await client.create_subgroup(
            event.id, name=data.name.strip(), description=data.description.strip(),
            join_policy=data.join_policy, visibility=data.visibility, rules=data.rules.strip(),
        )
    except FestioMeUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


@router.patch("/{event_id}/festiome/groups/{group_id}")
async def update_festiome_group(
    event_id: str,
    group_id: str,
    data: SubGroupUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
    client: FestioMeClient = Depends(get_festiome_client),
):
    event = await _gated_event(db, event_id, client)
    patch = data.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(400, "No changes supplied")
    try:
        return await client.update_subgroup(event.id, group_id, patch)
    except FestioMeUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/{event_id}/festiome/groups/{group_id}/join-requests")
async def list_festiome_join_requests(
    event_id: str,
    group_id: str,
    status: str = "pending",
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
    client: FestioMeClient = Depends(get_festiome_client),
):
    event = await _gated_event(db, event_id, client)
    try:
        return await client.list_join_requests(event.id, group_id, status=status)
    except FestioMeUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/{event_id}/festiome/groups/{group_id}/join-requests/{request_id}/approve")
async def approve_festiome_join_request(
    event_id: str,
    group_id: str,
    request_id: str,
    data: JoinRequestDecision,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
    client: FestioMeClient = Depends(get_festiome_client),
):
    event = await _gated_event(db, event_id, client)
    try:
        return await client.approve_join_request(event.id, group_id, request_id, role=data.role)
    except FestioMeUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/{event_id}/festiome/groups/{group_id}/join-requests/{request_id}/deny", status_code=204)
async def deny_festiome_join_request(
    event_id: str,
    group_id: str,
    request_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
    client: FestioMeClient = Depends(get_festiome_client),
):
    event = await _gated_event(db, event_id, client)
    try:
        await client.deny_join_request(event.id, group_id, request_id)
    except FestioMeUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
