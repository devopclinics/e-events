"""Per-event entitlement rules.

The database stores pricing as editable rows, but the product packaging is code
metadata for now so existing deployments do not need a schema migration just to
change feature gates.
"""
import asyncio
import logging
import math
import os
import uuid
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import object_session

from .models import Event, MessageCreditLedger, Organization, PricingPlan
from .config import settings

logger = logging.getLogger("entitlements")

# Free events: email-only invites, capped guest list, Festio branding.
FREE_GUEST_CAP = 25

PLAN_RANK = {
    "free": 0,
    "tier50": 1,      # Starter
    "tier150": 2,     # Standard
    "tier300": 3,     # Pro
    "scale": 4,
    "unlimited": 4,   # legacy key, treated as Scale for existing events
    "comp": 99,
}

PLAN_NAMES = {
    "free": "Free",
    "tier50": "Starter Event Pass",
    "tier150": "Standard Event Pass",
    "tier300": "Pro Event Pass",
    "scale": "Scale Event Pass",
    "unlimited": "Scale Event Pass",
    "comp": "Comp",
}

# Legacy tier-rank gate map. No longer consulted by event_allows() (see
# BASELINE_PAID_FEATURES / FEATURE_ADDON below) -- every paid tier now ships
# the same base package, so "requires at least tier150" no longer means
# anything. Kept only for plan_rank()/event_plan_rank(), which still describe
# which tier an event bought (guest_cap/credits), not feature eligibility.
FEATURE_MIN_PLAN = {
    "paid_channels": "tier50",
    "branding_removed": "tier50",
    "seating_enabled": "tier50",
    "menu_enabled": "tier50",
    "logistics_enabled": "tier50",
    "registry_enabled": "tier50",
    "festiome_addon_enabled": "tier50",
    "planner_enabled": "tier50",
    "design_publish": "tier50",
    "floor_plan": "tier150",
    "source_sync": "tier150",
    "venue_access_enabled": "tier150",
    "partner_pairing_enabled": "tier150",
    "experience_enabled": "tier300",
    "live_program_enabled": "tier300",
    "consent_forms": "tier300",
    "scanner_confirmation": "tier300",
    "souvenir_confirmation": "tier300",
    "section_mode_enabled": "tier300",
    "manual_checkin_enabled": "tier300",
    "self_checkin_enabled": "tier300",
    "notify_mms": "tier300",
}

# Included with every paid tier (Starter through Scale), no add-on purchase
# required -- just event.is_paid. manual_checkin_enabled/self_checkin_enabled
# and source_sync aren't listed here because they're not gated at all anymore
# (fall through to the default `True` in event_allows), matching QR check-in.
BASELINE_PAID_FEATURES = {"paid_channels", "branding_removed", "design_publish", "notify_mms"}

# Feature flag -> the PricingPlan(kind="addon") key that unlocks it. Bundled by
# product surface, not by legacy tier rank -- see docs/PHASE0 addon groupings.
FEATURE_ADDON = {
    "seating_enabled": "addon_seating",
    "floor_plan": "addon_seating",
    "partner_pairing_enabled": "addon_seating",
    "menu_enabled": "addon_menu",
    "logistics_enabled": "addon_logistics",
    "registry_enabled": "addon_registry",
    "venue_access_enabled": "addon_venue_access",
    "section_mode_enabled": "addon_venue_access",
    "experience_enabled": "addon_experience",
    "live_program_enabled": "addon_experience",
    "consent_forms": "addon_experience",
    "scanner_confirmation": "addon_experience",
    "souvenir_confirmation": "addon_experience",
    "festiome_addon_enabled": "addon_festiome",
    "planner_enabled": "addon_planner",
    "engagement_enabled": "addon_engagement",
    "speaker_enabled": "addon_speakers",
    "partner_enabled": "addon_partners",
    "reminders_enabled": "addon_reminders",
}

def guest_limit(event: Event) -> int | None:
    """Max guests for this event. None = unlimited."""
    if settings.organization_entitlements_v2:
        policy = _org_entitlement_cache.get(event.org_id)
        if policy and not (
            policy.get("status") == "active" and policy.get("expires_at")
            and policy["expires_at"] > datetime.utcnow()
        ):
            # Expired paid events preserve data but cannot add guests.
            return 0 if event.is_paid else FREE_GUEST_CAP
    if event.is_paid:
        return event.guest_cap  # None = unlimited for paid/comp tiers
    return FREE_GUEST_CAP


