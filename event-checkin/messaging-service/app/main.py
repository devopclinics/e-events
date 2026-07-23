import asyncio
import json
import logging
import os
import random
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import firebase_admin
from firebase_admin import auth as firebase_auth, credentials
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

logger = logging.getLogger("messaging-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://checkin:checkin@db/checkin"
    redis_url: str = "redis://redis:6379/0"
    frontend_url: str = "http://localhost:5173"
    firebase_credentials: str = ""
    superadmin_emails: str = ""
    messaging_enabled: bool = True
    guest_hub_enabled: bool = True
    announcements_enabled: bool = True
    direct_host_messages_enabled: bool = True
    event_chat_enabled: bool = False
    realtime_messaging_enabled: bool = False
    message_max_length: int = 1000
    announcement_max_length: int = 5000
    guest_message_rate_limit: int = 10
    guest_chat_rate_limit: int = 20
    guest_query_token_fallback_enabled: bool = True
    # Web Push is disabled unless all VAPID settings are present. The private
    # key stays in the server secret; the public key is returned only to an
    # authenticated guest Hub session when it is time to subscribe.
    web_push_enabled: bool = False
    web_push_vapid_public_key: str = ""
    web_push_vapid_private_key: str = ""
    web_push_vapid_subject: str = "mailto:events@festio.events"
    # FCM (native mobile push) reuses the same firebase_credentials service
    # account already initialized below for Firebase Auth — Admin SDK
    # credentials cover both Auth and Cloud Messaging, so no separate
    # FCM-specific credential is needed, just this kill switch. Defaults off;
    # staging-only until Phase 1-7 of the FCM backlog are built and tested.
    fcm_enabled: bool = False
    # Shared secret for server-to-server calls (e.g. backend posting a
    # denied-scan staff alert) — empty by default, which makes the internal
    # endpoint reject everything until explicitly configured.
    internal_service_token: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
bearer = HTTPBearer(auto_error=False)
redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
_firebase_app = None
_rate_buckets: dict[str, list[float]] = {}
_RATE_BUCKET_MAX_KEYS = 20000


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255))
    firebase_uid: Mapped[str | None] = mapped_column(String(128))
    is_platform_superadmin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Membership(Base):
    __tablename__ = "memberships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(20))


class EventUser(Base):
    """Mirrors the main backend's event_users junction table — a per-event
    manager grant for users who aren't org owner/admin (see app/models.py)."""
    __tablename__ = "event_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    event_role: Mapped[str] = mapped_column(String(30), default="staff")
    access_level: Mapped[str] = mapped_column(String(20), default="edit")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String(255))
    event_date: Mapped[datetime] = mapped_column(DateTime)
    # IANA timezone (e.g. "Africa/Lagos"). Without this, FestioHub falls back
    # to each guest's own browser timezone to format event_date and program
    # segment times — silently wrong for anyone not in the organizer's zone.
    timezone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    rsvp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    experience_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Organizer-facing add-on switch. `festiome_enabled` below only records
    # whether a remote FestioMe group has already been provisioned.
    festiome_addon_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    festiome_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    checkout_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    venue_name: Mapped[str | None] = mapped_column(String(255))
    admission_note: Mapped[str | None] = mapped_column(Text)
    # Platform-superadmin hard block (set from the backend console). Lists comm
    # features the operator has disabled for this event: guest_hub / guest_chat /
    # host_messages / announcements / festiome. Organizers cannot override it.
    blocked_comm_features: Mapped[list | None] = mapped_column(JSON, nullable=True)


def _comm_blocked(event: "Event | None", feature: str) -> bool:
    return bool(event and feature in (event.blocked_comm_features or []))


def festiome_available(event: "Event | None") -> bool:
    """Expose FestioMe only while its event add-on is currently enabled."""
    return bool(
        event
        and event.festiome_addon_enabled
        and event.festiome_enabled
        and not _comm_blocked(event, "festiome")
    )


class SeatingTable(Base):
    __tablename__ = "seating_tables"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(100))


class Guest(Base):
    __tablename__ = "guests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    qr_token: Mapped[str] = mapped_column(String(36))
    invite_token: Mapped[str | None] = mapped_column(String(36))
    rsvp_status: Mapped[str] = mapped_column(String(20))
    admitted: Mapped[bool] = mapped_column(Boolean, default=False)
    table_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("seating_tables.id"))
    seat_number: Mapped[str | None] = mapped_column(String(20))


class GuestTagLink(Base):
    __tablename__ = "guest_tag_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"))
    tag_id: Mapped[str] = mapped_column(String(36))


class ScanEvent(Base):
    """Read-only subset of the backend's scan_events — used to surface check-out."""
    __tablename__ = "scan_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"))
    zone_id: Mapped[str | None] = mapped_column(String(36))
    direction: Mapped[str | None] = mapped_column(String(10))
    denied: Mapped[bool] = mapped_column(Boolean, default=False)
    scanned_at: Mapped[datetime] = mapped_column(DateTime)


