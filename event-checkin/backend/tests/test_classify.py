"""Tag-based zone access: tags, zone allow-lists, gates, and gate scanning."""
import pytest
from sqlalchemy import select

from conftest import _Session
from app.models import Event, Guest, Zone, ScanEvent


async def _setup_access_event(ctx):
    """Make event_a a paid venue-access event with a zone and a guest with a QR."""
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        ev.venue_access_enabled = True
        ev.status = "active"
        zone = Zone(event_id=ev.id, name="VIP Lounge", capacity=None, direction_mode="both")
        s.add(zone)
        g = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        g.qr_token = "QR-TESTTOKEN"
        await s.commit()
        return zone.id, g.id


@pytest.mark.asyncio
async def test_tag_crud_and_assign(ctx):
    eid = ctx.ids["event_a"]
    await _setup_access_event(ctx)
    ctx.login(ctx.ids["user_a"])
    t = await ctx.client.post(f"/api/events/{eid}/tags", json={"name": "Speaker", "color": "#f00"})
    assert t.status_code == 201
    tag_id = t.json()["id"]

    g = (await ctx.client.get(f"/api/events/{eid}/guests")).json()[0]
    r = await ctx.client.put(f"/api/events/{eid}/guests/{g['id']}/tags", json={"tag_ids": [tag_id]})
    assert r.status_code == 200 and r.json() == [tag_id]
    assert (await ctx.client.get(f"/api/events/{eid}/guests/{g['id']}/tags")).json() == [tag_id]
    # guest_count reflects the assignment
    tags = (await ctx.client.get(f"/api/events/{eid}/tags")).json()
    assert tags[0]["guest_count"] == 1


@pytest.mark.asyncio
async def test_gate_scan_allow_and_deny(ctx):
    eid = ctx.ids["event_a"]
    zone_id, gid_guest = await _setup_access_event(ctx)
    ctx.login(ctx.ids["user_a"])
    # Tag + zone rule: VIP Lounge requires "VIP"
    vip = (await ctx.client.post(f"/api/events/{eid}/tags", json={"name": "VIP"})).json()["id"]
    await ctx.client.put(f"/api/events/{eid}/zones/{zone_id}/tags", json={"tag_ids": [vip]})
    gate = (await ctx.client.post(f"/api/events/{eid}/gates",
            json={"name": "VIP Door", "zone_id": zone_id, "direction": "in"})).json()
    assert gate["zone_name"] == "VIP Lounge"

    # Guest has no VIP tag → denied
    r = await ctx.client.post(f"/api/events/{eid}/gates/{gate['id']}/scan", json={"qr_token": "QR-TESTTOKEN"})
    assert r.status_code == 200 and r.json()["allowed"] is False
    assert "don't permit" in r.json()["message"]

    # Give the guest VIP → allowed, and it checks them in
    await ctx.client.put(f"/api/events/{eid}/guests/{gid_guest}/tags", json={"tag_ids": [vip]})
    r = await ctx.client.post(f"/api/events/{eid}/gates/{gate['id']}/scan", json={"qr_token": "QR-TESTTOKEN"})
    body = r.json()
    assert body["allowed"] is True and body["occupancy"] == 1
    assert body["matched_tags"] == ["VIP"]

    async with _Session() as s:
        g = await s.get(Guest, gid_guest)
        assert g.admitted is True
        n = len((await s.execute(select(ScanEvent).where(ScanEvent.event_id == eid))).scalars().all())
        assert n == 2  # one denied + one allowed, both logged


@pytest.mark.asyncio
async def test_open_zone_admits_everyone(ctx):
    eid = ctx.ids["event_a"]
    zone_id, _ = await _setup_access_event(ctx)
    ctx.login(ctx.ids["user_a"])
    gate = (await ctx.client.post(f"/api/events/{eid}/gates",
            json={"name": "Main Door", "zone_id": zone_id, "direction": "in"})).json()
    # No zone tag rules → anyone allowed
    r = await ctx.client.post(f"/api/events/{eid}/gates/{gate['id']}/scan", json={"qr_token": "QR-TESTTOKEN"})
    assert r.json()["allowed"] is True


@pytest.mark.asyncio
async def test_import_tags_column_autocreates_and_assigns(ctx):
    eid = ctx.ids["event_a"]
    await _setup_access_event(ctx)  # venue access on
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post(
        f"/api/events/{eid}/guests/upload",
        files={"file": ("g.csv", (
            "first_name,last_name,email,tags\n"
            "Neil,Gaiman,neil@x.com,VIP; Press\n"
            "Tori,Amos,tori@x.com,VIP\n"
        ).encode(), "text/csv")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["added"] == 2
    assert body["tags_assigned"] == 3      # Neil: VIP+Press, Tori: VIP
    assert body["tags_created"] == 2       # VIP, Press auto-created

    # Tags now exist and are queryable; re-import doesn't duplicate links.
    tags = (await ctx.client.get(f"/api/events/{eid}/tags")).json()
    assert {t["name"] for t in tags} == {"VIP", "Press"}
    r2 = await ctx.client.post(
        f"/api/events/{eid}/guests/upload",
        files={"file": ("g.csv", (
            "first_name,last_name,email,tags\n"
            "Neil,Gaiman,neil@x.com,VIP; Press\n"
        ).encode(), "text/csv")},
    )
    assert "tags_assigned" not in r2.json()  # already linked → no new links


@pytest.mark.asyncio
async def test_requires_access_enabled_and_member(ctx):
    eid = ctx.ids["event_a"]
    # Not enabled yet → 400
    ctx.login(ctx.ids["user_a"])
    assert (await ctx.client.get(f"/api/events/{eid}/tags")).status_code in (400, 402)
    # Cross-org user blocked
    await _setup_access_event(ctx)
    ctx.login(ctx.ids["user_b"])
    assert (await ctx.client.get(f"/api/events/{eid}/tags")).status_code == 404
