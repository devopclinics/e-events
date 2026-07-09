"""Event Pass pricing — now DB-backed (superadmin-editable via the console).

Prices/limits live in the `pricing_plans` table (seeded by db_migrate). Amounts
are smallest currency unit (USD cents, NGN kobo).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Event, PricingPlan
from .entitlements import feature_capabilities, grant_message_credits, plan_label

# Which currency each region pays in (and thus which provider is used).
REGION_CURRENCY = {"US": "USD", "NG": "NGN"}

PLAN_DESCRIPTIONS = {
    "tier50": "For intimate private events that need messaging, QR check-in, basic seating, menu, registry, logistics, and Design Studio publishing.",
    "tier150": "For full event operations with table groups, floor plans, access zones, source imports, registry pages, and vendor logistics.",
    "tier300": "For high-touch events that need Experience workflows, consent, scanner confirmations, section scanning, and richer messaging.",
    "scale": "For large events that need higher guest volume, larger batches, priority support, and advanced operations.",
    "unlimited": "For large events that need higher guest volume, larger batches, priority support, and advanced operations.",
}

ADD_ON_CATALOG = {
    "message_credits": [
        {"label": "100 credits", "usd": 600, "ngn": 500000},
        {"label": "500 credits", "usd": 2500, "ngn": 2000000},
        {"label": "2,000 credits", "usd": 8000, "ngn": 7000000},
    ],
    "design_studio": [
        "Standard templates are included in paid plans.",
        "Premium template packs can be added later.",
        "Custom flyer/design service is Enterprise or manual quote.",
        "Free users can preview but cannot publish premium designs or remove Festio branding.",
    ],
    "experience": [
        "Consent forms, workflow builder, scanner confirmations, souvenir/handoff confirmation, and guest progress tracking start at Pro.",
        "Complex multi-step or multi-program workflows are Scale or Enterprise.",
    ],
    "messaging": [
        "MMS/rich media ticket cards",
        "WhatsApp marketing templates",
        "Custom sender ID",
        "Dedicated WhatsApp sender",
        "High-volume SMS routing",
        "Nigerian/local SMS provider routing",
    ],
    "operations": [
        "Manual check-in",
        "Self check-in",
        "Section-based scanning",
        "Advanced access zones/gates",
        "Floor plan designer and share links",
        "Vendor logistics and packing lists",
        "Registry public page and affiliate/store support",
        "Live spreadsheet/source sync",
    ],
    "enterprise": [
        "White-label branding",
        "Custom domain",
        "SLA",
        "Dedicated support",
        "API/webhook access",
        "Multi-day/multi-program event structure",
        "Custom provider/sender setup",
    ],
}


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
        "name": plan_label(plan.key) if plan.kind == "tier" else plan.label,
        "description": PLAN_DESCRIPTIONS.get(plan.key, ""),
        "guest_cap": plan.guest_cap, "credits": plan.credits,
        "currency": cur, "amount": plan.usd if cur == "USD" else plan.ngn,
        "capabilities": feature_capabilities(plan.key) if plan.kind == "tier" else [],
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
    grant_message_credits(event, plan.credits or 0, reason=f"purchase:{plan.key}")


def public_catalog(currency: str, tiers: list[dict], packs: list[dict]) -> dict:
    cur = currency.upper()
    return {
        "currency": cur,
        "tiers": tiers,
        "packs": packs,
        "free": {
            "key": "free",
            "name": "Free",
            "amount": 0,
            "currency": cur,
            "guest_cap": 25,
            "credits": 0,
            "capabilities": [
                "RSVP page",
                "Email invitations",
                "Basic guest list",
                "Basic RSVP questions",
                "Festio branding",
                "Draft event setup",
            ],
            "limitations": [
                "No SMS/WhatsApp/MMS sending",
                "No QR check-in activation",
                "No Design Studio access or publishing",
                "No paid module publishing",
                "No branding removal",
            ],
        },
        "enterprise": {
            "key": "enterprise",
            "name": "Enterprise",
            "amount": None,
            "currency": cur,
            "guest_cap": None,
            "credits": None,
            "capabilities": ADD_ON_CATALOG["enterprise"],
        },
        "addons": ADD_ON_CATALOG,
    }
