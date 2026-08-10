"""Festio Marketing service.

Owns lead lifecycle, campaigns, content, referrals, follow-up sequences,
attribution, consent, staff grants, tasks, and reporting. It never imports the
main Festio backend or reads its database.
"""
import json
import csv
import io
import os
import smtplib
import threading
import uuid
import logging
import asyncio
import secrets
from html import escape
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any
from urllib.parse import quote

import jwt
import base64
import hashlib
import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


DATABASE_URL = os.getenv("MARKETING_DATABASE_URL", "sqlite:////data/marketing.db")
TOKEN_SECRET = os.getenv("MARKETING_INTERNAL_TOKEN") or os.getenv("PLANNER_INTERNAL_SERVICE_TOKEN", "")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(engine, expire_on_commit=False)
logger = logging.getLogger("festio.marketing")


class Base(DeclarativeBase): pass
def uid(): return str(uuid.uuid4())
def now(): return datetime.now(timezone.utc)


class AccessGrant(Base):
    __tablename__ = "marketing_access_grants"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    subject: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(240), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    role: Mapped[str] = mapped_column(String(30), default="marketer")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    owner_scoped: Mapped[bool] = mapped_column(Boolean, default=False)
    granted_by: Mapped[str] = mapped_column(String(240))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Lead(Base):
    __tablename__ = "marketing_leads"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    festio_user_id: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(240), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    organization: Mapped[str | None] = mapped_column(String(240), nullable=True)
    event_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    event_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    guest_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    country: Mapped[str | None] = mapped_column(String(80), nullable=True)
    stage: Mapped[str] = mapped_column(String(40), default="registered", index=True)
    stage_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    score: Mapped[int] = mapped_column(Integer, default=10)
    deal_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    probability: Mapped[int | None] = mapped_column(Integer, nullable=True)
    close_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    demo_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    calendar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    deletion_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    owner_email: Mapped[str | None] = mapped_column(String(240), nullable=True)
    source: Mapped[str] = mapped_column(String(100), default="website")
    medium: Mapped[str | None] = mapped_column(String(100), nullable=True)
    campaign: Mapped[str | None] = mapped_column(String(160), nullable=True)
    referrer: Mapped[str | None] = mapped_column(Text, nullable=True)
    landing_page: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    consent_email: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_sms: Mapped[bool] = mapped_column(Boolean, default=False)
    unsubscribed: Mapped[bool] = mapped_column(Boolean, default=False)
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Activity(Base):
    __tablename__ = "marketing_activities"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    lead_id: Mapped[str] = mapped_column(ForeignKey("marketing_leads.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(50))
    summary: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(String(240), default="system")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ModuleRecord(Base):
    __tablename__ = "marketing_module_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    module: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(240))
    status: Mapped[str] = mapped_column(String(40), default="draft", index=True)
    owner_email: Mapped[str | None] = mapped_column(String(240), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(240))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class SocialConnection(Base):
    __tablename__ = "marketing_social_connections"
    platform: Mapped[str] = mapped_column(String(30), primary_key=True)
    encrypted_credentials: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[str] = mapped_column(String(240), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class SavedView(Base):
    __tablename__ = "marketing_saved_views"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(160))
    owner_email: Mapped[str] = mapped_column(String(240), index=True)
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    shared: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuditLog(Base):
    __tablename__ = "marketing_audit_log"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    actor: Mapped[str] = mapped_column(String(240), index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    target_type: Mapped[str] = mapped_column(String(50))
    target_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class AutomationLease(Base):
    __tablename__ = "marketing_automation_leases"
    name: Mapped[str] = mapped_column(String(80), primary_key=True)
    holder: Mapped[str] = mapped_column(String(80))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class FormRateLimit(Base):
    __tablename__ = "marketing_form_rate_limits"
    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    count: Mapped[int] = mapped_column(Integer, default=0)


Base.metadata.create_all(engine)

# Lightweight additive migration for the service-owned SQLite database. This
# keeps upgrades independent from the main Festio schema and preserves leads.
if "registered_at" not in {column["name"] for column in inspect(engine).get_columns("marketing_leads")}:
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE marketing_leads ADD COLUMN registered_at DATETIME"))
        connection.execute(text("UPDATE marketing_leads SET registered_at = created_at WHERE registered_at IS NULL"))

lead_columns = {column["name"] for column in inspect(engine).get_columns("marketing_leads")}
with engine.begin() as connection:
    for column, definition in {
        "stage_changed_at": "DATETIME",
        "deal_value": "INTEGER",
        "probability": "INTEGER",
        "close_date": "VARCHAR(30)",
        "demo_at": "DATETIME",
        "calendar_url": "TEXT",
        "deletion_requested_at": "DATETIME",
    }.items():
        if column not in lead_columns:
            connection.execute(text(f"ALTER TABLE marketing_leads ADD COLUMN {column} {definition}"))
    connection.execute(text("UPDATE marketing_leads SET stage_changed_at = COALESCE(stage_changed_at, updated_at, created_at)"))
    # Normalize historical duplicates before enforcing the same invariant as the API.
    duplicates = connection.execute(text("SELECT lower(email), min(id) FROM marketing_leads GROUP BY lower(email) HAVING count(*) > 1")).all()
    for normalized_email, keep_id in duplicates:
        duplicate_ids = [row[0] for row in connection.execute(text("SELECT id FROM marketing_leads WHERE lower(email)=:email AND id<>:keep"), {"email": normalized_email, "keep": keep_id}).all()]
        for duplicate_id in duplicate_ids:
            connection.execute(text("UPDATE marketing_activities SET lead_id=:keep WHERE lead_id=:duplicate"), {"keep": keep_id, "duplicate": duplicate_id})
            connection.execute(text("DELETE FROM marketing_leads WHERE id=:duplicate"), {"duplicate": duplicate_id})
    connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_leads_email_normalized ON marketing_leads(lower(email))"))

access_columns = {column["name"] for column in inspect(engine).get_columns("marketing_access_grants")}
if "owner_scoped" not in access_columns:
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE marketing_access_grants ADD COLUMN owner_scoped BOOLEAN DEFAULT 0"))


def seed_defaults() -> None:
    defaults = [
        ("sequences", "New registration welcome", "active", {"stage": "registered", "cadence_days": 2, "cta_url": "https://festio.events/setup-redesign", "steps": [
            {"delay_hours": 0,   "subject": "Welcome to Festio", "body": "You've just joined thousands of event organizers who use Festio to manage invitations, check-ins, and the moments that make events memorable.\n\nYour account is ready — let's create your first event.", "cta": "Create your first event", "cta_url": "https://festio.events/setup-redesign"},
            {"delay_hours": 24,  "subject": "Let us help with your event setup", "body": "Setting up an event on Festio takes about 10 minutes. Add your event details, upload a cover image, and you'll have a shareable event page ready to go.\n\nWe're here if you get stuck.", "cta": "Continue setup", "cta_url": "https://festio.events/setup-redesign"},
            {"delay_hours": 72,  "subject": "What kind of event are you planning?", "body": "Whether it's a wedding, a corporate conference, or a birthday celebration — Festio adapts to how you work.\n\nThousands of organizers trust us for everything from a 20-person dinner to a 5,000-person festival. We'd love to hear about yours.", "cta": "Tell us about your event", "cta_url": "mailto:hello@festio.events?subject=My%20event%20type"},
            {"delay_hours": 168, "subject": "Would a 15-minute setup call help?", "body": "Sometimes a quick conversation makes all the difference. One of our team will walk through your event with you, answer any questions, and make sure Festio is set up exactly the way you need it.\n\nNo commitment — just a helpful call.", "cta": "Book a free call", "cta_url": "https://festio.events/admin-redesign"},
        ]}),
        ("sequences", "Event created onboarding", "active", {"stage": "event_created", "cadence_days": 3, "cta_url": "https://festio.events/admin-redesign", "steps": [
            {"delay_hours": 0,   "subject": "Your Festio event is ready for setup", "body": "Great news — your event is live on Festio.\n\nThe next step is adding your guest list and customizing your invitation. It only takes a few minutes and your guests will receive a beautiful, branded invite.", "cta": "Add guests", "cta_url": "https://festio.events/admin-redesign"},
            {"delay_hours": 48,  "subject": "Invite, sell tickets, or start planning", "body": "Your event dashboard is ready for everything — import your guest list, set up ticket types, configure check-in, and manage meals or seating.\n\nMost organizers get fully set up in under an hour.", "cta": "Open your event", "cta_url": "https://festio.events/admin-redesign"},
            {"delay_hours": 120, "subject": "See what your event still needs", "body": "A quick checklist can save a lot of day-of stress.\n\nHead to your event setup to make sure invitations are sent, RSVPs are tracking, and your check-in team is ready. Need help? We're one message away.", "cta": "Review your setup", "cta_url": "https://festio.events/admin-redesign"},
        ]}),
        ("segments", "Registered without an event", "active", {"rules": [{"field": "stage", "operator": "equals", "value": "registered"}]}),
        ("segments", "Paid event promotion audience", "active", {"rules": [{"field": "stage", "operator": "in", "value": ["paid", "customer"]}]}),
        ("campaigns", "Six-month paid add-on promotion", "draft", {"channels": ["email", "social"], "audience": "Paid event promotion audience", "goal": "addon_activation"}),
        ("content", "Weekly organizer education", "draft", {"channel": "linkedin", "pillar": "education", "cadence": "weekly"}),
        ("content", "Ticket Sales product demo", "draft", {"channel": "instagram", "pillar": "product_demo", "format": "short_video"}),
        ("content", "Planner product demo", "draft", {"channel": "linkedin", "pillar": "product_demo", "format": "carousel"}),
        ("content", "Social publishing workflow", "active", {"channels": ["linkedin", "instagram", "facebook"], "cadence": {"tuesday": "organizer education", "thursday": "product demo", "saturday": "customer story"}, "workflow": ["draft", "review", "approved", "published"], "owner": "muritala@festio.events"}),
        ("content", "Campaign tracking conventions", "active", {"utm_source": "lowercase platform or partner name", "utm_medium": ["email", "organic_social", "paid_social", "partner", "referral"], "utm_campaign": "yyyy-mm-campaign-name", "utm_content": "creative-or-cta-variant", "example": "utm_source=linkedin&utm_medium=organic_social&utm_campaign=2026-08-addon-promotion&utm_content=planner-carousel"}),
        ("tasks", "New lead response SLA", "active", {"owner": "muritala@festio.events", "target_minutes": 60, "applies_to": ["registered", "demo_booked"], "business_hours": "Monday-Friday, 09:00-17:00 America/Chicago"}),
        ("experiments", "Registration CTA test", "draft", {"metric": "sign_up_rate", "variants": ["Create free event", "Plan your event free"]}),
    ]
    with SessionLocal() as db:
        existing = set(db.scalars(select(ModuleRecord.name)).all())
        for module, name, status, payload in defaults:
            if name not in existing:
                db.add(ModuleRecord(module=module, name=name, status=status, payload=payload, created_by="system@festio.events"))
        promotion = db.scalar(select(ModuleRecord).where(ModuleRecord.name == "Six-month paid add-on promotion"))
        if promotion and not promotion.payload.get("starts_at"):
            promotion.payload = {**promotion.payload, "starts_at": "2026-08-07", "ends_at": "2027-02-07", "eligibility": "paid_events_only", "offer": "all add-ons included at no extra charge"}
        db.commit()


seed_defaults()


# Live migration: backfill body copy on existing seeded sequences that have steps
# with no body text (deployed before 2026-08-10 copy update).
_STEP_BODY_BACKFILL = {
    "New registration welcome": [
        "You've just joined thousands of event organizers who use Festio to manage invitations, check-ins, and the moments that make events memorable.\n\nYour account is ready — let's create your first event.",
        "Setting up an event on Festio takes about 10 minutes. Add your event details, upload a cover image, and you'll have a shareable event page ready to go.\n\nWe're here if you get stuck.",
        "Whether it's a wedding, a corporate conference, or a birthday celebration — Festio adapts to how you work.\n\nThousands of organizers trust us for everything from a 20-person dinner to a 5,000-person festival. We'd love to hear about yours.",
        "Sometimes a quick conversation makes all the difference. One of our team will walk through your event with you, answer any questions, and make sure Festio is set up exactly the way you need it.\n\nNo commitment — just a helpful call.",
    ],
    "Event created onboarding": [
        "Great news — your event is live on Festio.\n\nThe next step is adding your guest list and customizing your invitation. It only takes a few minutes and your guests will receive a beautiful, branded invite.",
        "Your event dashboard is ready for everything — import your guest list, set up ticket types, configure check-in, and manage meals or seating.\n\nMost organizers get fully set up in under an hour.",
        "A quick checklist can save a lot of day-of stress.\n\nHead to your event setup to make sure invitations are sent, RSVPs are tracking, and your check-in team is ready. Need help? We're one message away.",
    ],
}
with SessionLocal() as _db:
    for seq_name, bodies in _STEP_BODY_BACKFILL.items():
        _seq = _db.scalar(select(ModuleRecord).where(ModuleRecord.name == seq_name, ModuleRecord.module == "sequences"))
        if _seq:
            steps = list(_seq.payload.get("steps") or [])
            changed = False
            for i, body_text in enumerate(bodies):
                if i < len(steps) and not steps[i].get("body"):
                    steps[i] = {**steps[i], "body": body_text}
                    changed = True
            if changed:
                _seq.payload = {**_seq.payload, "steps": steps}
    _db.commit()


class Identity(BaseModel):
    subject: str
    email: str
    name: str
    is_superadmin: bool = False
    role: str = "viewer"
    owner_scoped: bool = False


def db_session():
    with SessionLocal() as db: yield db


SOCIAL_FIELDS = {
    "linkedin": ("access_token", "refresh_token", "client_id", "client_secret", "author_urn"),
    "facebook": ("access_token", "app_id", "app_secret", "page_id"),
    "instagram": ("access_token", "app_id", "app_secret", "user_id"),
}
SOCIAL_ENV = {
    "linkedin": {"access_token":"LINKEDIN_ACCESS_TOKEN", "refresh_token":"LINKEDIN_REFRESH_TOKEN", "client_id":"LINKEDIN_CLIENT_ID", "client_secret":"LINKEDIN_CLIENT_SECRET", "author_urn":"LINKEDIN_AUTHOR_URN"},
    "facebook": {"access_token":"META_ACCESS_TOKEN", "app_id":"META_APP_ID", "app_secret":"META_APP_SECRET", "page_id":"META_FACEBOOK_PAGE_ID"},
    "instagram": {"access_token":"META_ACCESS_TOKEN", "app_id":"META_APP_ID", "app_secret":"META_APP_SECRET", "user_id":"META_INSTAGRAM_USER_ID"},
}


def credential_cipher() -> Fernet:
    if not TOKEN_SECRET: raise HTTPException(503, "Credential encryption is not configured")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(TOKEN_SECRET.encode()).digest()))


def saved_social_credentials(db: Session, platform: str) -> dict[str, str]:
    row = db.get(SocialConnection, platform)
    if not row or not row.encrypted_credentials: return {}
    try: return json.loads(credential_cipher().decrypt(row.encrypted_credentials.encode()).decode())
    except (InvalidToken, ValueError, json.JSONDecodeError):
        logger.exception("Could not decrypt %s social credentials", platform); return {}


def social_credentials(db: Session, platform: str) -> dict[str, str]:
    saved = saved_social_credentials(db, platform)
    return {field: saved.get(field) or os.getenv(SOCIAL_ENV[platform][field], "") for field in SOCIAL_FIELDS[platform]}


def social_connection_out(db: Session, platform: str) -> dict:
    credentials = social_credentials(db, platform); saved = saved_social_credentials(db, platform); row = db.get(SocialConnection, platform)
    identifiers = {key: value for key, value in credentials.items() if key in {"client_id","author_urn","app_id","page_id","user_id"}}
    return {"platform":platform, "configured_fields":{key:bool(value) for key,value in credentials.items()}, "saved_in_festio":bool(saved), "identifiers":identifiers, "updated_by":row.updated_by if row else None, "updated_at":row.updated_at if row else None}


def decode_identity(authorization: str | None = Header(default=None), db: Session = Depends(db_session)) -> Identity:
    if not authorization or not authorization.startswith("Bearer ") or not TOKEN_SECRET:
        raise HTTPException(401, "Marketing authentication required")
    try:
        data = jwt.decode(authorization[7:], TOKEN_SECRET, algorithms=["HS256"], audience="marketing", issuer="guesthub")
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired Marketing session")
    identity = Identity(subject=str(data["sub"]), email=(data.get("email") or "").lower(), name=data.get("name") or "", is_superadmin=bool(data.get("is_platform_superadmin")))
    if identity.is_superadmin:
        identity.role = "superadmin"
        return identity
    grant = db.scalar(select(AccessGrant).where(AccessGrant.email == identity.email, AccessGrant.active.is_(True)))
    if not grant:
        raise HTTPException(403, "Marketing access has not been granted")
    if not grant.subject:
        grant.subject = identity.subject
        grant.name = identity.name
        db.commit()
    identity.role = grant.role
    identity.owner_scoped = bool(grant.owner_scoped)
    return identity


def require_manager(identity: Identity = Depends(decode_identity)) -> Identity:
    if identity.role not in {"superadmin", "manager"}: raise HTTPException(403, "Marketing manager access required")
    return identity


def require_superadmin(identity: Identity = Depends(decode_identity)) -> Identity:
    if not identity.is_superadmin: raise HTTPException(403, "Only a platform super-admin can manage Marketing staff access")
    return identity


def lead_out(row: Lead) -> dict:
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}
def record_out(row: ModuleRecord) -> dict:
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}
def audit(db: Session, identity: Identity | str, action: str, target_type: str, target_id: str | None = None, **data):
    db.add(AuditLog(actor=identity if isinstance(identity, str) else identity.email, action=action, target_type=target_type, target_id=target_id, data=data))


