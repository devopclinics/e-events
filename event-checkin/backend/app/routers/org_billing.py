"""Org-level recurring subscription — checkout + entitlement activation for
the new org-wide paid-feature axis (currently: read-write Public API access).

Separate from billing.py, which handles the per-event, one-time Event Pass
purchase. Mirrors its conventions exactly: no SDKs, raw httpx via
services/payments.py, provider chosen by org.currency, Payment-row
idempotency. The checkout/cancel/get-status endpoints below are mounted at
/api/organizations/me (same as api_keys.py/webhooks.py); the webhook *event
handling* itself is exposed as plain functions that billing.py's existing
/webhook/stripe and /webhook/paystack routes call for subscription-shaped
events — deliberately not a second webhook URL per provider.
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Membership, OrgPlan, Organization, Payment, User
from ..schemas import OrgSubscriptionCheckoutRequest, OrgSubscriptionOut
from ..auth import get_current_user
from ..config import settings
from .admin import DEFAULT_ORG_ID
from services import payments

logger = logging.getLogger(__name__)
router = APIRouter()


async def _owned_org(user: User, db: AsyncSession) -> Organization:
    """The org this user owns. Mirrors api_keys.py/webhooks.py's helper —
    subscriptions are org-wide billing, so only an owner can manage one.
    See api_keys.py's _owned_org for why DEFAULT_ORG_ID is deprioritized."""
    org_id = await db.scalar(
        select(Membership.org_id)
        .join(Organization, Organization.id == Membership.org_id)
        .where(Membership.user_id == user.id, Membership.role == "owner")
        .order_by(case((Organization.id == DEFAULT_ORG_ID, 1), else_=0), Organization.created_at.asc())
        .limit(1)
    )
    org = await db.get(Organization, org_id) if org_id else None
    if not org:
        raise HTTPException(403, "You must own an organization to manage its subscription")
    return org


def _provider_for(currency: str) -> str:
    return "paystack" if currency.upper() == "NGN" else "stripe"


def _provider_enabled(provider: str) -> bool:
    return payments.paystack_enabled() if provider == "paystack" else payments.stripe_enabled()


def _plan_amount(plan: OrgPlan, currency: str) -> int:
    return plan.usd_monthly if currency.upper() == "USD" else plan.ngn_monthly


