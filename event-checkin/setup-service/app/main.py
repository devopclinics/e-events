import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import firebase_admin
import httpx
from firebase_admin import auth as firebase_auth, credentials
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .recommendations import get_recommendations

logger = logging.getLogger("setup-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://checkin:checkin@db/checkin"
    backend_base_url: str = "http://backend:8000"
    frontend_url: str = "http://localhost:5173"
    firebase_credentials: str = ""
    superadmin_emails: str = ""
    backend_request_timeout_seconds: float = 15.0

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
bearer = HTTPBearer(auto_error=False)
_firebase_app = None


# ── Mirrored, read-only shared-DB models (auth only — never create_all'd) ────
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
    event_type: Mapped[str | None] = mapped_column(String(80))
    event_date: Mapped[datetime] = mapped_column(DateTime)
    timezone: Mapped[str | None] = mapped_column(String(80))
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False)


# ── Guided-setup progress — the one table this service exclusively owns ─────
# Deliberately a SEPARATE DeclarativeBase from the mirrored tables above, so
# its own create_all() at startup never touches (or races) backend's own
# migration of the shared tables. No cross-Base foreign keys for the same
# reason. See the setup-service section of the guided-setup plan for why this
# is a narrow, deliberate exception to "sibling services never own shared-DB
# schema".
class SetupBase(DeclarativeBase):
    pass


