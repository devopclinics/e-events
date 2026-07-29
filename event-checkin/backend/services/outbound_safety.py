"""Fail-closed recipient guard for staging and provider-safe E2E.

This module deliberately has no environment-name inference. Operators must
explicitly enable it in staging; its default is off so production behavior
does not change merely because a hostname or deployment label changes.
"""
import logging
import re
from email.utils import getaddresses

from app.config import settings

logger = logging.getLogger(__name__)


def _csv(value: str) -> set[str]:
    return {part.strip() for part in (value or "").split(",") if part.strip()}


def normalize_phone(value: str) -> str:
    raw = str(value or "").strip()
    if raw.lower().startswith("whatsapp:"):
        raw = raw.split(":", 1)[1]
    digits = re.sub(r"\D", "", raw)
    return f"+{digits}" if digits else ""


def email_recipients(value: str) -> list[str]:
    return [address.strip().lower() for _, address in getaddresses([value or ""]) if address.strip()]


def recipient_allowed(channel: str, recipient: str) -> bool:
    """Return whether a provider-bound send may proceed.

    With safety disabled this is intentionally a no-op. With it enabled,
    malformed recipients, empty allowlists, and any partial mismatch are
    denied. Email messages with several recipients require every address to be
    allowlisted.
    """
    if not settings.outbound_recipient_safety_enabled:
        return True
    if channel == "email":
        recipients = email_recipients(recipient)
        allowed = {item.lower() for item in _csv(settings.outbound_allowed_emails)}
        ok = bool(recipients) and all(item in allowed for item in recipients)
    else:
        recipients = [normalize_phone(recipient)]
        allowed = {normalize_phone(item) for item in _csv(settings.outbound_allowed_phones)}
        allowed.discard("")
        ok = bool(recipients[0]) and recipients[0] in allowed
    if not ok:
        logger.warning("Outbound %s blocked by staging recipient safety guard", channel)
    return ok
