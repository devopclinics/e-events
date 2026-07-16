import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import time
from pathlib import Path

import firebase_admin
import httpx
from firebase_admin import auth as firebase_auth, credentials
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google import genai
from redis.asyncio import Redis
from pydantic_settings import BaseSettings
from sqlalchemy import Boolean, ForeignKey, String, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

logger = logging.getLogger("support-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://checkin:checkin@db/checkin"
    redis_url: str = "redis://redis:6379/0"
    frontend_url: str = "http://localhost:5173"
    firebase_credentials: str = ""
    superadmin_emails: str = ""

    support_ai_enabled: bool = True
    support_ai_hourly_cap: int = 20   # per-org Gemini drafts/hour before we skip drafting and just log

    chatwoot_base_url: str = ""
    chatwoot_account_id: str = ""
    chatwoot_inbox_id: str = ""
    chatwoot_api_access_token: str = ""   # Agent Bot / Platform API token, minted in Chatwoot's UI
    chatwoot_hmac_secret: str = ""        # per-inbox Identity Validation secret, from Chatwoot's UI
    chatwoot_webhook_token: str = ""      # our own shared secret, checked on inbound webhook calls

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
bearer = HTTPBearer(auto_error=False)
redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
_firebase_app = None
_gemini_client = genai.Client(api_key=settings.gemini_api_key) if settings.gemini_api_key else None


class Base(DeclarativeBase):
    pass


# Read-only mirrors of tables owned by the main backend (see backend/app/models.py).
# Support is scoped to the organizer's account, not a specific event, so unlike
# messaging-service this does not need Event/EventUser at all.

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
    name: Mapped[str] = mapped_column(String(255))
    plan: Mapped[str] = mapped_column(String(50), default="free")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Membership(Base):
    __tablename__ = "memberships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(20))


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


# ── Knowledge base ────────────────────────────────────────────────────────
# Generated from frontend/src/guideContent.mjs by scripts/build_knowledge_base.mjs
# and committed — see that script + support-service/README.md to regenerate.

_KB_PATH = Path(__file__).parent / "knowledge_base.md"


def _load_knowledge_base() -> str:
    if _KB_PATH.exists():
        return _KB_PATH.read_text()
    logger.warning("knowledge_base.md not found — AI drafts will have no product context")
    return ""


KNOWLEDGE_BASE = _load_knowledge_base()

SYSTEM_PROMPT = """You are a support assistant for Festio, an event management platform. \
Answer the organizer's question using ONLY the product documentation below — be concise \
and concrete, and reference the exact tab/feature names used in the app.

If the question is about billing, payments, account status, or anything specific to this \
organizer's account that is not covered in the documentation, say plainly that you can't \
see their account details and that a teammate will follow up. Never guess at account-specific \
information.

# Festio product documentation

{knowledge_base}
"""


# ── Chatwoot API client ──────────────────────────────────────────────────

def _chatwoot_headers() -> dict:
    return {"api_access_token": settings.chatwoot_api_access_token, "Content-Type": "application/json"}


async def _fetch_conversation_transcript(conversation_id: int) -> str:
    """Recent messages in the conversation, oldest first, excluding our own
    private notes (those are drafts for a human, not part of the real thread)."""
    url = f"{settings.chatwoot_base_url}/api/v1/accounts/{settings.chatwoot_account_id}/conversations/{conversation_id}/messages"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=_chatwoot_headers())
        resp.raise_for_status()
        data = resp.json()
    messages = data.get("payload", data if isinstance(data, list) else [])
    lines = []
    for m in messages:
        if m.get("private"):
            continue
        msg_type = m.get("message_type")
        is_incoming = msg_type in (0, "incoming")
        speaker = "Organizer" if is_incoming else "Agent"
        content = (m.get("content") or "").strip()
        if content:
            lines.append(f"{speaker}: {content}")
    return "\n".join(lines[-20:])  # cap context to the last 20 turns


async def _post_private_note(conversation_id: int, content: str) -> None:
    url = f"{settings.chatwoot_base_url}/api/v1/accounts/{settings.chatwoot_account_id}/conversations/{conversation_id}/messages"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            url,
            headers=_chatwoot_headers(),
            json={"content": content, "message_type": "outgoing", "private": True},
        )
        resp.raise_for_status()