class EventGuestMessagingSettings(Base):
    __tablename__ = "event_guest_messaging_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    guest_hub_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    announcements_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    direct_host_messages_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    guest_chat_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    guest_chat_posting_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    attending_only_chat: Mapped[bool] = mapped_column(Boolean, default=True)
    staff_operational_alerts_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    quiet_hours_start: Mapped[str | None] = mapped_column(String(5))
    quiet_hours_end: Mapped[str | None] = mapped_column(String(5))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PushPreference(Base):
    """Per-actor, per-category push opt-out. Mirrors backend/app/models.py::PushPreference."""
    __tablename__ = "push_preferences"
    __table_args__ = (
        UniqueConstraint("event_id", "actor_type", "actor_id", "category", name="uq_push_preference_actor_category"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    actor_type: Mapped[str] = mapped_column(String(20), index=True)
    actor_id: Mapped[str] = mapped_column(String(36), index=True)
    category: Mapped[str] = mapped_column(String(30))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EventMessageThread(Base):
    __tablename__ = "event_message_threads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    thread_type: Mapped[str] = mapped_column(String(30))
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"))
    title: Mapped[str | None] = mapped_column(String(255))
    created_by_type: Mapped[str] = mapped_column(String(30), default="system")
    created_by_id: Mapped[str | None] = mapped_column(String(36))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EventMessage(Base):
    __tablename__ = "event_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    thread_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("event_message_threads.id"))
    sender_type: Mapped[str] = mapped_column(String(30))
    sender_id: Mapped[str | None] = mapped_column(String(36))
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"))
    message_type: Mapped[str] = mapped_column(String(30))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active")
    message_metadata: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EventAnnouncement(Base):
    __tablename__ = "event_announcements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    audience_type: Mapped[str] = mapped_column(String(40), default="attending_only")
    audience_filter: Mapped[dict | None] = mapped_column(JSON)
    send_in_app: Mapped[bool] = mapped_column(Boolean, default=True)
    send_email: Mapped[bool] = mapped_column(Boolean, default=False)
    send_sms: Mapped[bool] = mapped_column(Boolean, default=False)
    send_whatsapp: Mapped[bool] = mapped_column(Boolean, default=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_by: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EventMessageDeliveryLog(Base):
    __tablename__ = "event_message_delivery_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    message_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("event_messages.id"))
    announcement_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("event_announcements.id"))
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"))
    channel: Mapped[str] = mapped_column(String(30), default="in_app")
    recipient: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(30), default="pending")
    provider: Mapped[str | None] = mapped_column(String(60))
    provider_message_id: Mapped[str | None] = mapped_column(String(255))
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GuestPushSubscription(Base):
    """One browser/device push endpoint, owned by a guest for one event.

    Endpoints are opaque provider URLs and are never returned to the browser.
    An endpoint can move to a different guest only when that browser explicitly
    subscribes again using that guest's personal Hub link.
    """
    __tablename__ = "guest_push_subscriptions"
    __table_args__ = (UniqueConstraint("endpoint", name="uq_guest_push_subscription_endpoint"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    endpoint: Mapped[str] = mapped_column(Text)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FcmDeviceToken(Base):
    """A registered Firebase Cloud Messaging device token — actor-agnostic
    (guest or staff), unlike GuestPushSubscription which is guest-only Web
    Push. Mirrors backend/app/models.py::FcmDeviceToken; backend owns table
    creation via db_migrate.py, this is the read/write mirror.
    """
    __tablename__ = "fcm_device_tokens"
    __table_args__ = (UniqueConstraint("token", name="uq_fcm_device_token_token"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    actor_type: Mapped[str] = mapped_column(String(20), index=True)
    actor_id: Mapped[str] = mapped_column(String(36), index=True)
    platform: Mapped[str] = mapped_column(String(20))
    token: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    device_metadata: Mapped[dict | None] = mapped_column(JSON)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PushOutbox(Base):
    """Durable, retryable push-send jobs. Mirrors backend/app/models.py::PushOutbox;
    backend owns table creation via db_migrate.py, this is the read/write mirror."""
    __tablename__ = "push_outbox"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_push_outbox_idempotency"),
        Index("ix_push_outbox_due", "status", "next_attempt_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    channel: Mapped[str] = mapped_column(String(20), index=True)
    target_id: Mapped[str] = mapped_column(String(36))
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    message_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("event_messages.id"))
    announcement_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("event_announcements.id"))
    idempotency_key: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_error: Mapped[str | None] = mapped_column(Text)
    provider_message_id: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime)


async def get_db():
    async with SessionLocal() as session:
        yield session


def _ensure_enabled():
    if not settings.messaging_enabled:
        raise HTTPException(503, "Messaging is disabled")


def _clean(text: str, limit: int) -> str:
    body = " ".join((text or "").strip().split())
    if not body:
        raise HTTPException(422, "Message cannot be empty")
    if len(body) > limit:
        raise HTTPException(422, f"Message is too long. Limit is {limit} characters.")
    return body


def _display_name(guest: Guest) -> str:
    initial = f" {guest.last_name[:1]}." if guest.last_name else ""
    return f"{guest.first_name}{initial}".strip() or "Guest"


def _superadmin_emails() -> set[str]:
    return {e.strip().lower() for e in (settings.superadmin_emails or "").split(",") if e.strip()}


def _ensure_firebase():
    global _firebase_app
    if _firebase_app is not None:
        return
    if not settings.firebase_credentials:
        raise HTTPException(503, "Firebase not configured")
    _firebase_app = firebase_admin.initialize_app(credentials.Certificate(json.loads(settings.firebase_credentials)))


async def current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    _ensure_firebase()
    try:
        decoded = await asyncio.to_thread(firebase_auth.verify_id_token, creds.credentials)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    firebase_uid = decoded["uid"]
    email = (decoded.get("email") or "").lower()
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_uid))
    if not user and email:
        user = await db.scalar(select(User).where(User.email == email))
    if not user or not user.is_active:
        raise HTTPException(403, "Access denied")
    if email in _superadmin_emails() and not user.is_platform_superadmin:
        user.is_platform_superadmin = True
        await db.commit()
        await db.refresh(user)
    return user


async def require_event_admin(
    event_id: str, user: User, db: AsyncSession, request: Request | None = None
) -> Event:
    """Org owner/admin, or an assigned event manager (EventUser.event_role
    == 'manager'), matching the main backend's require_event_admin. Without
    this per-event check, a manager granted access to just this one event
    (not an org owner/admin) was always blocked here with a 403, even though
    every other admin panel correctly recognized their grant."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin:
        return event
    role = await db.scalar(
        select(Membership.role)
        .join(Organization, Organization.id == Membership.org_id)
        .where(
            Membership.user_id == user.id,
            Membership.org_id == event.org_id,
            Organization.is_active.is_(True),
        )
    )
    if role is None:
        raise HTTPException(404, "Event not found")
    if role not in ("owner", "admin"):
        eu = await db.scalar(select(EventUser).where(
            EventUser.event_id == event_id, EventUser.user_id == user.id
        ))
        if not eu or eu.event_role != "manager":
            raise HTTPException(403, "Admin access required")
        if (eu.access_level or "edit") != "edit" and request is not None and request.method not in ("GET", "HEAD", "OPTIONS"):
            raise HTTPException(403, "This event access is view-only.")
    return event


async def guest_by_token(event_id: str, token: str, db: AsyncSession) -> Guest:
    guest = await db.scalar(
        select(Guest).where(
            Guest.event_id == event_id,
            or_(Guest.invite_token == token, Guest.qr_token == token),
        )
    )
    if not guest:
        raise HTTPException(404, "Guest access not found")
    return guest


def _guest_access_token(
    query_token: str | None,
    creds: HTTPAuthorizationCredentials | None,
) -> str:
    # Prefer Authorization header to keep guest tokens out of URL logs.
    if creds and creds.credentials and creds.scheme.lower() == "bearer":
        token = creds.credentials.strip()
        if token:
            return token
    if query_token:
        token = query_token.strip()
        if token:
            if settings.guest_query_token_fallback_enabled:
                logger.warning("guest_query_token_fallback_used")
                return token
            raise HTTPException(401, "Guest access token must be sent in Authorization: Bearer <token>")
    raise HTTPException(401, "Guest access token is required")


def guest_is_attending(guest: Guest, event: Event | None) -> bool:
    """Treat imported invitees as attendees when an event has no RSVP step."""
    return guest.rsvp_status == "confirmed" or bool(
        event and not event.rsvp_enabled and guest.rsvp_status == "invited"
    )


def require_hub_guest(guest: Guest, event: Event | None):
    event_allows_experience = bool(event and event.experience_enabled)
    if not guest_is_attending(guest, event) and not event_allows_experience:
        raise HTTPException(403, "FestioHub is available after your RSVP is accepted.")


async def get_settings(event_id: str, db: AsyncSession) -> EventGuestMessagingSettings:
    row = await db.scalar(select(EventGuestMessagingSettings).where(EventGuestMessagingSettings.event_id == event_id))
    if row:
        return row
    row = EventGuestMessagingSettings(
        event_id=event_id,
        guest_hub_enabled=settings.guest_hub_enabled,
        announcements_enabled=settings.announcements_enabled,
        direct_host_messages_enabled=settings.direct_host_messages_enabled,
        guest_chat_enabled=settings.event_chat_enabled,
    )
    db.add(row)
    await db.flush()
    return row


async def _rate_limit(key: str, limit: int, window_seconds: int = 300):
    try:
        value = await redis_client.incr(f"msg-rate:{key}")
        if value == 1:
            await redis_client.expire(f"msg-rate:{key}", window_seconds)
        if value > limit:
            raise HTTPException(429, "Too many messages. Please wait a few minutes.")
        return
    except HTTPException:
        raise
    except Exception:
        # Keep service available if Redis is temporarily unavailable.
        pass

    now = time.time()
    bucket = [t for t in _rate_buckets.get(key, []) if now - t < window_seconds]
    if len(bucket) >= limit:
        raise HTTPException(429, "Too many messages. Please wait a few minutes.")
    bucket.append(now)
    _rate_buckets[key] = bucket
    # This in-process path is only a fallback while Redis is down. Bound its
    # memory: once the map is large, evict keys whose windows have fully expired
    # (one-shot guest ids from key churn) so a long outage can't grow it forever.
    if len(_rate_buckets) > _RATE_BUCKET_MAX_KEYS:
        for stale in [k for k, v in _rate_buckets.items() if not v or now - v[-1] >= window_seconds]:
            _rate_buckets.pop(stale, None)


async def _audience_filter(announcement: EventAnnouncement):
    where = [Guest.event_id == announcement.event_id]
    audience = announcement.audience_type or "attending_only"
    filters = announcement.audience_filter or {}
    if audience == "attending_only":
        where.append(Guest.rsvp_status == "confirmed")
    elif audience == "declined_only":
        where.append(Guest.rsvp_status == "declined")
    elif audience == "checked_in_only":
        where.append(Guest.admitted.is_(True))
    elif audience == "not_checked_in":
        where.append(Guest.admitted.is_(False))
    elif audience == "table":
        where.append(Guest.table_id == filters.get("table_id"))
    elif audience == "tag":
        return select(Guest).join(GuestTagLink, GuestTagLink.guest_id == Guest.id).where(
            Guest.event_id == announcement.event_id,
            GuestTagLink.tag_id == filters.get("tag_id"),
        )
    return select(Guest).where(and_(*where))


async def _announcement_visible(announcement: EventAnnouncement, guest: Guest, db: AsyncSession) -> bool:
    ids = (await db.execute((await _audience_filter(announcement)).with_only_columns(Guest.id))).scalars().all()
    return guest.id in set(ids)


def _web_push_configured() -> bool:
    return bool(
        settings.web_push_enabled
        and settings.web_push_vapid_public_key
        and settings.web_push_vapid_private_key
    )


def _fcm_configured() -> bool:
    """FCM (native mobile push) is a separate kill switch from Web Push —
    both can be on at once, one per client type. Reuses the same
    _firebase_app already initialized for Firebase Auth (see startup below);
    no separate FCM credential to configure or rotate."""
    return bool(settings.fcm_enabled and settings.firebase_credentials)


def _subscription_url_for(guest: Guest) -> str:
    token = guest.invite_token or guest.qr_token
    return f"{settings.frontend_url.rstrip('/')}/r/{token}#guest-hub"


def _web_push_status(exc: Exception) -> int | None:
    response = getattr(exc, "response", None)
    return getattr(response, "status_code", None) if response is not None else None


def _deliver_web_push(subscription: GuestPushSubscription, payload: dict[str, str]) -> None:
    """Send one encrypted Web Push payload without ever logging its endpoint."""
    from pywebpush import webpush

    webpush(
        subscription_info={
            "endpoint": subscription.endpoint,
            "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
        },
        data=json.dumps(payload),
        vapid_private_key=settings.web_push_vapid_private_key,
        vapid_claims={"sub": settings.web_push_vapid_subject},
        ttl=300,
    )


def _fcm_invalid_token(exc: Exception) -> bool:
    """True when the error means this specific token is permanently dead
    (app uninstalled/token expired, or registered under a different Firebase
    sender) — the token should be marked invalid, not retried. Any other
    error (quota, transient network, internal) is retryable."""
    from firebase_admin import messaging as fcm_messaging
    return isinstance(exc, (fcm_messaging.UnregisteredError, fcm_messaging.SenderIdMismatchError))


def _deliver_fcm(token: str, payload: dict[str, str]) -> str:
    """Send one FCM push. Returns the provider message id. Raises on
    failure — callers classify permanent vs. retryable via _fcm_invalid_token."""
    from firebase_admin import messaging as fcm_messaging
    _ensure_firebase()
    message = fcm_messaging.Message(
        token=token,
        notification=fcm_messaging.Notification(
            title=(payload.get("title") or "")[:255], body=(payload.get("body") or "")[:1000],
        ),
        data={"url": payload.get("url") or ""},
    )
    return fcm_messaging.send(message, app=_firebase_app)


# ── push outbox: durable, retryable delivery (mirrors backend's festiome_outbox) ─
# messaging-service has no queue broker (none exists anywhere in this codebase);
# a DB-backed outbox + bounded tick worker is the established pattern instead.

PUSH_TICK_SECONDS = 5
PUSH_MAX_ATTEMPTS = 10


def _push_backoff_seconds(attempts: int, base_cap: int = 900) -> int:
    """Exponential backoff with equal jitter — same shape as festiome_outbox's,
    so a provider outage's retries don't all stampede back in lockstep."""
    base = min(base_cap, 2 ** min(attempts, 9))
    return int(base / 2 + random.uniform(0, base / 2))


def queue_push_job(
    db: AsyncSession, *, event_id: str, channel: str, target_id: str, payload: dict[str, Any],
    guest_id: str | None = None, message_id: str | None = None, announcement_id: str | None = None,
    idempotency_key: str,
) -> None:
    """Queue a push send. Caller commits in the same transaction as whatever
    triggered it (an announcement publish, a chat reply), so the job is
    durable even if the process crashes right after."""
    db.add(PushOutbox(
        event_id=event_id, channel=channel, target_id=target_id, guest_id=guest_id,
        message_id=message_id, announcement_id=announcement_id,
        idempotency_key=idempotency_key, payload=payload,
    ))


async def _deliver_push_outbox_row(row: PushOutbox) -> str | None:
    if row.channel == "fcm":
        return await asyncio.to_thread(_deliver_fcm, row.payload["token"], row.payload)
    if row.channel == "web_push":
        sub_info = {"endpoint": row.payload["endpoint"], "keys": {"p256dh": row.payload["p256dh"], "auth": row.payload["auth"]}}

        def _send():
            from pywebpush import webpush
            webpush(
                subscription_info=sub_info,
                data=json.dumps({"title": row.payload.get("title"), "body": row.payload.get("body"), "url": row.payload.get("url")}),
                vapid_private_key=settings.web_push_vapid_private_key,
                vapid_claims={"sub": settings.web_push_vapid_subject},
                ttl=300,
            )
        await asyncio.to_thread(_send)
        return None
    raise ValueError(f"Unknown push outbox channel: {row.channel}")


async def process_due_push(*, limit: int = 50) -> int:
    delivered = 0
    async with SessionLocal() as db:
        rows = (await db.execute(
            select(PushOutbox)
            .where(PushOutbox.status.in_(["pending", "retry"]), PushOutbox.next_attempt_at <= datetime.utcnow())
            .order_by(PushOutbox.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )).scalars().all()
        for row in rows:
            try:
                provider_message_id = await _deliver_push_outbox_row(row)
            except Exception as exc:
                permanent = row.channel == "fcm" and _fcm_invalid_token(exc)
                if permanent:
                    token_row = await db.get(FcmDeviceToken, row.target_id)
                    if token_row:
                        token_row.status = "invalid"
                        token_row.revoked_at = datetime.utcnow()
                    row.status = "invalid_token"
                else:
                    row.attempts += 1
                    row.status = "failed" if row.attempts >= PUSH_MAX_ATTEMPTS else "retry"
                    row.next_attempt_at = datetime.utcnow() + timedelta(seconds=_push_backoff_seconds(row.attempts))
                row.last_error = str(exc)[:2000]
                db.add(EventMessageDeliveryLog(
                    event_id=row.event_id, message_id=row.message_id, announcement_id=row.announcement_id,
                    guest_id=row.guest_id, channel=row.channel, status=row.status, provider=row.channel,
                    error_message=row.last_error,
                ))
                logger.info("push_outbox_delivery_failed channel=%s status=%s permanent=%s", row.channel, row.status, permanent)
            else:
                row.status = "delivered"
                row.delivered_at = datetime.utcnow()
                row.last_error = None
                row.provider_message_id = provider_message_id
                db.add(EventMessageDeliveryLog(
                    event_id=row.event_id, message_id=row.message_id, announcement_id=row.announcement_id,
                    guest_id=row.guest_id, channel=row.channel, status="sent", provider=row.channel,
                    provider_message_id=provider_message_id,
                ))
                delivered += 1
        await db.commit()
    return delivered


async def run_push_outbox() -> None:
    logger.info("push_outbox started")
    while True:
        try:
            await process_due_push()
        except Exception:
            logger.exception("push_outbox tick crashed")
        await asyncio.sleep(PUSH_TICK_SECONDS)


def _in_quiet_hours(event: Event, cfg: EventGuestMessagingSettings) -> bool:
    """Non-urgent push is suppressed inside this window, evaluated in the
    event's own timezone (not the server's, not the recipient's browser)."""
    if not cfg.quiet_hours_start or not cfg.quiet_hours_end or not event.timezone:
        return False
    try:
        from zoneinfo import ZoneInfo
        now_local = datetime.now(ZoneInfo(event.timezone)).time()
        start = datetime.strptime(cfg.quiet_hours_start, "%H:%M").time()
        end = datetime.strptime(cfg.quiet_hours_end, "%H:%M").time()
    except Exception:
        return False
    if start <= end:
        return start <= now_local < end
    return now_local >= start or now_local < end  # window wraps past midnight


async def _preference_allows(
    db: AsyncSession, *, event_id: str, actor_type: str, actor_id: str, category: str,
) -> bool:
    """Opt-out model: no row means the (enabled) default."""
    pref = await db.scalar(select(PushPreference).where(
        PushPreference.event_id == event_id, PushPreference.actor_type == actor_type,
        PushPreference.actor_id == actor_id, PushPreference.category == category,
    ))
    return pref is None or pref.enabled


async def _rate_limit_push(key: str, limit: int, window_seconds: int) -> bool:
    """Non-raising throttle check for background push dispatch (there's no
    request/response to attach an HTTPException to here). Fails open on a
    Redis outage — a broker blip must not silently drop legitimate push."""
    try:
        value = await redis_client.incr(f"msg-rate:{key}")
        if value == 1:
            await redis_client.expire(f"msg-rate:{key}", window_seconds)
        return value <= limit
    except Exception:
        return True


async def send_event_push(
    *,
    event_id: str,
    guest_ids: list[str],
    title: str,
    body: str,
    message_id: str | None = None,
    announcement_id: str | None = None,
    category: str = "announcement",
    urgent: bool = False,
) -> None:
    """Best-effort delivery for organizer announcements and direct replies.

    The source message remains in FestioHub even if a browser or push provider
    is unavailable. Invalid/expired subscriptions (404/410) are removed so the
    database does not accumulate dead device endpoints. Web Push (browser)
    sends synchronously here as before; FCM (native mobile) is queued onto
    the durable push_outbox instead, since it's an entirely separate client
    surface (Phase 7) with its own retry/dead-letter needs.

    `category` gates per-recipient opt-out (PushPreference); non-`urgent`
    sends are also suppressed during the event's configured quiet hours.
    """
    if not guest_ids or not (_web_push_configured() or _fcm_configured()):
        return
    async with SessionLocal() as db:
        event = await db.get(Event, event_id)
        cfg = await get_settings(event_id, db)
        if not urgent and event and _in_quiet_hours(event, cfg):
            await db.commit()
            return
        if not await _rate_limit_push(f"push-send:event:{event_id}", 200, 3600):
            await db.commit()
            return

        allowed_guest_ids = {
            gid for gid in guest_ids
            if await _preference_allows(db, event_id=event_id, actor_type="guest", actor_id=gid, category=category)
        }
        expired_ids: list[str] = []
        if _web_push_configured() and allowed_guest_ids:
            rows = (await db.execute(
                select(GuestPushSubscription, Guest)
                .join(Guest, Guest.id == GuestPushSubscription.guest_id)
                .where(
                    GuestPushSubscription.event_id == event_id,
                    GuestPushSubscription.guest_id.in_(allowed_guest_ids),
                )
            )).all()
            for subscription, guest in rows:
                try:
                    await asyncio.to_thread(
                        _deliver_web_push,
                        subscription,
                        {"title": title[:255], "body": body[:5000], "url": _subscription_url_for(guest)},
                    )
                    db.add(EventMessageDeliveryLog(
                        event_id=event_id, message_id=message_id, announcement_id=announcement_id,
                        guest_id=guest.id, channel="web_push", status="sent", provider="web_push",
                    ))
                except Exception as exc:  # Provider/browser errors must not affect messaging.
                    status = _web_push_status(exc)
                    if status in (404, 410):
                        expired_ids.append(subscription.id)
                    db.add(EventMessageDeliveryLog(
                        event_id=event_id, message_id=message_id, announcement_id=announcement_id,
                        guest_id=guest.id, channel="web_push", status="failed", provider="web_push",
                        error_message=f"HTTP {status}" if status else "Push delivery failed",
                    ))
                    logger.info("web_push_delivery_failed status=%s", status)

        if _fcm_configured() and allowed_guest_ids:
            fcm_rows = (await db.execute(
                select(FcmDeviceToken).where(
                    FcmDeviceToken.event_id == event_id,
                    FcmDeviceToken.actor_type == "guest",
                    FcmDeviceToken.actor_id.in_(allowed_guest_ids),
                    FcmDeviceToken.status == "active",
                )
            )).scalars().all()
            guest_by_id = {g.id: g for g in (
                (await db.execute(select(Guest).where(Guest.id.in_([t.actor_id for t in fcm_rows])))).scalars().all()
            )} if fcm_rows else {}
            for token_row in fcm_rows:
                guest = guest_by_id.get(token_row.actor_id)
                if not guest:
                    continue
                queue_push_job(
                    db, event_id=event_id, channel="fcm", target_id=token_row.id,
                    guest_id=guest.id, message_id=message_id, announcement_id=announcement_id,
                    idempotency_key=f"push:{token_row.id}:{message_id or announcement_id or uuid.uuid4()}",
                    payload={
                        "token": token_row.token, "title": title[:255], "body": body[:1000],
                        "url": _subscription_url_for(guest),
                    },
                )

        if expired_ids:
            await db.execute(delete(GuestPushSubscription).where(GuestPushSubscription.id.in_(expired_ids)))
        await db.commit()


async def send_staff_push(*, event_id: str, title: str, body: str, roles: list[str] | None = None) -> None:
    """Operational alerts for staff (e.g. a denied-scan notice at the door).

    FCM only — staff have no Web Push subscription flow, unlike guests.
    Gated on both the global FCM kill switch and the event's own
    staff_operational_alerts_enabled toggle, so this stays fully opt-in per
    event even once FCM is turned on globally. `roles` optionally narrows
    recipients to specific EventUser.event_role values (e.g. ["scanner"]);
    omitted means every assigned staff member on the event. Always "urgent" —
    deliberately does not check quiet hours; a denied-scan alert losing an
    hour to a quiet window would defeat the point of it being operational.
    """
    if not _fcm_configured():
        return
    async with SessionLocal() as db:
        cfg = await get_settings(event_id, db)
        if not cfg.staff_operational_alerts_enabled:
            await db.commit()
            return
        if not await _rate_limit_push(f"push-send:event:{event_id}", 200, 3600):
            await db.commit()
            return
        staff_q = select(EventUser.user_id).where(EventUser.event_id == event_id)
        if roles:
            staff_q = staff_q.where(EventUser.event_role.in_(roles))
        user_ids = (await db.execute(staff_q)).scalars().all()
        allowed_user_ids = [
            uid for uid in user_ids
            if await _preference_allows(db, event_id=event_id, actor_type="staff", actor_id=uid, category="staff_ops")
            and await _rate_limit_push(f"push-send:staff:{uid}", 30, 3600)
        ]
        if not allowed_user_ids:
            await db.commit()
            return
        fcm_rows = (await db.execute(
            select(FcmDeviceToken).where(
                FcmDeviceToken.event_id == event_id,
                FcmDeviceToken.actor_type == "staff",
                FcmDeviceToken.actor_id.in_(allowed_user_ids),
                FcmDeviceToken.status == "active",
            )
        )).scalars().all()
        for token_row in fcm_rows:
            queue_push_job(
                db, event_id=event_id, channel="fcm", target_id=token_row.id,
                idempotency_key=f"staffpush:{token_row.id}:{uuid.uuid4()}",
                payload={"token": token_row.token, "title": title[:255], "body": body[:1000], "url": ""},
            )
        await db.commit()


class InternalStaffPushIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=1000)
    roles: list[str] | None = None


