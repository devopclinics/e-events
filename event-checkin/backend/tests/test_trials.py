"""Trial-credit request flow: customer submits, operator resolves (comp reuse)."""
import pytest
from sqlalchemy import select

from conftest import _Session
from app.config import settings
from app.models import Event, Organization, PricingPlan, TrialRequest


async def _submit(ctx, **over):
    body = {"contact_name": "Alice", "phone": "+18325550100", "event_name": "Spring Gala",
            "guest_count": 120, "use_case": "Trying check-in"}
    body.update(over)
    return await ctx.client.post("/api/trial-requests", json=body)


@pytest.mark.asyncio
async def test_submit_and_list_mine(ctx):
    ctx.login(ctx.ids["user_a"])
    r = await _submit(ctx)
    assert r.status_code == 201
    assert r.json()["status"] == "pending"

    r = await ctx.client.get("/api/trial-requests/mine")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["event_name"] == "Spring Gala"
    assert r.json()[0]["phone"] == "+18325550100"


@pytest.mark.asyncio
async def test_one_open_request_per_org(ctx):
    ctx.login(ctx.ids["user_a"])
    assert (await _submit(ctx)).status_code == 201
    dup = await _submit(ctx)
    assert dup.status_code == 409


@pytest.mark.asyncio
async def test_operator_only_for_queue(ctx):
    ctx.login(ctx.ids["user_a"])           # org owner, not operator
    assert (await ctx.client.get("/api/admin/trial-requests")).status_code == 403


@pytest.mark.asyncio
async def test_operator_sees_org_name_and_email(ctx):
    ctx.login(ctx.ids["user_a"])
    await _submit(ctx)
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.get("/api/admin/trial-requests")
    assert r.status_code == 200
    row = r.json()[0]
    assert row["org_name"] == "Org A"
    assert row["requester_email"] == "alice@a.com"


@pytest.mark.asyncio
async def test_approve_comps_event(ctx, monkeypatch):
    # Pins the legacy (pre-v2) event-level credit path explicitly, since this
    # checkout's .env runs with organization_entitlements_v2=true by default —
    # see test_approve_comps_event_v2 for the v2-on equivalent.
    monkeypatch.setattr(settings, "organization_entitlements_v2", False)
    ctx.login(ctx.ids["user_a"])
    sub = (await _submit(ctx)).json()
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.post(
        f"/api/admin/trial-requests/{sub['id']}/resolve",
        json={"action": "approve", "event_id": ctx.ids["event_a"],
              "add_credits": 50, "note": "Welcome!"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "approved"

    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        assert (ev.message_credits or 0) >= 50

    # Already resolved → 409 on a second resolve
    again = await ctx.client.post(
        f"/api/admin/trial-requests/{sub['id']}/resolve", json={"action": "decline"})
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_org_level_grant_applies_to_next_event(ctx, monkeypatch):
    # Pins the legacy (pre-v2) path explicitly — see
    # test_org_level_grant_applies_to_next_event_v2 for the v2-on equivalent.
    monkeypatch.setattr(settings, "organization_entitlements_v2", False)
    # Org with a pending request but (for this grant) no targeted event → the
    # grant is stashed on the org and consumed by the next event created.
    ctx.login(ctx.ids["user_a"])
    sub = (await _submit(ctx)).json()
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.post(
        f"/api/admin/trial-requests/{sub['id']}/resolve",
        json={"action": "approve", "add_credits": 40, "note": "Enjoy"})
    assert r.json()["status"] == "approved"

    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        assert org.trial_credits == 40

    # Owner creates a new event → grant applied and cleared.
    ctx.login(ctx.ids["user_a"])
    ev = await ctx.client.post("/api/events", json={
        "name": "Trial Event", "event_date": "2026-09-01T18:00:00",
        "timezone": "America/New_York", "checkin_base_url": "http://x"})
    assert ev.status_code in (200, 201)
    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        new_ev = await s.get(Event, ev.json()["id"])
        assert org.trial_credits is None
        assert (new_ev.message_credits or 0) >= 40


@pytest.mark.asyncio
async def test_approve_comps_event_v2(ctx, monkeypatch):
    """Regression: under organization_entitlements_v2, comping a specific
    event must land on the ORG's wallet/pass, not the legacy event fields —
    apply_purchase() bypassed the v2 gate and left the org's entitlement
    columns untouched, so add-ons stayed locked despite a "successful" grant."""
    monkeypatch.setattr(settings, "organization_entitlements_v2", True)
    async with _Session() as s:
        s.add(PricingPlan(key="tier300", kind="tier", label="Tier 300", guest_cap=300, credits=1800))
        await s.commit()

    ctx.login(ctx.ids["user_a"])
    sub = (await _submit(ctx)).json()
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.post(
        f"/api/admin/trial-requests/{sub['id']}/resolve",
        json={"action": "approve", "event_id": ctx.ids["event_a"],
              "tier": "tier300", "add_credits": 50, "note": "Welcome!"},
    )
    assert r.status_code == 200

    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        ev = await s.get(Event, ctx.ids["event_a"])
        assert org.event_pass_status == "active"
        assert org.event_pass_tier == "tier300"
        assert org.message_credit_units >= 500  # 50 credits * 10 units/credit
        # Legacy fallback fields on the event must be kept in sync too —
        # entitlements.guest_limit() still reads event.is_paid/guest_cap.
        assert ev.is_paid is True
        assert ev.guest_cap == 300


@pytest.mark.asyncio
async def test_org_level_grant_applies_to_next_event_v2(ctx, monkeypatch):
    """Same regression as above, for the "no event yet — stash on the org"
    path consumed at the org's next event creation."""
    monkeypatch.setattr(settings, "organization_entitlements_v2", True)
    async with _Session() as s:
        s.add(PricingPlan(key="tier150", kind="tier", label="Tier 150", guest_cap=150, credits=900))
        await s.commit()

    ctx.login(ctx.ids["user_b"])
    sub = (await _submit(ctx)).json()
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.post(
        f"/api/admin/trial-requests/{sub['id']}/resolve",
        json={"action": "approve", "tier": "tier150", "add_credits": 40, "note": "Enjoy"})
    assert r.json()["status"] == "approved"

    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_b"])
        assert org.trial_tier == "tier150"
        assert org.trial_credits == 40
        assert org.event_pass_status == "free"  # not applied yet — stashed

    ctx.login(ctx.ids["user_b"])
    ev = await ctx.client.post("/api/events", json={
        "name": "Trial Event", "event_date": "2026-09-01T18:00:00",
        "timezone": "America/New_York", "checkin_base_url": "http://x"})
    assert ev.status_code in (200, 201)
    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_b"])
        new_ev = await s.get(Event, ev.json()["id"])
        assert org.trial_tier is None
        assert org.trial_credits is None
        assert org.event_pass_status == "active"
        assert org.event_pass_tier == "tier150"
        assert org.message_credit_units >= 400  # 40 credits * 10 units/credit
        assert new_ev.is_paid is True
        assert new_ev.guest_cap == 150


@pytest.mark.asyncio
async def test_decline(ctx):
    ctx.login(ctx.ids["user_a"])
    sub = (await _submit(ctx)).json()
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.post(
        f"/api/admin/trial-requests/{sub['id']}/resolve",
        json={"action": "decline", "note": "Out of scope"})
    assert r.json()["status"] == "declined"
