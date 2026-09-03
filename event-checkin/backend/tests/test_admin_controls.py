"""Superadmin console hard-blocks for messaging channels + comm features."""
from datetime import datetime

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
async def test_superadmin_org_addon_grant_unlocks_all_org_events(ctx, monkeypatch):
    from app import entitlements
    from app.config import settings
    from app.models import Organization

    monkeypatch.setattr(settings, "organization_entitlements_v2", True)
    org_id = ctx.ids["org_a"]
    event_id = ctx.ids["event_a"]

    ctx.login(ctx.ids["superadmin"])
    response = await ctx.client.put(
        f"/api/admin/orgs/{org_id}/addon-overrides",
        json={"overrides": {"addon_engagement": True}},
    )
    assert response.status_code == 200
    assert response.json()["overrides"]["addon_engagement"] is True

    async with _Session() as session:
        org = await session.get(Organization, org_id)
        event = await session.get(Event, event_id)
        assert org.addon_overrides == {"addon_engagement": True}
        assert event.org_addon_overrides == {"addon_engagement": True}
        assert entitlements.event_allows_addon(event, "addon_engagement") is True


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


@pytest.mark.asyncio
async def test_accounts_dashboard_requires_superadmin(ctx):
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get("/api/admin/accounts/summary")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_accounts_dashboard_aggregates_per_org(ctx):
    from app.models import MessageCreditLedger, Organization

    ev = ctx.ids["event_a"]
    async with _Session() as s:
        obj = await s.get(Event, ev)
        obj.is_paid = True
        obj.event_type = "Wedding"
        obj.message_credits = 250
        await s.commit()
        # Two spend rows should sum to message_credits_spent for org_a.
        s.add_all([
            MessageCreditLedger(org_id=ctx.ids["org_a"], event_id=ev, action="spend", status="posted", credits=3, delta=-3),
            MessageCreditLedger(org_id=ctx.ids["org_a"], event_id=ev, action="spend", status="posted", credits=2, delta=-2),
            # A non-posted spend must NOT count.
            MessageCreditLedger(org_id=ctx.ids["org_a"], event_id=ev, action="spend", status="reserved", credits=99, delta=-99),
        ])
        # Give org_b a later created_at so newest-first ordering is unambiguous.
        org_b = await s.get(Organization, ctx.ids["org_b"])
        org_b.created_at = datetime(2030, 1, 1)
        await s.commit()

    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.get("/api/admin/accounts/summary")
    assert r.status_code == 200
    rows = r.json()
    assert [row["id"] for row in rows][:1] == [ctx.ids["org_b"]]  # newest first

    by_id = {row["id"]: row for row in rows}
    a = by_id[ctx.ids["org_a"]]
    assert a["owner_email"] == "alice@a.com"
    assert a["member_count"] == 1
    assert a["event_count"] == 1
    assert a["paid_event_count"] == 1
    assert a["event_types"] == ["Wedding"]
    assert a["message_credits_remaining"] == 250
    assert a["message_credits_spent"] == 5  # 3 + 2, reserved row excluded

    b = by_id[ctx.ids["org_b"]]
    assert b["owner_email"] == "bob@b.com"
    assert b["event_count"] == 0
    assert b["paid_event_count"] == 0
    assert b["event_types"] == []
    assert b["message_credits_spent"] == 0


@pytest.mark.asyncio
async def test_operator_grant_v2_lands_on_org_wallet(ctx, monkeypatch):
    """Regression: POST /admin/events/{id}/grant is the operator "comp" tool —
    the exact no-payment path that produced a live-prod bug where a comped
    event showed is_paid=True with credits, but add-ons stayed locked because
    apply_purchase() wrote only the legacy event fields and never touched the
    org's v2 entitlement columns that entitlements.event_allows_addon() reads
    once organization_entitlements_v2 is on."""
    from app.config import settings
    from app.models import Organization, PricingPlan
    from app import entitlements

    monkeypatch.setattr(settings, "organization_entitlements_v2", True)
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        s.add(PricingPlan(key="tier300", kind="tier", label="Tier 300", guest_cap=300, credits=1800))
        await s.commit()

    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.post(f"/api/admin/events/{ev}/grant", json={
        "tier": "tier300", "add_credits": 50,
    })
    assert r.status_code == 200

    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        obj = await s.get(Event, ev)
        assert org.event_pass_status == "active"
        assert org.event_pass_tier == "tier300"
        assert org.message_credit_units >= 500  # 50 credits * 10 units/credit
        assert obj.is_paid is True
        assert obj.guest_cap == 300

        await entitlements.reload_addon_policy_cache(s)
        assert entitlements.event_allows_addon(obj, "addon_seating") is True
