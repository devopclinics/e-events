"""Entitlement enforcement: guest cap, paid-channel gating, credit metering."""
import pytest

from app.entitlements import (
    FREE_GUEST_CAP, guest_limit, can_use_paid_channels, take_message_credit,
)
from app.models import Event


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


def test_credit_metering_decrements_then_blocks():
    e = _event(is_paid=True, paid_channels=True, message_credits=2)
    assert take_message_credit(e) is True and e.message_credits == 1
    assert take_message_credit(e) is True and e.message_credits == 0
    assert take_message_credit(e) is False and e.message_credits == 0  # blocked at zero


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
