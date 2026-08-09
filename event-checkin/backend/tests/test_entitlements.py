"""Entitlement enforcement: guest cap, paid-channel gating, credit metering."""
import pytest
from sqlalchemy import select

from app.entitlements import (
    FREE_GUEST_CAP, guest_limit, can_use_paid_channels, take_message_credit,
    event_allows, assert_feature_allowed, last_credit_ledger_id,
)
from app.models import Event, MessageCreditLedger


def _event(**kw):
    e = Event(name="x", couples_name="x", checkin_base_url="http://x")
    for k, v in kw.items():
        setattr(e, k, v)
    return e


def test_free_event_caps_and_blocks_paid_channels():
    e = _event(is_paid=False, paid_channels=False, guest_cap=None, message_credits=0)
    assert guest_limit(e) == FREE_GUEST_CAP
    assert can_use_paid_channels(e) is False


def test_paid_event_unlimited_when_cap_none():
    e = _event(is_paid=True, paid_channels=True, guest_cap=None, message_credits=10)
    assert guest_limit(e) is None
    assert can_use_paid_channels(e) is True


def test_tier_capability_gates():
    starter = _event(is_paid=True, plan_tier="tier50")
    standard = _event(is_paid=True, plan_tier="tier150")
    pro = _event(is_paid=True, plan_tier="tier300")

    assert event_allows(starter, "design_publish") is True
    assert event_allows(starter, "venue_access_enabled") is False
    assert event_allows(standard, "venue_access_enabled") is True
    assert event_allows(standard, "experience_enabled") is False
    assert event_allows(pro, "experience_enabled") is True


def test_feature_gate_raises_402_for_insufficient_tier():
    e = _event(is_paid=True, plan_tier="tier50")
    with pytest.raises(Exception) as exc:
        assert_feature_allowed(e, "experience_enabled")
    assert getattr(exc.value, "status_code", None) == 402


def test_addon_override_precedence_preserves_purchase_history():
    event = _event(
        org_id="org-1",
        purchased_addons=["addon_seating"],
        platform_addon_overrides={"addon_seating": False, "addon_menu": False},
        org_addon_overrides={"addon_seating": True, "addon_menu": False},
        addon_overrides={"addon_menu": True},
    )
    assert event_allows(event, "seating_enabled") is True  # org allow beats global deny
    assert event_allows(event, "menu_enabled") is True  # event allow beats org/global deny
    event.addon_overrides = {"addon_seating": False}
    assert event_allows(event, "seating_enabled") is False  # event deny beats purchase + org
    assert event.purchased_addons == ["addon_seating"]  # operator policy never mutates purchase history


def test_credit_metering_decrements_then_blocks():
    # Default SMS weight is 2 credits/send (see DEFAULT_CHANNEL_WEIGHTS).
    e = _event(is_paid=True, paid_channels=True, message_credits=4)
    assert take_message_credit(e) is True and e.message_credits == 2
    assert take_message_credit(e) is True and e.message_credits == 0
    assert take_message_credit(e) is False and e.message_credits == 0  # blocked at zero


def test_credit_metering_weights_and_ledger_rows():
    e = _event(id="event-1", org_id="org-1", is_paid=True, paid_channels=True, message_credits=4)
    assert take_message_credit(e, "mms", reason="ticket_card", guest_id="guest-1") is True
    assert e.message_credits == 1
    assert len(e.credit_ledger) == 1
    row = e.credit_ledger[0]
    assert row.channel == "mms"
    assert row.reason == "ticket_card"
    assert row.credits == 3
    assert row.delta == -3
    assert row.balance_after == 1
    assert take_message_credit(e, "mms") is False
    assert e.message_credits == 1


@pytest.mark.asyncio
async def test_provider_failure_refunds_credit_ledger(ctx, monkeypatch):
    from conftest import _Session
    from services import credit_ledger

    monkeypatch.setattr(credit_ledger, "AsyncSessionLocal", _Session)
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        ev.paid_channels = True
        ev.message_credits = 2
        assert take_message_credit(ev, "sms", reason="test_send") is True
        ledger_id = last_credit_ledger_id(ev)
        await s.commit()

    async def failed_send(**_kwargs):
        return {"provider": "twilio", "provider_message_id": "SM123", "status": "failed"}

    await credit_ledger.send_with_credit_ledger(ledger_id, failed_send, phone="+15551234567", body="Hi")

    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        rows = (await s.execute(
            select(MessageCreditLedger)
            .where(MessageCreditLedger.event_id == ev.id)
            .order_by(MessageCreditLedger.delta)
        )).scalars().all()
        assert ev.message_credits == 2
        assert len(rows) == 2
        assert rows[0].status == "refunded"
        assert rows[0].provider == "twilio"
        assert rows[0].provider_message_id == "SM123"
        assert rows[1].action == "refund"


