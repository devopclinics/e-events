import json
import logging
import os
import time
import uuid
from datetime import datetime
from typing import Any

import firebase_admin
from firebase_admin import auth as firebase_auth, credentials
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

logger = logging.getLogger("messaging-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://checkin:checkin@db/checkin"
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

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
bearer = HTTPBearer(auto_error=False)
_firebase_app = None
_rate_buckets: dict[str, list[float]] = {}


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


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String(255))
    event_date: Mapped[datetime] = mapped_column(DateTime)
    venue_name: Mapped[str | None] = mapped_column(String(255))
    admission_note: Mapped[str | None] = mapped_column(Text)


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
        decoded = firebase_auth.verify_id_token(creds.credentials)
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


async def require_event_admin(event_id: str, user: User, db: AsyncSession) -> Event:
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
        raise HTTPException(403, "Admin access required")
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


def require_accepted_guest(guest: Guest):
    if guest.rsvp_status != "confirmed":
        raise HTTPException(403, "Guest Hub is available after your RSVP is accepted.")


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


def _rate_limit(key: str, limit: int, window_seconds: int = 300):
    now = time.time()
    bucket = [t for t in _rate_buckets.get(key, []) if now - t < window_seconds]
    if len(bucket) >= limit:
        raise HTTPException(429, "Too many messages. Please wait a few minutes.")
    bucket.append(now)
    _rate_buckets[key] = bucket


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