def plan_rank(plan_tier: str | None) -> int:
    return PLAN_RANK.get(plan_tier or "free", 0)


def event_plan_rank(event: Event) -> int:
    if not event.is_paid:
        return 0
    return plan_rank(event.plan_tier)


def plan_label(plan_tier: str | None) -> str:
    return PLAN_NAMES.get(plan_tier or "free", plan_tier or "Free")


def min_plan_for_feature(feature: str) -> str | None:
    return FEATURE_MIN_PLAN.get(feature)


def addon_for_feature(feature: str) -> str | None:
    return FEATURE_ADDON.get(feature)


def event_allows(event: Event, feature: str) -> bool:
    if feature in BASELINE_PAID_FEATURES:
        return bool(event.is_paid)
    addon = FEATURE_ADDON.get(feature)
    if not addon:
        return True
    # Events created before the add-on purchase ledger was introduced have a
    # NULL value. Preserve the feature set included in their original pass;
    # an explicit empty list opts into the new add-on model with no purchases.
    if event.is_paid and event.purchased_addons is None:
        legacy_enabled = {
            "floor_plan": "seating_enabled",
            "consent_forms": "experience_enabled",
            "scanner_confirmation": "experience_enabled",
            "souvenir_confirmation": "experience_enabled",
        }.get(feature, feature)
        if bool(getattr(event, legacy_enabled, False)):
            return True
        minimum_plan = FEATURE_MIN_PLAN.get(feature)
        return minimum_plan is not None and event_plan_rank(event) >= plan_rank(minimum_plan)
    return event_allows_addon(event, addon)


def event_allows_addon(event: Event, addon: str) -> bool:
    # Add-ons supplement an Event Pass; they never turn a free event into a
    # paid event. This hard gate intentionally wins over every operator override
    # and promotional grant below.
    if settings.organization_entitlements_v2:
        policy = _org_entitlement_cache.get(event.org_id, {})
        active = policy.get("status") == "active" and policy.get("expires_at") and policy["expires_at"] > datetime.utcnow()
        if not active:
            return False
        org_override = _org_addon_override_cache.get(event.org_id, {}).get(addon)
        if org_override is not None:
            return bool(org_override)
        promo = policy.get("promo_expires_at")
        if promo and promo > datetime.utcnow():
            return True
        if addon in policy.get("purchased_addons", []):
            return True
    if not event.is_paid:
        return False
    event_override = (event.addon_overrides or {}).get(addon)
    if event_override is not None:
        return bool(event_override)
    org_override = (event.org_addon_overrides or {}).get(addon)
    if org_override is not None:
        return bool(org_override)
    if event.addon_promo_until and event.addon_promo_until > datetime.utcnow():
        return True
    platform_override = (event.platform_addon_overrides or {}).get(addon)
    if platform_override is not None and not platform_override:
        return False
    return addon in (event.purchased_addons or [])


_org_addon_override_cache: dict[str, dict[str, bool]] = {}
_global_addon_active_cache: dict[str, bool] = {}
_org_entitlement_cache: dict[str, dict] = {}


async def reload_addon_policy_cache(db) -> None:
    """Reload operator-controlled org overrides and global availability."""
    orgs = (await db.execute(select(Organization))).scalars().all()
    plans = (await db.execute(select(PricingPlan.key, PricingPlan.active).where(PricingPlan.kind == "addon"))).all()
    _org_addon_override_cache.clear()
    _org_addon_override_cache.update({org.id: dict(org.addon_overrides or {}) for org in orgs})
    _org_entitlement_cache.clear()
    _org_entitlement_cache.update({org.id: {
        "status": org.event_pass_status, "expires_at": org.event_pass_expires_at,
        "promo_expires_at": org.addon_promo_expires_at,
        "purchased_addons": list(org.purchased_addons or []),
    } for org in orgs})
    _global_addon_active_cache.clear()
    _global_addon_active_cache.update({key: bool(active) for key, active in plans})


def assert_feature_allowed(event: Event, feature: str) -> None:
    if event_allows(event, feature):
        return
    addon = FEATURE_ADDON.get(feature)
    if addon and event.purchased_addons is None:
        required = min_plan_for_feature(feature) or "tier50"
        raise HTTPException(
            402,
            f"{feature.replace('_', ' ').title()} requires at least the {plan_label(required)}.",
            headers={"X-Required-Plan": required},
        )
    if addon:
        raise HTTPException(
            402,
            f"{feature.replace('_', ' ').title()} needs the {addon} add-on. Buy it for this event to unlock it.",
            headers={"X-Required-Addon": addon},
        )
    raise HTTPException(
        402,
        f"{feature.replace('_', ' ').title()} requires a paid Event Pass. Upgrade this event to unlock it.",
    )


