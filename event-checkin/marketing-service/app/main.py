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
from html import escape
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any

import jwt
import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, func, inspect, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


DATABASE_URL = os.getenv("MARKETING_DATABASE_URL", "sqlite:////data/marketing.db")
TOKEN_SECRET = os.getenv("MARKETING_INTERNAL_TOKEN") or os.getenv("PLANNER_INTERNAL_SERVICE_TOKEN", "")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(engine, expire_on_commit=False)


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
    granted_by: Mapped[str] = mapped_column(String(240))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Lead(Base):
    __tablename__ = "marketing_leads"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    festio_user_id: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(240), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    organization: Mapped[str | None] = mapped_column(String(240), nullable=True)
    event_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    event_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    guest_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    country: Mapped[str | None] = mapped_column(String(80), nullable=True)
    stage: Mapped[str] = mapped_column(String(40), default="registered", index=True)
    score: Mapped[int] = mapped_column(Integer, default=10)
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


Base.metadata.create_all(engine)

# Lightweight additive migration for the service-owned SQLite database. This
# keeps upgrades independent from the main Festio schema and preserves leads.
if "registered_at" not in {column["name"] for column in inspect(engine).get_columns("marketing_leads")}:
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE marketing_leads ADD COLUMN registered_at DATETIME"))
        connection.execute(text("UPDATE marketing_leads SET registered_at = created_at WHERE registered_at IS NULL"))


