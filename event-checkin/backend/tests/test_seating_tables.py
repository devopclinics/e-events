import pytest

from app.models import Event
from conftest import _Session


@pytest.mark.asyncio
async def test_create_table_rejects_duplicate_name_for_event(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        await s.commit()

    ctx.login(ctx.ids["user_a"])

    first = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/tables",
        json={"name": "Table 1", "capacity": 8, "category": None},
    )
    assert first.status_code == 201

    duplicate = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/tables",
        json={"name": "  table   1  ", "capacity": 10, "category": None},
    )
    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["detail"]


@pytest.mark.asyncio
async def test_update_table_rejects_duplicate_name_for_event(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        await s.commit()

    ctx.login(ctx.ids["user_a"])

    first = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/tables",
        json={"name": "Head Table", "capacity": 8, "category": None},
    )
    second = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/tables",
        json={"name": "Family Table", "capacity": 8, "category": None},
    )
    assert first.status_code == 201
    assert second.status_code == 201

    duplicate = await ctx.client.put(
        f"/api/events/{ctx.ids['event_a']}/tables/{second.json()['id']}",
        json={"name": "head table", "capacity": 8, "category": None},
    )
    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["detail"]
