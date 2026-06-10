"""Trial-credit request flow: customer submits, operator resolves (comp reuse)."""
import pytest
from sqlalchemy import select

from conftest import _Session
from app.models import Event, Organization, TrialRequest


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
async def test_approve_comps_event(ctx):
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
async def test_org_level_grant_applies_to_next_event(ctx):
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
        "checkin_base_url": "http://x"})
    assert ev.status_code in (200, 201)
    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        new_ev = await s.get(Event, ev.json()["id"])
        assert org.trial_credits is None
        assert (new_ev.message_credits or 0) >= 40


@pytest.mark.asyncio
async def test_decline(ctx):
    ctx.login(ctx.ids["user_a"])
    sub = (await _submit(ctx)).json()
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.post(
        f"/api/admin/trial-requests/{sub['id']}/resolve",
        json={"action": "decline", "note": "Out of scope"})
    assert r.json()["status"] == "declined"