def seed_defaults() -> None:
    defaults = [
        ("sequences", "New registration welcome", "active", {"stage": "registered", "cadence_days": 2, "steps": [
            {"delay_hours": 0, "subject": "Welcome to Festio", "cta": "Create your first event"},
            {"delay_hours": 24, "subject": "Let us help with your event setup", "cta": "Continue setup"},
            {"delay_hours": 72, "subject": "What kind of event are you planning?", "cta": "Reply to Festio"},
            {"delay_hours": 168, "subject": "Would a 15-minute setup call help?", "cta": "Book a demo"},
        ]}),
        ("sequences", "Event created onboarding", "active", {"stage": "event_created", "cadence_days": 3, "steps": [
            {"delay_hours": 0, "subject": "Your Festio event is ready for setup", "cta": "Add guests"},
            {"delay_hours": 48, "subject": "Invite, sell tickets, or start planning", "cta": "Open your event"},
            {"delay_hours": 120, "subject": "See what your event still needs", "cta": "Review setup"},
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


class Identity(BaseModel):
    subject: str
    email: str
    name: str
    is_superadmin: bool = False
    role: str = "viewer"


def db_session():
    with SessionLocal() as db: yield db


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


def send_follow_up(lead: Lead, sequence: ModuleRecord, step_index: int = 0) -> dict:
    steps = sequence.payload.get("steps") or []
    step = steps[min(step_index, len(steps) - 1)] if steps else {"subject": sequence.name, "cta": "Open Festio"}
    message = EmailMessage()
    message["From"] = os.getenv("EMAIL_FROM", "Festio <events@festio.events>")
    message["To"] = lead.email
    message["Subject"] = step.get("subject") or sequence.name
    first_name = (lead.name or "there").split()[0]
    message.set_content(
        f"Hi {first_name},\n\n{step.get('body') or 'Your Festio event is ready for the next step.'}\n\n"
        f"{step.get('cta') or 'Open Festio'}: https://festio.events/admin-redesign\n\n"
        f"You are receiving this because you registered for Festio. Unsubscribe: "
        f"https://festio.events/api/marketing/unsubscribe/{lead.id}\n"
    )
    subject = str(step.get("subject") or sequence.name)
    body = str(step.get("body") or "Your Festio event is ready for the next step.")
    cta = str(step.get("cta") or "Open Festio")
    unsubscribe_url = f"https://festio.events/api/marketing/unsubscribe/{lead.id}"
    message.add_alternative(f"""<!doctype html><html><body style="margin:0;background:#f5f1e9;font-family:Arial,sans-serif;color:#172033"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:36px 16px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden"><tr><td style="padding:20px 32px;background:#075b5d;color:#fff;font-size:20px;font-weight:700">Festio</td></tr><tr><td style="padding:36px 32px"><p style="font-size:17px">Hi {escape(first_name)},</p><h1 style="font-size:28px;line-height:1.2">{escape(subject)}</h1><p style="font-size:16px;line-height:1.7;color:#526070">{escape(body)}</p><p style="margin:28px 0"><a href="https://festio.events/admin-redesign" style="display:inline-block;background:#a85d32;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">{escape(cta)}</a></p><p style="font-size:13px;color:#78828f">You received this because you asked Festio for event updates. <a href="{unsubscribe_url}">Unsubscribe</a>.</p></td></tr></table></td></tr></table></body></html>""", subtype="html")
    resend_key = os.getenv("RESEND_API_KEY", "")
    if resend_key:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {resend_key}"},
            json={"from": message["From"], "to": [lead.email], "subject": message["Subject"], "text": message.get_body(preferencelist=("plain",)).get_content(), "html": message.get_body(preferencelist=("html",)).get_content()},
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
        row = Lead(email=email, festio_user_id=subject or None, name=body.get("name") or "", source=body.get("source") or "website", stage=body.get("stage") or "registered", owner_email=os.getenv("MARKETING_DEFAULT_OWNER", "muritala@festio.events"), registered_at=registered_at or now(), last_active_at=now(), next_follow_up_at=now() + timedelta(hours=1))
        db.add(row); db.flush(); db.add(Activity(lead_id=row.id, kind="registered", summary="Festio account registered", actor="festio"))
    else:
        row.last_active_at = now()
        if body.get("name"): row.name = body["name"]
        if body.get("stage") and row.stage in {"registered", "event_created"}: row.stage = body["stage"]
        if body.get("event_type"): row.event_type = body["event_type"]
        if body.get("guest_count") is not None: row.guest_count = body["guest_count"]
        if body.get("stage") == "event_created": row.score = max(row.score, 30)
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
    return {"total_leads": total, "stages": stages, "modules": modules, "follow_ups_due": due, "email_marketable": consented, "unowned": unowned, "sla_overdue": sla_overdue, "conversion": {"registered": total, "event_created": event_created, "paid": paid, "event_creation_rate": round(event_created * 100 / total, 1) if total else 0, "paid_rate": round(paid * 100 / total, 1) if total else 0}}


@app.get("/api/marketing/access")
def list_access(_: Identity = Depends(require_superadmin), db: Session = Depends(db_session)):
    return [{c.name: getattr(r, c.name) for c in r.__table__.columns} for r in db.scalars(select(AccessGrant).order_by(AccessGrant.created_at)).all()]


class GrantIn(BaseModel):
    email: EmailStr
    name: str = ""
    role: str = "marketer"


@app.post("/api/marketing/access")
def grant_access(body: GrantIn, identity: Identity = Depends(require_superadmin), db: Session = Depends(db_session)):
    if body.role not in {"viewer", "marketer", "manager"}: raise HTTPException(400, "Invalid role")
    email = body.email.lower()
    row = db.scalar(select(AccessGrant).where(AccessGrant.email == email))
    if row: row.active, row.role, row.name = True, body.role, body.name
    else: row = AccessGrant(email=email, name=body.name, role=body.role, granted_by=identity.email); db.add(row)
    db.flush(); audit(db, identity, "access.granted", "access_grant", row.id, email=email, role=body.role); db.commit(); db.refresh(row)
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


@app.delete("/api/marketing/access/{grant_id}", status_code=204)
def revoke_access(grant_id: str, identity: Identity = Depends(require_superadmin), db: Session = Depends(db_session)):
    row = db.get(AccessGrant, grant_id)
    if row: row.active = False; audit(db, identity, "access.revoked", "access_grant", row.id, email=row.email); db.commit()


@app.get("/api/marketing/leads")
def list_leads(stage: str | None = None, q: str | None = None, owner: str | None = None, source: str | None = None, campaign: str | None = None, consent: bool | None = None, follow_up: str | None = None, date_from: datetime | None = None, date_to: datetime | None = None, tag: str | None = None, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    stmt = select(Lead)
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
    row = Lead(**values); db.add(row); db.flush()
    db.add(Activity(lead_id=row.id, kind="created", summary="Lead created", actor=identity.email)); audit(db, identity, "lead.created", "lead", row.id, consent_email=row.consent_email, consent_sms=row.consent_sms); db.commit(); db.refresh(row)
    return lead_out(row)


@app.patch("/api/marketing/leads/{lead_id}")
def update_lead(lead_id: str, body: dict, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    row = db.get(Lead, lead_id)
    if not row: raise HTTPException(404, "Lead not found")
    allowed = {c.name for c in Lead.__table__.columns} - {"id", "created_at", "updated_at", "festio_user_id"}
    for key, value in body.items():
        if key in allowed:
            if key in {"registered_at", "last_active_at", "next_follow_up_at"} and isinstance(value, str):
                try: value = datetime.fromisoformat(value.replace("Z", "+00:00"))
                except ValueError: raise HTTPException(400, f"Invalid {key}")
            setattr(row, key, value)
    db.add(Activity(lead_id=row.id, kind="updated", summary="Lead updated", actor=identity.email, data={"fields": list(body)})); audit(db, identity, "lead.updated", "lead", row.id, fields=list(body)); db.commit(); db.refresh(row)
    return lead_out(row)


@app.delete("/api/marketing/leads/{lead_id}", status_code=204)
def delete_lead(lead_id:str, identity:Identity=Depends(require_manager), db:Session=Depends(db_session)):
    row=db.get(Lead,lead_id)
    if not row: raise HTTPException(404,"Lead not found")
    # SQLite does not enforce ORM cascades here, so remove owned timeline data
    # explicitly and retain a non-PII audit record of the cleanup.
    db.query(Activity).filter(Activity.lead_id==lead_id).delete(synchronize_session=False)
    audit(db,identity,"lead.deleted","lead",lead_id);db.delete(row);db.commit()


@app.get("/api/marketing/leads/{lead_id}/activity")
def activities(lead_id: str, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    rows = db.scalars(select(Activity).where(Activity.lead_id == lead_id).order_by(Activity.created_at.desc())).all()
    return [{c.name: getattr(r, c.name) for c in r.__table__.columns} for r in rows]


@app.post("/api/marketing/leads/{lead_id}/activity")
def add_activity(lead_id: str, body: dict, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    if not db.get(Lead, lead_id): raise HTTPException(404, "Lead not found")
    row = Activity(lead_id=lead_id, kind=body.get("kind", "note"), summary=body.get("summary", ""), actor=identity.email, data=body.get("data", {})); db.add(row); db.commit(); db.refresh(row)
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


MODULES = {"segments", "sequences", "campaigns", "content", "referrals", "tasks", "experiments"}


@app.get("/api/marketing/modules/{module}")
def list_records(module: str, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    if module not in MODULES: raise HTTPException(404, "Module not found")
    return [record_out(r) for r in db.scalars(select(ModuleRecord).where(ModuleRecord.module == module).order_by(ModuleRecord.updated_at.desc())).all()]


@app.post("/api/marketing/modules/{module}")
def create_record(module: str, body: RecordIn, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    if module not in MODULES: raise HTTPException(404, "Module not found")
    row = ModuleRecord(module=module, created_by=identity.email, **body.model_dump()); db.add(row); db.flush(); audit(db, identity, "module.created", module, row.id, name=row.name); db.commit(); db.refresh(row); return record_out(row)


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


@app.post("/api/marketing/leads/bulk")
def bulk_leads(body: dict, identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    ids = list(dict.fromkeys(body.get("ids") or []))[:500]
    action, value = body.get("action"), body.get("value")
    rows = db.scalars(select(Lead).where(Lead.id.in_(ids))).all() if ids else []
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
    for row in db.scalars(select(Lead).order_by(Lead.registered_at.desc())).all():
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
    events=db.scalars(select(Activity).where(Activity.created_at>=since,Activity.kind.like("email_%"))).all();delivery={}
    for event in events: delivery[event.kind]=delivery.get(event.kind,0)+1
    return {"days":days,"total":len(leads),"sources":by_source,"campaigns":by_campaign,"daily":daily,"delivery":delivery}


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
def provider_readiness(identity:Identity=Depends(decode_identity)):
    return {"email":{"provider":"resend","configured":bool(os.getenv("RESEND_API_KEY"))},"sms":{"provider":"bird","configured":bool(os.getenv("BIRD_ACCESS_KEY") and os.getenv("BIRD_WORKSPACE_ID") and os.getenv("BIRD_SMS_CHANNEL_ID"))},"social":{"linkedin":bool(os.getenv("LINKEDIN_ACCESS_TOKEN") and os.getenv("LINKEDIN_AUTHOR_URN")),"facebook":bool(os.getenv("META_ACCESS_TOKEN") and os.getenv("META_FACEBOOK_PAGE_ID")),"instagram":bool(os.getenv("META_ACCESS_TOKEN") and os.getenv("META_INSTAGRAM_USER_ID"))}}


@app.post("/api/marketing/social/publish")
async def publish_social(body:SocialPublishIn, identity:Identity=Depends(require_manager), db:Session=Depends(db_session)):
    platform=body.platform.lower()
    if platform not in {"linkedin","facebook","instagram"}: raise HTTPException(400,"Unsupported social platform")
    if body.dry_run:
        audit(db,identity,"social.validated","content",None,platform=platform);db.commit();return {"status":"validated","platform":platform,"dry_run":True}
    async with httpx.AsyncClient(timeout=30) as client:
        if platform=="linkedin":
            token,author=os.getenv("LINKEDIN_ACCESS_TOKEN",""),os.getenv("LINKEDIN_AUTHOR_URN","")
            if not token or not author: raise HTTPException(503,"Connect a LinkedIn organization before publishing")
            payload={"author":author,"commentary":body.message,"visibility":"PUBLIC","distribution":{"feedDistribution":"MAIN_FEED","targetEntities":[],"thirdPartyDistributionChannels":[]},"lifecycleState":"PUBLISHED","isReshareDisabledByAuthor":False}
            response=await client.post("https://api.linkedin.com/rest/posts",headers={"Authorization":f"Bearer {token}","LinkedIn-Version":os.getenv("LINKEDIN_API_VERSION","202601"),"X-Restli-Protocol-Version":"2.0.0"},json=payload)
        elif platform=="facebook":
            token,page=os.getenv("META_ACCESS_TOKEN",""),os.getenv("META_FACEBOOK_PAGE_ID","")
            if not token or not page: raise HTTPException(503,"Connect a Facebook Page before publishing")
            response=await client.post(f"https://graph.facebook.com/v23.0/{page}/feed",data={"message":body.message,"link":body.link_url or "","access_token":token})
        else:
            token,user=os.getenv("META_ACCESS_TOKEN",""),os.getenv("META_INSTAGRAM_USER_ID","")
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
    row=db.get(Lead,lead_id); message=str(body.get("message") or "").strip()
    if not row: raise HTTPException(404,"Lead not found")
    if not row.phone: raise HTTPException(400,"Lead has no phone number")
    if not row.consent_sms: raise HTTPException(409,"SMS consent is required")
    if not message: raise HTTPException(400,"Message is required")
    key,workspace,channel=os.getenv("BIRD_ACCESS_KEY",""),os.getenv("BIRD_WORKSPACE_ID",""),os.getenv("BIRD_SMS_CHANNEL_ID","")
    if not all((key,workspace,channel)): raise HTTPException(503,"Bird SMS is not configured")
    final=f"{message[:1450]}\nReply STOP to opt out."
    async with httpx.AsyncClient(timeout=20) as client:
        response=await client.post(f"https://api.bird.com/workspaces/{workspace}/channels/{channel}/messages",headers={"Authorization":f"AccessKey {key}"},json={"receiver":{"contacts":[{"identifierValue":row.phone,"identifierKey":"phonenumber"}]},"body":{"type":"text","text":{"text":final}}})
    if response.status_code>=400: raise HTTPException(502,"Bird could not send this message")
    data=response.json() if response.content else {};db.add(Activity(lead_id=row.id,kind="sms_sent",summary="Marketing SMS sent",actor=identity.email,data={"provider":"bird","provider_id":data.get("id")}));audit(db,identity,"sms.sent","lead",row.id);db.commit();return {"status":"sent","provider_id":data.get("id")}


@app.post("/api/marketing/internal/delivery")
def ingest_delivery(body:dict, identity:Identity=Depends(decode_identity), db:Session=Depends(db_session)):
    if not identity.is_superadmin: raise HTTPException(403, "Internal delivery ingest requires platform authority")
    email=(body.get("email") or "").lower(); row=db.scalar(select(Lead).where(Lead.email==email))
    if not row: return {"recorded":False}
    event=str(body.get("event") or "delivered").replace("email.", "")
    db.add(Activity(lead_id=row.id,kind=f"email_{event}",summary=f"Email {event}",actor="resend",data={"provider":"resend","provider_id":body.get("provider_id")}));db.commit()
    return {"recorded":True}


@app.post("/api/marketing/automation/run")
def run_automation(identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    """Enroll due leads and queue consent-safe follow-ups from active sequences."""
    sequences = db.scalars(select(ModuleRecord).where(ModuleRecord.module == "sequences", ModuleRecord.status == "active")).all()
    leads = db.scalars(select(Lead).where(Lead.consent_email.is_(True), Lead.unsubscribed.is_(False), Lead.next_follow_up_at <= now())).all()
    queued = 0
    for lead in leads:
        matching = next((s for s in sequences if not s.payload.get("stage") or s.payload.get("stage") == lead.stage), None)
        if not matching: continue
        sent_count = db.scalar(select(func.count(Activity.id)).where(Activity.lead_id == lead.id, Activity.data["sequence_id"].as_string() == matching.id)) or 0
        steps = matching.payload.get("steps") or []
        if steps and sent_count >= len(steps):
            lead.next_follow_up_at = None
            continue
        try: delivery = send_follow_up(lead, matching, sent_count)
        except Exception: delivery = {"status":"failed","provider":"resend","provider_id":None}
        db.add(Activity(lead_id=lead.id, kind=f"email_{delivery['status']}", summary=f"Follow-up {delivery['status']} from {matching.name}", actor=identity.email, data={"sequence_id": matching.id, "step_index": sent_count, **delivery}))
        lead.next_follow_up_at = now() + timedelta(hours=int((steps[sent_count].get("next_delay_hours") if steps and sent_count < len(steps) else None) or int(matching.payload.get("cadence_days", 3)) * 24))
        queued += 1
    db.commit()
    return {"queued": queued, "eligible": len(leads), "active_sequences": len(sequences)}


def scheduled_automation() -> None:
    """Run consent-safe follow-ups every 15 minutes without a separate worker."""
    while True:
        threading.Event().wait(900)
        try:
            with SessionLocal() as db:
                identity = Identity(subject="scheduler", email="automation@festio.events", name="Festio Automation", is_superadmin=True, role="superadmin")
                run_automation(identity=identity, db=db)
        except Exception:
            # A delivery outage must not terminate the scheduler.
            continue


@app.on_event("startup")
def start_scheduler():
    threading.Thread(target=scheduled_automation, name="marketing-automation", daemon=True).start()


@app.post("/api/marketing/unsubscribe/{lead_id}")
def unsubscribe(lead_id: str, db: Session = Depends(db_session)):
    row = db.get(Lead, lead_id)
    if not row: raise HTTPException(404, "Lead not found")
    row.unsubscribed = True; row.consent_email = False; db.commit(); return {"ok": True}