@pytest.mark.asyncio
async def test_free_event_blocks_seating(ctx):
    # event_a is free by default → seating is a paid feature → 402.
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/tables")
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_free_event_blocks_logistics(ctx):
    # event_a is free by default → logistics is a paid feature → 402.
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/shipments")
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_free_event_blocks_registry(ctx):
    # event_a is free by default → registry is a paid feature → 402.
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/registry/items")
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_free_event_blocks_access(ctx):
    # event_a is free by default → venue access is a paid feature → 402.
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/zones")
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_starter_blocks_experience_toggle(ctx):
    from conftest import _Session
    from app.models import Event as E
    async with _Session() as s:
        ev = await s.get(E, ctx.ids["event_a"])
        ev.is_paid, ev.plan_tier, ev.guest_cap = True, "tier50", 50
        await s.commit()

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.patch(
        f"/api/events/{ctx.ids['event_a']}/features",
        json={"experience_enabled": True},
    )
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_broadcast_out_of_credits_reported(ctx):
    # Make the seeded event paid but with zero credits, then broadcast SMS.
    from conftest import _Session
    from app.models import Event as E
    async with _Session() as s:
        ev = await s.get(E, ctx.ids["event_a"])
        ev.is_paid, ev.paid_channels, ev.message_credits = True, True, 0
        # give the guest a phone + consent so the only blocker is credits
        from app.models import Guest
        from sqlalchemy import select
        g = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        g.phone, g.sms_consent = "+18327941707", True
        await s.commit()

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/broadcast",
        json={"message": "hi", "target": "all", "channels": ["sms"]},
    )
    assert r.status_code == 200
    assert r.json()["skipped_no_credits"] >= 1


def test_take_email_credit_quota_and_fractional_credit_bank():
    """First EMAIL_FREE_QUOTA emails free; then the configured email rate
    (default 10 emails/credit) via the shared fractional credit-bank
    mechanism (_spend_channel_credit, generalized from the old email-only
    email_half_pending flag); blocked when past quota with no balance."""
    from app.entitlements import take_email_credit, EMAIL_FREE_QUOTA, DEFAULT_EMAIL_CREDITS_PER_EMAIL
    from app.models import Event

    ev = Event(name="x", couples_name="", event_date=None, timezone="UTC",
               checkin_base_url="http://t", org_id="o")
    ev.message_credits = 2
    ev.emails_sent = 0

    # Free quota consumes no credits.
    for _ in range(EMAIL_FREE_QUOTA):
        assert take_email_credit(ev) is True
    assert ev.message_credits == 2 and ev.emails_sent == EMAIL_FREE_QUOTA

    per_credit = round(1 / DEFAULT_EMAIL_CREDITS_PER_EMAIL)  # 10 emails/credit by default
    # First credit's worth: 1 email charges it up front, the next (per_credit-1) are free.
    assert take_email_credit(ev) is True
    assert ev.message_credits == 1
    for _ in range(per_credit - 1):
        assert take_email_credit(ev) is True
    assert ev.message_credits == 1
    assert ev.emails_sent == EMAIL_FREE_QUOTA + per_credit

    # Second credit's worth, same shape, draining the balance to 0.
    assert take_email_credit(ev) is True
    assert ev.message_credits == 0
    for _ in range(per_credit - 1):
        assert take_email_credit(ev) is True
    assert ev.message_credits == 0

    # Past quota, no credits left → blocked and not counted.
    before = ev.emails_sent
    assert take_email_credit(ev) is False
    assert ev.emails_sent == before

    # Superadmin channel block wins even inside free quota.
    ev2 = Event(name="y", couples_name="", event_date=None, timezone="UTC",
                checkin_base_url="http://t", org_id="o")
    ev2.emails_sent = 0
    ev2.blocked_messaging_channels = ["email"]
    assert take_email_credit(ev2) is False


def test_spend_channel_credit_handles_weight_above_one_fractionally(monkeypatch):
    """A 1.5-credit-per-send channel should alternate 2,1,2,1,... credits per
    send, averaging exactly 1.5 over time — not round every send up to 2."""
    from app import entitlements
    from app.entitlements import take_message_credit
    monkeypatch.setitem(entitlements._rate_cache, (None, "whatsapp"), 1.5)

    e = _event(is_paid=True, paid_channels=True, message_credits=10, org_id="o")
    charges = []
    for _ in range(4):
        before = e.message_credits
        assert take_message_credit(e, "whatsapp") is True
        charges.append(before - e.message_credits)
    assert charges == [2, 1, 2, 1]
    assert e.message_credits == 10 - sum(charges)


def test_channel_weight_prefers_org_override_over_global_default(monkeypatch):
    from app import entitlements
    from app.entitlements import channel_weight
    monkeypatch.setitem(entitlements._rate_cache, (None, "sms"), 2)
    monkeypatch.setitem(entitlements._rate_cache, ("org-x", "sms"), 0.5)

    assert channel_weight("sms", org_id="org-x") == 0.5  # org override wins
    assert channel_weight("sms", org_id="org-y") == 2     # falls back to global default
    assert channel_weight("sms") == 2                     # no org context at all
