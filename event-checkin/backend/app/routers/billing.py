"""Event Pass billing — checkout + provider webhooks (Phase 3).

Provider is chosen by the org's currency: NGN → Paystack, else Stripe. All
endpoints degrade gracefully when keys aren't configured (checkout → 503).
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, Membership, MessageCreditLedger, Organization, Payment, PlatformSettings, User
from ..schemas import CheckoutRequest, CheckoutOut, CurrencyRequest
from ..auth import get_current_user, get_current_user_optional, _org_role
from ..billing import (
    get_plan, plan_amount, apply_purchase, apply_organization_purchase, tiers_public, packs_public, addons_public, public_catalog,
)
from ..config import settings
from ..entitlements import event_allows_addon, FEATURE_ADDON
from ..organization_entitlements import entitlement_snapshot
from services import payments
from . import org_billing

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/event-pass/{event_id}")
async def event_pass_status(event_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    event = await _require_event_admin(event_id, user, db)
    org = await db.get(Organization, event.org_id)
    if not org:
        raise HTTPException(404, "Organization not found")
    snapshot = entitlement_snapshot(org)
    snapshot.update({
        "credit_balance": snapshot["message_credit_units"] / 10,
        "email_messages_remaining": snapshot["message_credit_units"],
        "purchased_addons": org.purchased_addons or [],
    })
    return snapshot


def _provider_for(currency: str) -> str:
    return "paystack" if currency.upper() == "NGN" else "stripe"


def _provider_enabled(provider: str) -> bool:
    return payments.paystack_enabled() if provider == "paystack" else payments.stripe_enabled()


async def _require_event_admin(event_id: str, user: User, db: AsyncSession) -> Event:
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin:
        return event
    if (await _org_role(user, event.org_id, db)) not in ("owner", "admin"):
        raise HTTPException(404, "Event not found")
    return event


@router.get("/tiers/{event_id}")
async def list_tiers(event_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    event = await _require_event_admin(event_id, user, db)
    org = await db.get(Organization, event.org_id)
    currency = (org.currency if org else "USD").upper()
    provider = _provider_for(currency)
    tiers = await tiers_public(db, currency)
    packs = await packs_public(db, currency)
    addons = await addons_public(db, currency)
    return {
        "currency": currency,
        "provider": provider,
        "configured": _provider_enabled(provider),
        "is_paid": event.is_paid,
        "plan_tier": event.plan_tier,
        "message_credits": (org.message_credit_units / 10) if settings.organization_entitlements_v2 and org else event.message_credits,
        "purchased_addons": event.purchased_addons or [],
        "available_addons": [key for key in sorted(set(FEATURE_ADDON.values())) if event_allows_addon(event, key)],
        "tiers": tiers,
        "packs": packs,
        "addon_plans": addons,
        "catalog": public_catalog(currency, tiers, packs),
    }


@router.get("/credits/{event_id}")
async def credit_ledger(event_id: str, limit: int = 50, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    event = await _require_event_admin(event_id, user, db)
    rows = (await db.execute(
        select(MessageCreditLedger)
        .where(MessageCreditLedger.event_id == event.id)
        .order_by(desc(MessageCreditLedger.created_at))
        .limit(min(max(limit, 1), 200))
    )).scalars().all()
    summary_rows = (await db.execute(
        select(
            MessageCreditLedger.channel,
            func.count(MessageCreditLedger.id),
            func.coalesce(func.sum(MessageCreditLedger.credits), 0),
        )
        .where(MessageCreditLedger.event_id == event.id, MessageCreditLedger.action == "spend")
        .group_by(MessageCreditLedger.channel)
    )).all()
    return {
        "balance": event.message_credits,
        "summary": [
            {"channel": channel, "sends": int(count or 0), "credits": int(credits or 0)}
            for channel, count, credits in summary_rows
        ],
        "rows": [
            {
                "id": r.id,
                "action": r.action,
                "status": r.status,
                "channel": r.channel,
                "reason": r.reason,
                "provider": r.provider,
                "credits": r.credits,
                "delta": r.delta,
                "balance_after": r.balance_after,
                "provider_cost_cents": r.provider_cost_cents,
                "provider_currency": r.provider_currency,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


async def _viewer_has_paid_event(user: User | None, db: AsyncSession) -> bool:
    """Add-on prices are hidden on the public pricing page until the viewer
    has at least one paid event -- prices are for customers, not a public
    rate card. Anonymous visitors and Free-only accounts don't qualify."""
    if not user:
        return False
    if user.is_platform_superadmin:
        return True
    row = (await db.execute(
        select(Event.id)
        .join(Membership, Membership.org_id == Event.org_id)
        .where(Membership.user_id == user.id, Event.is_paid.is_(True))
        .limit(1)
    )).first()
    return row is not None