# ── Gemini drafting ───────────────────────────────────────────────────────

async def _draft_reply(transcript: str) -> str:
    prompt = SYSTEM_PROMPT.format(knowledge_base=KNOWLEDGE_BASE) + f"\n\n# Conversation so far\n{transcript}\n\nDraft a reply to the organizer's latest message."

    def _call():
        response = _gemini_client.models.generate_content(model=settings.gemini_model, contents=prompt)
        return (response.text or "").strip()

    return await asyncio.to_thread(_call)


async def _under_rate_cap(org_key: str) -> bool:
    hour_bucket = int(time.time() // 3600)
    key = f"support:ai:{org_key}:{hour_bucket}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, 3600)
    return count <= settings.support_ai_hourly_cap


# ── App ────────────────────────────────────────────────────────────────────

app = FastAPI(title="Festio Support Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/support/health")
async def health(db: AsyncSession = Depends(get_db)):
    await db.execute(select(1))
    return {"status": "ok", "service": "support-service"}


@app.get("/api/support/identify")
async def identify(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Returns everything the frontend widget needs to securely identify this
    organizer to Chatwoot (window.$chatwoot.setUser(...)). identifier_hash
    implements Chatwoot's documented Identity Validation HMAC scheme so a
    widget visitor can't impersonate another contact."""
    membership = await db.scalar(select(Membership).where(Membership.user_id == user.id))
    org = await db.get(Organization, membership.org_id) if membership else None
    identifier = user.id
    identifier_hash = (
        hmac.new(settings.chatwoot_hmac_secret.encode(), identifier.encode(), hashlib.sha256).hexdigest()
        if settings.chatwoot_hmac_secret
        else ""
    )
    return {
        "identifier": identifier,
        "identifier_hash": identifier_hash,
        "name": user.name,
        "email": user.email,
        "org_name": org.name if org else None,
        "plan": org.plan if org else None,
    }


@app.post("/api/support/webhooks/chatwoot")
async def chatwoot_webhook(request: Request, token: str | None = Query(default=None)):
    """Chatwoot's outgoing webhooks are plain, unsigned POSTs (unlike Twilio/
    Resend), so authenticity is a shared secret in the URL configured once in
    Chatwoot's Settings > Integrations > Webhooks screen, not a computed HMAC."""
    if not settings.chatwoot_webhook_token or not secrets.compare_digest(token or "", settings.chatwoot_webhook_token):
        raise HTTPException(403, "Invalid webhook token")

    payload = await request.json()

    # Only draft for a genuine organizer message. message_type distinguishes
    # incoming (organizer) from outgoing (agent replies AND our own private
    # notes) — without this check, our posted draft would re-trigger itself.
    msg_type = payload.get("message_type")
    is_incoming = msg_type in (0, "incoming")
    if payload.get("event") != "message_created" or not is_incoming or payload.get("private"):
        return {"status": "ignored"}

    if not settings.support_ai_enabled or _gemini_client is None:
        return {"status": "ai_disabled"}

    conversation = payload.get("conversation") or {}
    conversation_id = conversation.get("id")
    if not conversation_id:
        return {"status": "no_conversation"}

    contact = payload.get("sender") or payload.get("contact") or {}
    org_key = (contact.get("custom_attributes") or {}).get("org_id") or contact.get("email") or "unknown"

    if not await _under_rate_cap(org_key):
        logger.warning("support AI hourly cap reached for %s, skipping draft for conversation %s", org_key, conversation_id)
        return {"status": "rate_limited"}

    try:
        transcript = await _fetch_conversation_transcript(conversation_id)
        draft = await _draft_reply(transcript)
        if draft:
            await _post_private_note(conversation_id, f"\U0001F916 AI-drafted reply (review before sending):\n\n{draft}")
    except Exception:
        logger.exception("failed to draft/post AI reply for conversation %s", conversation_id)
        return {"status": "error"}

    return {"status": "drafted"}
