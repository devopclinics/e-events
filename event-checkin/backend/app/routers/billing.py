"""Event Pass billing — checkout + provider webhooks (Phase 3).

Provider is chosen by the org's currency: NGN → Paystack, else Stripe. All
endpoints degrade gracefully when keys aren't configured (checkout → 503).
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, Organization, Payment, User
from ..schemas import CheckoutRequest, CheckoutOut
from ..auth import get_current_user, _org_role
from ..billing import (
    get_plan, plan_amount, apply_purchase, tiers_public, packs_public,
)
from ..config import settings
from services import payments

logger = logging.getLogger(__name__)
router = APIRouter()


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
    return {
        "currency": currency,
        "provider": provider,
        "configured": _provider_enabled(provider),
        "is_paid": event.is_paid,
        "plan_tier": event.plan_tier,
        "message_credits": event.message_credits,
        "tiers": await tiers_public(db, currency),
        "packs": await packs_public(db, currency),
    }


@router.get("/pricing")
async def public_pricing(currency: str = "USD", db: AsyncSession = Depends(get_db)):
    """Public pricing catalogue for the marketing page (no auth)."""
    cur = currency.upper()
    if cur not in ("USD", "NGN"):
        cur = "USD"
    return {"currency": cur, "tiers": await tiers_public(db, cur), "packs": await packs_public(db, cur)}


@router.post("/checkout", response_model=CheckoutOut)
async def checkout(body: CheckoutRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    event = await _require_event_admin(body.event_id, user, db)
    plan = await get_plan(db, body.tier)
    if not plan or not plan.active:
        raise HTTPException(400, "Unknown or inactive item")
    if plan.kind == "pack" and not event.is_paid:
        raise HTTPException(400, "Buy an Event Pass before topping up message credits.")
    org = await db.get(Organization, event.org_id)
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
    logger.info("billing: applied %s to event %s via %s", tier_key, event.id, provider)


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    if not payments.stripe_verify(payload, request.headers.get("stripe-signature")):
        raise HTTPException(400, "Invalid signature")
    evt = json.loads(payload)
    if evt.get("type") == "checkout.session.completed":
        obj = evt["data"]["object"]
        meta = obj.get("metadata") or {}
        await _fulfill(db, "stripe", obj.get("id"), meta.get("event_id"), meta.get("tier_key"))
    return {"received": True}


@router.post("/webhook/paystack")
async def paystack_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    if not payments.paystack_verify(payload, request.headers.get("x-paystack-signature")):
        raise HTTPException(400, "Invalid signature")
    evt = json.loads(payload)
    if evt.get("event") == "charge.success":
        data = evt.get("data") or {}
        meta = data.get("metadata") or {}
        await _fulfill(db, "paystack", data.get("reference"), meta.get("event_id"), meta.get("tier_key"))
    return {"received": True}
