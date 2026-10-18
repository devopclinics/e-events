"""Recipient dispatch AFTER the existing inbound endpoint authenticates raw bytes.

The webhook signature authenticates Resend, not a claimed sender/account.
Marketing alone resolves the token's lead and compares its current mailbox.
"""
import base64
import hashlib
import hmac
import re
from email.utils import getaddresses

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.engagement_config import engagement_settings
from app.services.marketing_client import enqueue_marketing_payload
from app.services.prospect_ingress import event_key, incoming_event


def _address(value: str) -> str:
    if not isinstance(value, str) or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise HTTPException(400, "Invalid inbound recipient")
    addresses = getaddresses([value])
    if len(addresses) != 1:
        raise HTTPException(400, "Ambiguous inbound recipient")
    address = addresses[0][1]
    if not re.fullmatch(r"[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+", address) or len(address) > 320:
        raise HTTPException(400, "Invalid inbound recipient")
    local, domain = address.rsplit("@", 1)
    return f"{local}@{domain.lower()}"


def _recipients(data: dict) -> list[str]:
    result = []
    for field in ("to", "cc"):
        values = data.get(field)
        if values is None:
            values = []
        if isinstance(values, str):
            values = [values]
        if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
            raise HTTPException(400, "Invalid inbound recipients")
        result.extend(_address(v) for v in values)
    if not result or len(result) > 40 or not data.get("to"):
        raise HTTPException(400, "Missing or excessive inbound recipients")
    return result


def _valid_token(token: str) -> bool:
    secret = settings.planner_internal_token
    if not secret or not secret.strip() or not re.fullmatch(r"v1\.[0-9a-f]{32}\.[A-Za-z0-9_-]{22}", token):
        return False
    _, lead_hex, _ = token.split(".")
    signature = hmac.new(secret.encode(), f"festio-marketing-reply:v1:{lead_hex}".encode(), hashlib.sha256).digest()[:16]
    expected = f"v1.{lead_hex}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"
    return hmac.compare_digest(token, expected)


def prospect_reply_bases() -> set[str]:
    """Use the same exact, unambiguous configuration for routing and readiness."""
    bases = set()
    for configured in engagement_settings.prospect_email_recipients.split(","):
        if configured.strip():
            try:
                address = _address(configured.strip()).lower()
            except HTTPException:
                # Invalid sales config must not stop normal guest callbacks.
                continue
            if "+" not in address.split("@", 1)[0]:
                bases.add(address)
    return bases


async def dispatch_prospect_reply(data: dict, db: AsyncSession) -> bool:
    """Return False for guest traffic; never authenticate or reinterpret body identity."""
    recipients = _recipients(data)
    bases = prospect_reply_bases()
    classified = []
    for address in recipients:
        local, domain = address.rsplit("@", 1)
        base = f"{local.split('+', 1)[0].lower()}@{domain}"
        if base in bases:
            classified.append(address)
    if not classified:
        return False
    # No partial delivery: guest/unknown CCs or two distinct sales tokens are
    # ambiguous. Do not enqueue either path, even when the gate is disabled.
    if len(classified) != len(recipients) or len(set(classified)) != 1:
        raise HTTPException(400, "Ambiguous guest and prospect recipients")
    if not engagement_settings.prospect_ingress_enabled:
        raise HTTPException(503, "Prospect ingress is not enabled")
    # Preserve the guest endpoint's fallback signing authority for guests only.
    if not settings.resend_inbound_webhook_secret or not settings.resend_inbound_webhook_secret.strip():
        raise HTTPException(503, "Prospect receiving authority is not configured")
    local = classified[0].split("@", 1)[0]
    if "+" not in local:
        raise HTTPException(400, "Missing bound reply token")
    token = local.split("+", 1)[1]
    if not _valid_token(token):
        raise HTTPException(400, "Invalid bound reply token")
    sender = _address(data.get("from")).lower()
    provider_id = data.get("email_id")
    if not isinstance(provider_id, str) or not provider_id.strip() or len(provider_id) > 500:
        raise HTTPException(400, "Missing inbound email identity")
    if data.get("subject") is not None and not isinstance(data["subject"], str):
        raise HTTPException(400, "Invalid inbound subject")
    # Account IDs, identity_verified and other caller-supplied identity fields
    # never cross this boundary. The HMAC stays case-sensitive.
    await enqueue_marketing_payload(db, {
        "channel": "email", "event": incoming_event(data.get("subject")),
        "email": sender, "identity_verified": False,
        "source_contact_id": event_key("resend-contact", sender),
        "reply_token": token,
    }, endpoint="conversations", event_id=event_key("resend-inbound", provider_id))
    await db.commit()
    return True
