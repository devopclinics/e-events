"""Public API v2: tables + table groups. Mirrors test_seating_tables.py/
test_table_groups.py's own assertions (uniqueness, occupancy blocks) but
through the X-API-Key surface: org-scoping 404s, event.is_paid 402 gate
(seating is itself a paid module, so both reads and writes are gated), and
read-write scope enforcement (403 for a read-only key)."""
import pytest
from sqlalchemy import select

from app.models import Event, Guest, Organization, SeatingTable, TableGroup, WebhookDelivery
from conftest import _Session


async def _mint_key(ctx, owner) -> str:
    ctx.login(owner)
    created = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "Test key"})
    return created.json()["key"]


async def _mint_read_write_key(ctx, owner, org_id) -> str:
    async with _Session() as s:
        org = await s.get(Organization, org_id)
        org.subscription_status = "active"
        await s.commit()
    ctx.login(owner)
    created = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "RW key", "scope": "read_write"})
    assert created.status_code == 201, created.text
    return created.json()["key"]


async def _mark_paid(event_id: str):
    async with _Session() as s:
        event = await s.get(Event, event_id)
        event.is_paid = True
        event.plan_tier = "tier150"
        await s.commit()


@pytest.mark.asyncio
async def test_tables_require_event_is_paid(ctx):
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ev = ctx.ids["event_a"]
    ctx.login(None)
    r = await ctx.client.get(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a})
    assert r.status_code == 402

    await _mark_paid(ev)
    r2 = await ctx.client.get(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a})
    assert r2.status_code == 200
    assert r2.json() == []


@pytest.mark.asyncio
async def test_read_only_key_can_list_but_not_create_tables(ctx):
    ev = ctx.ids["event_a"]
    await _mark_paid(ev)
    key_a = await _mint_key(ctx, ctx.ids["user_a"])
    ctx.login(None)
    ok = await ctx.client.get(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a})
    assert ok.status_code == 200
    denied = await ctx.client.post(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a},
                                    json={"name": "Head Table", "capacity": 8})
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_read_write_key_creates_updates_and_deletes_table(ctx):
    ev = ctx.ids["event_a"]
    await _mark_paid(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)

    created = await ctx.client.post(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a},
                                     json={"name": "Head Table", "capacity": 8, "category": "VIP"})
    assert created.status_code == 201, created.text
    table_id = created.json()["id"]
    assert created.json()["capacity"] == 8
    assert "pos_x" not in created.json()   # floor-plan fields deliberately excluded

    updated = await ctx.client.patch(f"/api/public/v1/tables/{table_id}", headers={"X-API-Key": key_a},
                                      json={"capacity": 10})
    assert updated.status_code == 200
    assert updated.json()["capacity"] == 10

    deleted = await ctx.client.delete(f"/api/public/v1/tables/{table_id}", headers={"X-API-Key": key_a})
    assert deleted.status_code == 204
    async with _Session() as s:
        assert await s.get(SeatingTable, table_id) is None


@pytest.mark.asyncio
async def test_duplicate_table_name_409s(ctx):
    ev = ctx.ids["event_a"]
    await _mark_paid(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    await ctx.client.post(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a},
                           json={"name": "Table 1", "capacity": 8})
    dup = await ctx.client.post(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a},
                                 json={"name": "table 1", "capacity": 6})
    assert dup.status_code == 409


@pytest.mark.asyncio
async def test_table_from_other_org_404s(ctx):
    ev = ctx.ids["event_a"]
    await _mark_paid(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    created = await ctx.client.post(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a},
                                     json={"name": "Table 1", "capacity": 8})
    table_id = created.json()["id"]

    key_b = await _mint_read_write_key(ctx, ctx.ids["user_b"], ctx.ids["org_b"])
    ctx.login(None)
    r = await ctx.client.patch(f"/api/public/v1/tables/{table_id}", headers={"X-API-Key": key_b}, json={"capacity": 2})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_table_create_fires_webhook(ctx):
    ev = ctx.ids["event_a"]
    await _mark_paid(ev)
    ctx.login(ctx.ids["user_a"])
    await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "https://example.com/hook", "event_types": ["table.created"],
    })
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    r = await ctx.client.post(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a},
                               json={"name": "Table 1", "capacity": 8})
    assert r.status_code == 201
    async with _Session() as s:
        rows = (await s.execute(select(WebhookDelivery))).scalars().all()
        assert any(row.event_type == "table.created" for row in rows)


@pytest.mark.asyncio
async def test_table_groups_crud_and_membership(ctx):
    ev = ctx.ids["event_a"]
    await _mark_paid(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)

    t1 = (await ctx.client.post(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a},
                                 json={"name": "A", "capacity": 4})).json()
    t2 = (await ctx.client.post(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a},
                                 json={"name": "B", "capacity": 4})).json()

    created = await ctx.client.post(f"/api/public/v1/events/{ev}/table-groups", headers={"X-API-Key": key_a},
                                     json={"name": "Family", "table_ids": [t1["id"]]})
    assert created.status_code == 201, created.text
    group_id = created.json()["id"]
    assert created.json()["table_ids"] == [t1["id"]]
    assert created.json()["total_seats"] == 4

    updated = await ctx.client.put(f"/api/public/v1/table-groups/{group_id}/tables", headers={"X-API-Key": key_a},
                                    json={"table_ids": [t1["id"], t2["id"]]})
    assert updated.status_code == 200
    assert set(updated.json()["table_ids"]) == {t1["id"], t2["id"]}
    assert updated.json()["total_seats"] == 8


@pytest.mark.asyncio
async def test_table_belongs_to_one_group_409(ctx):
    ev = ctx.ids["event_a"]
    await _mark_paid(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    t1 = (await ctx.client.post(f"/api/public/v1/events/{ev}/tables", headers={"X-API-Key": key_a},
                                 json={"name": "A", "capacity": 4})).json()
    await ctx.client.post(f"/api/public/v1/events/{ev}/table-groups", headers={"X-API-Key": key_a},
                           json={"name": "Group 1", "table_ids": [t1["id"]]})
    dup = await ctx.client.post(f"/api/public/v1/events/{ev}/table-groups", headers={"X-API-Key": key_a},
                                 json={"name": "Group 2", "table_ids": [t1["id"]]})
    assert dup.status_code == 409


@pytest.mark.asyncio
async def test_table_group_delete_blocked_while_guest_assigned(ctx):
    ev = ctx.ids["event_a"]
    await _mark_paid(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    created = await ctx.client.post(f"/api/public/v1/events/{ev}/table-groups", headers={"X-API-Key": key_a},
                                     json={"name": "Family"})
    group_id = created.json()["id"]

    async with _Session() as s:
        rows = (await s.execute(select(Guest).where(Guest.event_id == ev))).scalars().all()
        guest = rows[0]
        guest.assigned_table_group_id = group_id
        await s.commit()

    blocked = await ctx.client.delete(f"/api/public/v1/table-groups/{group_id}", headers={"X-API-Key": key_a})
    assert blocked.status_code == 409

    async with _Session() as s:
        guest = await s.get(Guest, guest.id)
        guest.assigned_table_group_id = None
        await s.commit()

    ok = await ctx.client.delete(f"/api/public/v1/table-groups/{group_id}", headers={"X-API-Key": key_a})
    assert ok.status_code == 204
    async with _Session() as s:
        assert await s.get(TableGroup, group_id) is None
