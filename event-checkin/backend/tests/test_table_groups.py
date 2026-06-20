"""Table Groups: CRUD, guest assignment, import mapping, and seating/scanner
enforcement. Uses the superadmin login to bypass tenant guards so tests focus on
feature behavior."""
import pytest

from app.models import Event, Guest, TableGroup
from conftest import _Session


async def _paid_seating_event(event_id, *, active=False):
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.seating_enabled = True
        ev.enforce_table_groups = True
        if active:
            ev.status = "active"
        await s.commit()


async def _make_table(ctx, event_id, name, capacity=2):
    r = await ctx.client.post(f"/api/events/{event_id}/tables",
                              json={"name": name, "capacity": capacity, "category": None})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_group_crud_and_tag_uniqueness(ctx):
    await _paid_seating_event(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    t1 = await _make_table(ctx, ev, "T1")
    created = await ctx.client.post(f"/api/events/{ev}/table-groups",
                                    json={"name": "VIP Tables", "tag": "VIP", "table_ids": [t1]})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["tag"] == "VIP"
    assert body["table_ids"] == [t1]
    assert body["total_seats"] == 2

    dup = await ctx.client.post(f"/api/events/{ev}/table-groups",
                                json={"name": "Other", "tag": " vip "})
    assert dup.status_code == 409

    listing = await ctx.client.get(f"/api/events/{ev}/table-groups")
    assert listing.status_code == 200
    assert len(listing.json()) == 1


@pytest.mark.asyncio
async def test_table_belongs_to_one_group(ctx):
    await _paid_seating_event(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    t1 = await _make_table(ctx, ev, "T1")

    g1 = (await ctx.client.post(f"/api/events/{ev}/table-groups",
                                json={"name": "A", "table_ids": [t1]})).json()
    g2 = await ctx.client.post(f"/api/events/{ev}/table-groups",
                               json={"name": "B", "table_ids": [t1]})
    assert g2.status_code == 409


@pytest.mark.asyncio
async def test_delete_blocked_while_guests_assigned(ctx):
    await _paid_seating_event(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    grp = (await ctx.client.post(f"/api/events/{ev}/table-groups", json={"name": "VIP"})).json()

    guest = (await ctx.client.post(f"/api/events/{ev}/guests",
             json={"first_name": "Vi", "last_name": "Pee", "assigned_table_group_id": grp["id"]})).json()
    assert guest["assigned_table_group_id"] == grp["id"]

    blocked = await ctx.client.delete(f"/api/events/{ev}/table-groups/{grp['id']}")
    assert blocked.status_code == 409

    # Reassign (clear) then delete succeeds.
    await ctx.client.post(f"/api/events/{ev}/guests/bulk-assign-group",
                          json={"guest_ids": [guest["id"]], "table_group_id": None})
    ok = await ctx.client.delete(f"/api/events/{ev}/table-groups/{grp['id']}")
    assert ok.status_code == 204


@pytest.mark.asyncio
async def test_bulk_assign_and_listing_shows_name(ctx):
    await _paid_seating_event(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    grp = (await ctx.client.post(f"/api/events/{ev}/table-groups", json={"name": "Family"})).json()
    g = (await ctx.client.post(f"/api/events/{ev}/guests",
         json={"first_name": "Fam", "last_name": "Ily"})).json()

    res = await ctx.client.post(f"/api/events/{ev}/guests/bulk-assign-group",
                                json={"guest_ids": [g["id"]], "table_group_id": grp["id"]})
    assert res.status_code == 200 and res.json()["updated"] == 1

    guests = (await ctx.client.get(f"/api/events/{ev}/guests")).json()
    me = next(x for x in guests if x["id"] == g["id"])
    assert me["assigned_table_group_id"] == grp["id"]
    assert me["table_group_name"] == "Family"


@pytest.mark.asyncio
async def test_import_maps_and_autocreates_group(ctx):
    await _paid_seating_event(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    csv = "first_name,last_name,table_group\nAda,Lovelace,Sponsor Tables\n"
    r = await ctx.client.post(
        f"/api/events/{ev}/guests/upload",
        files={"file": ("guests.csv", csv, "text/csv")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("table_groups_created") == 1
    assert body.get("table_groups_assigned") == 1

    async with _Session() as s:
        grp = await s.scalar(TableGroup.__table__.select().where(TableGroup.event_id == ev))
    assert grp is not None


@pytest.mark.asyncio
async def test_manual_seat_outside_group_rejected(ctx):
    await _paid_seating_event(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    in_table = await _make_table(ctx, ev, "VIP-1")
    out_table = await _make_table(ctx, ev, "GA-1")
    grp = (await ctx.client.post(f"/api/events/{ev}/table-groups",
           json={"name": "VIP", "table_ids": [in_table]})).json()
    g = (await ctx.client.post(f"/api/events/{ev}/guests",
         json={"first_name": "V", "last_name": "I", "assigned_table_group_id": grp["id"]})).json()

    bad = await ctx.client.patch(f"/api/events/{ev}/guests/{g['id']}/seat",
                                 json={"table_id": out_table, "seat_number": "1"})
    assert bad.status_code == 409
    assert "cannot be seated" in bad.json()["detail"]

    good = await ctx.client.patch(f"/api/events/{ev}/guests/{g['id']}/seat",
                                  json={"table_id": in_table, "seat_number": "1"})
    assert good.status_code == 200


@pytest.mark.asyncio
async def test_scan_seats_within_group_only(ctx):
    await _paid_seating_event(ctx.ids["event_a"], active=True)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    in_table = await _make_table(ctx, ev, "VIP-1", capacity=1)
    _out = await _make_table(ctx, ev, "GA-1", capacity=10)
    grp = (await ctx.client.post(f"/api/events/{ev}/table-groups",
           json={"name": "VIP", "table_ids": [in_table]})).json()

    # First grouped guest seats inside the group.
    g1 = (await ctx.client.post(f"/api/events/{ev}/guests",
          json={"first_name": "A", "last_name": "One", "assigned_table_group_id": grp["id"]})).json()
    r1 = await ctx.client.post(f"/api/scan/{g1['qr_token']}")
    assert r1.status_code == 200 and r1.json()["status"] == "admitted"
    assert r1.json()["table_name"] == "VIP-1"

    # Group is now full (capacity 1) → second grouped guest is denied, NOT
    # seated at the GA table outside their group.
    g2 = (await ctx.client.post(f"/api/events/{ev}/guests",
          json={"first_name": "B", "last_name": "Two", "assigned_table_group_id": grp["id"]})).json()
    r2 = await ctx.client.post(f"/api/scan/{g2['qr_token']}")
    assert r2.status_code == 200 and r2.json()["status"] == "denied"
    assert "capacity reached" in r2.json()["message"]


@pytest.mark.asyncio
async def test_ungrouped_guest_unaffected(ctx):
    await _paid_seating_event(ctx.ids["event_a"], active=True)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    only_table = await _make_table(ctx, ev, "GA-1", capacity=5)
    # A group exists but this guest isn't in it — default seating applies.
    await ctx.client.post(f"/api/events/{ev}/table-groups", json={"name": "VIP"})

    g = (await ctx.client.post(f"/api/events/{ev}/guests",
         json={"first_name": "Free", "last_name": "Bird"})).json()
    r = await ctx.client.post(f"/api/scan/{g['qr_token']}")
    assert r.status_code == 200 and r.json()["status"] == "admitted"
    assert r.json()["table_name"] == "GA-1"
