"""Superadmin-only 'reset event data' — selective, FK-safe wipes that keep the
event record + settings."""
import pytest
from sqlalchemy import select, func, delete

from app.models import Event, Guest, ScanEvent, TableGroup, SeatingTable
from conftest import _Session


async def _paid_seating_active(event_id):
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.seating_enabled = True
        ev.status = "active"
        # conftest seeds one guest; start reset tests from a clean slate.
        await s.execute(delete(Guest).where(Guest.event_id == event_id))
        await s.commit()


async def _count(model, *where):
    async with _Session() as s:
        return int(await s.scalar(select(func.count()).select_from(model).where(*where)) or 0)


@pytest.mark.asyncio
async def test_reset_requires_superadmin(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])   # org owner, NOT a platform superadmin
    r = await ctx.client.post(f"/api/admin/events/{ev}/reset", json={"guests": True})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_reset_checkins_keeps_guests(ctx):
    await _paid_seating_active(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    await ctx.client.post(f"/api/events/{ev}/tables", json={"name": "T1", "capacity": 5})
    g = (await ctx.client.post(f"/api/events/{ev}/guests", json={"first_name": "A", "last_name": "B"})).json()
    scan = await ctx.client.post(f"/api/scan/{g['qr_token']}")
    assert scan.json()["status"] == "admitted"

    r = await ctx.client.post(f"/api/admin/events/{ev}/reset", json={"checkins": True})
    assert r.status_code == 200
    # Guest kept, but no longer admitted.
    assert await _count(Guest, Guest.event_id == ev) == 1
    async with _Session() as s:
        guest = await s.scalar(select(Guest).where(Guest.id == g["id"]))
    assert guest.admitted is False


@pytest.mark.asyncio
async def test_reset_guests_wipes_guests_only(ctx):
    await _paid_seating_active(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    grp = (await ctx.client.post(f"/api/events/{ev}/table-groups", json={"name": "VIP"})).json()
    await ctx.client.post(f"/api/events/{ev}/guests",
                          json={"first_name": "G", "last_name": "One", "assigned_table_group_id": grp["id"]})

    r = await ctx.client.post(f"/api/admin/events/{ev}/reset", json={"guests": True})
    assert r.status_code == 200
    assert await _count(Guest, Guest.event_id == ev) == 0
    # Table group kept (not selected for reset).
    assert await _count(TableGroup, TableGroup.event_id == ev) == 1


@pytest.mark.asyncio
async def test_reset_everything_seating(ctx):
    await _paid_seating_active(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    t = (await ctx.client.post(f"/api/events/{ev}/tables", json={"name": "T1", "capacity": 2})).json()
    grp = (await ctx.client.post(f"/api/events/{ev}/table-groups",
           json={"name": "VIP", "table_ids": [t["id"]]})).json()
    await ctx.client.post(f"/api/events/{ev}/guests",
                          json={"first_name": "G", "last_name": "One", "assigned_table_group_id": grp["id"]})

    r = await ctx.client.post(f"/api/admin/events/{ev}/reset",
                              json={"guests": True, "table_groups": True, "tables": True, "checkins": True})
    assert r.status_code == 200
    assert await _count(Guest, Guest.event_id == ev) == 0
    assert await _count(TableGroup, TableGroup.event_id == ev) == 0
    assert await _count(SeatingTable, SeatingTable.event_id == ev) == 0
    # Event itself survives.
    async with _Session() as s:
        assert await s.get(Event, ev) is not None


@pytest.mark.asyncio
async def test_reset_assignments_only_keeps_guest_and_group(ctx):
    await _paid_seating_active(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    grp = (await ctx.client.post(f"/api/events/{ev}/table-groups", json={"name": "VIP"})).json()
    g = (await ctx.client.post(f"/api/events/{ev}/guests",
         json={"first_name": "G", "last_name": "One", "assigned_table_group_id": grp["id"]})).json()

    r = await ctx.client.post(f"/api/admin/events/{ev}/reset", json={"group_assignments": True})
    assert r.status_code == 200
    assert await _count(Guest, Guest.event_id == ev) == 1       # guest kept
    assert await _count(TableGroup, TableGroup.event_id == ev) == 1  # group kept
    async with _Session() as s:
        guest = await s.scalar(select(Guest).where(Guest.id == g["id"]))
    assert guest.assigned_table_group_id is None               # only the assignment cleared
