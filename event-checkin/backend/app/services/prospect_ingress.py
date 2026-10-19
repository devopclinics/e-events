"""Minimal, consent-neutral events from authenticated prospect channels.

No message content is persisted here or forwarded to a model. A reply stops
follow-ups; it is not permission to contact the sender on another channel.
"""
import hashlib
import json
import re
from datetime import datetime,timezone,timedelta
from email.utils import parseaddr

from fastapi import HTTPException, Request

MAX_WEBHOOK_BYTES = 262144
_STOP_WORDS = {"stop", "unsubscribe", "cancel", "end", "quit", "stop all"}
_HANDOFF_PHRASES = ("talk to a human", "speak to a human", "live agent", "real person")


def authenticated_message_time(raw):
    try:
        value=datetime.fromtimestamp(raw,timezone.utc) if type(raw) in {int,float} else datetime.fromisoformat(str(raw).replace("Z","+00:00"))
        now=datetime.now(timezone.utc)
        if value.tzinfo is None or value>now or value<now-timedelta(days=7):
            return None
        return value.astimezone(timezone.utc).isoformat()
    except (TypeError,ValueError,OverflowError,OSError):
        return None


async def bounded_body(request: Request) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_WEBHOOK_BYTES:
            raise HTTPException(status_code=413, detail="Webhook payload too large")
    return bytes(body)


def object_payload(body: bytes) -> dict:
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object")
    return payload


def event_key(provider: str, message_id: str) -> str:
    """Bound IDs without retaining provider metadata or collisions by truncation."""
    return f"{provider}:{hashlib.sha256(message_id.encode()).hexdigest()}"


def incoming_event(text: str | None) -> str:
    normalized = " ".join(str(text or "").strip().casefold().split()).strip(".!?")
    if normalized in _STOP_WORDS:
        return "opt_out"
    if any(phrase in normalized for phrase in _HANDOFF_PHRASES):
        return "handoff_requested"
    return "message_received"


def sales_intent(text: str | None) -> str:
    """Bounded intent classification; no model/tools or account retrieval."""
    normalized = " ".join(str(text or "")[:2000].casefold().split())
    if normalized == "i agree to receive festio whatsapp guidance":
        return "setup"
    event = incoming_event(normalized)
    if event == "opt_out":
        return "opt_out"
    if event == "handoff_requested":
        return "handoff"
    if any(word in normalized for word in ("price", "pricing", "cost")):
        return "pricing"
    if any(word in normalized for word in ("setup", "set up", "create event", "guest list", "rsvp", "check-in")):
        return "setup"
    if normalized.strip(".!?") in {"hi", "hello", "help", "start"}:
        return "discovery"
    return "handoff"


def email_address(value) -> str | None:
    if not isinstance(value, str):
        return None
    address = parseaddr(value)[1].strip().lower()
    if len(address) > 320 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", address):
        return None
    return address


def phone_number(value) -> str | None:
    raw = str(value or "").strip().removeprefix("+")
    return f"+{raw}" if re.fullmatch(r"[1-9][0-9]{6,14}", raw) else None
