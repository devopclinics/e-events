"""Second batch of prod ports: table sort_order and walk-in registration."""
import pytest
from sqlalchemy import select, delete

from app.models import Event, Guest, TableGroup
from conftest import _Session


async def _paid_seating_active(event_id):
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.seating_enabled = True
        ev.status = "active"
        await s.execute(delete(Guest).where(Guest.event_id == event_id))
        await s.commit()


@pytest.mark.asyncio
async def test_tables_listed_by_sort_order(ctx):
    await _paid_seating_active(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    await ctx.client.post(f"/api/events/{ev}/tables", json={"name": "Zeta", "capacity": 4, "sort_order": 1})
    await ctx.client.post(f"/api/events/{ev}/tables", json={"name": "Alpha", "capacity": 4, "sort_order": 9})
    rows = (await ctx.client.get(f"/api/events/{ev}/tables")).json()
    # Sorted by sort_order (1 then 9), not name.
    assert [t["name"] for t in rows] == ["Zeta", "Alpha"]
    assert [t["sort_order"] for t in rows] == [1, 9]


@pytest.mark.asyncio
async def test_group_sort_order_and_table_orders(ctx):
    await _paid_seating_active(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    t1 = (await ctx.client.post(f"/api/events/{ev}/tables", json={"name": "T1", "capacity": 4})).json()
    grp = (await ctx.client.post(f"/api/events/{ev}/table-groups",
           json={"name": "VIP", "sort_order": 3, "table_ids": [t1["id"]],
                 "table_orders": {t1["id"]: 7}})).json()
    assert grp["sort_order"] == 3
    # The member table's sort_order was updated via table_orders.
    rows = (await ctx.client.get(f"/api/events/{ev}/tables")).json()
    assert next(t for t in rows if t["id"] == t1["id"])["sort_order"] == 7


@pytest.mark.asyncio
async def test_walk_in_register(ctx):
    await _paid_seating_active(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    t = (await ctx.client.post(f"/api/events/{ev}/tables", json={"name": "Walk-in 1", "capacity": 10})).json()
    grp = (await ctx.client.post(f"/api/events/{ev}/table-groups",
           json={"name": "Walk-ins", "table_ids": [t["id"]]})).json()

    # Off by default → register blocked.
    blocked = await ctx.client.post(f"/api/events/{ev}/guests/walk-in", json={"first_name": "Wendy"})
    assert blocked.status_code == 403

    # Enable + set group.
    assert (await ctx.client.patch(f"/api/events/{ev}/walk-in", json={"active": True})).status_code == 200
    assert (await ctx.client.patch(f"/api/events/{ev}/walk-in-group", json={"table_group_id": grp["id"]})).status_code == 200

    r = await ctx.client.post(f"/api/events/{ev}/guests/walk-in", json={"first_name": "Wendy", "last_name": "Walker"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "admitted"
    assert body["table_name"] == "Walk-in 1"      # seated within the walk-in group

    async with _Session() as s:
        g = await s.scalar(select(Guest).where(Guest.event_id == ev, Guest.first_name == "Wendy"))
    assert g.admitted is True
    assert g.assigned_table_group_id == grp["id"]  # auto-tagged to walk-in group
