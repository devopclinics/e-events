"""Opaque reply routing that cannot turn a self-reported From into identity.

The token authorizes only locating a lead for conservative reply suppression.
It is not a login/session token, and contains no email or other contact data.
"""
import base64
import hashlib
import hmac
import re
import uuid


def make_reply_token(lead_id: str, secret: str) -> str | None:
    if not secret or not secret.strip():
        return None
    try:
        key = uuid.UUID(lead_id).hex
    except (ValueError, TypeError, AttributeError):
        return None
    signature = hmac.new(secret.encode(), f"festio-marketing-reply:v1:{key}".encode(), hashlib.sha256).digest()[:16]
    tag = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"v1.{key}.{tag}"


def verify_reply_token(token: str | None, secret: str) -> str | None:
    if not isinstance(token, str) or not re.fullmatch(r"v1\.[0-9a-f]{32}\.[A-Za-z0-9_-]{22}", token):
        return None
    lead_id = str(uuid.UUID(hex=token.split(".")[1]))
    expected = make_reply_token(lead_id, secret)
    return lead_id if expected and hmac.compare_digest(token, expected) else None


def reply_address(lead_id: str, secret: str, domain: str) -> str | None:
    token = make_reply_token(lead_id, secret)
    domain = str(domain or "").strip().lower()
    if not token or len(domain) > 253 or "." not in domain:
        return None
    labels = domain.split(".")
    if any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels):
        return None
    # reply+ plus the versioned token is exactly 64 characters, the SMTP
    # local-part limit. The suffix uses a 128-bit, domain-separated HMAC.
    return f"reply+{token}@{domain}"
