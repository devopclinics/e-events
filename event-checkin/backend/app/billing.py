"""Event Pass pricing — now DB-backed (superadmin-editable via the console).

Prices/limits live in the `pricing_plans` table (seeded by db_migrate). Amounts
are smallest currency unit (USD cents, NGN kobo).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Event, Organization, PricingPlan
from .entitlements import grant_message_credits, plan_label

# Which currency each region pays in (and thus which provider is used).
REGION_CURRENCY = {"US": "USD", "NG": "NGN"}


def org_has_active_subscription(org: Organization) -> bool:
    """Org-level recurring subscription gate (separate from per-event
    is_paid). Used to gate org-wide paid features like read-write API keys."""
    return org.subscription_status == "active"

PLAN_DESCRIPTIONS = {
    # Every paid tier ships the same base package now, so these describe size,
    # not features -- see BASELINE_PAID_FEATURES/FEATURE_ADDON in entitlements.py.
    "tier50": "For intimate events, up to 50 guests.",
    "tier150": "For full-scale events, up to 150 guests.",
    "tier300": "For high-touch events, up to 300 guests.",
    "scale": "For large events, up to 500 guests.",
    "unlimited": "For large events, up to 500 guests.",
    "addon_registry": "A mark-only gift and cash registry guests can browse and claim from. No payments through the platform.",
    "addon_menu": "Track meal selections per guest and run live kitchen order fulfillment on the day of.",
    "addon_planner": "Budget tracking, vendor contracts, day-of timeline and runsheet, and document storage for planning the event itself.",
    "addon_logistics": "Ship gifts and merch to guests with a vendor packing list ready to hand off.",
    "addon_festiome": "Private groups, channels, and direct messages that keep guests connected before and after the event.",
    "addon_seating": "Assign tables, design your floor layout, and seat couples or plus-ones together automatically.",
    "addon_experience": "Multi-step guest journeys beyond check-in: consent forms, scanner confirmations, souvenir handoff, live program.",
    "addon_venue_access": "Multi-zone in/out scanning, live occupancy, and section-based routing for events with more than one entrance.",
}

ADDON_CAPABILITIES = {
    "addon_registry": ["Gift & cash fund items", "Public registry page"],
    "addon_menu": ["Guest meal selection", "Day-of kitchen order view"],
    "addon_planner": ["Budget & vendors", "Timeline & runsheet", "Documents"],
    "addon_logistics": ["Guest shipping addresses", "Vendor packing list export"],
    "addon_festiome": ["Groups & private channels", "Guest-to-guest DMs", "Staff broadcast into groups"],
    "addon_seating": ["Table & seat assignment", "Floor plan editor + sharing", "Partner/plus-one pairing"],
    "addon_experience": ["Workflow builder", "Consent forms & signatures", "Scanner & souvenir confirmation"],
    "addon_venue_access": ["Zones, tags & entry rules", "Occupancy / flow / peak analytics", "Section-based scanning"],
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
        # Tiers no longer carry a capabilities list -- every paid tier ships
        # the same base package now (see the "included in every plan" panel
        # on the pricing page), so a per-tier feature bullet list would be
        # actively misleading. Only add-ons have a real per-plan feature list.
        "capabilities": ADDON_CAPABILITIES.get(plan.key, []) if plan.kind == "addon" else [],
    }


async def tiers_public(db: AsyncSession, currency: str) -> list[dict]:
    return [plan_public(p, currency) for p in await list_plans(db, kind="tier")]


async def packs_public(db: AsyncSession, currency: str) -> list[dict]:
    return [plan_public(p, currency) for p in await list_plans(db, kind="pack")]


async def addons_public(db: AsyncSession, currency: str) -> list[dict]:
    return [plan_public(p, currency) for p in await list_plans(db, kind="addon")]


def apply_purchase(event: Event, plan: PricingPlan) -> None:
    """Apply a paid purchase to an event. A tier flips entitlements + adds its
    credits; a credit pack only adds credits; an add-on grants that one module,
    independent of tier. Caller commits; idempotency is the caller's
    responsibility (guard on Payment.reference)."""
    if plan.kind == "tier":
        event.plan_tier = plan.key
        event.is_paid = True
        event.paid_channels = True
        event.guest_cap = plan.guest_cap
    elif plan.kind == "addon":
        purchased = list(event.purchased_addons or [])
        if plan.key not in purchased:
            purchased.append(plan.key)
        event.purchased_addons = purchased
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
                "QR ticket generation and QR check-in",
                "Reports dashboard",
                "Festio branding",
                "Draft event setup",
            ],
            "limitations": [
                "Limited to 1 event",
                "No SMS/WhatsApp/MMS sending",
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
