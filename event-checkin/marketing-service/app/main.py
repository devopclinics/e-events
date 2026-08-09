"""Festio Marketing service.

Owns lead lifecycle, campaigns, content, referrals, follow-up sequences,
attribution, consent, staff grants, tasks, and reporting. It never imports the
main Festio backend or reads its database.
"""
import json
import os
import smtplib
import threading
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Query
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


def send_follow_up(lead: Lead, sequence: ModuleRecord, step_index: int = 0) -> str:
    steps = sequence.payload.get("steps") or []
    step = steps[min(step_index, len(steps) - 1)] if steps else {"subject": sequence.name, "cta": "Open Festio"}
    host, user, password = os.getenv("SMTP_HOST", ""), os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASSWORD", "")
    if not host or not user or not password:
        return "queued"
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
    port = int(os.getenv("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=15) as smtp:
        if os.getenv("SMTP_TLS", "true").lower() in {"1", "true", "yes"}: smtp.starttls()
        smtp.login(user, password); smtp.send_message(message)
    return "sent"


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
    sla_overdue = db.scalar(select(func.count(Lead.id)).where(Lead.stage == "registered", Lead.registered_at <= now() - timedelta(hours=1))) or 0
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
    db.commit(); db.refresh(row)
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


@app.delete("/api/marketing/access/{grant_id}", status_code=204)
def revoke_access(grant_id: str, _: Identity = Depends(require_superadmin), db: Session = Depends(db_session)):
    row = db.get(AccessGrant, grant_id)
    if row: row.active = False; db.commit()


@app.get("/api/marketing/leads")
def list_leads(stage: str | None = None, q: str | None = None, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    stmt = select(Lead)
    if stage: stmt = stmt.where(Lead.stage == stage)
    if q: stmt = stmt.where((Lead.email.ilike(f"%{q}%")) | (Lead.name.ilike(f"%{q}%")) | (Lead.organization.ilike(f"%{q}%")))
    return [lead_out(r) for r in db.scalars(stmt.order_by(Lead.updated_at.desc()).limit(500)).all()]


@app.post("/api/marketing/leads")
def create_lead(body: LeadIn, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    row = db.scalar(select(Lead).where(Lead.email == body.email.lower()))
    if row: raise HTTPException(409, "Lead already exists")
    values = body.model_dump()
    values["email"] = body.email.lower()
    row = Lead(**values); db.add(row); db.flush()
    db.add(Activity(lead_id=row.id, kind="created", summary="Lead created", actor=identity.email)); db.commit(); db.refresh(row)
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
    db.add(Activity(lead_id=row.id, kind="updated", summary="Lead updated", actor=identity.email, data={"fields": list(body)})); db.commit(); db.refresh(row)
    return lead_out(row)


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
    row = ModuleRecord(module=module, created_by=identity.email, **body.model_dump()); db.add(row); db.commit(); db.refresh(row); return record_out(row)


@app.patch("/api/marketing/modules/{module}/{record_id}")
def update_record(module: str, record_id: str, body: dict, identity: Identity = Depends(decode_identity), db: Session = Depends(db_session)):
    row = db.get(ModuleRecord, record_id)
    if not row or row.module != module: raise HTTPException(404, "Record not found")
    for key in ("name", "status", "owner_email", "payload", "scheduled_at"):
        if key in body: setattr(row, key, body[key])
    db.commit(); db.refresh(row); return record_out(row)


@app.delete("/api/marketing/modules/{module}/{record_id}", status_code=204)
def delete_record(module: str, record_id: str, identity: Identity = Depends(require_manager), db: Session = Depends(db_session)):
    row = db.get(ModuleRecord, record_id)
    if row and row.module == module: db.delete(row); db.commit()


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
        except Exception: delivery = "failed"
        db.add(Activity(lead_id=lead.id, kind=f"email_{delivery}", summary=f"Follow-up {delivery} from {matching.name}", actor=identity.email, data={"sequence_id": matching.id, "step_index": sent_count}))
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
