"""Event Pass pricing tiers and entitlement application (Phase 3).

Amounts are in the smallest currency unit (USD cents, NGN kobo). Tweak freely —
this is the single source of truth for what each pass costs and unlocks.
"""
from .models import Event

# tier_key -> definition. guest_cap=None means unlimited.
TIERS: dict[str, dict] = {
    "tier50":     {"label": "Up to 50 guests",     "guest_cap": 50,   "credits": 100,  "usd": 2900,  "ngn": 2500000},
    "tier150":    {"label": "Up to 150 guests",    "guest_cap": 150,  "credits": 300,  "usd": 5900,  "ngn": 5500000},
    "tier300":    {"label": "Up to 300 guests",    "guest_cap": 300,  "credits": 600,  "usd": 9900,  "ngn": 9500000},
    "unlimited":  {"label": "300+ (unlimited)",    "guest_cap": None, "credits": 1500, "usd": 14900, "ngn": 15000000},
}

# Which currency each region pays in (and thus which provider is used).
REGION_CURRENCY = {"US": "USD", "NG": "NGN"}


def amount_for(tier_key: str, currency: str) -> int:
    """Smallest-unit price for a tier in the given currency."""
    tier = TIERS[tier_key]
    return tier["usd"] if currency.upper() == "USD" else tier["ngn"]


def tiers_public(currency: str) -> list[dict]:
    """Tier catalogue for the pricing UI, priced in one currency."""
    cur = currency.upper()
    return [
        {
            "key": k,
            "label": t["label"],
            "guest_cap": t["guest_cap"],
            "credits": t["credits"],
            "currency": cur,
            "amount": t["usd"] if cur == "USD" else t["ngn"],
        }
        for k, t in TIERS.items()
    ]


def apply_pass(event: Event, tier_key: str) -> None:
    """Flip the event's entitlements for a purchased tier. Credits are added
    (top-ups accumulate). Caller commits. Idempotency is the caller's job
    (guard on the Payment reference)."""
    tier = TIERS[tier_key]
    event.plan_tier = tier_key
    event.is_paid = True
    event.paid_channels = True
    event.guest_cap = tier["guest_cap"]
    event.message_credits = (event.message_credits or 0) + tier["credits"]
