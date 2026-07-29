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
    tax_enabled: bool = False,
) -> tuple[str, str]:
    """Create a Checkout Session. Returns (checkout_url, reference=session_id)."""
    data = {
        "mode": "payment",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": currency.lower(),
        "line_items[0][price_data][unit_amount]": str(amount),
        "line_items[0][price_data][product_data][name]": f"Festio — {tier_key}",
        "metadata[event_id]": event_id,
        "metadata[tier_key]": tier_key,
        # A receipt/invoice the customer can download (also satisfies records).
        "invoice_creation[enabled]": "true",
    }
    if email:
        data["customer_email"] = email
    if tax_enabled:
        # Requires Stripe Tax activated in the dashboard.
        data["automatic_tax[enabled]"] = "true"
        data["billing_address_collection"] = "required"
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


# ── Org-level recurring subscriptions ────────────────────────────────────────
# Separate entitlement axis from the one-time Event Pass purchases above —
# same no-SDK, raw-httpx style, just `mode="subscription"` / a Paystack Plan.

async def stripe_create_subscription_checkout(
    *, amount: int, currency: str, org_id: str, plan_key: str,
    email: str | None, success_url: str, cancel_url: str,
) -> tuple[str, str]:
    """Create a recurring Checkout Session. Returns (checkout_url, session_id)."""
    data = {
        "mode": "subscription",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": currency.lower(),
        "line_items[0][price_data][unit_amount]": str(amount),
        "line_items[0][price_data][recurring][interval]": "month",
        "line_items[0][price_data][product_data][name]": f"Festio — {plan_key}",
        "metadata[org_id]": org_id,
        "metadata[plan_key]": plan_key,
        "subscription_data[metadata][org_id]": org_id,
        "subscription_data[metadata][plan_key]": plan_key,
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


async def stripe_cancel_subscription_at_period_end(subscription_id: str) -> None:
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(
            f"https://api.stripe.com/v1/subscriptions/{subscription_id}",
            data={"cancel_at_period_end": "true"}, auth=(settings.stripe_secret_key, ""),
        )
    r.raise_for_status()


async def paystack_ensure_plan(*, plan_key: str, label: str, amount: int, currency: str) -> str:
    """Create a Paystack Plan for this OrgPlan if one doesn't exist yet.
    Returns the plan_code. Caller caches it on OrgPlan.paystack_plan_code so
    this only runs once per plan, not once per checkout."""
    payload = {
        "name": f"Festio — {label}",
        "amount": amount,
        "currency": currency.upper(),
        "interval": "monthly",
        "plan_code": plan_key,
    }
    headers = {"Authorization": f"Bearer {settings.paystack_secret_key}"}
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post("https://api.paystack.co/plan", json=payload, headers=headers)
    r.raise_for_status()
    return r.json()["data"]["plan_code"]


async def paystack_create_subscription_checkout(
    *, amount: int, currency: str, org_id: str, plan_key: str, plan_code: str,
    email: str | None, callback_url: str,
) -> tuple[str, str]:
    """Initialize a transaction against a Plan — Paystack auto-creates the
    subscription on first successful charge. Returns (authorization_url, reference)."""
    payload = {
        "email": email or "billing@festio.app",
        "amount": amount,
        "currency": currency.upper(),
        "plan": plan_code,
        "callback_url": callback_url,
        "metadata": {"org_id": org_id, "plan_key": plan_key},
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


async def paystack_disable_subscription(subscription_code: str, email_token: str) -> None:
    payload = {"code": subscription_code, "token": email_token}
    headers = {"Authorization": f"Bearer {settings.paystack_secret_key}"}
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post("https://api.paystack.co/subscription/disable", json=payload, headers=headers)
    r.raise_for_status()
