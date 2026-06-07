"""Event Pass pricing — now DB-backed (superadmin-editable via the console).

Prices/limits live in the `pricing_plans` table (seeded by db_migrate). Amounts
are smallest currency unit (USD cents, NGN kobo).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Event, PricingPlan

# Which currency each region pays in (and thus which provider is used).
REGION_CURRENCY = {"US": "USD", "NG": "NGN"}


async def get_plan(db: AsyncSession, key: str) -> PricingPlan | None:
    return await db.scalar(select(PricingPlan).where(PricingPlan.key == key))


async def list_plans(db: AsyncSession, kind: str | None = None, active_only: bool = True):
    q = select(PricingPlan)
    if kind:
        q = q.where(PricingPlan.kind == kind)
    if active_only:
        q = q.where(PricingPlan.active.is_(True))
    return (await db.execute(q.order_by(PricingPlan.kind, PricingPlan.sort_order))).scalars().all()


def plan_amount(plan: PricingPlan, currency: str) -> int:
    return plan.usd if currency.upper() == "USD" else plan.ngn


def plan_public(plan: PricingPlan, currency: str) -> dict:
    cur = currency.upper()
    return {
        "key": plan.key, "kind": plan.kind, "label": plan.label,
        "guest_cap": plan.guest_cap, "credits": plan.credits,
        "currency": cur, "amount": plan.usd if cur == "USD" else plan.ngn,
    }


async def tiers_public(db: AsyncSession, currency: str) -> list[dict]:
    return [plan_public(p, currency) for p in await list_plans(db, kind="tier")]


async def packs_public(db: AsyncSession, currency: str) -> list[dict]:
    return [plan_public(p, currency) for p in await list_plans(db, kind="pack")]


def apply_purchase(event: Event, plan: PricingPlan) -> None:
    """Apply a paid purchase to an event. A tier flips entitlements + adds its
    credits; a credit pack only adds credits. Caller commits; idempotency is the
    caller's responsibility (guard on Payment.reference)."""
    if plan.kind == "tier":
        event.plan_tier = plan.key
        event.is_paid = True
        event.paid_channels = True
        event.guest_cap = plan.guest_cap
    event.message_credits = (event.message_credits or 0) + (plan.credits or 0)
