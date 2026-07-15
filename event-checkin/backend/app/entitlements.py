"""Per-event entitlement rules.

The database stores pricing as editable rows, but the product packaging is code
metadata for now so existing deployments do not need a schema migration just to
change feature gates.
"""
import os
import uuid
from fastapi import HTTPException
from sqlalchemy.orm import object_session

from .models import Event, MessageCreditLedger

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

FEATURE_MIN_PLAN = {
    "paid_channels": "tier50",
    "branding_removed": "tier50",
    "qr_checkin": "tier50",
    "seating_enabled": "tier50",
    "menu_enabled": "tier50",
    "logistics_enabled": "tier50",
    "registry_enabled": "tier50",
    "festiome_addon_enabled": "tier50",
    "design_publish": "tier50",
    "floor_plan": "tier150",
    "source_sync": "tier150",
    "venue_access_enabled": "tier150",
    "partner_pairing_enabled": "tier150",
    "experience_enabled": "tier300",
    # Live Program extends the Experience workflow; keep its commercial gate
    # aligned so it cannot be enabled independently on lower-tier events.
    "live_program_enabled": "tier300",
    "consent_forms": "tier300",
    "scanner_confirmation": "tier300",
    "souvenir_confirmation": "tier300",
    "section_mode_enabled": "tier300",
    "manual_checkin_enabled": "tier300",
    "self_checkin_enabled": "tier300",
    "notify_mms": "tier300",
}

PLAN_CAPABILITIES = {
    "tier50": [
        "SMS/WhatsApp/email invitations",
        "QR ticket generation and QR check-in",
        "Basic seating/table allocation",
        "Basic menu, registry, and logistics",
        "Festio branding removed",
        "Design Studio publishing with standard templates",
    ],
    "tier150": [
        "Everything in Starter",
        "Table groups/room groups and floor plan sharing",
        "Access zones and ticket types",
        "Guest import from file or source URL",
        "Registry public page and vendor logistics",
        "More Design Studio template families and flyer outputs",
    ],
    "tier300": [
        "Everything in Standard",
        "Experience workflows",
        "Consent forms and signatures",
        "Scanner confirmation and souvenir/handoff confirmation",
        "Section-based scanning and manual check-in",
        "Announcements, guest messaging, and MMS eligibility",
    ],
    "scale": [
        "Everything in Pro",
        "Higher-volume guest operations",
        "Multi-section check-in workflows",
        "Larger message batches",
        "Priority support",
        "Advanced logistics and access operations",
    ],
    "unlimited": [
        "Everything in Pro",
        "Higher-volume guest operations",
        "Multi-section check-in workflows",
        "Larger message batches",
        "Priority support",
        "Advanced logistics and access operations",
    ],
}


def guest_limit(event: Event) -> int | None:
    """Max guests for this event. None = unlimited."""
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


def event_allows(event: Event, feature: str) -> bool:
    required = min_plan_for_feature(feature)
    if not required:
        return True
    return event_plan_rank(event) >= plan_rank(required)


def feature_capabilities(plan_tier: str | None) -> list[str]:
    return PLAN_CAPABILITIES.get(plan_tier or "", [])


def assert_feature_allowed(event: Event, feature: str) -> None:
    if event_allows(event, feature):
        return
    required = min_plan_for_feature(feature) or "tier50"
    raise HTTPException(
        402,
        f"{feature.replace('_', ' ').title()} requires {plan_label(required)} — upgrade this event to unlock it.",
        headers={"X-Required-Plan": required},
    )


def can_use_paid_channels(event: Event) -> bool:
    """Whether SMS/WhatsApp may be sent for this event (email is always allowed)."""
    return bool(event.is_paid and event.paid_channels)


DEFAULT_CHANNEL_WEIGHTS = {"sms": 1, "whatsapp": 1, "mms": 3, "rcs": 2}


def channel_weight(channel: str | None) -> int:
    """Weighted credits per outbound message by channel.

    Override with MESSAGE_CREDIT_WEIGHTS='sms=1,whatsapp=1,mms=3,rcs=2'.
    """
    weights = dict(DEFAULT_CHANNEL_WEIGHTS)
    for part in (os.getenv("MESSAGE_CREDIT_WEIGHTS") or "").split(","):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        try:
            weights[key.strip().lower()] = max(1, int(value.strip()))
        except ValueError:
            continue
    return weights.get((channel or "sms").lower(), 1)


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
        unit_weight=channel_weight(channel),
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


def take_message_credit(
    event: Event,
    channel: str = "sms",
    *,
    reason: str = "message",
    guest_id: str | None = None,
    provider: str | None = None,
    provider_message_id: str | None = None,
) -> bool:
    """Reserve and post weighted credits for an outbound message.

    The balance remains on `events.message_credits`; this appends a matching
    ledger row. Existing callers can still use the old boolean API.
    """
    # Platform-superadmin hard block (console-only) wins over everything — no
    # paid send on a blocked channel, regardless of credits or notify_* flags.
    if channel in (event.blocked_messaging_channels or []):
        return False
    credits = channel_weight(channel)
    if (event.message_credits or 0) < credits:
        return False
    event.message_credits -= credits
    row = _ledger_row(
        event,
        action="spend",
        status="posted",
        channel=channel,
        reason=reason,
        credits=credits,
        delta=-credits,
        balance_after=event.message_credits,
        guest_id=guest_id,
        provider=provider,
        provider_message_id=provider_message_id,
    )
    if not row.id:
        row.id = str(uuid.uuid4())
    _add_ledger(event, row)
    event._last_credit_ledger_id = row.id
    return True


def last_credit_ledger_id(event: Event) -> str | None:
    return getattr(event, "_last_credit_ledger_id", None)


# First N guest emails per event are free; override with EMAIL_FREE_QUOTA.
EMAIL_FREE_QUOTA = max(0, int(os.getenv("EMAIL_FREE_QUOTA", "25")))


def take_email_credit(event: Event, *, guest_id: str | None = None, reason: str = "email") -> bool:
    """Meter a guest email: free up to EMAIL_FREE_QUOTA per event, then 0.5
    credit each. Credits are integers, so halves accumulate in
    email_half_pending and 1 credit posts on every second chargeable email.

    Returns False (send must be skipped) when the event is past the free quota
    and has no credit to cover the email; the attempt is not counted."""
    if "email" in (event.blocked_messaging_channels or []):
        return False
    sent = (event.emails_sent or 0) + 1
    if sent <= EMAIL_FREE_QUOTA:
        event.emails_sent = sent
        return True
    # Beyond the free quota an email needs cover: either a half already paid
    # for (pending) or at least 1 credit in the balance.
    if not (event.email_half_pending or 0) and (event.message_credits or 0) < 1:
        return False
    event.emails_sent = sent
    if event.email_half_pending:
        # Second half of an already-paid credit.
        event.email_half_pending = 0
        return True
    # First half: deduct the full credit now, remember the prepaid half.
    event.message_credits -= 1
    event.email_half_pending = 1
    row = _ledger_row(
        event,
        action="spend",
        status="posted",
        channel="email",
        reason=f"{reason}_x2",
        credits=1,
        delta=-1,
        balance_after=event.message_credits,
        guest_id=guest_id,
    )
    if not row.id:
        row.id = str(uuid.uuid4())
    _add_ledger(event, row)
    event._last_credit_ledger_id = row.id
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