def _message_out(m: EventMessage, guest_name: str | None = None) -> dict[str, Any]:
    return {
        "id": m.id,
        "sender_type": m.sender_type,
        "guest_id": m.guest_id,
        "sender_name": guest_name if m.sender_type == "guest" else ("Host" if m.sender_type == "organizer" else "Festio"),
        "message_type": m.message_type,
        "body": m.body,
        "status": m.status,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


class AnnouncementIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1)
    audience_type: str = "attending_only"
    audience_filter: dict[str, Any] | None = None
    send_in_app: bool = True


class AnnouncementPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    body: str | None = Field(default=None, min_length=1)
    audience_type: str | None = None
    audience_filter: dict[str, Any] | None = None


class MessageIn(BaseModel):
    body: str


class MessageModerationPatch(BaseModel):
    status: str


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=12, max_length=4096)
    keys: dict[str, str]


class PushSubscriptionDelete(BaseModel):
    endpoint: str = Field(min_length=12, max_length=4096)


class FcmTokenIn(BaseModel):
    token: str = Field(min_length=16, max_length=4096)
    platform: str = Field(pattern="^(android|ios|web)$")
    # Set by the client on a token-refresh event so the old token is revoked
    # in the same call as the new one is registered — avoids a window where
    # both are "active" and a guest/staff member gets duplicate pushes.
    previous_token: str | None = Field(default=None, max_length=4096)
    device_metadata: dict[str, Any] | None = None