@router.get("/subscription", response_model=OrgSubscriptionOut)
async def get_subscription(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _owned_org(user, db)
    return OrgSubscriptionOut(
        plan=org.plan, status=org.subscription_status,
        provider=org.subscription_provider, current_period_end=org.current_period_end,
    )


@router.get("/subscription/plans")
async def list_subscription_plans(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Active plan catalog for the subscribe UI (any authenticated user — this
    is a price list, not sensitive data; superadmin-only editing is the
    separate /api/admin/org-plans CRUD)."""
    org = await _owned_org(user, db)
    currency = (org.currency or "USD").upper()
    rows = (await db.execute(
        select(OrgPlan).where(OrgPlan.active.is_(True)).order_by(OrgPlan.sort_order)
    )).scalars().all()
    return [
        {"key": p.key, "label": p.label, "features": p.features,
         "currency": currency, "amount": p.usd_monthly if currency == "USD" else p.ngn_monthly}
        for p in rows
    ]


@router.post("/subscription/checkout")
async def checkout(
    body: OrgSubscriptionCheckoutRequest,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    org = await _owned_org(user, db)
    plan = await db.get(OrgPlan, body.plan_key)
    if not plan or not plan.active:
        raise HTTPException(400, "Unknown or inactive plan")

    currency = (org.currency or "USD").upper()
    provider = _provider_for(currency)
    if not _provider_enabled(provider):
        raise HTTPException(503, f"{provider.title()} billing is not configured yet.")

    amount = _plan_amount(plan, currency)
    base = (settings.public_base_url or settings.frontend_url).rstrip("/")
    success_url = f"{base}/org-settings?subscribed=1"
    cancel_url = f"{base}/org-settings"

    if provider == "stripe":
        url, reference = await payments.stripe_create_subscription_checkout(
            amount=amount, currency=currency, org_id=org.id, plan_key=plan.key,
            email=user.email, success_url=success_url, cancel_url=cancel_url,
        )
    else:
        if not plan.paystack_plan_code:
            plan.paystack_plan_code = await payments.paystack_ensure_plan(
                plan_key=plan.key, label=plan.label, amount=amount, currency=currency,
            )
            await db.commit()
        url, reference = await payments.paystack_create_subscription_checkout(
            amount=amount, currency=currency, org_id=org.id, plan_key=plan.key,
            plan_code=plan.paystack_plan_code, email=user.email, callback_url=success_url,
        )

    db.add(Payment(
        org_id=org.id, event_id=None, provider=provider, reference=reference,
        tier_key=plan.key, amount=amount, currency=currency, status="pending",
    ))
    await db.commit()
    return {"url": url, "provider": provider}


@router.post("/subscription/cancel")
async def cancel_subscription(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _owned_org(user, db)
    if org.subscription_status != "active":
        raise HTTPException(400, "No active subscription to cancel")
    if org.subscription_provider == "stripe" and org.stripe_subscription_id:
        await payments.stripe_cancel_subscription_at_period_end(org.stripe_subscription_id)
    elif org.subscription_provider == "paystack" and org.paystack_subscription_code and org.paystack_email_token:
        await payments.paystack_disable_subscription(org.paystack_subscription_code, org.paystack_email_token)
    else:
        raise HTTPException(400, "Subscription provider details missing; contact support")
    # Providers also fire subscription.deleted/subscription.disable webhooks
    # that flip status to "canceled" once processed; set it here too so the
    # UI reflects the cancellation immediately without waiting on the webhook.
    org.subscription_status = "canceled"
    await db.commit()
    return {"status": org.subscription_status}


# ── Webhook event handlers ───────────────────────────────────────────────────
# Called from billing.py's existing /webhook/stripe and /webhook/paystack
# routes for subscription-shaped events, so there is exactly one webhook URL
# per provider regardless of which entitlement axis fired it.

async def _activate(
    db: AsyncSession, *, org_id: str, plan_key: str, provider: str,
    stripe_customer_id: str | None = None, stripe_subscription_id: str | None = None,
    paystack_subscription_code: str | None = None, paystack_email_token: str | None = None,
    current_period_end: datetime | None = None,
) -> None:
    org = await db.get(Organization, org_id)
    if not org:
        logger.warning("org_billing: activate for unknown org %s", org_id)
        return
    org.plan = plan_key
    org.subscription_status = "active"
    org.subscription_provider = provider
    if stripe_customer_id:
        org.stripe_customer_id = stripe_customer_id
    if stripe_subscription_id:
        org.stripe_subscription_id = stripe_subscription_id
    if paystack_subscription_code:
        org.paystack_subscription_code = paystack_subscription_code
    if paystack_email_token:
        org.paystack_email_token = paystack_email_token
    if current_period_end:
        org.current_period_end = current_period_end
    await db.commit()
    logger.info("org_billing: activated %s for org %s via %s", plan_key, org_id, provider)


async def _fulfill_checkout(db: AsyncSession, provider: str, reference: str | None, org_id: str | None, plan_key: str | None) -> None:
    """Idempotently mark the initiating Payment row paid — mirrors billing.py's
    _fulfill. Entitlement activation is handled separately by the callers
    below, since Stripe/Paystack fire the checkout-completion event and the
    subscription-lifecycle event independently."""
    if not reference:
        return
    payment = (await db.execute(select(Payment).where(Payment.reference == reference))).scalar_one_or_none()
    if payment and payment.status == "paid":
        return
    if payment:
        payment.status = "paid"
    elif org_id and plan_key:
        db.add(Payment(
            org_id=org_id, event_id=None, provider=provider, reference=reference,
            tier_key=plan_key, amount=0, currency="", status="paid",
        ))
    await db.commit()


async def handle_stripe_subscription_checkout(db: AsyncSession, session_obj: dict) -> None:
    """checkout.session.completed where mode == 'subscription'."""
    meta = session_obj.get("metadata") or {}
    org_id, plan_key = meta.get("org_id"), meta.get("plan_key")
    await _fulfill_checkout(db, "stripe", session_obj.get("id"), org_id, plan_key)
    if org_id and plan_key:
        await _activate(
            db, org_id=org_id, plan_key=plan_key, provider="stripe",
            stripe_customer_id=session_obj.get("customer"),
            stripe_subscription_id=session_obj.get("subscription"),
        )


async def handle_stripe_subscription_event(db: AsyncSession, event_type: str, obj: dict) -> None:
    """customer.subscription.updated / .deleted / invoice.payment_failed."""
    if event_type == "invoice.payment_failed":
        sub_id = obj.get("subscription")
        if not sub_id:
            return
        org = await db.scalar(select(Organization).where(Organization.stripe_subscription_id == sub_id))
        if org:
            org.subscription_status = "past_due"
            await db.commit()
        return

    meta = obj.get("metadata") or {}
    org_id = meta.get("org_id")
    if not org_id:
        # Subscription-update events on an already-linked org may not carry
        # metadata (Stripe doesn't always echo it back) — fall back to the id.
        org = await db.scalar(select(Organization).where(Organization.stripe_subscription_id == obj.get("id")))
    else:
        org = await db.get(Organization, org_id)
    if not org:
        return

    if event_type == "customer.subscription.deleted":
        org.subscription_status = "canceled"
    elif event_type == "customer.subscription.updated":
        status = obj.get("status")
        org.subscription_status = "active" if status == "active" else (
            "past_due" if status == "past_due" else "canceled"
        )
        period_end = obj.get("current_period_end")
        if period_end:
            org.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc).replace(tzinfo=None)
    await db.commit()


async def handle_paystack_subscription_event(db: AsyncSession, event_type: str, data: dict) -> None:
    """subscription.create / subscription.disable."""
    if event_type == "subscription.create":
        meta = (data.get("customer") or {}).get("metadata") or data.get("metadata") or {}
        plan_key = (data.get("plan") or {}).get("plan_code") or meta.get("plan_key")
        org_id = meta.get("org_id")
        if not (org_id and plan_key):
            return
        next_payment = data.get("next_payment_date")
        period_end = None
        if next_payment:
            period_end = datetime.fromisoformat(next_payment.replace("Z", "+00:00")).replace(tzinfo=None)
        await _activate(
            db, org_id=org_id, plan_key=plan_key, provider="paystack",
            paystack_subscription_code=data.get("subscription_code"),
            paystack_email_token=data.get("email_token"),
            current_period_end=period_end,
        )
    elif event_type == "subscription.disable":
        sub_code = data.get("subscription_code")
        if not sub_code:
            return
        org = await db.scalar(select(Organization).where(Organization.paystack_subscription_code == sub_code))
        if org:
            org.subscription_status = "canceled"
            await db.commit()


async def handle_paystack_subscription_renewal(db: AsyncSession, data: dict) -> None:
    """charge.success carrying a `plan` — a subscription renewal charge."""
    meta = data.get("metadata") or {}
    org_id, plan_key = meta.get("org_id"), meta.get("plan_key")
    await _fulfill_checkout(db, "paystack", data.get("reference"), org_id, plan_key)
    if not org_id:
        return
    org = await db.get(Organization, org_id)
    if org and org.subscription_status == "active":
        org.current_period_end = datetime.utcnow() + timedelta(days=30)
        await db.commit()
