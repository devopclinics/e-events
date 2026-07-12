"""Superadmin console hard-blocks for messaging channels + comm features."""
import pytest

from app.main import app
from app.models import Event
from app.entitlements import take_message_credit
from app.database import get_db
from conftest import _Session


@pytest.mark.asyncio
async def test_superadmin_sets_blocks_and_they_are_enforced(ctx):
    ev = ctx.ids["event_a"]
    # Give the event credits so a block, not a shortage, is what stops the send.
    async with _Session() as s:
        obj = await s.get(Event, ev)
        obj.is_paid = True
        obj.message_credits = 100
        await s.commit()

    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.post(f"/api/admin/events/{ev}/controls", json={
        "blocked_messaging_channels": ["whatsapp", "mms"],
        "blocked_comm_features": ["festiome", "guest_chat"],
    })
    assert r.status_code == 200
    assert set(r.json()["blocked_messaging_channels"]) == {"whatsapp", "mms"}

    # Enforcement: take_message_credit refuses a blocked channel, allows others.
    async with _Session() as s:
        obj = await s.get(Event, ev)
        assert take_message_credit(obj, "whatsapp") is False
        assert take_message_credit(obj, "sms") is True

    # Read-back endpoint reflects the block.
    got = await ctx.client.get(f"/api/admin/events/{ev}/controls")
    assert set(got.json()["blocked_comm_features"]) == {"festiome", "guest_chat"}


@pytest.mark.asyncio
async def test_controls_require_superadmin(ctx):
    ctx.login(ctx.ids["user_a"])  # org admin, not platform superadmin
    r = await ctx.client.post(f'/api/admin/events/{ctx.ids["event_a"]}/controls', json={})
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_blocked_festiome_returns_403(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        obj = await s.get(Event, ev)
        obj.is_paid = True
        obj.festiome_addon_enabled = True
        obj.blocked_comm_features = ["festiome"]
        await s.commit()
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get(f"/api/events/{ev}/festiome/groups")
    assert r.status_code == 403