def can_use_paid_channels(event: Event) -> bool:
    """Whether SMS/WhatsApp may be sent for this event (email is always allowed)."""
    if settings.organization_entitlements_v2:
        policy = _org_entitlement_cache.get(event.org_id, {})
        return bool(policy.get("status") == "active" and policy.get("expires_at") and policy["expires_at"] > datetime.utcnow())
    return bool(event.is_paid and event.paid_channels)


# Hardcoded absolute fallback — only used if MessagingCreditRate has no
# global default row (e.g. a fresh DB before the Console pricing page's
# channel-weight panel has ever been saved). See team-docs/index.html §2c
# for how these were derived (cost-ratio to a corrected SMS anchor).
DEFAULT_CHANNEL_WEIGHTS = {"sms": 2, "whatsapp": 1.5, "mms": 3, "rcs": 2}
DEFAULT_EMAIL_CREDITS_PER_EMAIL = 0.1  # 10 emails per credit

# In-memory cache of admin-configured rates: {(org_id_or_None, channel): rate}.
# org_id=None holds the global default. Populated at app startup and
# refreshed by the Console pricing endpoints after every save (see
# reload_credit_rate_cache) — this keeps take_message_credit/take_email_credit
# plain synchronous functions that only touch the in-memory Event object,
# instead of threading an async db session through every call site across
# guests.py/invite.py/events.py/festiome.py/registry.py.
_rate_cache: dict[tuple[str | None, str], float] = {}


async def reload_credit_rate_cache(db) -> None:
    """Repopulate the in-memory channel-rate cache from MessagingCreditRate.
    Call at app startup and after any Console pricing save."""
    from sqlalchemy import select
    from .models import MessagingCreditRate
    rows = (await db.execute(select(MessagingCreditRate))).scalars().all()
    _rate_cache.clear()
    for row in rows:
        _rate_cache[(row.org_id, row.channel)] = row.credits_per_unit


async def run_cache_refresher(interval_seconds: int = 30) -> None:
    """Keep this process's copy of the above caches in sync with the DB.

    Both caches are refreshed on save from whichever replica handles the
    admin/Console request that changed them — fine on a single web process,
    but with multiple replicas every other pod keeps serving its stale
    startup snapshot until it happens to restart. Rather than thread an
    async db session through every event_allows_addon()/channel_weight()
    call site (they're plain sync functions on purpose — see the _rate_cache
    docstring above), every replica just re-polls the DB on a short timer so
    a Console change reaches all of them within one interval, not just the
    pod that served the request.
    """
    from .database import AsyncSessionLocal
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await reload_addon_policy_cache(db)
                await reload_credit_rate_cache(db)
        except Exception:
            logger.exception("cache refresh failed; will retry next tick")
        await asyncio.sleep(interval_seconds)


def channel_weight(channel: str | None, *, org_id: str | None = None) -> float:
    """Credits charged per outbound message for this channel: org-level
    negotiated override, then the admin-configured global default (Console
    pricing page), then a hardcoded fallback. May be below 1 (many sends per
    credit, e.g. email) or at/above 1 (multiple credits per send, e.g. MMS) —
    _spend_channel_credit handles both with one algorithm."""
    ch = (channel or "sms").lower()
    if org_id is not None and (org_id, ch) in _rate_cache:
        return _rate_cache[(org_id, ch)]
    if (None, ch) in _rate_cache:
        return _rate_cache[(None, ch)]
    if ch == "email":
        return DEFAULT_EMAIL_CREDITS_PER_EMAIL
    return DEFAULT_CHANNEL_WEIGHTS.get(ch, 1)


def provider_for_channel(channel: str | None) -> str | None:
    ch = (channel or "").lower()
    if ch == "whatsapp":
        return os.getenv("WHATSAPP_PROVIDER") or os.getenv("MESSAGING_PROVIDER") or None
    if ch in {"sms", "mms", "rcs"}:
        return os.getenv("MESSAGING_PROVIDER") or None
    return None


