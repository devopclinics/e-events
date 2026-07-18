import asyncio
import difflib
import hashlib
import hmac
import json
import logging
import re
import secrets
import string
import time
import socket
from contextlib import asynccontextmanager
from pathlib import Path

import firebase_admin
import httpx
from firebase_admin import auth as firebase_auth, credentials
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google import genai
from redis.asyncio import Redis
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Boolean, ForeignKey, String, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

logger = logging.getLogger("support-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class ConcurrencyBusy(Exception):
    pass


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+asyncpg://checkin:checkin@db/checkin"
    redis_url: str = "redis://redis:6379/0"
    frontend_url: str = "http://localhost:5173"
    firebase_credentials: str = ""
    superadmin_emails: str = ""

    support_ai_enabled: bool = True
    support_ai_hourly_cap: int = 20
    support_ai_global_hourly_cap: int = 500
    support_ai_global_concurrency: int = 4
    support_ai_org_concurrency: int = 1
    support_ai_concurrency_lease_seconds: int = 90
    support_ai_auto_send: bool = False
    support_ai_gating_enabled: bool = True
    support_local_ai_enabled: bool = False
    support_local_ai_url: str = "http://local-ai:8080"
    support_local_ai_model: str = ""
    support_local_ai_timeout_seconds: float = 30.0
    support_local_ai_confidence_threshold: float = 0.90
    support_local_ai_shadow_mode: bool = True
    support_local_ai_auto_reply: bool = False
    support_local_ai_drafting_enabled: bool = False
    support_max_message_chars: int = 4000
    support_max_transcript_chars: int = 12000
    support_max_reply_chars: int = 4000
    support_max_prompt_chars: int = 18000
    support_gemini_timeout_seconds: float = 20.0
    support_worker_concurrency: int = 1
    support_job_max_attempts: int = 3
    support_job_retry_base_seconds: int = 5
    support_run_worker: bool = True

    chatwoot_base_url: str = ""
    chatwoot_account_id: str = ""
    chatwoot_inbox_id: str = ""
    chatwoot_api_access_token: str = ""   # Agent Bot / Platform API token, minted in Chatwoot's UI
    chatwoot_hmac_secret: str = ""        # per-inbox Identity Validation secret, from Chatwoot's UI
    chatwoot_webhook_token: str = ""      # our own shared secret, checked on inbound webhook calls

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"
    gemini_simple_model: str = "gemini-3.5-flash"
    gemini_max_output_tokens: int = 700
    gemini_input_cost_per_million: float = 0.0
    gemini_output_cost_per_million: float = 0.0

settings = Settings()
engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
bearer = HTTPBearer(auto_error=False)
redis_client = Redis.from_url(settings.redis_url, decode_responses=True, socket_timeout=10)
AI_QUEUE_KEY = "support:ai:jobs"
AI_PROCESSING_KEY = "support:ai:processing"  # legacy pre-upgrade list
AI_PROCESSING_PREFIX = "support:ai:processing:"
AI_WORKER_HEARTBEAT_PREFIX = "support:ai:worker:"
AI_DEAD_KEY = "support:ai:dead"
AI_RETRY_KEY = "support:ai:retry"
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
_SUPPORT_POLICY_PATH = Path(__file__).parent / "support_policy.md"


def _load_knowledge_base() -> str:
    documents: list[str] = []
    if _SUPPORT_POLICY_PATH.exists():
        documents.append(_SUPPORT_POLICY_PATH.read_text())
    else:
        logger.warning("support_policy.md not found — AI drafts will lack support boundaries")
    if _KB_PATH.exists():
        documents.append(_KB_PATH.read_text())
    else:
        logger.warning("knowledge_base.md not found — AI drafts will have no product context")
    return "\n\n".join(documents)


KNOWLEDGE_BASE = _load_knowledge_base()
KNOWLEDGE_BASE_VERSION = hashlib.sha256(KNOWLEDGE_BASE.encode()).hexdigest()[:12]

def _knowledge_sections() -> list[tuple[str, str]]:
    """Split the generated guide on headings for cheap, deterministic retrieval."""
    sections: list[tuple[str, str]] = []
    title = "General"
    lines: list[str] = []
    for line in KNOWLEDGE_BASE.splitlines():
        if line.startswith("#"):
            if lines:
                sections.append((title, "\n".join(lines)))
            title, lines = line.lstrip("# ").strip(), [line]
        else:
            lines.append(line)
    if lines:
        sections.append((title, "\n".join(lines)))
    return sections

KB_SECTIONS = _knowledge_sections()

def _relevant_knowledge(message: str, limit: int = 3) -> tuple[str, list[str]]:
    normalized = _normalize_question(message)
    broad_getting_started = any(phrase in normalized for phrase in (
        "how do i use festio", "how does festio work", "get started with festio",
        "what can i do with festio", "new to festio",
    ))
    broad_feature_overview = _is_feature_overview(normalized)
    if broad_feature_overview:
        overview_titles = {
            "Complete Festio feature map", "Organizer features", "Staff and check-in features",
            "Guest features", "Operator features", "Get started",
        }
        chosen = [(title, text) for title, text in KB_SECTIONS if title in overview_titles]
        return "\n\n".join(text for _, text in chosen), [title for title, _ in chosen]
    if broad_getting_started:
        onboarding_titles = {"Get started", "Create your event", "Add your guest list"}
        chosen = [(title, text) for title, text in KB_SECTIONS if title in onboarding_titles]
        return "\n\n".join(text for _, text in chosen), [title for title, _ in chosen]
    words = set(re.findall(r"[a-z0-9]+", message.lower())) - {"the", "and", "for", "with", "how", "can", "you"}
    ranked = sorted(
        ((len(words & set(re.findall(r"[a-z0-9]+", text.lower()))), title, text)
        for title, text in KB_SECTIONS), reverse=True,
    )
    chosen = [(title, text) for score, title, text in ranked[:limit] if score]
    if not chosen:
        chosen = KB_SECTIONS[:1]
    return "\n\n".join(text for _, text in chosen), [title for title, _ in chosen]


def _knowledge_for_route(message: str, route: dict | None, limit: int = 3) -> tuple[str, list[str]]:
    """Prefer the validated local section hint, then fill with lexical matches."""
    knowledge, titles = _relevant_knowledge(message, limit)
    hint = str((route or {}).get("knowledge_section") or "").strip().lower()
    if not hint:
        return knowledge, titles
    ranked = sorted(
        KB_SECTIONS,
        key=lambda section: difflib.SequenceMatcher(None, hint, section[0].lower()).ratio(),
        reverse=True,
    )
    if not ranked or difflib.SequenceMatcher(None, hint, ranked[0][0].lower()).ratio() < 0.35:
        return knowledge, titles
    selected = [ranked[0]] + [section for section in KB_SECTIONS if section[0] in titles and section != ranked[0]]
    selected = selected[:limit]
    return "\n\n".join(text for _, text in selected), [title for title, _ in selected]

SYSTEM_PROMPT = """You are a knowledgeable support assistant for Festio, an event management platform.
Answer the organizer's latest question using ONLY the product documentation below. Resolve short
follow-up questions from the conversation, but correct any earlier assistant statement that conflicts
with the documentation. Reference the exact tab, button, and feature names used in the app.

Give a complete, useful answer rather than a fragment. For a how-to request, provide 4–7 numbered
steps and include the expected result. For a broad getting-started question, explain the normal path
(create an event, add guests, configure invitations/RSVPs, send invites, and run check-in) instead of
jumping to an optional advanced feature. Use roughly 120–350 words for broad or step-by-step answers;
a simple factual question may be shorter. Finish every sentence and list item.

If the question is about billing, payments, account status, or anything specific to this \
organizer's account that is not covered in the documentation, say plainly that you can't \
see their account details and that a teammate will follow up. Never guess at account-specific \
information.

If the documentation does not explicitly contain the requested fact, do not substitute a loosely
related feature or invent an answer. State that the information is not listed, and say that a
teammate will follow up in this chat.

# Festio product documentation

{knowledge_base}
"""

# Topics an AI should never answer unsupervised — account/billing/security
# questions where a wrong auto-sent answer could cost the organizer money or
# access. Matched against the organizer's incoming message; a hit always
# routes to a private note for a human, regardless of support_ai_auto_send.
GATED_KEYWORDS = [
    "billing", "billed", "invoice", "refund", "charge", "chargeback", "dispute",
    "payment", "credit card", "card", "subscription", "cancel", "downgrade",
    "delete my account", "delete account", "close my account",
    "password", "2fa", "security", "hacked", "breach", "compromised",
    "legal", "lawsuit", "gdpr", "data request", "sue",
    "personal information", "personal data", "accessed my account", "account access",
    "my plan", "change my plan", "plan am i", "current plan", "which plan am i",
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
    "connect me to an agent", "connect me with an agent",
]

CONTACT_SUPPORT_PHRASES = [
    "support phone", "support number", "phone number", "contact number", "telephone number",
    "support email", "support address", "customer service number", "customer support number",
    "helpdesk number", "help desk number", "hotline",
]

ACKNOWLEDGEMENT_PHRASES = {
    "thanks", "thank you", "thank you very much", "thanks a lot", "thx", "got it", "ok", "okay",
}
GREETING_PHRASES = {"hi", "hello", "hey", "good morning", "good afternoon", "good evening"}
KNOWN_FAQS = {
    "how do i import guests": "Add your guest list",
    "how do i send invitations": "Send invitations",
    "how do i check guests in": "Check guests in",
    "where is my qr code": "Your ticket & QR code",
    "how do i export guests": "Export & post-event",
}


def _is_gated(text: str) -> bool:
    lowered = (text or "").lower()
    return any(kw in lowered for kw in GATED_KEYWORDS)


def _is_escalation_request(text: str) -> bool:
    lowered = (text or "").lower()
    return any(p in lowered for p in ESCALATION_PHRASES)


def _is_deferral(text: str) -> bool:
    lowered = (text or "").lower()
    return any(p in lowered for p in DEFERRAL_PHRASES)


def _is_acknowledgement(text: str) -> bool:
    return (text or "").lower().strip().strip(string.punctuation) in ACKNOWLEDGEMENT_PHRASES


def _is_general_pricing_question(text: str) -> bool:
    normalized = _normalize_question(text)
    words = set(normalized.split())
    return bool({"pricing", "prices", "plans"} & words) or any(phrase in normalized for phrase in (
        "how much does festio cost", "event pass cost", "event pass price", "edit pricing",
    ))


def _deterministic_route(text: str) -> str:
    """Conservative rules which always run before either model."""
    normalized = (text or "").lower().strip().strip(string.punctuation)
    if not normalized:
        return "unsupported"
    if _is_escalation_request(normalized):
        return "human"
    if any(phrase in normalized for phrase in CONTACT_SUPPORT_PHRASES):
        return "human"
    if _is_gated(normalized):
        return "sensitive"
    if _is_acknowledgement(normalized):
        return "acknowledgement"
    if _is_general_pricing_question(normalized):
        return "pricing_info"
    if normalized in GREETING_PHRASES:
        return "greeting"
    if _is_feature_overview(normalized):
        return "feature_overview"
    if normalized in KNOWN_FAQS:
        return "faq"
    return "model"


def _conversation_summary(transcript: str) -> str:
    lines = [line.strip() for line in transcript.splitlines() if line.strip()]
    if not lines:
        return "No conversation context available."
    return " | ".join(lines[-5:])[:800]


def _parse_json_object(content: str | dict) -> dict:
    if isinstance(content, dict):
        return content
    if not isinstance(content, str) or len(content) > 10000:
        raise ValueError("invalid local model response")
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", stripped, flags=re.IGNORECASE)
    start, end = stripped.find("{"), stripped.rfind("}")
    if start < 0 or end < start:
        raise ValueError("local model response did not contain JSON")
    result = json.loads(stripped[start:end + 1])
    if not isinstance(result, dict):
        raise ValueError("local model response was not an object")
    return result


def _answer_looks_complete(answer: str) -> bool:
    text = (answer or "").strip()
    if len(text) < 80 or text.count("**") % 2 or text.count('"') % 2:
        return False
    return text[-1] in ".!?)]"


def _normalize_question(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", (text or "").lower()))[:1000]


def _is_feature_overview(text: str) -> bool:
    normalized = _normalize_question(text)
    words = set(normalized.split())
    return (
        "festio" in words
        and bool({"feature", "features"} & words)
        and bool({"all", "every", "complete", "main"} & words)
    ) or any(phrase in normalized for phrase in (
        "all festio features", "all features of festio", "festio features", "what can festio do",
        "complete feature list", "every festio feature", "advantages of festio",
    ))


def _redact_for_model(text: str) -> str:
    """Minimize personal data sent to remote models while preserving support context."""
    redacted = re.sub(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[email]", text or "", flags=re.I)
    redacted = re.sub(r"(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)", "[phone]", redacted)
    redacted = re.sub(
        r"(?i)\b(api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*\S+",
        r"\1=[redacted]",
        redacted,
    )
    return redacted


def _confidence_policy(route: dict | None, shadow_mode: bool) -> str:
    if not route or shadow_mode:
        return "observe"
    confidence = float(route.get("confidence", 0))
    if route.get("needs_human") or route.get("intent") in {"billing", "security", "escalation"}:
        return "escalate"
    if confidence < 0.50:
        return "escalate"
    if confidence < settings.support_local_ai_confidence_threshold:
        return "review"
    return "draft"


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
    return "\n".join(lines[-20:])[-settings.support_max_transcript_chars:]


async def _post_private_note(conversation_id: int, content: str) -> None:
    url = f"{settings.chatwoot_base_url}/api/v1/accounts/{settings.chatwoot_account_id}/conversations/{conversation_id}/messages"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            url,
            headers=_chatwoot_headers(),
            json={"content": content, "message_type": "outgoing", "private": True},
        )
        resp.raise_for_status()
    if content.startswith("🤖 AI suggestion"):
        suggested = content.split("\n\n", 2)[1] if "\n\n" in content else content
        await redis_client.setex(f"support:suggestion:{conversation_id}", 7 * 86400, suggested.strip().lower())


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

GREETING_REPLY = (
    "Hello! I’m Festio Support. I can help you create an event, add guests, configure RSVPs "
    "and invitations, send updates, manage seating, and run check-in. What would you like to do?"
)

FEATURE_OVERVIEW_REPLY = """Festio features are organized around four roles:

**For organizers**
1. Create and manage events, dates, status, and invitation URLs.
2. Add guests manually or import/sync spreadsheets; manage tags, tickets, RSVPs, approvals, and exports.
3. Build public or personal RSVP pages with deadlines, questions, categories, and additional guests.
4. Send email/SMS/WhatsApp invitations, reminders, and targeted broadcasts.
5. Configure seating, floor plans, orders, entry areas, gates, ticket rules, and section scanning.
6. Build Experience workflows for consent, badges, souvenirs, room assignments, and sessions.
7. Manage deliveries, gift lists, FestioHub, FestioMe communities, teams, check-in, Results, and reporting.

**For staff/check-in teams**
- Browser QR scanning, gates/zones, sections, access decisions, Experience steps, session entry, parallel stations, and manual-lookup escalation.

**For guests**
- Invitation links, RSVP/additional guests, approval, Festio Pass QR tickets, seating/orders, FestioHub, FestioMe, consent, room/session assignments, addresses, and gift registries.

**For platform operators**
- Organizations/accounts, trials, complimentary Event Passes/credits, pricing, suspensions/deletions, and operator access.

I can give you an exact step-by-step guide for any workflow. Start with **creating an event**, **RSVP and invitations**, **guest import**, or **check-in**, or name another feature."""

PRICING_GUIDE_REPLY = """Festio has two documented pricing paths:

**For organizers buying an Event Pass**
1. Open your event and go to **Invites & RSVP → Event Pass**.
2. Review the available tiers and choose the guest-cap tier that fits your event.
3. Complete checkout in the currency/options displayed for your account.
4. Return to the Event Pass area to confirm the active pass and view or buy message-credit top-ups.

The free tier includes email invitations, RSVP tracking, and up to 25 guests. An Event Pass unlocks features such as SMS/WhatsApp invitations, larger guest lists, QR check-in, seating/orders, entry areas, deliveries, gift lists, and removal of Festio branding. Current amounts are displayed on the public **Pricing** page and at checkout because tiers and currencies can change.

**For platform operators editing pricing**
1. Open **Console → Pricing** to view Event Pass tiers and message-credit packs.
2. Edit a tier's display name, USD/NGN price, guest cap, and active/inactive status, or add a custom tier.
3. Edit message-credit pack quantities, prices, and active status as needed.
4. Save carefully: changes apply immediately to the public Pricing page and checkout.
5. Deactivating a tier hides it from new checkout purchases but does not change events already using it.

Operator pricing controls require platform-superadministrator access. Questions about a specific charge, invoice, refund, or current account plan must be handled by a support teammate."""


async def _escalate_conversation(conversation_id: int) -> None:
    """No Gemini call — this isn't a product question. Acknowledge immediately
    and mark the conversation urgent so a human notices it faster."""
    await _post_reply(conversation_id, ESCALATION_ACK)
    url = f"{settings.chatwoot_base_url}/api/v1/accounts/{settings.chatwoot_account_id}/conversations/{conversation_id}/toggle_priority"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, headers=_chatwoot_headers(), json={"priority": "urgent"})
        resp.raise_for_status()
    await redis_client.incr("support:metrics:human_escalated")


# ── Gemini drafting ───────────────────────────────────────────────────────

async def _draft_reply(transcript: str, route: dict | None = None, latest_question: str = "") -> tuple[str, str]:
    knowledge_base, _ = _knowledge_for_route(latest_question or transcript, route)
    safe_transcript = _redact_for_model(transcript)
    prompt = SYSTEM_PROMPT.format(knowledge_base=knowledge_base) + f"\n\n# Conversation so far\n{safe_transcript}\n\nDraft a reply to the organizer's latest message."
    prompt = prompt[-settings.support_max_prompt_chars:]

    def _call():
        confidence = float((route or {}).get("confidence", 0))
        simple = (route or {}).get("intent") == "faq" and confidence >= 0.70 and len(transcript) < 6000
        selected_model = settings.gemini_simple_model if simple else settings.gemini_model
        config = {
            "max_output_tokens": settings.gemini_max_output_tokens,
            "temperature": 0.2,
            "thinking_config": {"thinking_budget": 0, "include_thoughts": False},
        }
        response = _gemini_client.models.generate_content(model=selected_model, contents=prompt, config=config)
        answer = (response.text or "").strip()
        if not _answer_looks_complete(answer):
            retry_prompt = (
                prompt
                + "\n\nYour previous draft was incomplete. Regenerate the entire answer from the beginning. "
                "Return plain Markdown, complete every sentence and numbered step, and do not wrap the answer in quotes."
            )
            response = _gemini_client.models.generate_content(
                model=selected_model, contents=retry_prompt, config=config,
            )
            answer = (response.text or "").strip()
        if not _answer_looks_complete(answer):
            raise RuntimeError("Gemini returned an incomplete support answer")
        return answer, selected_model

    started = time.monotonic()
    try:
        result, selected_model = await asyncio.wait_for(asyncio.to_thread(_call), timeout=settings.support_gemini_timeout_seconds)
    except Exception:
        await redis_client.incr("support:metrics:gemini_failed")
        raise
    input_tokens = max(1, len(prompt) // 4)
    output_tokens = max(1, len(result) // 4)
    cost_micros = int(
        input_tokens * settings.gemini_input_cost_per_million
        + output_tokens * settings.gemini_output_cost_per_million
    )
    pipe = redis_client.pipeline()
    pipe.incrby("support:metrics:gemini_input_tokens", input_tokens)
    pipe.incrby("support:metrics:gemini_output_tokens", output_tokens)
    pipe.incrby("support:metrics:estimated_cost_microusd", cost_micros)
    pipe.incrby("support:metrics:gemini_latency_ms", int((time.monotonic() - started) * 1000))
    pipe.incr("support:metrics:gemini_requests")
    pipe.incr(f"support:metrics:gemini_model:{selected_model}")
    await pipe.execute()
    return result, selected_model


async def _under_rate_cap(org_key: str) -> bool:
    hour_bucket = int(time.time() // 3600)
    org_hash = hashlib.sha256(org_key.encode()).hexdigest()[:24]
    script = """
    local org = redis.call('INCR', KEYS[1])
    local global = redis.call('INCR', KEYS[2])
    if org == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
    if global == 1 then redis.call('EXPIRE', KEYS[2], 3600) end
    if org > tonumber(ARGV[1]) or global > tonumber(ARGV[2]) then return 0 end
    return 1
    """
    return bool(await redis_client.eval(
        script, 2, f"support:ai:org:{org_hash}:{hour_bucket}",
        f"support:ai:global:{hour_bucket}", settings.support_ai_hourly_cap,
        settings.support_ai_global_hourly_cap,
    ))


async def _acquire_concurrency(scope: str, limit: int, job_id: str) -> bool:
    now = time.time()
    key = f"support:concurrency:{scope}"
    script = """
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
    if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
    redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
    return 1
    """
    return bool(await redis_client.eval(
        script, 1, key, now, limit,
        now + settings.support_ai_concurrency_lease_seconds, job_id,
        settings.support_ai_concurrency_lease_seconds + 5,
    ))


async def _release_concurrency(scope: str, job_id: str) -> None:
    await redis_client.zrem(f"support:concurrency:{scope}", job_id)


async def _enqueue_once(message_id: str, payload: dict) -> bool:
    """Atomically deduplicate and enqueue so a partial Redis failure cannot lose work."""
    script = """
    if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
    redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])
    redis.call('LPUSH', KEYS[2], ARGV[2])
    redis.call('INCR', KEYS[3])
    return 1
    """
    payload.setdefault("job_id", hashlib.sha256(message_id.encode()).hexdigest()[:16])
    payload.setdefault("queued_at", time.time())
    payload.setdefault("attempt", 0)
    try:
        result = await redis_client.eval(
            script, 3, f"support:message:{message_id}", AI_QUEUE_KEY,
            "support:metrics:queued", 86400, json.dumps(payload),
        )
    except Exception as exc:
        logger.error("support_enqueue_failed message_id=%s", message_id)
        raise HTTPException(503, "Support queue unavailable") from exc
    return bool(result)


async def _local_route(message: str) -> dict | None:
    """Ask an optional local model to classify a message before Gemini.

    The local service is deliberately treated as untrusted: malformed output,
    timeouts, and low confidence all fall back to the normal Gemini path.
    """
    if not settings.support_local_ai_enabled or not settings.support_local_ai_model:
        return None
    prompt = (
        'Classify this support message. Return JSON only with keys '
        'intent (faq|billing|security|escalation|unknown), confidence (0..1), '
        'knowledge_section (string or null), and needs_human (boolean).\n'
        f'Message: {message[:4000]}'
    )
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=settings.support_local_ai_timeout_seconds) as client:
            response = await client.post(
                f"{settings.support_local_ai_url.rstrip('/')}/v1/chat/completions",
                json={
                    "model": settings.support_local_ai_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "max_tokens": 128,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            result = _parse_json_object(content)
            intent = result.get("intent")
            confidence = float(result.get("confidence", 0))
            section = result.get("knowledge_section")
            needs_human = result.get("needs_human")
            if intent not in {"faq", "billing", "security", "escalation", "unknown"}:
                return None
            if section is not None and not isinstance(section, str):
                return None
            if not isinstance(needs_human, bool):
                return None
            routed = {
                "intent": intent,
                "confidence": max(0.0, min(1.0, confidence)),
                "knowledge_section": section,
                "needs_human": needs_human,
            }
            await redis_client.incrby("support:metrics:local_latency_ms", int((time.monotonic() - started) * 1000))
            await redis_client.incr("support:metrics:local_requests")
            return routed
    except (httpx.TimeoutException, asyncio.TimeoutError):
        await redis_client.incr("support:metrics:local_timeout")
        logger.warning("local AI routing timed out; falling back to Gemini")
        return None
    except Exception:
        logger.warning("local AI routing failed; falling back to Gemini", exc_info=True)
        return None


async def _local_faq_draft(question: str, knowledge: str) -> str | None:
    if (
        not settings.support_local_ai_enabled
        or not settings.support_local_ai_model
        or not settings.support_local_ai_drafting_enabled
    ):
        return None
    prompt = (
        "Answer the support question using only the documentation. Return JSON only "
        "as {\"answer\": \"...\"}. Do not answer billing, security, legal, or account-specific questions.\n\n"
        f"Documentation:\n{knowledge[:10000]}\n\nQuestion: {question[:settings.support_max_message_chars]}"
    )
    try:
        async with httpx.AsyncClient(timeout=settings.support_local_ai_timeout_seconds) as client:
            response = await client.post(
                f"{settings.support_local_ai_url.rstrip('/')}/v1/chat/completions",
                json={
                    "model": settings.support_local_ai_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "max_tokens": 500,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            result = _parse_json_object(content)
            answer = result.get("answer")
            if not isinstance(answer, str):
                return None
            answer = answer.strip()[:settings.support_max_reply_chars]
            if not answer or _is_gated(answer) or _is_deferral(answer):
                return None
            return answer
    except Exception:
        logger.warning("local FAQ draft failed; falling back to Gemini", exc_info=True)
        return None


async def _local_summarize(transcript: str) -> str | None:
    lines = [line for line in transcript.splitlines() if line.strip()]
    if len(lines) <= 10 or not settings.support_local_ai_enabled or settings.support_local_ai_shadow_mode:
        return None
    older = "\n".join(lines[:-8])[-8000:]
    prompt = (
        'Summarize this older support conversation without names, email addresses, phone numbers, '
        'or other personal data. Return JSON only as {"summary":"..."}. Keep product questions, '
        f'actions, and unresolved issues in at most 500 characters.\n\n{older}'
    )
    try:
        async with httpx.AsyncClient(timeout=settings.support_local_ai_timeout_seconds) as client:
            response = await client.post(
                f"{settings.support_local_ai_url.rstrip('/')}/v1/chat/completions",
                json={
                    "model": settings.support_local_ai_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "max_tokens": 180,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            result = _parse_json_object(response.json()["choices"][0]["message"]["content"])
            summary = result.get("summary")
            if isinstance(summary, str) and summary.strip():
                await redis_client.incr("support:metrics:local_summaries")
                return summary.strip()[:500]
    except Exception:
        logger.warning("local transcript summary failed; using recent turns only", exc_info=True)
    return None


async def _compact_transcript(transcript: str) -> str:
    lines = [line for line in transcript.splitlines() if line.strip()]
    if len(lines) <= 10:
        return "\n".join(lines)
    summary = await _local_summarize(transcript)
    recent = "\n".join(lines[-8:])
    return f"Older conversation summary: {summary}\n{recent}" if summary else recent


async def _claim_question(org_key: str, question: str) -> bool:
    normalized = _normalize_question(question)
    if not normalized:
        return True
    org_hash = hashlib.sha256(org_key.encode()).hexdigest()[:16]
    question_hash = hashlib.sha256(normalized.encode()).hexdigest()
    return bool(await redis_client.set(
        f"support:duplicate:{org_hash}:{question_hash}", "1", ex=600, nx=True,
    ))


# ── App ────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    required = {
        "CHATWOOT_BASE_URL": settings.chatwoot_base_url,
        "CHATWOOT_ACCOUNT_ID": settings.chatwoot_account_id,
        "CHATWOOT_API_ACCESS_TOKEN": settings.chatwoot_api_access_token,
        "CHATWOOT_HMAC_SECRET": settings.chatwoot_hmac_secret,
        "CHATWOOT_WEBHOOK_TOKEN": settings.chatwoot_webhook_token,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise RuntimeError(f"Missing required Chatwoot settings: {', '.join(missing)}")
    workers = []
    worker_ids: list[str] = []
    if settings.support_run_worker:
        # Recover the one legacy processing list used before per-worker ownership.
        while raw := await redis_client.rpop(AI_PROCESSING_KEY):
            await redis_client.lpush(AI_QUEUE_KEY, raw)
            await redis_client.incr("support:metrics:recovered")
        process_id = f"{socket.gethostname()}-{id(app)}"
        worker_ids = [f"{process_id}-{index}" for index in range(max(1, settings.support_worker_concurrency))]
        workers = [asyncio.create_task(_ai_worker(worker_id)) for worker_id in worker_ids]
        workers.append(asyncio.create_task(_retry_scheduler()))
    app.state.ai_workers = workers
    yield
    for worker in workers:
        worker.cancel()
    if workers:
        await asyncio.gather(*workers, return_exceptions=True)
    if worker_ids:
        await redis_client.delete(*(f"{AI_WORKER_HEARTBEAT_PREFIX}{worker_id}" for worker_id in worker_ids))


app = FastAPI(title="Festio Support Service", version="0.2.0", lifespan=lifespan)


@app.middleware("http")
async def observe_webhook_latency(request: Request, call_next):
    started = time.monotonic()
    response = await call_next(request)
    if request.url.path.endswith("/webhooks/chatwoot"):
        try:
            await redis_client.incrby("support:metrics:webhook_latency_ms", int((time.monotonic() - started) * 1000))
            await redis_client.incr("support:metrics:webhook_requests")
        except Exception:
            logger.warning("could not record webhook metrics")
    return response
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
    try:
        await redis_client.ping()
    except Exception as exc:
        raise HTTPException(503, "Redis unavailable") from exc
    return {"status": "ok", "service": "support-service"}

@app.get("/api/support/metrics")
async def metrics(user: User = Depends(current_user)):
    if not user.is_platform_superadmin:
        raise HTTPException(403, "Platform administrator access required")
    return await _metrics_snapshot()


async def _metrics_snapshot():
    keys = (
        "queued", "completed", "retried", "recovered", "dead", "cache_hit", "cache_miss",
        "duplicate_jobs", "local_timeout", "local_requests", "local_latency_ms",
        "gemini_failed", "gemini_requests", "gemini_latency_ms", "gemini_input_tokens",
        "gemini_output_tokens", "estimated_cost_microusd", "human_escalated",
        "suggestion_accepted", "suggestion_edited",
        "webhook_latency_ms", "webhook_requests",
    )
    metric_keys = [key async for key in redis_client.scan_iter("support:metrics:*")]
    values = await redis_client.mget(metric_keys) if metric_keys else []
    result = {
        key.removeprefix("support:metrics:"): int(value or 0)
        for key, value in zip(metric_keys, values)
    }
    for key in keys:
        result.setdefault(key, 0)
    result["queue_depth"] = await redis_client.llen(AI_QUEUE_KEY)
    result["retry_depth"] = await redis_client.zcard(AI_RETRY_KEY)
    result["dead_depth"] = await redis_client.llen(AI_DEAD_KEY)
    oldest = await redis_client.lindex(AI_QUEUE_KEY, -1)
    if oldest:
        try:
            result["oldest_job_age_seconds"] = max(0, int(time.time() - float(json.loads(oldest).get("queued_at", time.time()))))
        except (TypeError, ValueError, json.JSONDecodeError):
            result["oldest_job_age_seconds"] = 0
    else:
        result["oldest_job_age_seconds"] = 0
    return result


@app.get("/metrics", include_in_schema=False)
async def prometheus_metrics():
    data = await _metrics_snapshot()
    lines = ["# TYPE support_ai gauge"]
    lines.extend(f"support_ai{{metric=\"{key}\"}} {value}" for key, value in data.items())
    return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")


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


async def _draft_and_post(
    conversation_id: int,
    gated: bool,
    route: dict | None = None,
    latest_question: str = "",
    force_review: bool = False,
    review_reason: str | None = None,
) -> None:
    started = time.monotonic()
    full_transcript = await _fetch_conversation_transcript(conversation_id)
    question = (latest_question or full_transcript.rsplit("\n", 1)[-1].removeprefix("Organizer:")).strip().lower()
    transcript = await _compact_transcript(full_transcript)
    cache_key = f"support:faq:v2:{KNOWLEDGE_BASE_VERSION}:" + hashlib.sha256(
        _normalize_question(question).encode()
    ).hexdigest()
    knowledge, sections = _knowledge_for_route(question, route)
    local_eligible = bool(
        route and route.get("intent") == "faq"
        and float(route.get("confidence", 0)) >= settings.support_local_ai_confidence_threshold
        and route.get("knowledge_section") and not route.get("needs_human") and not gated
    )
    draft = await redis_client.get(cache_key)
    if draft and not _answer_looks_complete(draft):
        await redis_client.delete(cache_key)
        draft = None
    provider = "cache" if draft else "gemini"
    cache_hit = draft is not None
    if draft is None and local_eligible:
        draft = await _local_faq_draft(question, knowledge)
        if draft:
            provider = "local"
            await redis_client.setex(cache_key, 86400, draft)
    if draft is None:
        if _gemini_client is None:
            raise RuntimeError("Gemini is unavailable")
        draft, selected_model = await _draft_reply(transcript, route, question)
        provider = f"gemini:{selected_model}"
        if draft:
            draft = draft[:settings.support_max_reply_chars]
            await redis_client.setex(cache_key, 86400, draft)
    await redis_client.incr(f"support:metrics:cache_{'hit' if cache_hit else 'miss'}")
    if not draft:
        raise RuntimeError("Gemini returned an empty draft")
    held_back = settings.support_ai_gating_enabled and (gated or _is_deferral(draft))
    intent = (route or {}).get("intent", "faq" if question in KNOWN_FAQS else "unknown")
    confidence = float((route or {}).get("confidence", 0.0))
    can_auto_send = settings.support_ai_auto_send and (
        provider != "local" or settings.support_local_ai_auto_reply
    )
    if held_back:
        await _post_private_note(
            conversation_id,
            "🤖 AI suggestion withheld because it needs human review\n\n"
            f"{draft}\n\nIntent: {intent}\nConfidence: {confidence:.2f}\n"
            f"Source: {', '.join(sections) or 'none'}\nProvider: {provider}",
        )
        await _escalate_conversation(conversation_id)
        return
    if not can_auto_send or force_review:
        reason = review_reason or ("sensitive-topic or model deferral" if held_back else "manual-review mode")
        await _post_private_note(
            conversation_id,
            "\U0001F916 AI suggestion (review before sending)\n\n"
            f"{draft}\n\nIntent: {intent}\nConfidence: {confidence:.2f}\n"
            f"Source: {', '.join(sections) or 'none'}\nReason: {reason}\nProvider: {provider}"
            f"\nConversation summary: {_conversation_summary(full_transcript)}",
        )
    else:
        await _post_reply(conversation_id, draft)
    logger.info("support_reply conversation_id=%s provider=%s gated=%s latency_ms=%d", conversation_id, provider, gated, (time.monotonic() - started) * 1000)


async def _process_job(payload: dict) -> None:
    message_id = str(payload["message_id"])
    done_key = f"support:reply:done:{message_id}"
    if await redis_client.exists(done_key):
        await redis_client.incr("support:metrics:duplicate_jobs")
        return
    conversation_id = int(payload["conversation_id"])
    job_id = str(payload.get("job_id", message_id))
    org_key = str(payload.get("org_key", "unknown"))
    scopes = ("global", f"org:{hashlib.sha256(org_key.encode()).hexdigest()[:16]}", f"conversation:{conversation_id}")
    limits = (settings.support_ai_global_concurrency, settings.support_ai_org_concurrency, 1)
    acquired: list[str] = []
    try:
        for scope, limit in zip(scopes, limits):
            if not await _acquire_concurrency(scope, limit, job_id):
                raise ConcurrencyBusy(scope)
            acquired.append(scope)
        if payload.get("kind") == "escalate":
            await _escalate_conversation(conversation_id)
        elif payload.get("kind") == "canned":
            await _post_reply(conversation_id, str(payload["content"]))
        else:
            message = str(payload.get("message", ""))
            if not await _claim_question(org_key, message):
                await redis_client.incr("support:metrics:duplicate_questions")
                # Continue through the normal path. Exact questions reuse the
                # response cache, but must still receive a visible reply; an
                # earlier attempt may have produced only a private review note.
            local_route = await _local_route(message)
            if local_route:
                await redis_client.incr(f"support:metrics:local_{local_route['intent']}")
                logger.info(
                    "support_route conversation_id=%s job_id=%s intent=%s confidence=%.2f provider=local",
                    conversation_id, job_id, local_route["intent"], local_route["confidence"],
                )
            confidence = float((local_route or {}).get("confidence", 0))
            policy = _confidence_policy(local_route, settings.support_local_ai_shadow_mode)
            if policy == "escalate":
                await _escalate_conversation(conversation_id)
            else:
                medium_confidence = policy == "review"
                effective_route = None if settings.support_local_ai_shadow_mode else local_route
                await _draft_and_post(
                    conversation_id,
                    bool(payload.get("gated")),
                    effective_route,
                    latest_question=message,
                    force_review=medium_confidence,
                    review_reason="medium-confidence local classification" if medium_confidence else None,
                )
        await redis_client.set(done_key, "1", ex=7 * 86400)
    finally:
        for scope in acquired:
            await _release_concurrency(scope, job_id)


async def _ai_worker(worker_id: str = "worker-0") -> None:
    processing_key = f"{AI_PROCESSING_PREFIX}{worker_id}"
    heartbeat_key = f"{AI_WORKER_HEARTBEAT_PREFIX}{worker_id}"
    while True:
        raw = None
        try:
            await redis_client.set(heartbeat_key, "1", ex=120)
            raw = await redis_client.brpoplpush(AI_QUEUE_KEY, processing_key, timeout=5)
            if not raw:
                continue
            payload = json.loads(raw)
            await _process_job(payload)
            await redis_client.lrem(processing_key, 1, raw)
            await redis_client.incr("support:metrics:completed")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("support AI worker failed; retrying")
            if raw:
                await redis_client.lrem(processing_key, 1, raw)
                try:
                    payload = json.loads(raw)
                    payload["attempt"] = int(payload.get("attempt", 0)) + 1
                    retry_raw = json.dumps(payload)
                    if payload["attempt"] < settings.support_job_max_attempts:
                        delay = settings.support_job_retry_base_seconds * (2 ** (payload["attempt"] - 1))
                        await redis_client.zadd(AI_RETRY_KEY, {retry_raw: time.time() + delay})
                        await redis_client.incr("support:metrics:retried")
                    else:
                        await redis_client.rpush(AI_DEAD_KEY, retry_raw)
                        await redis_client.incr("support:metrics:dead")
                        try:
                            await _escalate_conversation(int(payload["conversation_id"]))
                            await redis_client.set(
                                f"support:reply:done:{payload['message_id']}", "1", ex=7 * 86400,
                            )
                        except Exception:
                            logger.exception("could not post final support fallback")
                except Exception:
                    await redis_client.rpush(AI_DEAD_KEY, raw)
                    await redis_client.incr("support:metrics:dead")
            await asyncio.sleep(1)


async def _retry_scheduler() -> None:
    script = """
    local jobs = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 100)
    for _, job in ipairs(jobs) do
      redis.call('ZREM', KEYS[1], job)
      redis.call('LPUSH', KEYS[2], job)
    end
    return #jobs
    """
    while True:
        try:
            await redis_client.eval(script, 2, AI_RETRY_KEY, AI_QUEUE_KEY, time.time())
            async for processing_key in redis_client.scan_iter(f"{AI_PROCESSING_PREFIX}*"):
                worker_id = processing_key.removeprefix(AI_PROCESSING_PREFIX)
                if await redis_client.exists(f"{AI_WORKER_HEARTBEAT_PREFIX}{worker_id}"):
                    continue
                while raw := await redis_client.rpop(processing_key):
                    await redis_client.lpush(AI_QUEUE_KEY, raw)
                    await redis_client.incr("support:metrics:recovered")
                await redis_client.delete(processing_key)
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("retry scheduler unavailable")
            await asyncio.sleep(2)


@app.post("/api/support/webhooks/chatwoot")
async def chatwoot_webhook(request: Request, token: str | None = Query(default=None)):
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
    if payload.get("event") != "message_created" or payload.get("private"):
        return {"status": "ignored"}

    conversation = payload.get("conversation") or {}
    conversation_id = conversation.get("id")
    if not conversation_id:
        return {"status": "no_conversation"}
    if not is_incoming:
        suggestion_key = f"support:suggestion:{conversation_id}"
        suggestion = await redis_client.get(suggestion_key)
        if suggestion:
            sent = (payload.get("content") or "").strip().lower()
            metric = "accepted" if sent == suggestion else "edited"
            await redis_client.incr(f"support:metrics:suggestion_{metric}")
            await redis_client.delete(suggestion_key)
        return {"status": "agent_reply_recorded"}

    content = (payload.get("content") or "")[:settings.support_max_message_chars]
    if payload.get("id") is None:
        raise HTTPException(422, "Chatwoot message id is required")
    message_id = str(payload["id"])
    if await redis_client.exists(f"support:message:{message_id}"):
        return {"status": "duplicate"}
    contact = payload.get("sender") or payload.get("contact") or {}
    org_key = (contact.get("custom_attributes") or {}).get("org_id") or contact.get("email") or "unknown"
    route = _deterministic_route(content)
    if route in {"unsupported", "acknowledgement"}:
        return {"status": "no_reply_needed"}

    if route == "greeting":
        queued = await _enqueue_once(message_id, {
            "kind": "canned", "content": GREETING_REPLY,
            "conversation_id": conversation_id, "message_id": message_id, "org_key": org_key,
        })
        return {"status": "queued", "route": "greeting"} if queued else {"status": "duplicate"}

    if route == "feature_overview":
        queued = await _enqueue_once(message_id, {
            "kind": "canned", "content": FEATURE_OVERVIEW_REPLY,
            "conversation_id": conversation_id, "message_id": message_id, "org_key": org_key,
        })
        return {"status": "queued", "route": "feature_overview"} if queued else {"status": "duplicate"}

    if route == "pricing_info":
        queued = await _enqueue_once(message_id, {
            "kind": "canned", "content": PRICING_GUIDE_REPLY,
            "conversation_id": conversation_id, "message_id": message_id, "org_key": org_key,
        })
        return {"status": "queued", "route": "pricing_info"} if queued else {"status": "duplicate"}

    if route == "human":
        queued = await _enqueue_once(message_id, {"kind": "escalate", "conversation_id": conversation_id, "message_id": message_id, "org_key": org_key})
        if not queued:
            return {"status": "duplicate"}
        return {"status": "queued", "route": "human"}

    if route == "sensitive":
        queued = await _enqueue_once(message_id, {"kind": "escalate", "conversation_id": conversation_id, "message_id": message_id, "org_key": org_key})
        if not queued:
            return {"status": "duplicate"}
        return {"status": "queued", "route": "sensitive"}

    if not settings.support_ai_enabled or _gemini_client is None:
        queued = await _enqueue_once(message_id, {
            "kind": "escalate", "conversation_id": conversation_id,
            "message_id": message_id, "org_key": org_key,
        })
        return {"status": "queued", "route": "human"} if queued else {"status": "duplicate"}

    if not await _under_rate_cap(org_key):
        org_hash = hashlib.sha256(org_key.encode()).hexdigest()[:16]
        logger.warning("support AI hourly cap reached for org_hash=%s conversation_id=%s", org_hash, conversation_id)
        queued = await _enqueue_once(message_id, {
            "kind": "escalate", "conversation_id": conversation_id,
            "message_id": message_id, "org_key": org_key,
        })
        return {"status": "queued", "route": "human"} if queued else {"status": "duplicate"}

    gated = route == "sensitive"
    queued = await _enqueue_once(message_id, {
        "conversation_id": conversation_id, "gated": gated, "message_id": message_id,
        "org_key": org_key, "message": content,
    })
    if not queued:
        return {"status": "duplicate"}
    return {"status": "queued"}
