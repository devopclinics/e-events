"""Section-based scanning: a scanner device picks one table group ("section")
per shift; walk-ins and group-less manual check-ins route to it. Off by default,
so existing walk-in / manual behavior is unchanged."""
import pytest
from sqlalchemy import delete

from app.models import Event, Guest
from conftest import _Session


async def _prep(event_id, *, section_mode=False, walk_in=True, manual=True):
    """Paid, active event with table groups; flags configurable. Seating is left
    OFF so admission just records the routed group (seat-within-group enforcement
    is covered separately in test_table_groups)."""
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.status = "active"
        ev.seating_enabled = False
        ev.walk_in_enabled = walk_in
        ev.manual_checkin_enabled = manual
        ev.section_mode_enabled = section_mode
        await s.execute(delete(Guest).where(Guest.event_id == event_id))  # clean seeded guest
        await s.commit()


async def _group(ctx, ev, name):
    r = await ctx.client.post(f"/api/events/{ev}/table-groups", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _group_of(guest_id):
    async with _Session() as s:
        return (await s.get(Guest, guest_id)).assigned_table_group_id


@pytest.mark.asyncio
async def test_walk_in_routes_to_active_section(ctx):
    await _prep(ctx.ids["event_a"], section_mode=True)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    men = await _group(ctx, ev, "Men")
    await _group(ctx, ev, "Women")

    r = await ctx.client.post(f"/api/events/{ev}/guests/walk-in",
                              json={"first_name": "Walk", "table_group_id": men})
    assert r.status_code == 200 and r.json()["status"] == "admitted"
    assert await _group_of(r.json()["guest"]["id"]) == men


@pytest.mark.asyncio
async def test_walk_in_rejects_unknown_section(ctx):
    await _prep(ctx.ids["event_a"], section_mode=True)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    # A section id that isn't a group on this event is rejected.
    r = await ctx.client.post(f"/api/events/{ev}/guests/walk-in",
                              json={"first_name": "Walk", "table_group_id": "no-such-group"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_walk_in_falls_back_when_section_mode_off(ctx):
    """Section mode OFF → the single walk_in_table_group_id still applies and a
    passed table_group_id is ignored (regression guard for existing events)."""
    await _prep(ctx.ids["event_a"], section_mode=False)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    default_grp = await _group(ctx, ev, "Default")
    ignored = await _group(ctx, ev, "Ignored")
    async with _Session() as s:
        (await s.get(Event, ev)).walk_in_table_group_id = default_grp
        await s.commit()

    r = await ctx.client.post(f"/api/events/{ev}/guests/walk-in",
                              json={"first_name": "Walk", "table_group_id": ignored})
    assert r.status_code == 200
    assert await _group_of(r.json()["guest"]["id"]) == default_grp


@pytest.mark.asyncio
async def test_manual_checkin_assigns_section_to_ungrouped(ctx):
    await _prep(ctx.ids["event_a"], section_mode=True)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    women = await _group(ctx, ev, "Women")
    g = (await ctx.client.post(f"/api/events/{ev}/guests",
         json={"first_name": "No", "last_name": "Group"})).json()
    assert g["assigned_table_group_id"] is None

    r = await ctx.client.post(f"/api/events/{ev}/guests/{g['id']}/checkin?table_group_id={women}")
    assert r.status_code == 200 and r.json()["status"] == "admitted"
    assert await _group_of(g["id"]) == women


@pytest.mark.asyncio
async def test_manual_checkin_never_overrides_existing_group(ctx):
    """A guest pre-assigned to a group keeps it even at a different section."""
    await _prep(ctx.ids["event_a"], section_mode=True)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    men = await _group(ctx, ev, "Men")
    women = await _group(ctx, ev, "Women")
    g = (await ctx.client.post(f"/api/events/{ev}/guests",
         json={"first_name": "Her", "last_name": "Self", "assigned_table_group_id": women})).json()

    # Scanned at the Men's door — her own group must win.
    r = await ctx.client.post(f"/api/events/{ev}/guests/{g['id']}/checkin?table_group_id={men}")
    assert r.status_code == 200
    assert await _group_of(g["id"]) == women


@pytest.mark.asyncio
async def test_manual_checkin_ignores_section_when_mode_off(ctx):
    await _prep(ctx.ids["event_a"], section_mode=False)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    grp = await _group(ctx, ev, "Men")
    g = (await ctx.client.post(f"/api/events/{ev}/guests",
         json={"first_name": "No", "last_name": "Group"})).json()

    r = await ctx.client.post(f"/api/events/{ev}/guests/{g['id']}/checkin?table_group_id={grp}")
    assert r.status_code == 200
    assert await _group_of(g["id"]) is None


@pytest.mark.asyncio
async def test_toggle_requires_a_table_group(ctx):
    await _prep(ctx.ids["event_a"], section_mode=False)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    # No groups yet → enabling is rejected.
    bad = await ctx.client.patch(f"/api/events/{ev}/features", json={"section_mode_enabled": True})
    assert bad.status_code == 400

    await _group(ctx, ev, "Men")
    ok = await ctx.client.patch(f"/api/events/{ev}/features", json={"section_mode_enabled": True})
    assert ok.status_code == 200 and ok.json()["section_mode_enabled"] is True

    # Disabling is always allowed.
    off = await ctx.client.patch(f"/api/events/{ev}/features", json={"section_mode_enabled": False})
    assert off.status_code == 200 and off.json()["section_mode_enabled"] is False
