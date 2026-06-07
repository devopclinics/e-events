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

# Credit-only top-up packs (no tier/cap change) — for paid events that run low.
CREDIT_PACKS: dict[str, dict] = {
    "credits_100":  {"label": "100 message credits",   "credits": 100,  "usd": 500,  "ngn": 500000},
    "credits_500":  {"label": "500 message credits",   "credits": 500,  "usd": 2000, "ngn": 2000000},
    "credits_2000": {"label": "2,000 message credits", "credits": 2000, "usd": 6000, "ngn": 6000000},
}

# Which currency each region pays in (and thus which provider is used).
REGION_CURRENCY = {"US": "USD", "NG": "NGN"}


def _catalog(key: str) -> dict | None:
    return TIERS.get(key) or CREDIT_PACKS.get(key)


def is_purchasable(key: str) -> bool:
    return key in TIERS or key in CREDIT_PACKS


def is_credit_pack(key: str) -> bool:
    return key in CREDIT_PACKS


def amount_for(key: str, currency: str) -> int:
    """Smallest-unit price for a tier or credit pack in the given currency."""
    item = _catalog(key)
    return item["usd"] if currency.upper() == "USD" else item["ngn"]


def packs_public(currency: str) -> list[dict]:
    cur = currency.upper()
    return [
        {"key": k, "label": p["label"], "credits": p["credits"],
         "currency": cur, "amount": p["usd"] if cur == "USD" else p["ngn"]}
        for k, p in CREDIT_PACKS.items()
    ]


def apply_purchase(event: Event, key: str) -> None:
    """Apply a paid purchase: a tier flips entitlements; a credit pack only
    adds credits. Caller commits; idempotency is the caller's job."""
    if key in TIERS:
        apply_pass(event, key)
    elif key in CREDIT_PACKS:
        event.message_credits = (event.message_credits or 0) + CREDIT_PACKS[key]["credits"]


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
