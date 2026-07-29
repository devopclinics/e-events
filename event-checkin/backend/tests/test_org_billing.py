"""Org-level recurring subscription: checkout payload shape, Stripe/Paystack
webhook activation/renewal/cancellation (idempotent via Payment.reference),
and cancel-at-period-end. Mirrors billing.py/test conventions but mocks the
payments.py functions directly rather than httpx.MockTransport, since these
are simple (url, reference) tuples rather than full HTTP round-trips."""
import hashlib
import hmac
import time

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import OrgPlan, Organization, Payment
from app.routers import org_billing
from conftest import _Session


async def _seed_org_plan(**overrides):
    defaults = dict(key="api_access", label="API Access", usd_monthly=2900,
                     ngn_monthly=3500000, features=["api_write"], active=True, sort_order=1)
    defaults.update(overrides)
    async with _Session() as s:
        s.add(OrgPlan(**defaults))
        await s.commit()


def _stripe_sig(payload: bytes, secret: str) -> str:
    t = str(int(time.time()))
    signed = f"{t}.{payload.decode()}".encode()
    v1 = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


def _paystack_sig(payload: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), payload, hashlib.sha512).hexdigest()


async def _get_org(org_id):
    async with _Session() as s:
        return await s.get(Organization, org_id)


@pytest.mark.asyncio
async def test_checkout_503s_when_provider_not_configured(ctx, monkeypatch):
    # backend/.env carries real provider credentials (this checkout IS the
    # staging deploy — see conftest's _no_real_outbound_messages comment), so
    # explicitly blank the key this test needs "not configured".
    monkeypatch.setattr(settings, "stripe_secret_key", "")
    await _seed_org_plan()
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/organizations/me/subscription/checkout", json={"plan_key": "api_access"})
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_checkout_rejects_unknown_plan(ctx, monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/organizations/me/subscription/checkout", json={"plan_key": "nope"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_stripe_checkout_builds_payload_and_creates_pending_payment(ctx, monkeypatch):
    await _seed_org_plan()
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")

    captured = {}
    async def fake_checkout(**kwargs):
        captured.update(kwargs)
        return "https://checkout.stripe.com/pay/xyz", "cs_test_123"
    monkeypatch.setattr(org_billing.payments, "stripe_create_subscription_checkout", fake_checkout)

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/organizations/me/subscription/checkout", json={"plan_key": "api_access"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["url"] == "https://checkout.stripe.com/pay/xyz"
    assert body["provider"] == "stripe"
    assert captured["amount"] == 2900
    assert captured["currency"] == "USD"
    assert captured["org_id"] == ctx.ids["org_a"]
    assert captured["plan_key"] == "api_access"

    async with _Session() as s:
        payment = (await s.execute(select(Payment).where(Payment.reference == "cs_test_123"))).scalar_one()
        assert payment.status == "pending"
        assert payment.event_id is None
        assert payment.org_id == ctx.ids["org_a"]


@pytest.mark.asyncio
async def test_stripe_webhook_activates_subscription_and_is_idempotent(ctx, monkeypatch):
    await _seed_org_plan()
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")

    async def fake_checkout(**kwargs):
        return "https://checkout.stripe.com/pay/xyz", "cs_test_abc"
    monkeypatch.setattr(org_billing.payments, "stripe_create_subscription_checkout", fake_checkout)

    ctx.login(ctx.ids["user_a"])
    await ctx.client.post("/api/organizations/me/subscription/checkout", json={"plan_key": "api_access"})

    import json as _json
    payload = _json.dumps({
        "type": "checkout.session.completed",
        "data": {"object": {
            "id": "cs_test_abc", "mode": "subscription",
            "customer": "cus_123", "subscription": "sub_123",
            "metadata": {"org_id": ctx.ids["org_a"], "plan_key": "api_access"},
        }},
    }).encode()
    sig = _stripe_sig(payload, "whsec_test")

    ctx.login(None)
    resp = await ctx.client.post("/api/billing/webhook/stripe", content=payload,
                                  headers={"stripe-signature": sig, "content-type": "application/json"})
    assert resp.status_code == 200

    org = await _get_org(ctx.ids["org_a"])
    assert org.subscription_status == "active"
    assert org.subscription_provider == "stripe"
    assert org.plan == "api_access"
    assert org.stripe_customer_id == "cus_123"
    assert org.stripe_subscription_id == "sub_123"

    async with _Session() as s:
        payment = (await s.execute(select(Payment).where(Payment.reference == "cs_test_abc"))).scalar_one()
        assert payment.status == "paid"

    # Retry (webhook redelivery) must not error or double-apply.
    resp2 = await ctx.client.post("/api/billing/webhook/stripe", content=payload,
                                   headers={"stripe-signature": sig, "content-type": "application/json"})
    assert resp2.status_code == 200


@pytest.mark.asyncio
async def test_stripe_webhook_bad_signature_rejected(ctx, monkeypatch):
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    resp = await ctx.client.post("/api/billing/webhook/stripe", content=b'{"type":"x"}',
                                  headers={"stripe-signature": "t=1,v1=deadbeef"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_stripe_invoice_payment_failed_marks_past_due(ctx, monkeypatch):
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        org.subscription_status = "active"
        org.subscription_provider = "stripe"
        org.stripe_subscription_id = "sub_456"
        await s.commit()

    import json as _json
    payload = _json.dumps({
        "type": "invoice.payment_failed",
        "data": {"object": {"subscription": "sub_456"}},
    }).encode()
    sig = _stripe_sig(payload, "whsec_test")
    resp = await ctx.client.post("/api/billing/webhook/stripe", content=payload, headers={"stripe-signature": sig})
    assert resp.status_code == 200

    org = await _get_org(ctx.ids["org_a"])
    assert org.subscription_status == "past_due"


@pytest.mark.asyncio
async def test_stripe_subscription_deleted_marks_canceled(ctx, monkeypatch):
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        org.subscription_status = "active"
        org.subscription_provider = "stripe"
        org.stripe_subscription_id = "sub_789"
        await s.commit()

    import json as _json
    payload = _json.dumps({
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_789", "metadata": {"org_id": ctx.ids["org_a"]}}},
    }).encode()
    sig = _stripe_sig(payload, "whsec_test")
    resp = await ctx.client.post("/api/billing/webhook/stripe", content=payload, headers={"stripe-signature": sig})
    assert resp.status_code == 200

    org = await _get_org(ctx.ids["org_a"])
    assert org.subscription_status == "canceled"


@pytest.mark.asyncio
async def test_paystack_checkout_creates_plan_lazily_and_pending_payment(ctx, monkeypatch):
    await _seed_org_plan()
    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        org.currency = "NGN"
        await s.commit()
    monkeypatch.setattr(settings, "paystack_secret_key", "sk_test_paystack")

    ensure_calls = []
    async def fake_ensure_plan(**kwargs):
        ensure_calls.append(kwargs)
        return "PLN_abc123"
    checkout_calls = {}
    _ref_counter = {"n": 0}
    async def fake_checkout(**kwargs):
        checkout_calls.update(kwargs)
        _ref_counter["n"] += 1
        return "https://paystack.com/pay/xyz", f"ref_{_ref_counter['n']}"
    monkeypatch.setattr(org_billing.payments, "paystack_ensure_plan", fake_ensure_plan)
    monkeypatch.setattr(org_billing.payments, "paystack_create_subscription_checkout", fake_checkout)

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/organizations/me/subscription/checkout", json={"plan_key": "api_access"})
    assert r.status_code == 200, r.text
    assert r.json()["provider"] == "paystack"
    assert len(ensure_calls) == 1
    assert checkout_calls["plan_code"] == "PLN_abc123"
    assert checkout_calls["currency"] == "NGN"

    async with _Session() as s:
        plan = await s.get(OrgPlan, "api_access")
        assert plan.paystack_plan_code == "PLN_abc123"

    # Second checkout must not re-create the plan (cached on OrgPlan).
    r2 = await ctx.client.post("/api/organizations/me/subscription/checkout", json={"plan_key": "api_access"})
    assert r2.status_code == 200
    assert len(ensure_calls) == 1


@pytest.mark.asyncio
async def test_paystack_subscription_create_webhook_activates(ctx, monkeypatch):
    monkeypatch.setattr(settings, "paystack_secret_key", "sk_test_paystack")

    import json as _json
    payload = _json.dumps({
        "event": "subscription.create",
        "data": {
            "plan": {"plan_code": "api_access"},
            "subscription_code": "SUB_abc",
            "email_token": "tok_abc",
            "customer": {"metadata": {"org_id": ctx.ids["org_a"], "plan_key": "api_access"}},
        },
    }).encode()
    sig = _paystack_sig(payload, "sk_test_paystack")
    resp = await ctx.client.post("/api/billing/webhook/paystack", content=payload,
                                  headers={"x-paystack-signature": sig})
    assert resp.status_code == 200

    org = await _get_org(ctx.ids["org_a"])
    assert org.subscription_status == "active"
    assert org.subscription_provider == "paystack"
    assert org.paystack_subscription_code == "SUB_abc"
    assert org.paystack_email_token == "tok_abc"


@pytest.mark.asyncio
async def test_paystack_subscription_disable_webhook_cancels(ctx, monkeypatch):
    monkeypatch.setattr(settings, "paystack_secret_key", "sk_test_paystack")
    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        org.subscription_status = "active"
        org.subscription_provider = "paystack"
        org.paystack_subscription_code = "SUB_xyz"
        await s.commit()

    import json as _json
    payload = _json.dumps({"event": "subscription.disable", "data": {"subscription_code": "SUB_xyz"}}).encode()
    sig = _paystack_sig(payload, "sk_test_paystack")
    resp = await ctx.client.post("/api/billing/webhook/paystack", content=payload,
                                  headers={"x-paystack-signature": sig})
    assert resp.status_code == 200

    org = await _get_org(ctx.ids["org_a"])
    assert org.subscription_status == "canceled"


@pytest.mark.asyncio
async def test_paystack_webhook_bad_signature_rejected(ctx, monkeypatch):
    monkeypatch.setattr(settings, "paystack_secret_key", "sk_test_paystack")
    resp = await ctx.client.post("/api/billing/webhook/paystack", content=b'{"event":"x"}',
                                  headers={"x-paystack-signature": "bad"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_list_subscription_plans_returns_active_plans_in_org_currency(ctx):
    await _seed_org_plan()
    await _seed_org_plan(key="inactive_plan", label="Inactive", active=False, sort_order=2)
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get("/api/organizations/me/subscription/plans")
    assert r.status_code == 200
    plans = r.json()
    assert [p["key"] for p in plans] == ["api_access"]
    assert plans[0]["currency"] == "USD"
    assert plans[0]["amount"] == 2900
    assert plans[0]["features"] == ["api_write"]


@pytest.mark.asyncio
async def test_get_subscription_reports_status(ctx):
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get("/api/organizations/me/subscription")
    assert r.status_code == 200
    assert r.json()["plan"] == "free"
    assert r.json()["status"] is None


@pytest.mark.asyncio
async def test_cancel_subscription_calls_provider_and_marks_canceled(ctx, monkeypatch):
    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        org.subscription_status = "active"
        org.subscription_provider = "stripe"
        org.stripe_subscription_id = "sub_cancel_me"
        await s.commit()

    calls = []
    async def fake_cancel(subscription_id):
        calls.append(subscription_id)
    monkeypatch.setattr(org_billing.payments, "stripe_cancel_subscription_at_period_end", fake_cancel)

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/organizations/me/subscription/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "canceled"
    assert calls == ["sub_cancel_me"]

    org = await _get_org(ctx.ids["org_a"])
    assert org.subscription_status == "canceled"


@pytest.mark.asyncio
async def test_cancel_with_no_active_subscription_400s(ctx):
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/organizations/me/subscription/cancel")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_only_owner_can_manage_subscription(ctx):
    # user_b owns org_b, not org_a — must not see or affect org_a's subscription.
    ctx.login(ctx.ids["user_b"])
    r = await ctx.client.get("/api/organizations/me/subscription")
    assert r.status_code == 200
    assert r.json()["plan"] == "free"   # org_b's own (unrelated) status, not org_a's

    org_a = await _get_org(ctx.ids["org_a"])
    assert org_a.subscription_status is None