@router.get("/pricing")
async def public_pricing(
    currency: str = "USD",
    user: User | None = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Public pricing catalogue for the marketing page. Auth is optional --
    base tier/pack pricing is always public; add-on prices only reveal once
    the viewer has a paid event (see _viewer_has_paid_event). The real
    enforcement is in /checkout (kind="addon" requires event.is_paid), this
    is a display-only gate, not a security boundary."""
    cur = currency.upper()
    if cur not in ("USD", "NGN"):
        cur = "USD"
    tiers = await tiers_public(db, cur)
    packs = await packs_public(db, cur)
    addons = await addons_public(db, cur)
    unlocked = await _viewer_has_paid_event(user, db)
    if not unlocked:
        addons = [{**a, "amount": None, "locked": True} for a in addons]
    else:
        addons = [{**a, "locked": False} for a in addons]
    catalog = public_catalog(cur, tiers, packs)
    # NOTE: public_catalog() already sets catalog["addons"] to the legacy
    # descriptive category groups (AddOnCatalog in AdminPage.jsx reads that
    # shape) -- the new priced add-on catalog is a distinct key so it doesn't
    # collide with that existing consumer.
    catalog["addon_plans"] = addons
    catalog["addon_plans_unlocked"] = unlocked
    platform_policy = await db.get(PlatformSettings, "singleton")
    catalog["addon_promo_until"] = (
        platform_policy.addon_promo_until.isoformat()
        if platform_policy and platform_policy.addon_promo_until
        else None
    )
    return catalog


@router.post("/currency")
async def set_currency(body: CurrencyRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Set the billing currency for the event's organization (USD→Stripe, NGN→Paystack)."""
    event = await _require_event_admin(body.event_id, user, db)
    org = await db.get(Organization, event.org_id)
    if not org:
        raise HTTPException(404, "Organization not found")
    org.currency = body.currency
    org.region = "NG" if body.currency == "NGN" else "US"
    await db.commit()
    return {"currency": org.currency, "region": org.region}


@router.post("/checkout", response_model=CheckoutOut)
async def checkout(body: CheckoutRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    event = await _require_event_admin(body.event_id, user, db)
    plan = await get_plan(db, body.tier)
    if not plan or not plan.active:
        raise HTTPException(400, "Unknown or inactive item")
    org = await db.get(Organization, event.org_id)
    if settings.organization_entitlements_v2:
        from ..organization_entitlements import pass_is_active
        has_pass = bool(org and pass_is_active(org))
    else:
        has_pass = bool(event.is_paid)
    if plan.kind == "pack" and not has_pass:
        raise HTTPException(400, "Buy or renew an Event Pass before topping up message credits.")
    if plan.kind == "addon" and not has_pass:
        raise HTTPException(400, "Buy or renew an Event Pass before adding this add-on.")
    currency = (org.currency if org else "USD").upper()
    provider = _provider_for(currency)
    if not _provider_enabled(provider):
        raise HTTPException(503, f"{provider.title()} billing is not configured yet.")

    amount = plan_amount(plan, currency)
    base = (settings.public_base_url or settings.frontend_url).rstrip("/")
    success_url = f"{base}/admin?upgraded=1"
    cancel_url = f"{base}/admin"

    if provider == "stripe":
        url, reference = await payments.stripe_create_checkout(
            amount=amount, currency=currency, event_id=event.id, tier_key=body.tier,
            email=user.email, success_url=success_url, cancel_url=cancel_url,
            tax_enabled=settings.stripe_tax_enabled,
        )
    else:
        url, reference = await payments.paystack_create_checkout(
            amount=amount, currency=currency, event_id=event.id, tier_key=body.tier,
            email=user.email, callback_url=success_url,
        )

    db.add(Payment(
        org_id=event.org_id, event_id=event.id, provider=provider, reference=reference,
        tier_key=body.tier, amount=amount, currency=currency, status="pending",
    ))
    await db.commit()
    return CheckoutOut(url=url, provider=provider)


async def _fulfill(db: AsyncSession, provider: str, reference: str, event_id: str | None, tier_key: str | None) -> None:
    """Idempotently mark a payment paid and apply the entitlement to its event."""
    if not reference or not tier_key:
        return
    payment = (await db.execute(
        select(Payment).where(Payment.reference == reference)
    )).scalar_one_or_none()
    if payment and payment.status == "paid":
        return  # already processed (webhook retry)

    event = await db.get(Event, event_id or (payment.event_id if payment else None))
    if not event:
        logger.warning("billing: fulfill for unknown event ref=%s", reference)
        return

    plan = await get_plan(db, tier_key)
    if not plan:
        logger.warning("billing: fulfill for unknown plan key=%s ref=%s", tier_key, reference)
        return
    if settings.organization_entitlements_v2:
        org = await db.scalar(select(Organization).where(Organization.id == event.org_id).with_for_update())
        if not org:
            logger.warning("billing: fulfill for unknown org event=%s", event.id)
            return
        apply_organization_purchase(org, plan)
    else:
        apply_purchase(event, plan)
    if payment:
        payment.status = "paid"
    else:
        # Safety net: a paid webhook with no prior pending record (e.g. manual test).
        db.add(Payment(
            org_id=event.org_id, event_id=event.id, provider=provider, reference=reference,
            tier_key=tier_key, amount=0, currency="", status="paid",
        ))
    await db.commit()
    if settings.organization_entitlements_v2:
        from .. import entitlements
        await entitlements.reload_addon_policy_cache(db)
    from ..services.marketing_client import ingest_org_lifecycle
    await ingest_org_lifecycle(db, event.org_id, stage="paid", event_type=event.event_type)
    logger.info("billing: applied %s to event %s via %s", tier_key, event.id, provider)


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    if not payments.stripe_verify(payload, request.headers.get("stripe-signature")):
        raise HTTPException(400, "Invalid signature")
    evt = json.loads(payload)
    etype = evt.get("type")
    if etype == "checkout.session.completed":
        obj = evt["data"]["object"]
        if obj.get("mode") == "subscription":
            await org_billing.handle_stripe_subscription_checkout(db, obj)
        else:
            meta = obj.get("metadata") or {}
            await _fulfill(db, "stripe", obj.get("id"), meta.get("event_id"), meta.get("tier_key"))
    elif etype in ("customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed"):
        await org_billing.handle_stripe_subscription_event(db, etype, evt["data"]["object"])
    return {"received": True}


@router.post("/webhook/paystack")
async def paystack_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    if not payments.paystack_verify(payload, request.headers.get("x-paystack-signature")):
        raise HTTPException(400, "Invalid signature")
    evt = json.loads(payload)
    etype = evt.get("event")
    data = evt.get("data") or {}
    if etype == "charge.success":
        if data.get("plan"):
            await org_billing.handle_paystack_subscription_renewal(db, data)
        else:
            meta = data.get("metadata") or {}
            await _fulfill(db, "paystack", data.get("reference"), meta.get("event_id"), meta.get("tier_key"))
    elif etype in ("subscription.create", "subscription.disable"):
        await org_billing.handle_paystack_subscription_event(db, etype, data)
    return {"received": True}
