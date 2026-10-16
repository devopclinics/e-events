"""Minimal, consent-neutral events from authenticated prospect channels.

No message content is persisted here or forwarded to a model. A reply stops
follow-ups; it is not permission to contact the sender on another channel.
"""
import hashlib
import json
import re
from email.utils import parseaddr

from fastapi import HTTPException, Request

MAX_WEBHOOK_BYTES = 262144
_STOP_WORDS = {"stop", "unsubscribe", "cancel", "end", "quit", "stop all"}
_HANDOFF_PHRASES = ("talk to a human", "speak to a human", "live agent", "real person")


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