class SetupProgress(SetupBase):
    __tablename__ = "setup_progress"
    __table_args__ = (UniqueConstraint("event_id", "step_key", name="uq_setup_progress_event_step"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    step_key: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="completed")  # "completed" | "skipped"
    completed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_by_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(SetupBase.metadata.create_all)
    yield


async def get_db():
    async with SessionLocal() as session:
        yield session


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
    """Fast local pre-check mirroring backend's own require_event_admin — lets
    setup-service fail fast with a clean 403/404 before any backend round
    trip. Backend re-checks this exact same rule on every forwarded call, so
    this is a UX optimization, not the source of truth for authorization."""
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


# ── Backend HTTP client — forwards the caller's own bearer token unchanged so
# backend's own auth/entitlement gating applies exactly as if the organizer's
# browser had called backend directly. setup-service never bypasses this. ───
async def call_backend(method: str, path: str, bearer_token: str, **kwargs) -> httpx.Response:
    async with httpx.AsyncClient(
        base_url=settings.backend_base_url,
        timeout=httpx.Timeout(settings.backend_request_timeout_seconds),
    ) as client:
        return await client.request(
            method, path, headers={"Authorization": f"Bearer {bearer_token}"}, **kwargs
        )


def _relay_or_raise(resp: httpx.Response):
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("detail", resp.text)
        except Exception:
            detail = resp.text
        exc = HTTPException(resp.status_code, detail)
        required_plan = resp.headers.get("x-required-plan")
        if required_plan:
            exc.headers = {"X-Required-Plan": required_plan}
        raise exc


app = FastAPI(title="Festio Guided Setup Service", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/setup/health")
async def health(db: AsyncSession = Depends(get_db)):
    await db.execute(select(1))
    return {"status": "ok", "service": "setup-service"}


# ── 1. Bulk table + table-group creation ─────────────────────────────────────
class TableGroupBulkSpec(BaseModel):
    group_name: str = Field(min_length=1, max_length=100)
    category: str | None = None
    table_count: int = Field(ge=1, le=200)
    table_capacity: int = Field(ge=1, le=100)


class TablesBulkCreate(BaseModel):
    groups: list[TableGroupBulkSpec] = Field(min_length=1, max_length=20)


class TablesBulkAdd(BaseModel):
    table_group_id: str
    additional_table_count: int = Field(ge=1, le=200)
    table_capacity: int = Field(ge=1, le=100)
    category: str | None = None


@app.post("/api/setup/{event_id}/tables/bulk", status_code=201)
async def bulk_create_tables(
    event_id: str,
    data: TablesBulkCreate,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    creds: HTTPAuthorizationCredentials = Depends(bearer),
):
    await require_event_admin(event_id, user, db, request)
    token = creds.credentials
    results = []
    for group in data.groups:
        table_ids: list[str] = []
        error = None
        for i in range(group.table_count):
            resp = await call_backend(
                "POST", f"/api/events/{event_id}/tables", token,
                json={"name": f"{group.group_name} {i + 1}", "capacity": group.table_capacity,
                      "category": group.category, "sort_order": i},
            )
            if resp.status_code >= 400:
                if resp.status_code == 402:
                    _relay_or_raise(resp)  # surface the paywall immediately, don't partial-create
                try:
                    error = resp.json().get("detail", resp.text)
                except Exception:
                    error = resp.text
                break
            table_ids.append(resp.json()["id"])
        group_id = None
        if table_ids:
            gresp = await call_backend(
                "POST", f"/api/events/{event_id}/table-groups", token,
                json={"name": group.group_name, "table_ids": table_ids},
            )
            if gresp.status_code < 400:
                group_id = gresp.json()["id"]
            elif error is None:
                try:
                    error = gresp.json().get("detail", gresp.text)
                except Exception:
                    error = gresp.text
        results.append({
            "group_name": group.group_name, "table_group_id": group_id,
            "table_ids": table_ids, "created": len(table_ids),
            "requested": group.table_count, "error": error,
        })
    return {"groups": results}


@app.patch("/api/setup/{event_id}/tables/bulk")
async def bulk_add_tables_to_group(
    event_id: str,
    data: TablesBulkAdd,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    creds: HTTPAuthorizationCredentials = Depends(bearer),
):
    await require_event_admin(event_id, user, db, request)
    token = creds.credentials
    groups_resp = await call_backend("GET", f"/api/events/{event_id}/table-groups", token)
    _relay_or_raise(groups_resp)
    current_group = next((g for g in groups_resp.json() if g["id"] == data.table_group_id), None)
    if not current_group:
        raise HTTPException(404, "Table group not found")
    new_ids: list[str] = []
    existing_count = len(current_group.get("table_ids") or [])
    for i in range(data.additional_table_count):
        resp = await call_backend(
            "POST", f"/api/events/{event_id}/tables", token,
            json={"name": f"{current_group['name']} {existing_count + i + 1}", "capacity": data.table_capacity,
                  "category": data.category, "sort_order": existing_count + i},
        )
        _relay_or_raise(resp)
        new_ids.append(resp.json()["id"])
    all_ids = list(current_group.get("table_ids") or []) + new_ids
    put_resp = await call_backend(
        "PUT", f"/api/events/{event_id}/table-groups/{data.table_group_id}/tables", token,
        json={"table_ids": all_ids},
    )
    _relay_or_raise(put_resp)
    return {"table_group_id": data.table_group_id, "added": new_ids, "total_tables": len(all_ids)}


# ── 2. Structured multi-invitee rules ────────────────────────────────────────
class MultiInviteeRule(BaseModel):
    category_name: str = Field(min_length=1, max_length=200)
    limit: int = Field(ge=0, le=100)
    submitter_table_category: str | None = None
    invitee_table_category: str | None = None


class MultiInviteeRulesIn(BaseModel):
    rules: list[MultiInviteeRule] = Field(max_length=50)


@app.put("/api/setup/{event_id}/multi-invitee")
async def set_multi_invitee_rules(
    event_id: str,
    data: MultiInviteeRulesIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    creds: HTTPAuthorizationCredentials = Depends(bearer),
):
    await require_event_admin(event_id, user, db, request)
    limit_rules = {r.category_name: r.limit for r in data.rules}
    seating_rules = {}
    for r in data.rules:
        bucket = {}
        if r.submitter_table_category:
            bucket["submitter"] = r.submitter_table_category
        if r.invitee_table_category:
            bucket["invitee"] = r.invitee_table_category
        if bucket:
            seating_rules[r.category_name] = bucket
    resp = await call_backend(
        "PUT", f"/api/events/{event_id}/invite-settings", creds.credentials,
        json={
            "rsvp_multi_invitee_enabled": True,
            "rsvp_multi_invitee_limit_rules": limit_rules,
            "rsvp_category_seating_rules": seating_rules,
        },
    )
    _relay_or_raise(resp)
    return resp.json()


# ── 3. Program day/time builder ──────────────────────────────────────────────
class ProgramBulkItem(BaseModel):
    day_offset_days: int = Field(ge=0, le=60)
    time_of_day: str = Field(pattern=r"^\d{2}:\d{2}$")
    duration_minutes: int = Field(ge=1, le=1440)
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None


class ProgramBulkIn(BaseModel):
    workflow_id: str
    items: list[ProgramBulkItem] = Field(min_length=1, max_length=100)


def _slugify(title: str, index: int) -> str:
    slug = "".join(c.lower() if c.isalnum() else "-" for c in title).strip("-")
    slug = "-".join(filter(None, slug.split("-")))[:40] or "segment"
    return f"{slug}-{index}"


@app.post("/api/setup/{event_id}/program/bulk", status_code=201)
async def bulk_import_program(
    event_id: str,
    data: ProgramBulkIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    creds: HTTPAuthorizationCredentials = Depends(bearer),
):
    await require_event_admin(event_id, user, db, request)
    token = creds.credentials
    ev_resp = await call_backend("GET", f"/api/events/{event_id}", token)
    _relay_or_raise(ev_resp)
    ev = ev_resp.json()
    tz_name = ev.get("timezone") or "UTC"
    tz = ZoneInfo(tz_name)
    event_date_utc = datetime.fromisoformat(ev["event_date"]).replace(tzinfo=ZoneInfo("UTC"))
    anchor = event_date_utc.astimezone(tz)

    items = []
    previews = []
    for i, item in enumerate(data.items):
        target_date = anchor.date() + timedelta(days=item.day_offset_days)
        hh, mm = (int(x) for x in item.time_of_day.split(":"))
        target_local = datetime.combine(target_date, time(hh, mm), tzinfo=tz)
        starts_offset_seconds = int((target_local - anchor).total_seconds())
        if starts_offset_seconds < 0:
            raise HTTPException(422, f"'{item.title}' starts before the event begins — check the day/time.")
        duration_seconds = item.duration_minutes * 60
        items.append({
            "key": _slugify(item.title, i),
            "title": item.title,
            "description": item.description,
            "starts_offset_seconds": starts_offset_seconds,
            "duration_seconds": duration_seconds,
        })
        previews.append({"title": item.title, "starts_at": target_local.isoformat(), "starts_offset_seconds": starts_offset_seconds})

    resp = await call_backend(
        "POST", f"/api/events/{event_id}/experience/workflows/{data.workflow_id}/program/import", token,
        json={"items": items},
    )
    _relay_or_raise(resp)
    return {"steps": resp.json(), "preview": previews}


# ── 4. Team email pre-check ──────────────────────────────────────────────────
class CheckEmailIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)


@app.post("/api/setup/team/check-email")
async def check_team_email(data: CheckEmailIn, user: User = Depends(current_user)):
    _ensure_firebase()
    try:
        await asyncio.to_thread(firebase_auth.get_user_by_email, data.email.strip().lower())
        return {"exists": True}
    except firebase_auth.UserNotFoundError:
        return {"exists": False}
    except Exception:
        # Firebase Admin errors (rate limit, transient) shouldn't block the
        # flow — treat as "unknown" and let the organizer proceed with the
        # normal confirmation prompt rather than a hard failure.
        return {"exists": False, "unknown": True}


# ── 5. Type-driven recommendations ───────────────────────────────────────────
@app.get("/api/setup/recommendations")
async def recommendations(event_type: str = Query(default=""), user: User = Depends(current_user)):
    return get_recommendations(event_type)


# ── 6. Guided-setup progress ─────────────────────────────────────────────────
class ProgressIn(BaseModel):
    event_id: str
    step_key: str = Field(min_length=1, max_length=40)
    status: str = Field(pattern="^(completed|skipped)$")


@app.get("/api/setup/progress")
async def get_progress(
    event_id: str = Query(...),
    request: Request = None,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_event_admin(event_id, user, db, request)
    rows = (await db.execute(select(SetupProgress).where(SetupProgress.event_id == event_id))).scalars().all()
    return {"steps": {r.step_key: r.status for r in rows}}


@app.post("/api/setup/progress", status_code=204)
async def set_progress(
    data: ProgressIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_event_admin(data.event_id, user, db, request)
    stmt = pg_insert(SetupProgress).values(
        id=str(uuid.uuid4()), event_id=data.event_id, step_key=data.step_key,
        status=data.status, completed_at=datetime.utcnow(), completed_by_user_id=user.id,
    ).on_conflict_do_update(
        index_elements=["event_id", "step_key"],
        set_={"status": data.status, "completed_at": datetime.utcnow(), "completed_by_user_id": user.id},
    )
    await db.execute(stmt)
    await db.commit()
    return None
