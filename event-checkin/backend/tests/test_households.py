"""Family/household contact grouping (Gatsby gap-backlog item): CRUD + bulk
guest assignment, independent of TableGroup (seating) and works regardless of
how a guest was added (manual, CSV, self-service RSVP)."""
import pytest

from app.models import Event, Guest, Household
from conftest import _Session


async def _guest(ctx, event_id, first_name, last_name="G"):
    r = await ctx.client.post(f"/api/events/{event_id}/guests",
                              json={"first_name": first_name, "last_name": last_name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_household_crud(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    created = await ctx.client.post(f"/api/events/{ev}/households", json={"name": "The Smiths"})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "The Smiths"
    assert body["member_count"] == 0
    hid = body["id"]

    renamed = await ctx.client.put(f"/api/events/{ev}/households/{hid}", json={"name": "The Smith Family"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "The Smith Family"

    listing = await ctx.client.get(f"/api/events/{ev}/households")
    assert listing.status_code == 200
    assert len(listing.json()) == 1

    deleted = await ctx.client.delete(f"/api/events/{ev}/households/{hid}")
    assert deleted.status_code == 204
    listing2 = await ctx.client.get(f"/api/events/{ev}/households")
    assert listing2.json() == []


@pytest.mark.asyncio
async def test_household_requires_nonempty_name(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    r = await ctx.client.post(f"/api/events/{ev}/households", json={"name": "   "})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_cannot_delete_household_with_members(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    hid = (await ctx.client.post(f"/api/events/{ev}/households", json={"name": "The Smiths"})).json()["id"]
    gid = await _guest(ctx, ev, "Ada")
    assign = await ctx.client.post(f"/api/events/{ev}/guests/bulk-assign-household",
                                    json={"guest_ids": [gid], "household_id": hid})
    assert assign.status_code == 200
    assert assign.json()["updated"] == 1

    delete = await ctx.client.delete(f"/api/events/{ev}/households/{hid}")
    assert delete.status_code == 409


@pytest.mark.asyncio
async def test_bulk_assign_and_clear_household_works_regardless_of_how_guest_was_added(ctx):
    """Covers a manually-added guest AND one created via self-service RSVP —
    household grouping must work for both, unlike rsvp_submitter_* which only
    applies to multi-invitee RSVP submissions."""
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        e = await s.get(Event, ev)
        e.rsvp_enabled = True
        e.invite_mode = "open"
        await s.commit()

    manual_id = await _guest(ctx, ev, "Manual")
    rsvp = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "SelfReg", "last_name": "Guest", "email": "selfreg@x.com",
    })
    assert rsvp.status_code == 201
    rsvp_guest_id = rsvp.json()["id"]

    hid = (await ctx.client.post(f"/api/events/{ev}/households", json={"name": "The Household"})).json()["id"]
    assign = await ctx.client.post(f"/api/events/{ev}/guests/bulk-assign-household",
                                    json={"guest_ids": [manual_id, rsvp_guest_id], "household_id": hid})
    assert assign.status_code == 200
    assert assign.json()["updated"] == 2

    listed = await ctx.client.get(f"/api/events/{ev}/households")
    assert listed.json()[0]["member_count"] == 2

    guests = (await ctx.client.get(f"/api/events/{ev}/guests")).json()
    by_id = {g["id"]: g for g in guests}
    assert by_id[manual_id]["household_name"] == "The Household"
    assert by_id[rsvp_guest_id]["household_name"] == "The Household"

    # Clear assignment for one guest.
    clear = await ctx.client.post(f"/api/events/{ev}/guests/bulk-assign-household",
                                   json={"guest_ids": [manual_id], "household_id": None})
    assert clear.status_code == 200
    async with _Session() as s:
        g = await s.get(Guest, manual_id)
        assert g.household_id is None


@pytest.mark.asyncio
async def test_household_default_seating_auto_applies_on_assignment(ctx):
    """A household's default table group/table is a one-time suggestion applied
    when a guest is assigned to it — not a live link."""
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        e = await s.get(Event, ev)
        e.is_paid = True
        await s.commit()

    group = await ctx.client.post(f"/api/events/{ev}/table-groups", json={"name": "VIP"})
    group_id = group.json()["id"]
    table = await ctx.client.post(f"/api/events/{ev}/tables", json={"name": "T1", "capacity": 4})
    table_id = table.json()["id"]

    household = await ctx.client.post(f"/api/events/{ev}/households", json={
        "name": "The Smiths", "default_table_group_id": group_id, "default_table_id": table_id,
    })
    assert household.status_code == 201, household.text
    hid = household.json()["id"]
    assert household.json()["default_table_group_id"] == group_id
    assert household.json()["default_table_id"] == table_id

    gid = await _guest(ctx, ev, "Ada")
    assign = await ctx.client.post(f"/api/events/{ev}/guests/bulk-assign-household",
                                    json={"guest_ids": [gid], "household_id": hid})
    assert assign.status_code == 200

    async with _Session() as s:
        g = await s.get(Guest, gid)
        assert g.assigned_table_group_id == group_id
        assert g.table_id == table_id

    # Removing from the household afterward must NOT undo the seating — it was
    # a one-time default, not a live link.
    clear = await ctx.client.post(f"/api/events/{ev}/guests/bulk-assign-household",
                                   json={"guest_ids": [gid], "household_id": None})
    assert clear.status_code == 200
    async with _Session() as s:
        g = await s.get(Guest, gid)
        assert g.household_id is None
        assert g.assigned_table_group_id == group_id
        assert g.table_id == table_id


@pytest.mark.asyncio
async def test_household_default_seating_does_not_override_existing_assignment(ctx):
    """If a guest already has explicit seating, the household default must not
    clobber it."""
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        e = await s.get(Event, ev)
        e.is_paid = True
        await s.commit()

    other_group = await ctx.client.post(f"/api/events/{ev}/table-groups", json={"name": "General"})
    other_group_id = other_group.json()["id"]
    default_group = await ctx.client.post(f"/api/events/{ev}/table-groups", json={"name": "VIP"})
    default_group_id = default_group.json()["id"]

    household = await ctx.client.post(f"/api/events/{ev}/households", json={
        "name": "The Smiths", "default_table_group_id": default_group_id,
    })
    hid = household.json()["id"]

    gid = await _guest(ctx, ev, "Ada")
    await ctx.client.post(f"/api/events/{ev}/guests/bulk-assign-group",
                          json={"guest_ids": [gid], "table_group_id": other_group_id})

    await ctx.client.post(f"/api/events/{ev}/guests/bulk-assign-household",
                          json={"guest_ids": [gid], "household_id": hid})

    async with _Session() as s:
        g = await s.get(Guest, gid)
        assert g.assigned_table_group_id == other_group_id   # untouched


@pytest.mark.asyncio
async def test_household_rejects_seating_defaults_from_other_event(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev_a = ctx.ids["event_a"]
    async with _Session() as s:
        from datetime import datetime as dt
        other_event = Event(org_id=ctx.ids["org_b"], name="Other", couples_name="Other", event_date=dt(2026, 9, 1), checkin_base_url="http://x")
        s.add(other_event)
        await s.commit()
        foreign_event_id = other_event.id

    foreign_group = await ctx.client.post(f"/api/events/{foreign_event_id}/table-groups", json={"name": "Foreign"})
    assert foreign_group.status_code == 201
    foreign_group_id = foreign_group.json()["id"]

    r = await ctx.client.post(f"/api/events/{ev_a}/households", json={
        "name": "The Smiths", "default_table_group_id": foreign_group_id,
    })
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_household_is_independent_of_table_group(ctx):
    """A guest can belong to a household and a seating table group at the same
    time — the two concepts don't interfere."""
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        e = await s.get(Event, ev)
        e.is_paid = True
        await s.commit()

    gid = await _guest(ctx, ev, "Ada")
    hid = (await ctx.client.post(f"/api/events/{ev}/households", json={"name": "The Household"})).json()["id"]
    group = await ctx.client.post(f"/api/events/{ev}/table-groups", json={"name": "VIP"})
    assert group.status_code == 201
    group_id = group.json()["id"]

    await ctx.client.post(f"/api/events/{ev}/guests/bulk-assign-household",
                          json={"guest_ids": [gid], "household_id": hid})
    await ctx.client.post(f"/api/events/{ev}/guests/bulk-assign-group",
                          json={"guest_ids": [gid], "table_group_id": group_id})

    async with _Session() as s:
        g = await s.get(Guest, gid)
        assert g.household_id == hid
        assert g.assigned_table_group_id == group_id
