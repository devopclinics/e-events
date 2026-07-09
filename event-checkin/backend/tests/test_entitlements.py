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


def test_credit_metering_decrements_then_blocks():
    e = _event(is_paid=True, paid_channels=True, message_credits=2)
    assert take_message_credit(e) is True and e.message_credits == 1
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
