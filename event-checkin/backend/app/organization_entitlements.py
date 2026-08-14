"""Organization-scoped Event Pass policy (v2 rollout).

Pure policy lives here so every creation path uses the same rules. Database
mutation remains in routers/services where it can be transactionally locked.
"""
from datetime import datetime, timedelta

from fastapi import HTTPException

from sqlalchemy import select

from .config import settings
from .models import Event, MessageCreditLedger, Organization

FREE_GUEST_CAP = 25
FREE_EMAIL_CREDIT_UNITS = 100  # 10 credits = 100 emails
PASS_DURATION_DAYS = 365
ADDON_PROMO_DAYS = 183
TIER_GUEST_CAPS = {"tier50": 50, "tier150": 150, "tier300": 300, "scale": 500, "unlimited": 500}


def pass_is_active(org: Organization, now: datetime | None = None) -> bool:
    now = now or datetime.utcnow()
    return bool(
        org.event_pass_status == "active"
        and org.event_pass_tier
        and org.event_pass_expires_at
        and org.event_pass_expires_at > now
    )


def guest_cap(org: Organization, now: datetime | None = None) -> int:
    if not pass_is_active(org, now):
        return FREE_GUEST_CAP
    return int(org.event_pass_guest_cap or TIER_GUEST_CAPS.get(org.event_pass_tier or "", FREE_GUEST_CAP))


def assert_can_create_event(org: Organization, existing_event_count: int, *, is_superadmin: bool = False) -> None:
    if is_superadmin or pass_is_active(org):
        return
    if not org.free_event_used and existing_event_count == 0:
        return
    raise HTTPException(
        402,
        "Your organization has used its free event. Buy or renew an Event Pass to create more events.",
        headers={"X-Required-Entitlement": "active_event_pass"},
    )


def snapshot_new_event(event: Event, org: Organization, now: datetime | None = None) -> None:
    """Populate legacy event fields so existing feature gates remain compatible."""
    now = now or datetime.utcnow()
    if pass_is_active(org, now):
        event.is_paid = True
        event.paid_channels = True
        event.plan_tier = org.event_pass_tier
        event.guest_cap = guest_cap(org, now)
        event.addon_promo_until = org.addon_promo_expires_at
    else:
        event.is_paid = False
        event.paid_channels = False
        event.plan_tier = "free"
        event.guest_cap = FREE_GUEST_CAP
        event.purchased_addons = []
        event.notify_sms = False
        event.notify_whatsapp = False


def assert_event_configuration_allowed(event: Event, org: Organization, *, activating: bool = False) -> None:
    """Reject saved configuration that exceeds the organization's entitlement."""
    cap = guest_cap(org)
    if event.rsvp_capacity is not None and event.rsvp_capacity > cap:
        raise HTTPException(
            402,
            f"This Event Pass allows up to {cap} guests per event. Reduce the capacity or upgrade the organization pass.",
            headers={"X-Guest-Cap": str(cap)},
        )
    if not pass_is_active(org) and (event.notify_sms or event.notify_whatsapp):
        raise HTTPException(402, "Free events are email-only. Buy an Event Pass to enable SMS or WhatsApp.")


def activate_pass(org: Organization, tier: str, *, guest_limit: int | None = None, now: datetime | None = None) -> None:
    now = now or datetime.utcnow()
    cap = guest_limit or TIER_GUEST_CAPS.get(tier)
    if not cap:
        raise ValueError("Unknown Event Pass tier or missing custom guest limit")
    org.event_pass_tier = tier
    org.event_pass_status = "active"
    org.event_pass_started_at = now
    org.event_pass_expires_at = now + timedelta(days=PASS_DURATION_DAYS)
    org.event_pass_guest_cap = int(cap)
    org.addon_promo_expires_at = now + timedelta(days=ADDON_PROMO_DAYS)


def grant_message_units(org: Organization, credits: int) -> None:
    """Add flat message credits to the org wallet outside a plan purchase
    (operator comps, trial grants) — mirrors apply_organization_purchase's
    credit handling."""
    credits = int(credits or 0)
    if credits <= 0:
        return
    org.message_credit_units = int(org.message_credit_units or 0) + credits * 10


def entitlement_snapshot(org: Organization) -> dict:
    return {
        "tier": org.event_pass_tier,
        "status": org.event_pass_status,
        "started_at": org.event_pass_started_at.isoformat() if org.event_pass_started_at else None,
        "expires_at": org.event_pass_expires_at.isoformat() if org.event_pass_expires_at else None,
        "guest_cap": org.event_pass_guest_cap,
        "addon_promo_expires_at": org.addon_promo_expires_at.isoformat() if org.addon_promo_expires_at else None,
        "free_event_used": bool(org.free_event_used),
        "message_credit_units": int(org.message_credit_units or 0),
    }


def channel_credit_units(channel: str, credits_per_message: float) -> int:
    """Convert configured credit prices to exact wallet tenths."""
    return max(0, round(float(credits_per_message) * 10))


async def reserve_message_units(
    db,
    event: Event,
    channel: str,
    *,
    credits_per_message: float,
    reason: str = "message",
    guest_id: str | None = None,
    idempotency_key: str | None = None,
) -> MessageCreditLedger | None:
    """Atomically reserve organization credits and append an idempotent ledger.

    Returns None for insufficient credit or a blocked/expired paid channel.
    The caller owns the transaction and must commit before dispatching.
    """
    if not settings.organization_entitlements_v2:
        raise RuntimeError("Organization wallet called while rollout is disabled")
    if channel in (event.blocked_messaging_channels or []):
        return None
    org = await db.scalar(select(Organization).where(Organization.id == event.org_id).with_for_update())
    if not org:
        return None
    if channel != "email" and not pass_is_active(org):
        return None
    if idempotency_key:
        existing = await db.scalar(select(MessageCreditLedger).where(MessageCreditLedger.idempotency_key == idempotency_key))
        if existing:
            return existing
    units = channel_credit_units(channel, credits_per_message)
    if units and int(org.message_credit_units or 0) < units:
        return None
    org.message_credit_units = int(org.message_credit_units or 0) - units
    ledger = MessageCreditLedger(
        org_id=org.id, event_id=event.id, guest_id=guest_id,
        action="reserve", status="reserved", channel=channel, reason=reason,
        units=1, unit_weight=units, credits=units // 10,
        delta=0, balance_after=org.message_credit_units // 10,
        credit_units=units, unit_delta=-units,
        unit_balance_after=org.message_credit_units,
        idempotency_key=idempotency_key,
    )
    db.add(ledger)
    await db.flush()
    return ledger


async def refund_message_units(db, ledger: MessageCreditLedger, *, reason: str) -> bool:
    """Idempotently return a failed reservation to the organization wallet."""
    if ledger.status in {"refunded", "failed_refunded"} or ledger.unit_delta >= 0:
        return False
    org = await db.scalar(select(Organization).where(Organization.id == ledger.org_id).with_for_update())
    if not org:
        return False
    amount = abs(int(ledger.unit_delta))
    org.message_credit_units = int(org.message_credit_units or 0) + amount
    ledger.status = "refunded"
    ledger.reason = f"{ledger.reason or 'message'}:{reason}"
    ledger.unit_balance_after = org.message_credit_units
    return True