class FcmTokenDelete(BaseModel):
    token: str = Field(min_length=16, max_length=4096)


class SettingsPatch(BaseModel):
    guest_hub_enabled: bool | None = None
    announcements_enabled: bool | None = None
    direct_host_messages_enabled: bool | None = None
    guest_chat_enabled: bool | None = None
    guest_chat_posting_enabled: bool | None = None
    attending_only_chat: bool | None = None
    staff_operational_alerts_enabled: bool | None = None
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # The push outbox tick worker only runs when FCM is actually enabled —
    # keeps a disabled feature fully inert (no polling, no DB load) rather
    # than just no-op-ing on every tick.
    push_task = asyncio.create_task(run_push_outbox()) if settings.fcm_enabled else None
    try:
        yield
    finally:
        if push_task:
            push_task.cancel()


app = FastAPI(title="Festio Messaging Service", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/messaging/health")
async def health(db: AsyncSession = Depends(get_db)):
    await db.execute(select(1))
    return {"status": "ok", "service": "messaging-service"}


@app.post("/api/messaging/internal/events/{event_id}/staff-push", status_code=202)
async def internal_staff_push(event_id: str, payload: InternalStaffPushIn, request: Request):
    """Server-to-server trigger for staff operational alerts — called by
    backend (e.g. on a denied door scan), authenticated by a shared internal
    token rather than a user session, matching how other internal-only
    integrations in this codebase (FestioMe) authenticate service calls."""
    provided = request.headers.get("x-internal-token", "")
    if not settings.internal_service_token or provided != settings.internal_service_token:
        raise HTTPException(401, "Invalid internal token")
    await send_staff_push(event_id=event_id, title=payload.title, body=payload.body, roles=payload.roles)
    return {"queued": True}


async def _push_guest_access(
    event_id: str,
    token: str | None,
    creds: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
) -> Guest:
    _ensure_enabled()
    guest = await guest_by_token(event_id, _guest_access_token(token, creds), db)
    event = await db.get(Event, event_id)
    require_hub_guest(guest, event)
    cfg = await get_settings(event_id, db)
    if not cfg.guest_hub_enabled or _comm_blocked(event, "guest_hub"):
        raise HTTPException(403, "FestioHub is disabled for this event.")
    return guest


@app.get("/api/messaging/events/{event_id}/push/config")
async def guest_push_config(
    event_id: str,
    token: str | None = Query(default=None),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    await _push_guest_access(event_id, token, creds, db)
    return {
        "enabled": _web_push_configured(),
        "public_key": settings.web_push_vapid_public_key if _web_push_configured() else "",
    }


@app.post("/api/messaging/events/{event_id}/push-subscription", status_code=201)
async def save_guest_push_subscription(
    event_id: str,
    payload: PushSubscriptionIn,
    token: str | None = Query(default=None),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    guest = await _push_guest_access(event_id, token, creds, db)
    if not _web_push_configured():
        raise HTTPException(503, "Push notifications are not configured")
    parsed = urlparse(payload.endpoint)
    p256dh = (payload.keys.get("p256dh") or "").strip()
    auth = (payload.keys.get("auth") or "").strip()
    if parsed.scheme != "https" or not parsed.netloc or not p256dh or not auth:
        raise HTTPException(422, "Invalid push subscription")
    await _rate_limit(f"push-subscription:{guest.id}", 20, 3600)
    row = await db.scalar(select(GuestPushSubscription).where(GuestPushSubscription.endpoint == payload.endpoint))
    if row is None:
        row = GuestPushSubscription(
            event_id=event_id, guest_id=guest.id, endpoint=payload.endpoint,
            p256dh=p256dh, auth=auth,
        )
        db.add(row)
    else:
        row.event_id = event_id
        row.guest_id = guest.id
        row.p256dh = p256dh
        row.auth = auth
        row.updated_at = datetime.utcnow()
    await db.commit()
    return {"enabled": True}


@app.delete("/api/messaging/events/{event_id}/push-subscription")
async def remove_guest_push_subscription(
    event_id: str,
    payload: PushSubscriptionDelete,
    token: str | None = Query(default=None),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    guest = await _push_guest_access(event_id, token, creds, db)
    await db.execute(delete(GuestPushSubscription).where(
        GuestPushSubscription.event_id == event_id,
        GuestPushSubscription.guest_id == guest.id,
        GuestPushSubscription.endpoint == payload.endpoint,
    ))
    await db.commit()
    return {"enabled": False}


async def _resolve_push_actor(
    event_id: str,
    token: str | None,
    creds: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
) -> tuple[str, str]:
    """FCM tokens are actor-agnostic (guest or staff), unlike
    GuestPushSubscription which is guest-only Web Push — so token
    register/unregister needs to resolve either kind of caller from one
    endpoint. Tries staff (Firebase ID token) first: a guest's access token
    is never a valid Firebase ID token, so this fails harmlessly and falls
    through to guest resolution when the bearer is actually a guest's.
    """
    if creds and creds.credentials:
        try:
            user = await current_user(creds, db)
        except HTTPException:
            user = None
        if user is not None:
            event = await db.get(Event, event_id)
            if not event:
                raise HTTPException(404, "Event not found")
            if not user.is_platform_superadmin:
                role = await db.scalar(
                    select(Membership.role)
                    .join(Organization, Organization.id == Membership.org_id)
                    .where(
                        Membership.user_id == user.id, Membership.org_id == event.org_id,
                        Organization.is_active.is_(True),
                    )
                )
                if role is None:
                    eu = await db.scalar(select(EventUser).where(
                        EventUser.event_id == event_id, EventUser.user_id == user.id))
                    if not eu:
                        raise HTTPException(403, "Not assigned to this event")
            return "staff", user.id
    guest = await _push_guest_access(event_id, token, creds, db)
    return "guest", guest.id


@app.post("/api/messaging/events/{event_id}/push/fcm-token", status_code=201)
async def register_fcm_token(
    event_id: str,
    payload: FcmTokenIn,
    token: str | None = Query(default=None),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    if not _fcm_configured():
        raise HTTPException(503, "Push notifications are not configured")
    actor_type, actor_id = await _resolve_push_actor(event_id, token, creds, db)
    await _rate_limit(f"fcm-token:{actor_type}:{actor_id}", 20, 3600)

    if payload.previous_token and payload.previous_token != payload.token:
        prev = await db.scalar(select(FcmDeviceToken).where(FcmDeviceToken.token == payload.previous_token))
        if prev is not None and prev.actor_type == actor_type and prev.actor_id == actor_id:
            prev.status = "revoked"
            prev.revoked_at = datetime.utcnow()

    row = await db.scalar(select(FcmDeviceToken).where(FcmDeviceToken.token == payload.token))
    if row is None:
        row = FcmDeviceToken(
            event_id=event_id, actor_type=actor_type, actor_id=actor_id,
            platform=payload.platform, token=payload.token,
            device_metadata=payload.device_metadata,
        )
        db.add(row)
    else:
        # Same physical token re-registering — move it to the current
        # event/actor/platform rather than duplicate (unique constraint on
        # token makes this the only correct path for a resubscribe).
        row.event_id = event_id
        row.actor_type = actor_type
        row.actor_id = actor_id
        row.platform = payload.platform
        row.status = "active"
        row.device_metadata = payload.device_metadata
        row.revoked_at = None
        row.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": row.status, "platform": row.platform}


@app.delete("/api/messaging/events/{event_id}/push/fcm-token")
async def unregister_fcm_token(
    event_id: str,
    payload: FcmTokenDelete,
    token: str | None = Query(default=None),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    actor_type, actor_id = await _resolve_push_actor(event_id, token, creds, db)
    row = await db.scalar(select(FcmDeviceToken).where(
        FcmDeviceToken.token == payload.token,
        FcmDeviceToken.actor_type == actor_type,
        FcmDeviceToken.actor_id == actor_id,
    ))
    if row is not None and row.status != "revoked":
        row.status = "revoked"
        row.revoked_at = datetime.utcnow()
        await db.commit()
    return {"status": "revoked"}


class PushPreferenceIn(BaseModel):
    category: str = Field(pattern="^(announcement|chat|staff_ops)$")
    enabled: bool


@app.get("/api/messaging/events/{event_id}/push/preferences")
async def get_push_preferences(
    event_id: str,
    token: str | None = Query(default=None),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    actor_type, actor_id = await _resolve_push_actor(event_id, token, creds, db)
    rows = (await db.execute(select(PushPreference).where(
        PushPreference.event_id == event_id, PushPreference.actor_type == actor_type,
        PushPreference.actor_id == actor_id,
    ))).scalars().all()
    overrides = {r.category: r.enabled for r in rows}
    categories = ["staff_ops"] if actor_type == "staff" else ["announcement", "chat"]
    return {"preferences": [{"category": c, "enabled": overrides.get(c, True)} for c in categories]}


@app.put("/api/messaging/events/{event_id}/push/preferences")
async def set_push_preference(
    event_id: str,
    payload: PushPreferenceIn,
    token: str | None = Query(default=None),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    actor_type, actor_id = await _resolve_push_actor(event_id, token, creds, db)
    row = await db.scalar(select(PushPreference).where(
        PushPreference.event_id == event_id, PushPreference.actor_type == actor_type,
        PushPreference.actor_id == actor_id, PushPreference.category == payload.category,
    ))
    if row is None:
        row = PushPreference(
            event_id=event_id, actor_type=actor_type, actor_id=actor_id,
            category=payload.category, enabled=payload.enabled,
        )
        db.add(row)
    else:
        row.enabled = payload.enabled
        row.updated_at = datetime.utcnow()
    await db.commit()
    return {"category": payload.category, "enabled": payload.enabled}


@app.get("/api/messaging/events/{event_id}/guest-hub")
async def guest_hub(
    event_id: str,
    token: str | None = Query(default=None),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    guest = await guest_by_token(event_id, _guest_access_token(token, creds), db)
    event = await db.get(Event, event_id)
    require_hub_guest(guest, event)
    cfg = await get_settings(event_id, db)
    if not cfg.guest_hub_enabled or _comm_blocked(event, "guest_hub"):
        raise HTTPException(403, "FestioHub is disabled for this event.")
    table = await db.get(SeatingTable, guest.table_id) if guest.table_id else None
    anns = []
    if cfg.announcements_enabled and not _comm_blocked(event, "announcements"):
        rows = (await db.execute(
            select(EventAnnouncement)
            .where(EventAnnouncement.event_id == event_id, EventAnnouncement.send_in_app.is_(True), EventAnnouncement.sent_at.isnot(None))
            .order_by(EventAnnouncement.created_at.desc())
            .limit(20)
        )).scalars().all()
        for ann in rows:
            if await _announcement_visible(ann, guest, db):
                anns.append({"id": ann.id, "title": ann.title, "body": ann.body, "created_at": ann.created_at.isoformat()})
    host_messages_on = cfg.direct_host_messages_enabled and not _comm_blocked(event, "host_messages")
    direct = await _direct_messages(event_id, guest, db) if host_messages_on else []
    attending = guest_is_attending(guest, event)
    chat_enabled = bool(cfg.guest_chat_enabled and not _comm_blocked(event, "guest_chat")
                        and (attending or not cfg.attending_only_chat))
    # Check-out (when the event enables it): the guest's latest normal exit scan.
    checked_out_at = None
    if event and event.checkout_enabled:
        last_out = await db.scalar(
            select(ScanEvent)
            .where(
                ScanEvent.event_id == event_id,
                ScanEvent.guest_id == guest.id,
                ScanEvent.zone_id.is_(None),
                ScanEvent.direction == "out",
                ScanEvent.denied.is_(False),
            )
            .order_by(ScanEvent.scanned_at.desc())
            .limit(1)
        )
        checked_out_at = last_out.scanned_at.isoformat() if last_out and last_out.scanned_at else None
    return {
        "guest": {
            "id": guest.id,
            "name": _display_name(guest),
            "rsvp_status": guest.rsvp_status,
            "admitted": guest.admitted,
            "checkout_enabled": bool(event and event.checkout_enabled),
            "checked_out": checked_out_at is not None,
            "checked_out_at": checked_out_at,
            "qr_token": guest.qr_token,
            "table_name": table.name if table else None,
            "seat_number": guest.seat_number,
        },
        "event": {
            "id": event.id if event else event_id,
            "name": event.name if event else "",
            "event_date": event.event_date.isoformat() if event and event.event_date else None,
            "timezone": event.timezone if event else None,
            "venue_name": event.venue_name if event else None,
            "admission_note": event.admission_note if event else None,
        },
        "capabilities": {
            "announcements": bool(cfg.announcements_enabled and not _comm_blocked(event, "announcements")),
            "direct_host_messages": bool(host_messages_on and attending),
            "guest_chat": chat_enabled,
            "guest_chat_posting": bool(chat_enabled and cfg.guest_chat_posting_enabled),
            "festiome": festiome_available(event),
        },
        "announcements": anns,
        "direct_messages": direct,
        "chat_messages": await _chat_messages(event_id, db) if chat_enabled else [],
    }


async def _direct_thread(event_id: str, guest: Guest, db: AsyncSession, create: bool = False) -> EventMessageThread | None:
    thread = await db.scalar(select(EventMessageThread).where(
        EventMessageThread.event_id == event_id,
        EventMessageThread.thread_type == "direct",
        EventMessageThread.guest_id == guest.id,
        EventMessageThread.is_active.is_(True),
    ))
    if not thread and create:
        thread = EventMessageThread(event_id=event_id, thread_type="direct", guest_id=guest.id, title=f"Message with {_display_name(guest)}", created_by_type="guest")
        db.add(thread)
        await db.flush()
    return thread


async def _direct_messages(event_id: str, guest: Guest, db: AsyncSession) -> list[dict[str, Any]]:
    thread = await _direct_thread(event_id, guest, db)
    if not thread:
        return []
    rows = (await db.execute(select(EventMessage).where(
        EventMessage.thread_id == thread.id,
        EventMessage.status == "active",
    ).order_by(EventMessage.created_at))).scalars().all()
    return [_message_out(m, _display_name(guest)) for m in rows]


async def _chat_thread(event_id: str, db: AsyncSession, create: bool = False) -> EventMessageThread | None:
    thread = await db.scalar(select(EventMessageThread).where(
        EventMessageThread.event_id == event_id,
        EventMessageThread.thread_type == "group_chat",
        EventMessageThread.is_active.is_(True),
    ))
    if not thread and create:
        thread = EventMessageThread(event_id=event_id, thread_type="group_chat", title="Guest Chat", created_by_type="system")
        db.add(thread)
        await db.flush()
    return thread


async def _chat_messages(event_id: str, db: AsyncSession, include_hidden: bool = False) -> list[dict[str, Any]]:
    thread = await _chat_thread(event_id, db)
    if not thread:
        return []
    where = [
        EventMessage.thread_id == thread.id,
        EventMessage.message_type == "group_chat",
        EventMessage.status != "deleted",
    ]
    if not include_hidden:
        where.append(EventMessage.status == "active")
    rows = (await db.execute(
        select(EventMessage, Guest)
        .outerjoin(Guest, Guest.id == EventMessage.guest_id)
        .where(and_(*where))
        .order_by(EventMessage.created_at.desc())
        .limit(80)
    )).all()
    return [
        _message_out(message, _display_name(guest) if guest else None)
        for message, guest in reversed(rows)
    ]


@app.post("/api/messaging/events/{event_id}/messages/direct")
async def guest_direct_message(
    event_id: str,
    payload: MessageIn,
    token: str | None = Query(default=None),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    guest = await guest_by_token(event_id, _guest_access_token(token, creds), db)
    cfg = await get_settings(event_id, db)
    event = await db.get(Event, event_id)
    require_hub_guest(guest, event)
    if not cfg.guest_hub_enabled or _comm_blocked(event, "guest_hub"):
        raise HTTPException(403, "FestioHub is disabled for this event.")
    if not cfg.direct_host_messages_enabled or _comm_blocked(event, "host_messages"):
        raise HTTPException(403, "Message Host is only available to confirmed guests")
    if not guest_is_attending(guest, event):
        raise HTTPException(403, "Message Host is only available to attending guests")
    await _rate_limit(f"direct:{guest.id}", settings.guest_message_rate_limit)
    thread = await _direct_thread(event_id, guest, db, create=True)
    body = _clean(payload.body, settings.message_max_length)
    msg = EventMessage(event_id=event_id, thread_id=thread.id, sender_type="guest", sender_id=guest.id, guest_id=guest.id, message_type="direct", body=body)
    thread.updated_at = datetime.utcnow()
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return _message_out(msg, _display_name(guest))


@app.post("/api/messaging/events/{event_id}/messages/chat")
async def guest_chat_message(
    event_id: str,
    payload: MessageIn,
    token: str | None = Query(default=None),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    guest = await guest_by_token(event_id, _guest_access_token(token, creds), db)
    cfg = await get_settings(event_id, db)
    event = await db.get(Event, event_id)
    require_hub_guest(guest, event)
    if not cfg.guest_hub_enabled or _comm_blocked(event, "guest_hub"):
        raise HTTPException(403, "FestioHub is disabled for this event.")
    if not cfg.guest_chat_enabled or _comm_blocked(event, "guest_chat"):
        raise HTTPException(403, "Guest Chat is disabled for this event")
    if cfg.attending_only_chat and not guest_is_attending(guest, event):
        raise HTTPException(403, "Guest Chat is only available to confirmed guests")
    if not cfg.guest_chat_posting_enabled:
        raise HTTPException(403, "Guest Chat posting is paused")
    await _rate_limit(f"chat:{guest.id}", settings.guest_chat_rate_limit)
    thread = await _chat_thread(event_id, db, create=True)
    msg = EventMessage(
        event_id=event_id,
        thread_id=thread.id,
        sender_type="guest",
        sender_id=guest.id,
        guest_id=guest.id,
        message_type="group_chat",
        body=_clean(payload.body, settings.message_max_length),
    )
    thread.updated_at = datetime.utcnow()
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return _message_out(msg, _display_name(guest))


@app.get("/api/messaging/admin/events/{event_id}/messaging/settings")
async def admin_settings(event_id: str, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db, request)
    cfg = await get_settings(event_id, db)
    await db.commit()
    return {
        "guest_hub_enabled": cfg.guest_hub_enabled,
        "announcements_enabled": cfg.announcements_enabled,
        "direct_host_messages_enabled": cfg.direct_host_messages_enabled,
        "guest_chat_enabled": cfg.guest_chat_enabled,
        "guest_chat_posting_enabled": cfg.guest_chat_posting_enabled,
        "attending_only_chat": cfg.attending_only_chat,
        "staff_operational_alerts_enabled": cfg.staff_operational_alerts_enabled,
        "quiet_hours_start": cfg.quiet_hours_start,
        "quiet_hours_end": cfg.quiet_hours_end,
    }


@app.patch("/api/messaging/admin/events/{event_id}/messaging/settings")
async def admin_patch_settings(event_id: str, patch: SettingsPatch, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db, request)
    cfg = await get_settings(event_id, db)
    for key, value in patch.model_dump(exclude_none=True).items():
        setattr(cfg, key, value)
    await db.commit()
    return await admin_settings(event_id, request, user, db)


@app.get("/api/messaging/admin/events/{event_id}/announcements")
async def admin_announcements(event_id: str, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db, request)
    rows = (await db.execute(select(EventAnnouncement).where(EventAnnouncement.event_id == event_id).order_by(EventAnnouncement.created_at.desc()))).scalars().all()
    return [{
        "id": a.id,
        "title": a.title,
        "body": a.body,
        "audience_type": a.audience_type,
        "sent_at": a.sent_at.isoformat() if a.sent_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    } for a in rows]


@app.post("/api/messaging/admin/events/{event_id}/announcements", status_code=201)
async def admin_create_announcement(
    event_id: str,
    payload: AnnouncementIn,
    background_tasks: BackgroundTasks,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_event_admin(event_id, user, db, request)
    cfg = await get_settings(event_id, db)
    if not cfg.announcements_enabled:
        raise HTTPException(403, "Announcements are disabled for this event")
    ann = EventAnnouncement(
        event_id=event_id,
        title=_clean(payload.title, 255),
        body=_clean(payload.body, settings.announcement_max_length),
        audience_type=payload.audience_type,
        audience_filter=payload.audience_filter,
        send_in_app=payload.send_in_app,
        sent_at=datetime.utcnow() if payload.send_in_app else None,
        created_by=user.id,
    )
    db.add(ann)
    await db.flush()
    guests = (await db.execute(await _audience_filter(ann))).scalars().all()
    if payload.send_in_app:
        msg = EventMessage(event_id=event_id, sender_type="organizer", sender_id=user.id, message_type="announcement", body=ann.body, message_metadata={"announcement_id": ann.id, "title": ann.title})
        db.add(msg)
        await db.flush()
        for guest in guests:
            db.add(EventMessageDeliveryLog(event_id=event_id, message_id=msg.id, announcement_id=ann.id, guest_id=guest.id, channel="in_app", status="sent"))
    await db.commit()
    if payload.send_in_app:
        background_tasks.add_task(
            send_event_push,
            event_id=event_id,
            guest_ids=[guest.id for guest in guests],
            title=ann.title,
            body=ann.body,
            message_id=msg.id,
            announcement_id=ann.id,
        )
    return {"id": ann.id, "title": ann.title, "body": ann.body, "audience_type": ann.audience_type, "reached": len(guests), "sent_at": ann.sent_at.isoformat() if ann.sent_at else None}


@app.patch("/api/messaging/admin/events/{event_id}/announcements/{announcement_id}")
async def admin_update_announcement(
    event_id: str,
    announcement_id: str,
    patch: AnnouncementPatch,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_event_admin(event_id, user, db, request)
    ann = await db.scalar(select(EventAnnouncement).where(
        EventAnnouncement.id == announcement_id,
        EventAnnouncement.event_id == event_id,
    ))
    if not ann:
        raise HTTPException(404, "Announcement not found")
    changes = patch.model_dump(exclude_unset=True)
    if changes.get("title") is not None:
        ann.title = _clean(changes["title"], 255)
    if changes.get("body") is not None:
        ann.body = _clean(changes["body"], settings.announcement_max_length)
    if changes.get("audience_type") is not None:
        ann.audience_type = changes["audience_type"]
    if "audience_filter" in changes:
        ann.audience_filter = changes["audience_filter"]
    ann.updated_at = datetime.utcnow()

    # Keep the historical in-app message representation aligned. Editing does
    # not create new deliveries or re-send external notifications.
    messages = (await db.scalars(select(EventMessage).where(
        EventMessage.event_id == event_id,
        EventMessage.message_type == "announcement",
    ))).all()
    for message in messages:
        metadata = dict(message.message_metadata or {})
        if metadata.get("announcement_id") != ann.id:
            continue
        message.body = ann.body
        metadata["title"] = ann.title
        message.message_metadata = metadata
        message.updated_at = datetime.utcnow()
    await db.commit()
    return {
        "id": ann.id, "title": ann.title, "body": ann.body,
        "audience_type": ann.audience_type,
        "sent_at": ann.sent_at.isoformat() if ann.sent_at else None,
        "updated_at": ann.updated_at.isoformat() if ann.updated_at else None,
    }


@app.get("/api/messaging/admin/events/{event_id}/messages/inbox")
async def admin_inbox(event_id: str, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db, request)
    rows = (await db.execute(select(EventMessageThread, Guest).join(Guest, Guest.id == EventMessageThread.guest_id).where(
        EventMessageThread.event_id == event_id,
        EventMessageThread.thread_type == "direct",
        EventMessageThread.is_active.is_(True),
    ).order_by(EventMessageThread.updated_at.desc()))).all()
    thread_ids = [thread.id for thread, _ in rows]
    last_by_thread: dict[str, tuple[str, datetime | None]] = {}
    guest_count_by_thread: dict[str, int] = {}
    if thread_ids:
        last_rows = (await db.execute(
            select(EventMessage.thread_id, EventMessage.body, EventMessage.created_at)
            .where(
                EventMessage.thread_id.in_(thread_ids),
                EventMessage.status == "active",
            )
            .order_by(EventMessage.thread_id, EventMessage.created_at.desc())
            .distinct(EventMessage.thread_id)
        )).all()
        last_by_thread = {
            thread_id: (body, created_at)
            for thread_id, body, created_at in last_rows
        }
        count_rows = (await db.execute(
            select(EventMessage.thread_id, func.count(EventMessage.id))
            .where(
                EventMessage.thread_id.in_(thread_ids),
                EventMessage.sender_type == "guest",
                EventMessage.status == "active",
            )
            .group_by(EventMessage.thread_id)
        )).all()
        guest_count_by_thread = {
            thread_id: int(count)
            for thread_id, count in count_rows
        }
    out = []
    for thread, guest in rows:
        last_body, last_created_at = last_by_thread.get(thread.id, ("", None))
        count = guest_count_by_thread.get(thread.id, 0)
        out.append({
            "thread_id": thread.id,
            "guest_id": guest.id,
            "guest_name": _display_name(guest),
            "rsvp_status": guest.rsvp_status,
            "last_message": last_body,
            "last_message_at": last_created_at.isoformat() if last_created_at else None,
            "guest_message_count": int(count),
        })
    return out


@app.get("/api/messaging/admin/events/{event_id}/messages/inbox/{thread_id}")
async def admin_thread(event_id: str, thread_id: str, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db, request)
    thread = await db.scalar(select(EventMessageThread).where(EventMessageThread.id == thread_id, EventMessageThread.event_id == event_id))
    if not thread:
        raise HTTPException(404, "Thread not found")
    guest = await db.get(Guest, thread.guest_id)
    rows = (await db.execute(select(EventMessage).where(EventMessage.thread_id == thread.id, EventMessage.status == "active").order_by(EventMessage.created_at))).scalars().all()
    return {"thread_id": thread.id, "guest": {"id": guest.id, "name": _display_name(guest), "rsvp_status": guest.rsvp_status} if guest else None, "messages": [_message_out(m, _display_name(guest) if guest else None) for m in rows]}


@app.post("/api/messaging/admin/events/{event_id}/messages/inbox/{thread_id}/reply")
async def admin_reply(
    event_id: str,
    thread_id: str,
    payload: MessageIn,
    background_tasks: BackgroundTasks,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_event_admin(event_id, user, db, request)
    thread = await db.scalar(select(EventMessageThread).where(EventMessageThread.id == thread_id, EventMessageThread.event_id == event_id))
    if not thread:
        raise HTTPException(404, "Thread not found")
    msg = EventMessage(event_id=event_id, thread_id=thread.id, sender_type="organizer", sender_id=user.id, guest_id=thread.guest_id, message_type="direct", body=_clean(payload.body, settings.message_max_length))
    thread.updated_at = datetime.utcnow()
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    if thread.guest_id:
        background_tasks.add_task(
            send_event_push,
            event_id=event_id,
            guest_ids=[thread.guest_id],
            title="New message from your event host",
            # Private message content never goes in a push payload (unlike a
            # public announcement) — a lock-screen notification is far more
            # exposed than an in-app toast. The guest opens FestioHub to read it.
            body="Tap to view your event host's message.",
            message_id=msg.id,
            category="chat",
        )
    return _message_out(msg)


@app.get("/api/messaging/admin/events/{event_id}/messages/chat")
async def admin_chat_messages(event_id: str, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db, request)
    return await _chat_messages(event_id, db, include_hidden=True)


@app.patch("/api/messaging/admin/events/{event_id}/messages/chat/{message_id}")
async def admin_moderate_chat_message(
    event_id: str,
    message_id: str,
    patch: MessageModerationPatch,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_event_admin(event_id, user, db, request)
    if patch.status not in {"active", "hidden"}:
        raise HTTPException(422, "Status must be active or hidden")
    msg = await db.scalar(select(EventMessage).where(
        EventMessage.id == message_id,
        EventMessage.event_id == event_id,
        EventMessage.message_type == "group_chat",
    ))
    if not msg:
        raise HTTPException(404, "Chat message not found")
    msg.status = patch.status
    msg.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(msg)
    guest = await db.get(Guest, msg.guest_id) if msg.guest_id else None
    return _message_out(msg, _display_name(guest) if guest else None)
