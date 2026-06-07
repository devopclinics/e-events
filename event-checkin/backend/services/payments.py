"""Payment provider integration for Event Pass checkout — Stripe and Paystack.

Implemented over plain HTTP (httpx) + stdlib HMAC so there are no extra SDK
dependencies. Each provider exposes: create a one-time checkout, and verify an
inbound webhook signature.
"""
import hashlib
import hmac
import json

import httpx

from app.config import settings


def stripe_enabled() -> bool:
    return bool(settings.stripe_secret_key)


def paystack_enabled() -> bool:
    return bool(settings.paystack_secret_key)


# ── Stripe ───────────────────────────────────────────────────────────────────

async def stripe_create_checkout(
    *, amount: int, currency: str, event_id: str, tier_key: str,
    email: str | None, success_url: str, cancel_url: str,
) -> tuple[str, str]:
    """Create a Checkout Session. Returns (checkout_url, reference=session_id)."""
    data = {
        "mode": "payment",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": currency.lower(),
        "line_items[0][price_data][unit_amount]": str(amount),
        "line_items[0][price_data][product_data][name]": f"EventQR Event Pass — {tier_key}",
        "metadata[event_id]": event_id,
        "metadata[tier_key]": tier_key,
    }
    if email:
        data["customer_email"] = email
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(
            "https://api.stripe.com/v1/checkout/sessions",
            data=data, auth=(settings.stripe_secret_key, ""),
        )
    r.raise_for_status()
    body = r.json()
    return body["url"], body["id"]


def stripe_verify(payload: bytes, sig_header: str | None) -> bool:
    secret = settings.stripe_webhook_secret
    if not secret or not sig_header:
        return False
    parts = dict(p.split("=", 1) for p in sig_header.split(",") if "=" in p)
    t, v1 = parts.get("t"), parts.get("v1")
    if not t or not v1:
        return False
    signed = f"{t}.{payload.decode()}".encode()
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


# ── Paystack ─────────────────────────────────────────────────────────────────

async def paystack_create_checkout(
    *, amount: int, currency: str, event_id: str, tier_key: str,
    email: str | None, callback_url: str,
) -> tuple[str, str]:
    """Initialize a transaction. Returns (authorization_url, reference)."""
    payload = {
        "email": email or "guest@eventqr.app",
        "amount": amount,
        "currency": currency.upper(),
        "callback_url": callback_url,
        "metadata": {"event_id": event_id, "tier_key": tier_key},
    }
    headers = {"Authorization": f"Bearer {settings.paystack_secret_key}"}
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(
            "https://api.paystack.co/transaction/initialize",
            json=payload, headers=headers,
        )
    r.raise_for_status()
    data = r.json()["data"]
    return data["authorization_url"], data["reference"]


def paystack_verify(payload: bytes, sig_header: str | None) -> bool:
    secret = settings.paystack_secret_key
    if not secret or not sig_header:
        return False
    digest = hmac.new(secret.encode(), payload, hashlib.sha512).hexdigest()
    return hmac.compare_digest(digest, sig_header)