def provider_cost_cents(channel: str | None, provider: str | None = None) -> tuple[int | None, str | None]:
    """Optional provider-cost abstraction for gross-margin reporting.

    Configure costs in cents/kobo via MESSAGE_PROVIDER_COSTS, e.g.
    'sms:twilio=2,whatsapp:bird=5,mms:clicksend=35'.
    """
    ch = (channel or "").lower()
    prov = (provider or provider_for_channel(ch) or "").lower()
    wanted = f"{ch}:{prov}" if prov else ch
    for part in (os.getenv("MESSAGE_PROVIDER_COSTS") or "").split(","):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        if key.strip().lower() != wanted:
            continue
        try:
            return max(0, int(value.strip())), os.getenv("MESSAGE_PROVIDER_COST_CURRENCY", "USD").upper()
        except ValueError:
            return None, None
    return None, None


def _ledger_row(
    event: Event,
    *,
    action: str,
    status: str,
    channel: str | None,
    reason: str | None,
    credits: int,
    delta: int,
    balance_after: int,
    unit_weight: int = 1,
    guest_id: str | None = None,
    payment_id: str | None = None,
    provider: str | None = None,
    provider_message_id: str | None = None,
) -> MessageCreditLedger:
    cost, cost_currency = provider_cost_cents(channel, provider)
    return MessageCreditLedger(
        org_id=event.org_id,
        event_id=event.id,
        guest_id=guest_id,
        payment_id=payment_id,
        action=action,
        status=status,
        channel=channel,
        reason=reason,
        provider=provider or provider_for_channel(channel),
        provider_message_id=provider_message_id,
        units=1,
        unit_weight=unit_weight,
        credits=credits,
        delta=delta,
        balance_after=balance_after,
        provider_cost_cents=cost,
        provider_currency=cost_currency,
    )


def _add_ledger(event: Event, row: MessageCreditLedger) -> None:
    session = object_session(event)
    if session is not None:
        session.add(row)
    else:
        event.credit_ledger.append(row)


def record_free_send(event: Event, channel: str, *, reason: str, guest_id: str | None = None) -> None:
    """Log a zero-cost send (e.g. broadcast email, which isn't credit-metered)
    for usage reporting, without touching event.message_credits."""
    _add_ledger(event, _ledger_row(
        event, action="spend", status="posted", channel=channel, reason=reason,
        credits=0, delta=0, balance_after=event.message_credits, guest_id=guest_id,
    ))


def grant_message_credits(event: Event, credits: int, *, reason: str = "grant", payment_id: str | None = None) -> None:
    credits = int(credits or 0)
    if credits <= 0:
        return
    event.message_credits = (event.message_credits or 0) + credits
    _add_ledger(event, _ledger_row(
        event,
        action="topup" if payment_id else "grant",
        status="posted",
        channel=None,
        reason=reason,
        credits=credits,
        delta=credits,
        balance_after=event.message_credits,
        payment_id=payment_id,
    ))


def _spend_channel_credit(
    event: Event,
    channel: str,
    rate: float,
    *,
    reason: str,
    guest_id: str | None = None,
    provider: str | None = None,
    provider_message_id: str | None = None,
) -> bool:
    """Shared fractional credit-charging algorithm for every channel (SMS,
    WhatsApp, MMS, RCS, email). `rate` is that channel's configured
    credits-per-unit (see channel_weight) and may be any positive float.

    The balance itself only ever moves in whole credits — this tracks each
    channel's running over/under-payment in event.credit_bank so the
    *average* cost per send converges exactly on `rate`, whether it's below 1
    (a send gets covered by a fraction of a previously-paid credit, the way
    email's old email_half_pending flag worked, generalized to any ratio) or
    at/above 1 (a send may pre-pay part of the next one, e.g. a 1.5-credit
    rate charges 2/1/2/1/... alternating, averaging exactly 1.5).

    Returns False (nothing charged, nothing counted) when a whole-credit
    charge is due and the balance can't cover it."""
    if rate <= 0:
        return True
    bank = dict(event.credit_bank or {})
    banked = bank.get(channel, 0.0)
    need = rate - banked
    if need <= 1e-9:
        # Fully covered by a previous overpayment on this channel.
        bank[channel] = -need
        event.credit_bank = bank
        return True
    charge = math.ceil(need - 1e-9)
    if (event.message_credits or 0) < charge:
        return False
    event.message_credits -= charge
    bank[channel] = charge - need
    event.credit_bank = bank
    row = _ledger_row(
        event,
        action="spend",
        status="posted",
        channel=channel,
        reason=reason,
        credits=charge,
        delta=-charge,
        balance_after=event.message_credits,
        unit_weight=charge,
        guest_id=guest_id,
        provider=provider,
        provider_message_id=provider_message_id,
    )
    if not row.id:
        row.id = str(uuid.uuid4())
    _add_ledger(event, row)
    event._last_credit_ledger_id = row.id
    return True


