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
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
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
    support_ai_auto_send: bool = True  # master switch: off = every draft is always a private note
    support_ai_gating_enabled: bool = False  # on = GATED_KEYWORDS/deferral topics still fall back to a private note even when auto_send is on

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

# Topics an AI should never answer unsupervised — account/billing/security
# questions where a wrong auto-sent answer could cost the organizer money or
# access. Matched against the organizer's incoming message; a hit always
# routes to a private note for a human, regardless of support_ai_auto_send.
GATED_KEYWORDS = [
    "billing", "invoice", "refund", "charge", "chargeback", "dispute",
    "payment", "credit card", "card", "subscription", "cancel", "downgrade",
    "delete my account", "delete account", "close my account",
    "password", "2fa", "security", "hacked", "breach", "compromised",
    "legal", "lawsuit", "gdpr", "data request", "sue",
]

# Signals the model itself couldn't confidently answer (per SYSTEM_PROMPT's
# own instruction to defer on account-specific questions) — treated the same
# as a keyword hit, so a good-faith deferral never gets auto-sent as-is.
DEFERRAL_PHRASES = [
    "can't see", "cannot see", "can't access", "cannot access",
    "don't have access", "do not have access", "teammate will follow up",
    "flagging for a teammate", "a teammate will",
]


# Explicit requests to talk to a person — not a product question, so we skip
# Gemini entirely (saves quota, faster) and just acknowledge + flag the
# conversation for a human, rather than forcing an answer out of the docs.
ESCALATION_PHRASES = [
    "live agent", "real person", "real human", "talk to a human", "talk to someone",
    "speak to a human", "speak with a human", "speak to someone", "speak with someone",
    "human agent", "customer service rep", "connect me with", "speak to a person",
    "speak with a person", "actual person", "talk to a person",
]


def _is_gated(text: str) -> bool:
    lowered = (text or "").lower()
    return any(kw in lowered for kw in GATED_KEYWORDS)


def _is_escalation_request(text: str) -> bool:
    lowered = (text or "").lower()
    return any(p in lowered for p in ESCALATION_PHRASES)


def _is_deferral(text: str) -> bool:
    lowered = (text or "").lower()
    return any(p in lowered for p in DEFERRAL_PHRASES)


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


async def _post_reply(conversation_id: int, content: str) -> None:
    """A real, visible reply to the organizer — only used for non-gated topics
    when support_ai_auto_send is on. Always discloses it's automated."""
    url = f"{settings.chatwoot_base_url}/api/v1/accounts/{settings.chatwoot_account_id}/conversations/{conversation_id}/messages"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            url,
            headers=_chatwoot_headers(),
            json={"content": f"{content}\n\n_🤖 Automated reply from Festio's AI assistant_", "message_type": "outgoing", "private": False},
        )
        resp.raise_for_status()


ESCALATION_ACK = (
    "Of course — I've flagged this conversation for our team and a teammate "
    "will jump in shortly. In the meantime, feel free to keep describing what "
    "you need help with so they have full context when they join."
)


async def _escalate_conversation(conversation_id: int) -> None:
    """No Gemini call — this isn't a product question. Acknowledge immediately
    and mark the conversation urgent so a human notices it faster."""
    try:
        await _post_reply(conversation_id, ESCALATION_ACK)
        url = f"{settings.chatwoot_base_url}/api/v1/accounts/{settings.chatwoot_account_id}/conversations/{conversation_id}/toggle_priority"
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, headers=_chatwoot_headers(), json={"priority": "urgent"})
            resp.raise_for_status()
    except Exception:
        logger.exception("failed to escalate conversation %s", conversation_id)


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


async def _draft_and_post(conversation_id: int, gated: bool) -> None:
    try:
        transcript = await _fetch_conversation_transcript(conversation_id)
        draft = await _draft_reply(transcript)
        if not draft:
            return
        # Gated by the incoming message's own topic, OR the model itself
        # deferred (per SYSTEM_PROMPT's instruction on account-specific
        # questions) — only enforced while support_ai_gating_enabled is on.
        held_back = settings.support_ai_gating_enabled and (gated or _is_deferral(draft))
        if not settings.support_ai_auto_send or held_back:
            await _post_private_note(conversation_id, f"\U0001F916 AI-drafted reply (review before sending):\n\n{draft}")
        else:
            await _post_reply(conversation_id, draft)
    except Exception:
        logger.exception("failed to draft/post AI reply for conversation %s", conversation_id)


@app.post("/api/support/webhooks/chatwoot")
async def chatwoot_webhook(request: Request, background_tasks: BackgroundTasks, token: str | None = Query(default=None)):
    """Chatwoot's outgoing webhooks are plain, unsigned POSTs (unlike Twilio/
    Resend), so authenticity is a shared secret in the URL configured once in
    Chatwoot's Settings > Integrations > Webhooks screen, not a computed HMAC.

    Chatwoot's own webhook delivery has a tight default timeout (5s) and treats
    a slow/failed response as delivery failure — it does not retry, it just
    logs a warning. The actual Gemini call + Chatwoot post-back routinely takes
    longer than that, so this handler validates fast and hands the slow work to
    a background task, returning 200 immediately."""
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

    conversation = payload.get("conversation") or {}
    conversation_id = conversation.get("id")
    if not conversation_id:
        return {"status": "no_conversation"}

    content = payload.get("content") or ""

    # "Talk to a human" isn't a product question — skip Gemini/rate-limit
    # entirely (nothing to draft) and just acknowledge + flag for a human.
    if _is_escalation_request(content):
        background_tasks.add_task(_escalate_conversation, conversation_id)
        return {"status": "escalated"}

    if not settings.support_ai_enabled or _gemini_client is None:
        return {"status": "ai_disabled"}

    contact = payload.get("sender") or payload.get("contact") or {}
    org_key = (contact.get("custom_attributes") or {}).get("org_id") or contact.get("email") or "unknown"

    if not await _under_rate_cap(org_key):
        logger.warning("support AI hourly cap reached for %s, skipping draft for conversation %s", org_key, conversation_id)
        return {"status": "rate_limited"}

    gated = _is_gated(content)
    background_tasks.add_task(_draft_and_post, conversation_id, gated)
    return {"status": "queued"}
