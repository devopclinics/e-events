"""Manual (no-QR) check-in: superadmin toggle, search, and admit-by-id."""
import pytest
from sqlalchemy import select, delete

from app.models import Event, Guest, Membership, User
from conftest import _Session


async def _prep(event_id, *, manual=True):
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.status = "active"
        ev.manual_checkin_enabled = manual
        await s.execute(delete(Guest).where(Guest.event_id == event_id))  # clean seeded guest
        await s.commit()


async def _add(ctx, ev, first, last, phone=None):
    return (await ctx.client.post(f"/api/events/{ev}/guests",
            json={"first_name": first, "last_name": last, "phone": phone})).json()


@pytest.mark.asyncio
async def test_toggle_requires_superadmin(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])      # org owner, not platform superadmin
    r = await ctx.client.patch(f"/api/admin/events/{ev}/manual-checkin", json={"active": True})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_superadmin_can_toggle(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.patch(f"/api/admin/events/{ev}/manual-checkin", json={"active": True})
    assert r.status_code == 200 and r.json()["manual_checkin_enabled"] is True
    async with _Session() as s:
        assert (await s.get(Event, ev)).manual_checkin_enabled is True


@pytest.mark.asyncio
async def test_search_blocked_when_disabled(ctx):
    await _prep(ctx.ids["event_a"], manual=False)
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests/search?q=smith")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_search_matches_name_and_phone(ctx):
    await _prep(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    await _add(ctx, ev, "John", "Smith", "+18325550111")
    await _add(ctx, ev, "Jane", "Doe", "+18325559999")

    # by last name
    r = await ctx.client.get(f"/api/events/{ev}/guests/search?q=smit")
    assert r.status_code == 200
    names = [g["full_name"] for g in r.json()]
    assert names == ["John Smith"]
    assert r.json()[0]["phone_masked"].endswith("0111")
    assert "•" in r.json()[0]["phone_masked"]   # masked, not full number

    # by full name fragment
    r2 = await ctx.client.get(f"/api/events/{ev}/guests/search?q=john sm")
    assert [g["full_name"] for g in r2.json()] == ["John Smith"]

    # by phone fragment
    r3 = await ctx.client.get(f"/api/events/{ev}/guests/search?q=9999")
    assert [g["full_name"] for g in r3.json()] == ["Jane Doe"]

    # too short → empty
    assert (await ctx.client.get(f"/api/events/{ev}/guests/search?q=a")).json() == []


@pytest.mark.asyncio
async def test_manual_checkin_admits_then_already(ctx):
    await _prep(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    g = await _add(ctx, ev, "Mark", "Lee", "+18325550000")

    r1 = await ctx.client.post(f"/api/events/{ev}/guests/{g['id']}/checkin")
    assert r1.status_code == 200 and r1.json()["status"] == "admitted"

    r2 = await ctx.client.post(f"/api/events/{ev}/guests/{g['id']}/checkin")
    assert r2.json()["status"] == "already_admitted"

    # And the search now flags them admitted.
    s = await ctx.client.get(f"/api/events/{ev}/guests/search?q=lee")
    assert s.json()[0]["admitted"] is True


@pytest.mark.asyncio
async def test_manual_checkin_blocked_when_disabled(ctx):
    await _prep(ctx.ids["event_a"], manual=False)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    g = await _add(ctx, ev, "No", "Manual")
    r = await ctx.client.post(f"/api/events/{ev}/guests/{g['id']}/checkin")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_unassigned_staff_cannot_search(ctx):
    await _prep(ctx.ids["event_a"])
    # Staff member of org A but NOT assigned to the event.
    async with _Session() as s:
        staff = User(name="Sam", email="sam@a.com", role="official")
        s.add(staff); await s.flush()
        s.add(Membership(org_id=ctx.ids["org_a"], user_id=staff.id, role="staff"))
        await s.commit()
        staff_obj = staff
    ctx.login(staff_obj)
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests/search?q=smith")
    assert r.status_code == 403