def _message_out(m: EventMessage, guest_name: str | None = None) -> dict[str, Any]:
    return {
        "id": m.id,
        "sender_type": m.sender_type,
        "guest_id": m.guest_id,
        "sender_name": guest_name if m.sender_type == "guest" else ("Host" if m.sender_type == "organizer" else "EventQR"),
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


class MessageIn(BaseModel):
    body: str


class MessageModerationPatch(BaseModel):
    status: str


class SettingsPatch(BaseModel):
    guest_hub_enabled: bool | None = None
    announcements_enabled: bool | None = None
    direct_host_messages_enabled: bool | None = None
    guest_chat_enabled: bool | None = None
    guest_chat_posting_enabled: bool | None = None
    attending_only_chat: bool | None = None


app = FastAPI(title="EventQR Messaging Service", version="0.1.0")
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


@app.get("/api/messaging/events/{event_id}/guest-hub")
async def guest_hub(event_id: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    _ensure_enabled()
    guest = await guest_by_token(event_id, token, db)
    require_accepted_guest(guest)
    event = await db.get(Event, event_id)
    cfg = await get_settings(event_id, db)
    if not cfg.guest_hub_enabled:
        raise HTTPException(403, "Guest Hub is disabled for this event.")
    table = await db.get(SeatingTable, guest.table_id) if guest.table_id else None
    anns = []
    if cfg.announcements_enabled:
        rows = (await db.execute(
            select(EventAnnouncement)
            .where(EventAnnouncement.event_id == event_id, EventAnnouncement.send_in_app.is_(True), EventAnnouncement.sent_at.isnot(None))
            .order_by(EventAnnouncement.created_at.desc())
            .limit(20)
        )).scalars().all()
        for ann in rows:
            if await _announcement_visible(ann, guest, db):
                anns.append({"id": ann.id, "title": ann.title, "body": ann.body, "created_at": ann.created_at.isoformat()})
    direct = await _direct_messages(event_id, guest, db)
    chat_enabled = bool(cfg.guest_chat_enabled)
    return {
        "guest": {
            "id": guest.id,
            "name": _display_name(guest),
            "rsvp_status": guest.rsvp_status,
            "admitted": guest.admitted,
            "qr_token": guest.qr_token,
            "table_name": table.name if table else None,
            "seat_number": guest.seat_number,
        },
        "event": {
            "id": event.id if event else event_id,
            "name": event.name if event else "",
            "event_date": event.event_date.isoformat() if event and event.event_date else None,
            "venue_name": event.venue_name if event else None,
            "admission_note": event.admission_note if event else None,
        },
        "capabilities": {
            "announcements": bool(cfg.announcements_enabled),
            "direct_host_messages": bool(cfg.direct_host_messages_enabled and guest.rsvp_status == "confirmed"),
            "guest_chat": chat_enabled,
            "guest_chat_posting": bool(chat_enabled and cfg.guest_chat_posting_enabled),
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
async def guest_direct_message(event_id: str, payload: MessageIn, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    _ensure_enabled()
    guest = await guest_by_token(event_id, token, db)
    require_accepted_guest(guest)
    cfg = await get_settings(event_id, db)
    if not cfg.guest_hub_enabled:
        raise HTTPException(403, "Guest Hub is disabled for this event.")
    if not cfg.direct_host_messages_enabled:
        raise HTTPException(403, "Message Host is only available to confirmed guests")
    _rate_limit(f"direct:{guest.id}", settings.guest_message_rate_limit)
    thread = await _direct_thread(event_id, guest, db, create=True)
    body = _clean(payload.body, settings.message_max_length)
    msg = EventMessage(event_id=event_id, thread_id=thread.id, sender_type="guest", sender_id=guest.id, guest_id=guest.id, message_type="direct", body=body)
    thread.updated_at = datetime.utcnow()
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return _message_out(msg, _display_name(guest))


@app.post("/api/messaging/events/{event_id}/messages/chat")
async def guest_chat_message(event_id: str, payload: MessageIn, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    _ensure_enabled()
    guest = await guest_by_token(event_id, token, db)
    require_accepted_guest(guest)
    cfg = await get_settings(event_id, db)
    if not cfg.guest_hub_enabled:
        raise HTTPException(403, "Guest Hub is disabled for this event.")
    if not cfg.guest_chat_enabled:
        raise HTTPException(403, "Guest Chat is disabled for this event")
    if not cfg.guest_chat_posting_enabled:
        raise HTTPException(403, "Guest Chat posting is paused")
    _rate_limit(f"chat:{guest.id}", settings.guest_chat_rate_limit)
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
async def admin_settings(event_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db)
    cfg = await get_settings(event_id, db)
    await db.commit()
    return {
        "guest_hub_enabled": cfg.guest_hub_enabled,
        "announcements_enabled": cfg.announcements_enabled,
        "direct_host_messages_enabled": cfg.direct_host_messages_enabled,
        "guest_chat_enabled": cfg.guest_chat_enabled,
        "guest_chat_posting_enabled": cfg.guest_chat_posting_enabled,
        "attending_only_chat": cfg.attending_only_chat,
    }


@app.patch("/api/messaging/admin/events/{event_id}/messaging/settings")
async def admin_patch_settings(event_id: str, patch: SettingsPatch, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db)
    cfg = await get_settings(event_id, db)
    for key, value in patch.model_dump(exclude_none=True).items():
        setattr(cfg, key, value)
    await db.commit()
    return await admin_settings(event_id, user, db)


@app.get("/api/messaging/admin/events/{event_id}/announcements")
async def admin_announcements(event_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db)
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
async def admin_create_announcement(event_id: str, payload: AnnouncementIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db)
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
    return {"id": ann.id, "title": ann.title, "body": ann.body, "audience_type": ann.audience_type, "reached": len(guests), "sent_at": ann.sent_at.isoformat() if ann.sent_at else None}


@app.get("/api/messaging/admin/events/{event_id}/messages/inbox")
async def admin_inbox(event_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db)
    rows = (await db.execute(select(EventMessageThread, Guest).join(Guest, Guest.id == EventMessageThread.guest_id).where(
        EventMessageThread.event_id == event_id,
        EventMessageThread.thread_type == "direct",
        EventMessageThread.is_active.is_(True),
    ).order_by(EventMessageThread.updated_at.desc()))).all()
    out = []
    for thread, guest in rows:
        last = await db.scalar(select(EventMessage).where(EventMessage.thread_id == thread.id, EventMessage.status == "active").order_by(EventMessage.created_at.desc()).limit(1))
        count = await db.scalar(select(func.count(EventMessage.id)).where(EventMessage.thread_id == thread.id, EventMessage.sender_type == "guest", EventMessage.status == "active")) or 0
        out.append({
            "thread_id": thread.id,
            "guest_id": guest.id,
            "guest_name": _display_name(guest),
            "rsvp_status": guest.rsvp_status,
            "last_message": last.body if last else "",
            "last_message_at": last.created_at.isoformat() if last and last.created_at else None,
            "guest_message_count": int(count),
        })
    return out


@app.get("/api/messaging/admin/events/{event_id}/messages/inbox/{thread_id}")
async def admin_thread(event_id: str, thread_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db)
    thread = await db.scalar(select(EventMessageThread).where(EventMessageThread.id == thread_id, EventMessageThread.event_id == event_id))
    if not thread:
        raise HTTPException(404, "Thread not found")
    guest = await db.get(Guest, thread.guest_id)
    rows = (await db.execute(select(EventMessage).where(EventMessage.thread_id == thread.id, EventMessage.status == "active").order_by(EventMessage.created_at))).scalars().all()
    return {"thread_id": thread.id, "guest": {"id": guest.id, "name": _display_name(guest), "rsvp_status": guest.rsvp_status} if guest else None, "messages": [_message_out(m, _display_name(guest) if guest else None) for m in rows]}


@app.post("/api/messaging/admin/events/{event_id}/messages/inbox/{thread_id}/reply")
async def admin_reply(event_id: str, thread_id: str, payload: MessageIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db)
    thread = await db.scalar(select(EventMessageThread).where(EventMessageThread.id == thread_id, EventMessageThread.event_id == event_id))
    if not thread:
        raise HTTPException(404, "Thread not found")
    msg = EventMessage(event_id=event_id, thread_id=thread.id, sender_type="organizer", sender_id=user.id, guest_id=thread.guest_id, message_type="direct", body=_clean(payload.body, settings.message_max_length))
    thread.updated_at = datetime.utcnow()
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return _message_out(msg)


@app.get("/api/messaging/admin/events/{event_id}/messages/chat")
async def admin_chat_messages(event_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_event_admin(event_id, user, db)
    return await _chat_messages(event_id, db, include_hidden=True)


@app.patch("/api/messaging/admin/events/{event_id}/messages/chat/{message_id}")
async def admin_moderate_chat_message(
    event_id: str,
    message_id: str,
    patch: MessageModerationPatch,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_event_admin(event_id, user, db)
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