async def reserve_message_credit(
    event: Event,
    channel: str = "sms",
    *,
    db=None,
    reason: str = "message",
    guest_id: str | None = None,
    provider: str | None = None,
    provider_message_id: str | None = None,
) -> bool:
    """Reserve and post weighted credits for an outbound message (see
    _spend_channel_credit). The balance remains on `events.message_credits`;
    this appends a matching ledger row. Existing callers can still use the
    old boolean API."""
    if settings.organization_entitlements_v2:
        if db is None:
            raise RuntimeError("db is required for organization credit reservations")
        from .organization_entitlements import reserve_message_units
        row = await reserve_message_units(
            db, event, channel, credits_per_message=channel_weight(channel, org_id=event.org_id),
            reason=reason, guest_id=guest_id, idempotency_key=provider_message_id,
        )
        if row:
            event._last_credit_ledger_id = row.id
            return True
        return False
    # Email has its own free-quota-then-paid metering (see take_email_credit
    # below) -- route it there instead of the generic per-message spend, so
    # legacy-mode orgs get the same free-tier behavior the v2 path above
    # already gets via reserve_message_units' channel="email" handling.
    if channel == "email":
        return take_email_credit(event, reason=reason, guest_id=guest_id)
    return take_message_credit(
        event, channel, reason=reason, guest_id=guest_id,
        provider=provider, provider_message_id=provider_message_id,
    )


def take_message_credit(
    event: Event,
    channel: str = "sms",
    *,
    reason: str = "message",
    guest_id: str | None = None,
    provider: str | None = None,
    provider_message_id: str | None = None,
) -> bool:
    """Legacy synchronous event-wallet API, retained for flag-off compatibility."""
    # Platform-superadmin hard block (console-only) wins over everything — no
    # paid send on a blocked channel, regardless of credits or notify_* flags.
    if channel in (event.blocked_messaging_channels or []):
        return False
    rate = channel_weight(channel, org_id=event.org_id)
    return _spend_channel_credit(
        event, channel, rate, reason=reason, guest_id=guest_id,
        provider=provider, provider_message_id=provider_message_id,
    )


def last_credit_ledger_id(event: Event) -> str | None:
    return getattr(event, "_last_credit_ledger_id", None)


# First N guest emails per event are free; override with EMAIL_FREE_QUOTA.
EMAIL_FREE_QUOTA = max(0, int(os.getenv("EMAIL_FREE_QUOTA", "75")))


def take_email_credit(event: Event, *, guest_id: str | None = None, reason: str = "email") -> bool:
    """Meter a guest email: free up to EMAIL_FREE_QUOTA per event, then the
    configured email rate (see channel_weight) via the same fractional
    credit-bank mechanism as every other channel (_spend_channel_credit).

    Returns False (send must be skipped) when the event is past the free quota
    and has no credit to cover the email; the attempt is not counted."""
    if "email" in (event.blocked_messaging_channels or []):
        return False
    sent = (event.emails_sent or 0) + 1
    if sent <= EMAIL_FREE_QUOTA:
        event.emails_sent = sent
        return True
    rate = channel_weight("email", org_id=event.org_id)
    if not _spend_channel_credit(event, "email", rate, reason=reason, guest_id=guest_id):
        return False
    event.emails_sent = sent
    return True


def refund_message_credit(event: Event, ledger: MessageCreditLedger, *, reason: str = "refund") -> None:
    if ledger.status == "refunded" or ledger.delta >= 0:
        return
    credits = abs(ledger.delta)
    event.message_credits = (event.message_credits or 0) + credits
    ledger.status = "refunded"
    _add_ledger(event, _ledger_row(
        event,
        action="refund",
        status="posted",
        channel=ledger.channel,
        reason=reason,
        credits=credits,
        delta=credits,
        balance_after=event.message_credits,
        guest_id=ledger.guest_id,
        provider=ledger.provider,
        provider_message_id=ledger.provider_message_id,
    ))


def assert_within_guest_cap(event: Event, current_count: int, adding: int = 1) -> None:
    """Raise 402 if adding `adding` guests would exceed the event's plan cap."""
    cap = guest_limit(event)
    if cap is not None and current_count + adding > cap:
        raise HTTPException(
            402,
            f"This event's plan allows up to {cap} guests. "
            "Upgrade with an Event Pass to add more.",
            headers={"X-Required-Plan": "scale" if cap >= 300 else "tier300" if cap >= 150 else "tier150" if cap >= 50 else "tier50"},
        )