def visible_lead(db: Session, lead_id: str, identity: Identity) -> Lead:
    row = db.get(Lead, lead_id)
    if not row or (identity.owner_scoped and row.owner_email != identity.email):
        raise HTTPException(404, "Lead not found")
    return row


def sequence_steps(record: ModuleRecord) -> list[dict]:
    steps = record.payload.get("steps") or []
    if steps:
        return steps
    if record.payload.get("subject") or record.payload.get("body"):
        return [{key: record.payload.get(key) for key in ("subject", "body", "cta", "cta_url", "next_delay_hours") if record.payload.get(key) is not None}]
    return []


def safe_cta_url(value: Any) -> str:
    url = str(value or "https://festio.events/admin-redesign").strip()
    return url if url.startswith(("https://", "http://")) else "https://festio.events/admin-redesign"


def send_follow_up(lead: Lead, sequence: ModuleRecord, step_index: int = 0) -> dict:
    steps = sequence_steps(sequence)
    step = steps[min(step_index, len(steps) - 1)] if steps else {"subject": sequence.name, "cta": "Open Festio"}
    message = EmailMessage()
    message["From"] = os.getenv("EMAIL_FROM", "Festio <events@festio.events>")
    message["To"] = lead.email
    message["Subject"] = step.get("subject") or sequence.name
    unsubscribe_url = f"https://festio.events/api/marketing/unsubscribe/{lead.id}"
    message["List-Unsubscribe"] = f"<{unsubscribe_url}>"
    message["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    first_name = (lead.name or "there").split()[0]
    cta_url = safe_cta_url(step.get("cta_url") or sequence.payload.get("cta_url"))
    message.set_content(
        f"Hi {first_name},\n\n{step.get('body') or 'Your Festio event is ready for the next step.'}\n\n"
        f"{step.get('cta') or 'Open Festio'}: {cta_url}\n\n"
        f"You are receiving this because you registered for Festio. Unsubscribe: "
        f"https://festio.events/api/marketing/unsubscribe/{lead.id}\n"
    )
    subject = str(step.get("subject") or sequence.name)
    body = str(step.get("body") or "Your Festio event is ready for the next step.")
    cta = str(step.get("cta") or "Open Festio")
    message.add_alternative(f"""<!doctype html><html><body style="margin:0;background:#f5f1e9;font-family:Arial,sans-serif;color:#172033"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:36px 16px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden"><tr><td style="padding:20px 32px;background:#075b5d;color:#fff;font-size:20px;font-weight:700">Festio</td></tr><tr><td style="padding:36px 32px"><p style="font-size:17px">Hi {escape(first_name)},</p><h1 style="font-size:28px;line-height:1.2">{escape(subject)}</h1><p style="font-size:16px;line-height:1.7;color:#526070">{escape(body)}</p><p style="margin:28px 0"><a href="{escape(cta_url)}" style="display:inline-block;background:#a85d32;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">{escape(cta)}</a></p><p style="font-size:13px;color:#78828f">You received this because you asked Festio for event updates. <a href="{unsubscribe_url}">Unsubscribe</a>.</p></td></tr></table></td></tr></table></body></html>""", subtype="html")
    resend_key = os.getenv("RESEND_API_KEY", "")
    if resend_key:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {resend_key}"},
            json={"from": message["From"], "to": [lead.email], "subject": message["Subject"], "text": message.get_body(preferencelist=("plain",)).get_content(), "html": message.get_body(preferencelist=("html",)).get_content(), "headers": {"List-Unsubscribe": f"<{unsubscribe_url}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}, "tags": [{"name": "marketing_record_id", "value": sequence.id}]},
            timeout=20,
        )
        response.raise_for_status()
        return {"status": "sent", "provider": "resend", "provider_id": response.json().get("id")}
    host, user, password = os.getenv("SMTP_HOST", ""), os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASSWORD", "")
    if not host or not user or not password:
        return {"status": "queued", "provider": "none", "provider_id": None}
    port = int(os.getenv("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=15) as smtp:
        if os.getenv("SMTP_TLS", "true").lower() in {"1", "true", "yes"}: smtp.starttls()
        smtp.login(user, password); smtp.send_message(message)
    return {"status": "sent", "provider": "smtp", "provider_id": None}


class LeadIn(BaseModel):
    email: EmailStr
    name: str = ""
    phone: str | None = None
    organization: str | None = None
    event_type: str | None = None
    event_date: str | None = None
    guest_count: int | None = None
    country: str | None = None
    stage: str = "registered"
    score: int = 10
    owner_email: str | None = None
    source: str = "website"
    medium: str | None = None
    campaign: str | None = None
    referrer: str | None = None
    landing_page: str | None = None
    tags: list[str] = Field(default_factory=list)
    consent_email: bool = False
    consent_sms: bool = False
    registered_at: datetime | None = None


class RecordIn(BaseModel):
    name: str
    status: str = "draft"
    owner_email: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    scheduled_at: datetime | None = None


class SocialPublishIn(BaseModel):
    platform: str
    message: str = Field(min_length=1, max_length=3000)
    link_url: str | None = None
    image_url: str | None = None
    dry_run: bool = False


app = FastAPI(title="Festio Marketing Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["https://festio.events", "http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health(): return {"status": "ok", "service": "marketing-service"}


def enforce_form_rate_limit(db: Session, token: str, remote_ip: str) -> None:
    key = f"{token}:{remote_ip}"[:200]; window = now() - timedelta(minutes=10)
    row = db.get(FormRateLimit, key)
    if not row: db.add(FormRateLimit(key=key, count=1)); db.flush(); return
    if row.window_started_at.replace(tzinfo=timezone.utc) < window: row.window_started_at, row.count = now(), 1
    else:
        row.count += 1
        if row.count > int(os.getenv("MARKETING_FORM_RATE_LIMIT", "8")): raise HTTPException(429, "Too many submissions. Please try again later.")


@app.get("/api/marketing/forms/{public_token}")
def public_form(public_token: str, db: Session = Depends(db_session)):
    row = db.scalar(select(ModuleRecord).where(ModuleRecord.module=="forms", ModuleRecord.status=="active", ModuleRecord.payload["public_token"].as_string()==public_token))
    if not row: raise HTTPException(404,"Form not found")
    return {"name":row.name,"title":row.payload.get("title") or row.name,"description":row.payload.get("description") or "","fields":row.payload.get("fields") or ["name","email","organization","event_type"],"turnstile_site_key":os.getenv("TURNSTILE_SITE_KEY","")}


@app.post("/api/marketing/forms/{public_token}/submit")
async def submit_public_form(public_token: str, body: dict, request: Request, db: Session = Depends(db_session)):
    row = db.scalar(select(ModuleRecord).where(ModuleRecord.module=="forms", ModuleRecord.status=="active", ModuleRecord.payload["public_token"].as_string()==public_token))
    if not row: raise HTTPException(404,"Form not found")
    enforce_form_rate_limit(db, public_token, request.client.host if request.client else "unknown")
    captcha_secret=os.getenv("TURNSTILE_SECRET_KEY","");captcha_token=str(body.pop("captcha_token","") or body.pop("cf-turnstile-response", ""))
    if not captcha_secret: raise HTTPException(503,"Lead capture CAPTCHA is not configured")
    async with httpx.AsyncClient(timeout=10) as client:
        verification=await client.post("https://challenges.cloudflare.com/turnstile/v0/siteverify",data={"secret":captcha_secret,"response":captcha_token,"remoteip":request.client.host if request.client else ""})
    if not verification.json().get("success"): raise HTTPException(400,"CAPTCHA verification failed")
    email=str(body.get("email") or "").strip().lower()
    if not email or "@" not in email: raise HTTPException(400,"A valid email is required")
    lead=db.scalar(select(Lead).where(Lead.email==email))
    if not lead:
        allowed={"name","phone","organization","event_type","event_date","guest_count","country","source","medium","campaign","referrer","landing_page"}
        values={key:value for key,value in body.items() if key in allowed};values["source"]=values.get("source") or f"form:{row.name}"
        lead=Lead(email=email,owner_email=row.owner_email or os.getenv("MARKETING_DEFAULT_OWNER","muritala@festio.events"),registered_at=now(),**values);db.add(lead);db.flush()
    db.add(Activity(lead_id=lead.id,kind="form_submitted",summary=f"Submitted {row.name}",actor="public_form",data={"form_id":row.id}))
    audit(db,"public_form","form.submitted","lead",lead.id,form_id=row.id);db.commit();return {"ok":True,"message":row.payload.get("success_message") or "Thanks. Our team will follow up shortly."}


@app.get("/api/marketing/me")
def me(identity: Identity = Depends(decode_identity)): return identity.model_dump()


@app.post("/api/marketing/internal/ingest")
def ingest(body: dict, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    if not identity.is_superadmin: raise HTTPException(403, "Internal ingest requires platform authority")
    email = (body.get("email") or "").lower()
    subject = str(body.get("festio_user_id") or "")
    if not email: raise HTTPException(400, "Email is required")
    row = db.scalar(select(Lead).where((Lead.festio_user_id == subject) | (Lead.email == email)))
    if not row:
        registered_at = body.get("registered_at")
        if isinstance(registered_at, str):
            try: registered_at = datetime.fromisoformat(registered_at.replace("Z", "+00:00"))
            except ValueError: registered_at = None
        row = Lead(email=email, festio_user_id=subject or None, name=body.get("name") or "", source=body.get("source") or "website", stage=body.get("stage") or "registered", owner_email=os.getenv("MARKETING_DEFAULT_OWNER", "muritala@festio.events"), registered_at=registered_at or now(), last_active_at=now(), next_follow_up_at=now() + timedelta(hours=1), consent_email=True)
        db.add(row); db.flush(); db.add(Activity(lead_id=row.id, kind="registered", summary="Festio account registered", actor="festio"))
    else:
        row.last_active_at = now()
        if body.get("name"): row.name = body["name"]
        prev_stage = row.stage
        if body.get("stage") and row.stage in {"registered", "event_created"}: row.stage = body["stage"]
        if body.get("event_type"): row.event_type = body["event_type"]
        if body.get("guest_count") is not None: row.guest_count = body["guest_count"]
        if body.get("stage") == "event_created": row.score = max(row.score, 30)
        # Re-enroll in sequences when stage advances so stage-specific follow-ups fire
        if row.stage != prev_stage and row.consent_email and not row.unsubscribed:
            row.next_follow_up_at = now()
        if body.get("registered_at"):
            try: row.registered_at = datetime.fromisoformat(str(body["registered_at"]).replace("Z", "+00:00"))
            except ValueError: pass
    if body.get("consent_email") is True and not row.unsubscribed:
        row.consent_email = True
    for field in ("source", "medium", "campaign", "referrer", "landing_page"):
        if body.get(field): setattr(row, field, body[field])
    db.commit(); db.refresh(row); return lead_out(row)


@app.get("/api/marketing/dashboard")
def dashboard(identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    stages = dict(db.execute(select(Lead.stage, func.count(Lead.id)).group_by(Lead.stage)).all())
    modules = dict(db.execute(select(ModuleRecord.module, func.count(ModuleRecord.id)).group_by(ModuleRecord.module)).all())
    due = db.scalar(select(func.count(Lead.id)).where(Lead.next_follow_up_at <= now())) or 0
    consented = db.scalar(select(func.count(Lead.id)).where(Lead.consent_email.is_(True), Lead.unsubscribed.is_(False))) or 0
    total = sum(stages.values())
    event_created = sum(stages.get(stage, 0) for stage in ("event_created", "activated", "qualified", "demo_booked", "paid", "customer"))
    paid = stages.get("paid", 0) + stages.get("customer", 0)
    unowned = db.scalar(select(func.count(Lead.id)).where(Lead.owner_email.is_(None))) or 0
    # SLA measures scheduled work that is actually due. Historical registrations
    # without a follow-up date no longer appear as thousands of false breaches.
    sla_overdue = db.scalar(select(func.count(Lead.id)).where(Lead.stage == "registered", Lead.next_follow_up_at.is_not(None), Lead.next_follow_up_at <= now())) or 0
    pipeline_value = db.scalar(select(func.sum(Lead.deal_value * func.coalesce(Lead.probability, 0) / 100.0))) or 0
    return {"total_leads": total, "stages": stages, "modules": modules, "follow_ups_due": due, "email_marketable": consented, "unowned": unowned, "sla_overdue": sla_overdue, "expected_pipeline_value": round(float(pipeline_value), 2), "conversion": {"registered": total, "event_created": event_created, "paid": paid, "event_creation_rate": round(event_created * 100 / total, 1) if total else 0, "paid_rate": round(paid * 100 / total, 1) if total else 0}}


@app.get("/api/marketing/access")
def list_access(_: Identity = Depends(require_superadmin), db: Session = Depends(db_session)):
    return [{c.name: getattr(r, c.name) for c in r.__table__.columns} for r in db.scalars(select(AccessGrant).order_by(AccessGrant.created_at)).all()]


class GrantIn(BaseModel):
    email: EmailStr
    name: str = ""
    role: str = "marketer"
    owner_scoped: bool = False


@app.post("/api/marketing/access")
def grant_access(body: GrantIn, identity: Identity = Depends(require_superadmin), db: Session = Depends(db_session)):
    if body.role not in {"viewer", "marketer", "manager"}: raise HTTPException(400, "Invalid role")
    email = body.email.lower()
    row = db.scalar(select(AccessGrant).where(AccessGrant.email == email))
    if row: row.active, row.role, row.name, row.owner_scoped = True, body.role, body.name, body.owner_scoped
    else: row = AccessGrant(email=email, name=body.name, role=body.role, owner_scoped=body.owner_scoped, granted_by=identity.email); db.add(row)
    db.flush(); audit(db, identity, "access.granted", "access_grant", row.id, email=email, role=body.role, owner_scoped=body.owner_scoped); db.commit(); db.refresh(row)
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


@app.delete("/api/marketing/access/{grant_id}", status_code=204)
def revoke_access(grant_id: str, identity: Identity = Depends(require_superadmin), db: Session = Depends(db_session)):
    row = db.get(AccessGrant, grant_id)
    if row: row.active = False; audit(db, identity, "access.revoked", "access_grant", row.id, email=row.email); db.commit()


@app.get("/api/marketing/leads")
def list_leads(stage: str | None = None, q: str | None = None, owner: str | None = None, source: str | None = None, campaign: str | None = None, consent: bool | None = None, follow_up: str | None = None, date_from: datetime | None = None, date_to: datetime | None = None, tag: str | None = None, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    stmt = select(Lead)
    if identity.owner_scoped: stmt = stmt.where(Lead.owner_email == identity.email)
    if stage: stmt = stmt.where(Lead.stage == stage)
    if q: stmt = stmt.where((Lead.email.ilike(f"%{q}%")) | (Lead.name.ilike(f"%{q}%")) | (Lead.organization.ilike(f"%{q}%")))
    if owner: stmt = stmt.where(Lead.owner_email == owner)
    if source: stmt = stmt.where(Lead.source == source)
    if campaign: stmt = stmt.where(Lead.campaign == campaign)
    if consent is not None: stmt = stmt.where(Lead.consent_email.is_(consent))
    if follow_up == "due": stmt = stmt.where(Lead.next_follow_up_at <= now())
    if follow_up == "scheduled": stmt = stmt.where(Lead.next_follow_up_at > now())
    if date_from: stmt = stmt.where(Lead.registered_at >= date_from)
    if date_to: stmt = stmt.where(Lead.registered_at <= date_to)
    if tag: stmt = stmt.where(Lead.tags.contains(tag))
    return [lead_out(r) for r in db.scalars(stmt.order_by(Lead.updated_at.desc()).limit(500)).all()]


@app.post("/api/marketing/leads")
def create_lead(body: LeadIn, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    row = db.scalar(select(Lead).where(Lead.email == body.email.lower()))
    if row: raise HTTPException(409, "Lead already exists")
    values = body.model_dump()
    values["email"] = body.email.lower()
    if identity.owner_scoped: values["owner_email"] = identity.email
    row = Lead(**values)
    if row.consent_email:
        row.next_follow_up_at = now() + timedelta(minutes=int(os.getenv("MARKETING_INITIAL_DELAY_MINUTES", "60")))
    db.add(row)
    try: db.flush()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, "Lead already exists")
    db.add(Activity(lead_id=row.id, kind="created", summary="Lead created", actor=identity.email)); audit(db, identity, "lead.created", "lead", row.id, consent_email=row.consent_email, consent_sms=row.consent_sms); db.commit(); db.refresh(row)
    return lead_out(row)


@app.patch("/api/marketing/leads/{lead_id}")
def update_lead(lead_id: str, body: dict, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    row = visible_lead(db, lead_id, identity)
    allowed = {c.name for c in Lead.__table__.columns} - {"id", "created_at", "updated_at", "festio_user_id", "stage_changed_at"}
    previous_stage, previous_score = row.stage, row.score
    for key, value in body.items():
        if identity.owner_scoped and key == "owner_email": continue
        if key in allowed:
            if key in {"registered_at", "last_active_at", "next_follow_up_at"} and isinstance(value, str):
                try: value = datetime.fromisoformat(value.replace("Z", "+00:00"))
                except ValueError: raise HTTPException(400, f"Invalid {key}")
            setattr(row, key, value)
    if "probability" in body and row.probability is not None:
        row.probability = max(0, min(100, int(row.probability)))
    if row.stage != previous_stage:
        row.stage_changed_at = now()
        if row.consent_email and not row.unsubscribed: row.next_follow_up_at = now()
        db.add(Activity(lead_id=row.id, kind="stage_changed", summary=f"Stage changed from {previous_stage} to {row.stage}", actor=identity.email, data={"from": previous_stage, "to": row.stage}))
    if row.score != previous_score:
        db.add(Activity(lead_id=row.id, kind="score_changed", summary=f"Score changed from {previous_score} to {row.score}", actor=identity.email, data={"from": previous_score, "to": row.score}))
    if any(key in body for key in ("consent_email", "consent_sms", "unsubscribed")):
        audit(db, identity, "consent.changed", "lead", row.id, consent_email=row.consent_email, consent_sms=row.consent_sms, unsubscribed=row.unsubscribed)
    db.add(Activity(lead_id=row.id, kind="updated", summary="Lead updated", actor=identity.email, data={"fields": list(body)})); audit(db, identity, "lead.updated", "lead", row.id, fields=list(body)); db.commit(); db.refresh(row)
    return lead_out(row)


@app.delete("/api/marketing/leads/{lead_id}", status_code=204)
def delete_lead(lead_id:str, identity:Identity=Depends(require_manager), db:Session=Depends(db_session)):
    row=visible_lead(db,lead_id,identity)
    # SQLite does not enforce ORM cascades here, so remove owned timeline data
    # explicitly and retain a non-PII audit record of the cleanup.
    db.query(Activity).filter(Activity.lead_id==lead_id).delete(synchronize_session=False)
    audit(db,identity,"lead.deleted","lead",lead_id);db.delete(row);db.commit()


@app.get("/api/marketing/leads/{lead_id}/activity")
def activities(lead_id: str, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    visible_lead(db, lead_id, identity)
    rows = db.scalars(select(Activity).where(Activity.lead_id == lead_id).order_by(Activity.created_at.desc())).all()
    return [{c.name: getattr(r, c.name) for c in r.__table__.columns} for r in rows]


@app.post("/api/marketing/leads/{lead_id}/activity")
def add_activity(lead_id: str, body: dict, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    visible_lead(db, lead_id, identity)
    row = Activity(lead_id=lead_id, kind=body.get("kind", "note"), summary=body.get("summary", ""), actor=identity.email, data=body.get("data", {})); db.add(row); db.commit(); db.refresh(row)
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


@app.post("/api/marketing/leads/{lead_id}/demo")
def schedule_demo(lead_id:str, body:dict, identity:Identity=Depends(decode_identity), db:Session=Depends(db_session)):
    row=visible_lead(db,lead_id,identity)
    try: start=datetime.fromisoformat(str(body.get("starts_at") or "").replace("Z","+00:00"))
    except ValueError: raise HTTPException(400,"A valid demo start time is required")
    duration=max(15,min(180,int(body.get("duration_minutes") or 30)));end=start+timedelta(minutes=duration);title=f"Festio demo with {row.name or row.organization or row.email}";details=str(body.get("notes") or "Festio event planning demo")
    calendar_url=f"https://calendar.google.com/calendar/render?action=TEMPLATE&text={quote(title)}&dates={start.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}/{end.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}&details={quote(details)}"
    row.demo_at=start;row.calendar_url=calendar_url;row.stage="demo_booked";row.stage_changed_at=now();db.add(Activity(lead_id=row.id,kind="demo_booked",summary="Demo booked",actor=identity.email,data={"starts_at":start.isoformat(),"duration_minutes":duration,"calendar_url":calendar_url}));audit(db,identity,"demo.booked","lead",row.id,starts_at=start.isoformat());db.commit();return {"starts_at":start,"ends_at":end,"calendar_url":calendar_url}


MODULES = {"segments", "sequences", "campaigns", "content", "referrals", "tasks", "experiments", "forms"}


@app.get("/api/marketing/modules/{module}")
def list_records(module: str, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    if module not in MODULES: raise HTTPException(404, "Module not found")
    return [record_out(r) for r in db.scalars(select(ModuleRecord).where(ModuleRecord.module == module).order_by(ModuleRecord.updated_at.desc())).all()]


@app.post("/api/marketing/modules/{module}")
def create_record(module: str, body: RecordIn, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    if module not in MODULES: raise HTTPException(404, "Module not found")
    values = body.model_dump()
    if module == "forms": values["payload"] = {**values.get("payload", {}), "public_token": values.get("payload", {}).get("public_token") or secrets.token_urlsafe(24)}
    row = ModuleRecord(module=module, created_by=identity.email, **values); db.add(row); db.flush(); audit(db, identity, "module.created", module, row.id, name=row.name); db.commit(); db.refresh(row); return record_out(row)


@app.patch("/api/marketing/modules/{module}/{record_id}")
def update_record(module: str, record_id: str, body: dict, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    row = db.get(ModuleRecord, record_id)
    if not row or row.module != module: raise HTTPException(404, "Record not found")
    for key in ("name", "status", "owner_email", "payload", "scheduled_at"):
        if key in body: setattr(row, key, body[key])
    audit(db, identity, "module.updated", module, row.id, fields=list(body)); db.commit(); db.refresh(row); return record_out(row)


@app.delete("/api/marketing/modules/{module}/{record_id}", status_code=204)
def delete_record(module: str, record_id: str, identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    row = db.get(ModuleRecord, record_id)
    if row and row.module == module: audit(db, identity, "module.deleted", module, row.id, name=row.name); db.delete(row); db.commit()


@app.post("/api/marketing/leads/merge")
def merge_leads(body: dict, identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    target = visible_lead(db, str(body.get("target_id") or ""), identity)
    source = visible_lead(db, str(body.get("source_id") or ""), identity)
    if target.id == source.id: raise HTTPException(400, "Choose two different leads")
    for field in ("name","phone","organization","event_type","event_date","guest_count","country","owner_email","medium","campaign","referrer","landing_page","deal_value","probability","close_date","demo_at","calendar_url"):
        if not getattr(target, field, None) and getattr(source, field, None): setattr(target, field, getattr(source, field))
    target.tags = list(dict.fromkeys([*(target.tags or []), *(source.tags or [])]))
    target.consent_email = target.consent_email or source.consent_email
    target.consent_sms = target.consent_sms or source.consent_sms
    db.query(Activity).filter(Activity.lead_id == source.id).update({Activity.lead_id: target.id}, synchronize_session=False)
    audit(db, identity, "lead.merged", "lead", target.id, source_id=source.id); db.delete(source); db.commit(); db.refresh(target)
    return lead_out(target)


@app.get("/api/marketing/tags")
def tag_taxonomy(identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    counts: dict[str,int] = {}
    stmt = select(Lead)
    if identity.owner_scoped: stmt = stmt.where(Lead.owner_email == identity.email)
    for lead in db.scalars(stmt).all():
        for tag in lead.tags or []: counts[str(tag)] = counts.get(str(tag), 0) + 1
    return [{"name": name, "count": count} for name,count in sorted(counts.items(), key=lambda item:(-item[1],item[0].lower()))]


@app.patch("/api/marketing/tags/{tag_name}")
def rename_tag(tag_name: str, body: dict, identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    replacement = str(body.get("name") or "").strip()
    if not replacement: raise HTTPException(400, "New tag name is required")
    changed=0
    for lead in db.scalars(select(Lead)).all():
        if tag_name in (lead.tags or []): lead.tags=list(dict.fromkeys(replacement if tag==tag_name else tag for tag in lead.tags)); changed+=1
    audit(db,identity,"tag.renamed","tag",tag_name,new_name=replacement,count=changed);db.commit();return {"updated":changed}


@app.delete("/api/marketing/tags/{tag_name}")
def remove_tag(tag_name: str, identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    changed=0
    for lead in db.scalars(select(Lead)).all():
        if tag_name in (lead.tags or []): lead.tags=[tag for tag in lead.tags if tag!=tag_name];changed+=1
    audit(db,identity,"tag.deleted","tag",tag_name,count=changed);db.commit();return {"updated":changed}


def lead_matches_segment(lead: Lead, segment: ModuleRecord) -> bool:
    rules = segment.payload.get("rules") or ([{key: segment.payload.get(key) for key in ("field", "operator", "value")}] if segment.payload.get("field") else [])
    for rule in rules:
        field, operator, expected = str(rule.get("field") or ""), str(rule.get("operator") or "equals"), rule.get("value")
        if field not in {c.name for c in Lead.__table__.columns}: return False
        actual = getattr(lead, field, None)
        if operator == "equals" and str(actual).lower() != str(expected).lower(): return False
        if operator == "not_equals" and str(actual).lower() == str(expected).lower(): return False
        if operator == "contains" and str(expected).lower() not in str(actual or "").lower(): return False
        if operator == "in" and str(actual).lower() not in {str(value).lower() for value in (expected if isinstance(expected, list) else str(expected).split(","))}: return False
        if operator == "exists" and not actual: return False
        if operator in {"greater_than", "less_than"}:
            try:
                if operator == "greater_than" and not float(actual) > float(expected): return False
                if operator == "less_than" and not float(actual) < float(expected): return False
            except (TypeError, ValueError): return False
    return True


def campaign_audience(campaign: ModuleRecord, db: Session) -> list[Lead]:
    reference = str(campaign.payload.get("segment_id") or campaign.payload.get("audience") or "")
    segment = db.get(ModuleRecord, reference) or db.scalar(select(ModuleRecord).where(ModuleRecord.module == "segments", ModuleRecord.name == reference))
    if not segment or segment.module != "segments": raise HTTPException(400, "Choose a valid saved segment before sending")
    leads = db.scalars(select(Lead).where(Lead.consent_email.is_(True), Lead.unsubscribed.is_(False))).all()
    return [lead for lead in leads if lead_matches_segment(lead, segment)]


@app.post("/api/marketing/campaigns/{campaign_id}/execute")
def execute_campaign(campaign_id: str, dry_run: bool = Query(False), identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    campaign = db.get(ModuleRecord, campaign_id)
    if not campaign or campaign.module != "campaigns": raise HTTPException(404, "Campaign not found")
    if not sequence_steps(campaign): raise HTTPException(400, "Add an email subject and message before sending")
    audience = campaign_audience(campaign, db)
    if dry_run: return {"dry_run": True, "eligible": len(audience), "recipients": [{"id": row.id, "email": row.email, "name": row.name} for row in audience[:100]]}
    sent = failed = 0
    for lead in audience:
        already_sent = db.scalar(select(func.count(Activity.id)).where(Activity.lead_id == lead.id, Activity.data["campaign_id"].as_string() == campaign.id)) or 0
        if already_sent: continue
        try: delivery = send_follow_up(lead, campaign); sent += 1
        except Exception as exc:
            logger.exception("Campaign delivery failed"); delivery = {"status": "failed", "provider": "resend", "provider_id": None, "error": str(exc)[:240]}; failed += 1
        db.add(Activity(lead_id=lead.id, kind=f"email_{delivery['status']}", summary=f"Campaign {campaign.name}: {delivery['status']}", actor=identity.email, data={"campaign_id": campaign.id, **delivery}))
    campaign.payload = {**campaign.payload, "last_executed_at": now().isoformat(), "sent": sent, "failed": failed}
    audit(db, identity, "campaign.executed", "campaigns", campaign.id, eligible=len(audience), sent=sent, failed=failed); db.commit()
    return {"eligible": len(audience), "sent": sent, "failed": failed}


@app.post("/api/marketing/campaigns/{campaign_id}/preview")
def preview_campaign(campaign_id: str, identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    campaign = db.get(ModuleRecord, campaign_id)
    if not campaign or campaign.module != "campaigns": raise HTTPException(404, "Campaign not found")
    if not sequence_steps(campaign): raise HTTPException(400, "Add an email subject and message before previewing")
    preview_lead = Lead(id=uid(), email=identity.email, name=identity.name or "Festio teammate")
    delivery = send_follow_up(preview_lead, campaign)
    audit(db, identity, "campaign.previewed", "campaigns", campaign.id, provider=delivery.get("provider")); db.commit()
    return delivery


@app.post("/api/marketing/sequences/{sequence_id}/preview")
def preview_sequence(sequence_id: str, step: int = Query(0, ge=0), identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    """Send a test email for a specific sequence step to the requesting manager."""
    seq = db.get(ModuleRecord, sequence_id)
    if not seq or seq.module != "sequences": raise HTTPException(404, "Sequence not found")
    steps = sequence_steps(seq)
    if not steps: raise HTTPException(400, "Add at least one step with a subject before previewing")
    preview_lead = Lead(id=uid(), email=identity.email, name=identity.name or "Festio teammate")
    delivery = send_follow_up(preview_lead, seq, min(step, len(steps) - 1))
    audit(db, identity, "sequence.previewed", "sequences", seq.id, step=step, provider=delivery.get("provider")); db.commit()
    return delivery



def bulk_leads(body: dict, identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    ids = list(dict.fromkeys(body.get("ids") or []))[:500]
    action, value = body.get("action"), body.get("value")
    stmt=select(Lead).where(Lead.id.in_(ids))
    if identity.owner_scoped: stmt=stmt.where(Lead.owner_email==identity.email)
    rows = db.scalars(stmt).all() if ids else []
    for row in rows:
        if action == "assign": row.owner_email = value or None
        elif action == "stage" and value in {"registered","event_created","activated","qualified","demo_booked","paid","customer","inactive","lost"}: row.stage = value
        elif action == "tag" and value: row.tags = list(dict.fromkeys([*(row.tags or []), str(value)]))
        elif action == "schedule": row.next_follow_up_at = now()
        else: raise HTTPException(400, "Unsupported bulk action")
        db.add(Activity(lead_id=row.id, kind="bulk_updated", summary=f"Bulk {action}", actor=identity.email, data={"value": value}))
    audit(db, identity, f"leads.bulk_{action}", "lead", data_count=len(rows), value=value); db.commit()
    return {"updated": len(rows)}


@app.get("/api/marketing/saved-views")
def list_saved_views(identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    rows=db.scalars(select(SavedView).where((SavedView.owner_email==identity.email)|(SavedView.shared.is_(True))).order_by(SavedView.created_at)).all()
    return [{c.name:getattr(row,c.name) for c in row.__table__.columns} for row in rows]


@app.post("/api/marketing/saved-views")
def create_saved_view(body: dict, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    row=SavedView(name=str(body.get("name") or "My view")[:160],owner_email=identity.email,filters=body.get("filters") or {},shared=bool(body.get("shared")));db.add(row);audit(db,identity,"view.created","saved_view",row.id);db.commit();db.refresh(row)
    return {c.name:getattr(row,c.name) for c in row.__table__.columns}


@app.delete("/api/marketing/saved-views/{view_id}",status_code=204)
def delete_saved_view(view_id:str,identity:Identity=Depends(decode_identity),db:Session=Depends(db_session)):
    row=db.get(SavedView,view_id)
    if not row or (row.owner_email!=identity.email and not identity.is_superadmin): raise HTTPException(404,"View not found")
    db.delete(row);audit(db,identity,"view.deleted","saved_view",view_id);db.commit()


@app.get("/api/marketing/audit")
def audit_history(limit:int=100,identity:Identity=Depends(require_manager),db:Session=Depends(db_session)):
    rows=db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(min(limit,500))).all()
    return [{c.name:getattr(row,c.name) for c in row.__table__.columns} for row in rows]


@app.get("/api/marketing/export/leads.csv")
def export_leads(identity:Identity=Depends(decode_identity),db:Session=Depends(db_session)):
    fields=["email","name","organization","phone","registered_at","stage","score","owner_email","source","medium","campaign","tags","consent_email","consent_sms","unsubscribed"]
    output=io.StringIO(); writer=csv.DictWriter(output,fieldnames=fields);writer.writeheader()
    stmt=select(Lead)
    if identity.owner_scoped: stmt=stmt.where(Lead.owner_email==identity.email)
    for row in db.scalars(stmt.order_by(Lead.registered_at.desc())).all():
        data=lead_out(row);data["tags"]="|".join(data.get("tags") or []);writer.writerow({key:data.get(key) for key in fields})
    return StreamingResponse(iter([output.getvalue()]),media_type="text/csv",headers={"Content-Disposition":"attachment; filename=festio-marketing-leads.csv"})


@app.post("/api/marketing/import/leads.csv")
async def import_leads(file:UploadFile=File(...),identity:Identity=Depends(require_manager),db:Session=Depends(db_session)):
    rows=list(csv.DictReader(io.StringIO((await file.read()).decode("utf-8-sig"))))[:5000];created=updated=0
    for item in rows:
        email=(item.get("email") or "").strip().lower()
        if not email or "@" not in email: continue
        row=db.scalar(select(Lead).where(Lead.email==email))
        if not row: row=Lead(email=email,name=item.get("name") or "",source=item.get("source") or "csv_import",owner_email=item.get("owner_email") or None,tags=[v for v in (item.get("tags") or "").split("|") if v]);db.add(row);created+=1
        else: updated+=1
    audit(db,identity,"leads.imported","lead",data_count=len(rows),created=created,updated=updated);db.commit();return {"processed":len(rows),"created":created,"updated":updated}


@app.get("/api/marketing/analytics")
def analytics(days:int=30,identity:Identity=Depends(decode_identity),db:Session=Depends(db_session)):
    since=now()-timedelta(days=max(1,min(days,365)))
    leads=db.scalars(select(Lead).where(Lead.registered_at>=since)).all()
    by_source:dict[str,int]={};by_campaign:dict[str,int]={};daily:dict[str,int]={}
    for lead in leads:
        by_source[lead.source or "direct"]=by_source.get(lead.source or "direct",0)+1
        by_campaign[lead.campaign or "unattributed"]=by_campaign.get(lead.campaign or "unattributed",0)+1
        day=(lead.registered_at or lead.created_at).date().isoformat();daily[day]=daily.get(day,0)+1
    events=db.scalars(select(Activity).where(Activity.created_at>=since,Activity.kind.like("email_%"))).all();delivery={};campaign_delivery={}
    for event in events:
        delivery[event.kind]=delivery.get(event.kind,0)+1
        campaign_id=(event.data or {}).get("campaign_id")
        if campaign_id:
            bucket=campaign_delivery.setdefault(campaign_id,{})
            bucket[event.kind]=bucket.get(event.kind,0)+1
    stages=dict(db.execute(select(Lead.stage,func.count(Lead.id)).group_by(Lead.stage)).all())
    expected_pipeline=sum((lead.deal_value or 0)*(lead.probability or 0)/100 for lead in db.scalars(select(Lead)).all())
    return {"days":days,"total":len(leads),"sources":by_source,"campaigns":by_campaign,"daily":daily,"delivery":delivery,"campaign_delivery":campaign_delivery,"funnel":stages,"expected_pipeline_value":round(expected_pipeline,2)}


@app.get("/api/marketing/preferences/me")
def get_preferences(identity:Identity=Depends(decode_identity),db:Session=Depends(db_session)):
    row=db.scalar(select(Lead).where(Lead.email==identity.email));return {"email":identity.email,"consent_email":bool(row and row.consent_email),"consent_sms":bool(row and row.consent_sms),"unsubscribed":bool(row and row.unsubscribed)}


@app.put("/api/marketing/preferences/me")
def set_preferences(body:dict,identity:Identity=Depends(decode_identity),db:Session=Depends(db_session)):
    row=db.scalar(select(Lead).where(Lead.email==identity.email))
    if not row: raise HTTPException(404,"Marketing profile not found")
    row.consent_email=bool(body.get("consent_email"));row.consent_sms=bool(body.get("consent_sms"));row.unsubscribed=not row.consent_email
    db.add(Activity(lead_id=row.id,kind="consent_changed",summary="Communication preferences updated",actor=identity.email,data={"email":row.consent_email,"sms":row.consent_sms}));audit(db,identity,"consent.changed","lead",row.id,email=row.consent_email,sms=row.consent_sms);db.commit();return {"ok":True}


@app.get("/api/marketing/internal/preferences/{email}")
def internal_preferences(email:str,identity:Identity=Depends(decode_identity),db:Session=Depends(db_session)):
    if not identity.is_superadmin: raise HTTPException(403,"Internal preference access requires platform authority")
    row=db.scalar(select(Lead).where(Lead.email==email.lower()))
    return {"email":email.lower(),"consent_email":bool(row and row.consent_email),"consent_sms":bool(row and row.consent_sms),"unsubscribed":bool(row and row.unsubscribed)}


@app.put("/api/marketing/internal/preferences/{email}")
def internal_set_preferences(email:str,body:dict,identity:Identity=Depends(decode_identity),db:Session=Depends(db_session)):
    if not identity.is_superadmin: raise HTTPException(403,"Internal preference access requires platform authority")
    row=db.scalar(select(Lead).where(Lead.email==email.lower()))
    if not row:
        row=Lead(email=email.lower(),source="account_preferences",registered_at=now());db.add(row);db.flush()
    row.consent_email=bool(body.get("consent_email"));row.consent_sms=bool(body.get("consent_sms"));row.unsubscribed=not row.consent_email
    db.add(Activity(lead_id=row.id,kind="consent_changed",summary="Account communication preferences updated",actor=email.lower(),data={"email":row.consent_email,"sms":row.consent_sms}));audit(db,email.lower(),"consent.changed","lead",row.id,email=row.consent_email,sms=row.consent_sms);db.commit()
    return {"email":email.lower(),"consent_email":row.consent_email,"consent_sms":row.consent_sms,"unsubscribed":row.unsubscribed}


@app.get("/api/marketing/providers")
def provider_readiness(identity:Identity=Depends(decode_identity), db:Session=Depends(db_session)):
    social={platform:social_credentials(db,platform) for platform in SOCIAL_FIELDS}
    return {"email":{"provider":"resend","configured":bool(os.getenv("RESEND_API_KEY"))},"sms":{"provider":"signalhouse","configured":bool(os.getenv("SIGNALHOUSE_API_KEY") and os.getenv("SIGNALHOUSE_FROM_NUMBER"))},"whatsapp":{"provider":"bird","configured":bool(os.getenv("BIRD_ACCESS_KEY") and os.getenv("BIRD_WORKSPACE_ID") and os.getenv("BIRD_WHATSAPP_CHANNEL_ID"))},"social":{"linkedin":bool(social["linkedin"]["access_token"] and social["linkedin"]["author_urn"]),"facebook":bool(social["facebook"]["access_token"] and social["facebook"]["page_id"]),"instagram":bool(social["instagram"]["access_token"] and social["instagram"]["user_id"])},"oauth_refresh":{"linkedin":all(social["linkedin"].get(key) for key in ("refresh_token","client_id","client_secret")),"facebook":all(social["facebook"].get(key) for key in ("access_token","app_id","app_secret")),"instagram":all(social["instagram"].get(key) for key in ("access_token","app_id","app_secret"))}}


@app.get("/api/marketing/social-connections")
def list_social_connections(identity:Identity=Depends(require_superadmin), db:Session=Depends(db_session)):
    return [social_connection_out(db, platform) for platform in SOCIAL_FIELDS]


@app.put("/api/marketing/social-connections/{platform}")
def save_social_connection(platform:str, body:dict, identity:Identity=Depends(require_superadmin), db:Session=Depends(db_session)):
    if platform not in SOCIAL_FIELDS: raise HTTPException(404,"Social platform not found")
    credentials=saved_social_credentials(db,platform)
    for field in SOCIAL_FIELDS[platform]:
        value=str(body.get(field) or "").strip()
        if value: credentials[field]=value
    for field in body.get("clear_fields",[]):
        if field in SOCIAL_FIELDS[platform]: credentials.pop(field,None)
    row=db.get(SocialConnection,platform) or SocialConnection(platform=platform)
    row.encrypted_credentials=credential_cipher().encrypt(json.dumps(credentials).encode()).decode();row.updated_by=identity.email;db.add(row)
    audit(db,identity,"social.credentials_updated","provider",platform,fields=[key for key in body if key!="clear_fields"],cleared=body.get("clear_fields",[]));db.commit();db.refresh(row)
    return social_connection_out(db,platform)


@app.post("/api/marketing/social-connections/{platform}/test")
async def test_social_connection(platform:str, identity:Identity=Depends(require_superadmin), db:Session=Depends(db_session)):
    if platform not in SOCIAL_FIELDS: raise HTTPException(404,"Social platform not found")
    credentials=social_credentials(db,platform);token=credentials.get("access_token")
    if not token: raise HTTPException(400,"Save an access token before testing")
    async with httpx.AsyncClient(timeout=20) as client:
        if platform=="linkedin": response=await client.get("https://api.linkedin.com/v2/userinfo",headers={"Authorization":f"Bearer {token}"})
        else: response=await client.get("https://graph.facebook.com/v23.0/me",params={"fields":"id,name","access_token":token})
    if response.status_code>=400: raise HTTPException(502,f"{platform.title()} rejected these credentials")
    audit(db,identity,"social.connection_tested","provider",platform);db.commit()
    details=response.json();return {"platform":platform,"connected":True,"account":details.get("name") or details.get("localizedFirstName") or details.get("sub") or details.get("id")}


async def refreshed_social_token(platform: str, db: Session) -> str:
    credentials=social_credentials(db,platform)
    if platform == "linkedin" and all(credentials.get(key) for key in ("refresh_token","client_id","client_secret")):
        async with httpx.AsyncClient(timeout=20) as client:
            response=await client.post("https://www.linkedin.com/oauth/v2/accessToken",data={"grant_type":"refresh_token","refresh_token":credentials["refresh_token"],"client_id":credentials["client_id"],"client_secret":credentials["client_secret"]})
        if response.status_code < 400: return response.json().get("access_token") or credentials["access_token"]
    if platform in {"facebook","instagram"} and all(credentials.get(key) for key in ("access_token","app_id","app_secret")):
        async with httpx.AsyncClient(timeout=20) as client:
            response=await client.get("https://graph.facebook.com/v23.0/oauth/access_token",params={"grant_type":"fb_exchange_token","client_id":credentials["app_id"],"client_secret":credentials["app_secret"],"fb_exchange_token":credentials["access_token"]})
        if response.status_code < 400: return response.json().get("access_token") or credentials["access_token"]
    return credentials.get("access_token","")


@app.post("/api/marketing/providers/{platform}/refresh")
async def refresh_provider(platform: str, identity:Identity=Depends(require_manager), db:Session=Depends(db_session)):
    if platform not in {"linkedin","facebook","instagram"}: raise HTTPException(400,"Unsupported provider")
    credentials=social_credentials(db,platform)
    refresh_ready = all(credentials.get(key) for key in (("refresh_token","client_id","client_secret") if platform=="linkedin" else ("access_token","app_id","app_secret")))
    if not refresh_ready: raise HTTPException(503,f"{platform.title()} OAuth refresh credentials are not configured")
    token=await refreshed_social_token(platform,db)
    if not token: raise HTTPException(503,f"{platform.title()} OAuth refresh is not configured")
    audit(db,identity,"provider.token_refreshed","provider",platform);db.commit();return {"platform":platform,"refreshed":True}


@app.post("/api/marketing/social/publish")
async def publish_social(body:SocialPublishIn, identity:Identity=Depends(require_manager), db:Session=Depends(db_session)):
    platform=body.platform.lower()
    if platform not in {"linkedin","facebook","instagram"}: raise HTTPException(400,"Unsupported social platform")
    if body.dry_run:
        audit(db,identity,"social.validated","content",None,platform=platform);db.commit();return {"status":"validated","platform":platform,"dry_run":True}
    async with httpx.AsyncClient(timeout=30) as client:
        if platform=="linkedin":
            credentials=social_credentials(db,"linkedin");token,author=await refreshed_social_token("linkedin",db),credentials["author_urn"]
            if not token or not author: raise HTTPException(503,"Connect a LinkedIn organization before publishing")
            payload={"author":author,"commentary":body.message,"visibility":"PUBLIC","distribution":{"feedDistribution":"MAIN_FEED","targetEntities":[],"thirdPartyDistributionChannels":[]},"lifecycleState":"PUBLISHED","isReshareDisabledByAuthor":False}
            response=await client.post("https://api.linkedin.com/rest/posts",headers={"Authorization":f"Bearer {token}","LinkedIn-Version":os.getenv("LINKEDIN_API_VERSION","202601"),"X-Restli-Protocol-Version":"2.0.0"},json=payload)
        elif platform=="facebook":
            credentials=social_credentials(db,"facebook");token,page=await refreshed_social_token("facebook",db),credentials["page_id"]
            if not token or not page: raise HTTPException(503,"Connect a Facebook Page before publishing")
            response=await client.post(f"https://graph.facebook.com/v23.0/{page}/feed",data={"message":body.message,"link":body.link_url or "","access_token":token})
        else:
            credentials=social_credentials(db,"instagram");token,user=await refreshed_social_token("instagram",db),credentials["user_id"]
            if not token or not user: raise HTTPException(503,"Connect an Instagram business account before publishing")
            if not body.image_url: raise HTTPException(400,"Instagram publishing requires a public image URL")
            created=await client.post(f"https://graph.facebook.com/v23.0/{user}/media",data={"image_url":body.image_url,"caption":body.message,"access_token":token})
            if created.status_code>=400: raise HTTPException(502,"Instagram could not create the media post")
            response=await client.post(f"https://graph.facebook.com/v23.0/{user}/media_publish",data={"creation_id":created.json().get("id"),"access_token":token})
    if response.status_code>=400: raise HTTPException(502,f"{platform.title()} rejected the post")
    result=response.json() if response.content else {};provider_id=result.get("id") or response.headers.get("x-restli-id")
    audit(db,identity,"social.published","content",provider_id,platform=platform);db.commit()
    return {"status":"published","platform":platform,"provider_id":provider_id}


@app.post("/api/marketing/leads/{lead_id}/sms")
async def send_lead_sms(lead_id:str, body:dict, identity:Identity=Depends(decode_identity), db:Session=Depends(db_session)):
    row=visible_lead(db,lead_id,identity); message=str(body.get("message") or "").strip()
    if not row.phone: raise HTTPException(400,"Lead has no phone number")
    if not row.consent_sms: raise HTTPException(409,"SMS consent is required")
    if not message: raise HTTPException(400,"Message is required")
    key,from_number=os.getenv("SIGNALHOUSE_API_KEY",""),os.getenv("SIGNALHOUSE_FROM_NUMBER","")
    if not all((key,from_number)): raise HTTPException(503,"SignalHouse SMS is not configured")
    final=f"{message[:1450]}\nReply STOP to opt out."
    async with httpx.AsyncClient(timeout=20) as client:
        response=await client.post(f"{os.getenv('SIGNALHOUSE_API_BASE','https://v2.signalhouse.io').rstrip('/')}/message/sms",headers={"Authorization":f"Bearer {key}"},json={"senderPhoneNumber":from_number,"recipientPhoneNumber":[row.phone],"messageBody":final,"enableShortlink":False,"statusCallbackUrl":os.getenv("SIGNALHOUSE_STATUS_CALLBACK_URL","")})
    if response.status_code>=400: raise HTTPException(502,"SignalHouse could not send this message")
    data=response.json() if response.content else {};provider_id=data.get("messageId") or data.get("id") or data.get("groupId");db.add(Activity(lead_id=row.id,kind="sms_sent",summary="Marketing SMS sent",actor=identity.email,data={"provider":"signalhouse","provider_id":provider_id}));audit(db,identity,"sms.sent","lead",row.id);db.commit();return {"status":"sent","provider":"signalhouse","provider_id":provider_id}


@app.post("/api/marketing/internal/delivery")
def ingest_delivery(body:dict, identity:Identity=Depends(decode_identity), db:Session=Depends(db_session)):
    if not identity.is_superadmin: raise HTTPException(403, "Internal delivery ingest requires platform authority")
    email=(body.get("email") or "").lower(); row=db.scalar(select(Lead).where(Lead.email==email))
    if not row: return {"recorded":False}
    event=str(body.get("event") or "delivered").replace("email.", "")
    provider_id = body.get("provider_id")
    prior = db.scalar(select(Activity).where(Activity.lead_id == row.id, Activity.data["provider_id"].as_string() == provider_id).order_by(Activity.created_at.desc())) if provider_id else None
    attribution = {key: (prior.data or {}).get(key) for key in ("campaign_id", "sequence_id") if prior and (prior.data or {}).get(key)}
    db.add(Activity(lead_id=row.id,kind=f"email_{event}",summary=f"Email {event}",actor="resend",data={"provider":"resend","provider_id":provider_id,"bounce_type":body.get("bounce_type"),**attribution}))
    # Suppress complaints and permanent bounces. Soft bounces stay eligible for retry.
    bounce_type = str(body.get("bounce_type") or "").lower()
    if event == "complained" or (event == "bounced" and bounce_type not in {"soft", "transient"}):
        row.unsubscribed = True
        row.consent_email = False
        row.next_follow_up_at = None
    db.commit()
    return {"recorded":True}


@app.post("/api/marketing/automation/run")
def run_automation(dry_run: bool = Query(False), identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    """Enroll due leads and queue consent-safe follow-ups from active sequences."""
    sequences = db.scalars(select(ModuleRecord).where(ModuleRecord.module == "sequences", ModuleRecord.status == "active")).all()
    leads = db.scalars(select(Lead).where(Lead.consent_email.is_(True), Lead.unsubscribed.is_(False), Lead.next_follow_up_at <= now())).all()
    queued = 0
    for lead in leads:
        matching = next((s for s in sequences if not s.payload.get("stage") or s.payload.get("stage") == lead.stage), None)
        if not matching: continue
        sent_count = db.scalar(select(func.count(Activity.id)).where(Activity.lead_id == lead.id, Activity.data["sequence_id"].as_string() == matching.id)) or 0
        steps = sequence_steps(matching)
        if not steps:
            # Sequence has no steps defined — skip to avoid infinite follow-up loop
            lead.next_follow_up_at = None
            continue
        max_touches = max(1, int(matching.payload.get("max_touches") or len(steps)))
        if sent_count >= min(len(steps), max_touches):
            lead.next_follow_up_at = None
            continue
        if dry_run:
            queued += 1
            continue
        try: delivery = send_follow_up(lead, matching, sent_count)
        except Exception: delivery = {"status":"failed","provider":"resend","provider_id":None}
        db.add(Activity(lead_id=lead.id, kind=f"email_{delivery['status']}", summary=f"Follow-up {delivery['status']} from {matching.name}", actor=identity.email, data={"sequence_id": matching.id, "step_index": sent_count, **delivery}))
        lead.next_follow_up_at = now() + timedelta(hours=int((steps[sent_count].get("next_delay_hours") if steps and sent_count < len(steps) else None) or int(matching.payload.get("cadence_days", 3)) * 24))
        queued += 1
    if not dry_run: db.commit()
    else: db.rollback()
    return {"queued": queued, "eligible": len(leads), "active_sequences": len(sequences), "dry_run": dry_run}


@app.post("/api/marketing/leads/{lead_id}/gdpr-delete")
def request_gdpr_deletion(lead_id:str, identity:Identity=Depends(require_manager), db:Session=Depends(db_session)):
    row=visible_lead(db,lead_id,identity);row.deletion_requested_at=now();row.consent_email=False;row.consent_sms=False;row.unsubscribed=True;row.next_follow_up_at=None
    audit(db,identity,"gdpr.deletion_requested","lead",row.id);db.commit();return {"scheduled":True,"purge_after_days":int(os.getenv("MARKETING_GDPR_GRACE_DAYS","30"))}


def run_gdpr_retention(db:Session, identity:Identity) -> int:
    grace=int(os.getenv("MARKETING_GDPR_GRACE_DAYS","30"));cutoff=now()-timedelta(days=max(0,grace));rows=db.scalars(select(Lead).where(Lead.deletion_requested_at.is_not(None),Lead.deletion_requested_at<=cutoff)).all()
    for row in rows:
        db.query(Activity).filter(Activity.lead_id==row.id).delete(synchronize_session=False)
        audit(db,identity,"gdpr.lead_purged","lead",row.id);db.delete(row)
    db.commit();return len(rows)


def acquire_lease(db:Session,name:str,seconds:int=840) -> bool:
    holder=f"{os.getpid()}-{uuid.uuid4()}";expiry=now()+timedelta(seconds=seconds);row=db.get(AutomationLease,name)
    if row and row.expires_at.replace(tzinfo=timezone.utc)>now(): return False
    if row: row.holder,row.expires_at=holder,expiry
    else: db.add(AutomationLease(name=name,holder=holder,expires_at=expiry))
    try: db.commit();return True
    except IntegrityError: db.rollback();return False


async def run_scheduled_social(db:Session, identity:Identity) -> int:
    rows=db.scalars(select(ModuleRecord).where(ModuleRecord.module=="content",ModuleRecord.status=="scheduled",ModuleRecord.scheduled_at.is_not(None),ModuleRecord.scheduled_at<=now())).all();published=0
    for row in rows:
        try:
            await publish_social(SocialPublishIn(platform=row.payload.get("channel") or "",message=row.payload.get("caption") or row.name,link_url=row.payload.get("link_url"),image_url=row.payload.get("image_url")),identity=identity,db=db);row.status="complete";published+=1
        except Exception as exc:
            audit(db,identity,"social.schedule_failed","content",row.id,error=str(exc)[:300])
    db.commit();return published


def scheduled_automation() -> None:
    """Run consent-safe follow-ups every 15 minutes without a separate worker."""
    while True:
        threading.Event().wait(900)
        try:
            with SessionLocal() as db:
                identity = Identity(subject="scheduler", email="automation@festio.events", name="Festio Automation", is_superadmin=True, role="superadmin")
                if not acquire_lease(db,"marketing-scheduler"): continue
                run_automation(dry_run=False, identity=identity, db=db)
                asyncio.run(run_scheduled_social(db,identity))
                run_gdpr_retention(db,identity)
        except Exception as exc:
            # A delivery outage must not terminate the scheduler.
            logger.exception("Marketing automation scheduler failed")
            try:
                with SessionLocal() as db:
                    audit(db, "automation@festio.events", "automation.failed", "scheduler", error=str(exc)[:500]); db.commit()
            except Exception: logger.exception("Could not persist scheduler failure")


@app.on_event("startup")
def start_scheduler():
    threading.Thread(target=scheduled_automation, name="marketing-automation", daemon=True).start()


@app.post("/api/marketing/unsubscribe/{lead_id}")
def unsubscribe(lead_id: str, db: Session = Depends(db_session)):
    row = db.get(Lead, lead_id)
    if not row: raise HTTPException(404, "Lead not found")
    row.unsubscribed = True; row.consent_email = False; db.commit(); return {"ok": True}

@app.get("/api/marketing/unsubscribe/{lead_id}", response_class=HTMLResponse)
def unsubscribe_get(lead_id: str, db: Session = Depends(db_session)):
    """Handles GET requests from email anchor-tag unsubscribe links (CAN-SPAM)."""
    row = db.get(Lead, lead_id)
    if not row:
        return HTMLResponse("<h1>Not found</h1>", status_code=404)
    row.unsubscribed = True
    row.consent_email = False
    db.commit()
    return HTMLResponse("""<!doctype html><html><head><meta charset="utf-8">
<title>Unsubscribed \u2014 Festio</title>
<style>body{font-family:Arial,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#172033}
h1{font-size:24px}p{color:#526070;line-height:1.6}a{color:#075b5d}</style></head>
<body><h1>You've been unsubscribed</h1>
<p>You will no longer receive marketing emails from Festio.</p>
<p>If this was a mistake, contact <a href="mailto:support@festio.events">support@festio.events</a>.</p>
</body></html>""")


@app.post("/api/marketing/sms/webhook")
def signalhouse_sms_webhook(body: dict, x_webhook_token: str | None = Header(default=None), db: Session = Depends(db_session)):
    """Record SignalHouse inbound opt-out replies in Festio's consent ledger."""
    configured_token = os.getenv("SIGNALHOUSE_WEBHOOK_TOKEN", "")
    if configured_token and x_webhook_token != configured_token:
        raise HTTPException(401, "Invalid SignalHouse webhook token")
    payload = body.get("payload") or body
    sender = payload.get("sender") or {}
    contact = sender.get("contact") or {}
    phone = str(contact.get("identifierValue") or payload.get("phone") or payload.get("senderPhoneNumber") or payload.get("from") or "").strip()
    text_body = ((payload.get("body") or {}).get("text") or {})
    message = str(text_body.get("text") or payload.get("text") or payload.get("messageBody") or payload.get("body") or "").strip().upper()
    if not phone or not message: return {"recorded": False}
    row = db.scalar(select(Lead).where(Lead.phone == phone))
    if not row: return {"recorded": False}
    keyword = message.split()[0]
    if keyword in {"STOP", "STOPALL", "END", "QUIT", "UNSUBSCRIBE", "CANCEL"}:
        row.consent_sms = False
        db.add(Activity(lead_id=row.id, kind="sms_unsubscribed", summary="SMS opt-out received", actor="signalhouse", data={"keyword": keyword}))
        audit(db, "signalhouse", "consent.sms_opt_out", "lead", row.id, keyword=keyword); db.commit()
        return {"recorded": True, "unsubscribed": True}
    db.add(Activity(lead_id=row.id, kind="sms_received", summary="SMS reply received", actor="signalhouse", data={"message": message[:500]})); db.commit()
    return {"recorded": True, "unsubscribed": False}
