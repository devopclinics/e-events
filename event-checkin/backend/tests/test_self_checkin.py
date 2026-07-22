"""Public event-code self check-in."""
import pytest
from sqlalchemy import delete

from app.models import Event, Guest, SeatingTable
from conftest import _Session


async def _prep(event_id, *, enabled=True, code="RHOEDA25", active=True):
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.plan_tier = "tier300"
        ev.status = "active" if active else "draft"
        ev.self_checkin_enabled = enabled
        ev.event_code = code
        ev.seating_enabled = True
        await s.execute(delete(Guest).where(Guest.event_id == event_id))
        await s.execute(delete(SeatingTable).where(SeatingTable.event_id == event_id))
        table = SeatingTable(event_id=event_id, name="Aso Rock", capacity=4)
        s.add(table)
        await s.commit()


async def _add(ctx, ev, first, last, phone=None):
    return (await ctx.client.post(
        f"/api/events/{ev}/guests",
        json={"first_name": first, "last_name": last, "phone": phone},
    )).json()


@pytest.mark.asyncio
async def test_admin_toggle_generates_code(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.is_paid = True
        event.plan_tier = "tier300"
        event.event_code = None
        event.self_checkin_enabled = False
        await s.commit()

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.patch(f"/api/events/{ev}/self-checkin", json={"active": True})
    assert r.status_code == 200
    body = r.json()
    assert body["self_checkin_enabled"] is True
    assert len(body["event_code"]) == 8
    assert not set(body["event_code"]) & set("0O1IL")


@pytest.mark.asyncio
async def test_public_info_blocks_disabled_or_inactive(ctx):
    ev = ctx.ids["event_a"]
    await _prep(ev, enabled=False, active=True)
    assert (await ctx.client.get("/api/e/RHOEDA25")).json()["status"] == "invalid"

    await _prep(ev, enabled=True, active=False)
    body = (await ctx.client.get("/api/e/RHOEDA25")).json()
    assert body["status"] == "not_active"
    assert body["name"] == "A Wedding"


@pytest.mark.asyncio
async def test_search_is_limited_and_name_only(ctx):
    ev = ctx.ids["event_a"]
    await _prep(ev)
    ctx.login(ctx.ids["user_a"])
    for i in range(7):
        await _add(ctx, ev, f"Jane{i}", "Smith", f"+1832555000{i}")

    r = await ctx.client.post("/api/e/RHOEDA25/search", json={"query": "smith"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert len(body["guests"]) == 5
    assert set(body["guests"][0].keys()) == {"id", "name"}


@pytest.mark.asyncio
async def test_checkin_admits_with_seat_then_reports_already_time(ctx):
    ev = ctx.ids["event_a"]
    await _prep(ev)
    ctx.login(ctx.ids["user_a"])
    guest = await _add(ctx, ev, "John", "Smith", "+18325550111")

    r1 = await ctx.client.post(f"/api/e/RHOEDA25/checkin/{guest['id']}")
    assert r1.status_code == 200
    body1 = r1.json()
    assert body1["status"] == "admitted"
    assert body1["admitted_guest"] == "John Smith"
    assert body1["table_name"] == "Aso Rock"
    assert body1["seat_number"] == "1"

    r2 = await ctx.client.post(f"/api/e/RHOEDA25/checkin/{guest['id']}")
    body2 = r2.json()
    assert body2["status"] == "already_admitted"
    assert body2["admitted_at"]


@pytest.mark.asyncio
async def test_checkin_requires_code_guest_pair(ctx):
    ev = ctx.ids["event_a"]
    await _prep(ev)
    ctx.login(ctx.ids["user_a"])
    guest = await _add(ctx, ev, "Wrong", "Code")

    r = await ctx.client.post(f"/api/e/BADCODE/checkin/{guest['id']}")
    assert r.status_code == 200
    assert r.json()["status"] == "invalid"
