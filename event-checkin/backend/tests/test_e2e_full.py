"""End-to-end coverage across the whole check-in lifecycle, driving the real
HTTP API (httpx + ASGI, in-memory SQLite). Each test builds an event with real
data — rooms/tables, table groups, sections, zones, ticket types, tags, gates —
then scans and admits guests and asserts the resulting state.

Focus areas requested:
  * seat assignment never double-books a (table, seat) pair;
  * a re-scan is idempotent (same seat, no second admission);
  * table-group / section routing seats guests in the right place;
  * venue-access zones gate entry and track occupancy in/out;
  * entry-rule tags + gates allow/deny correctly.

Setup that needs DB writes (event flags, staff assignment) goes through the
session directly; everything under test goes through the API.
"""
import pytest
from sqlalchemy import delete, select

from app.models import (
    Event, Guest, User, Membership, EventUser, EventUserSection, SeatingTable,
)
from conftest import _Session


# ── shared helpers ────────────────────────────────────────────────────────────

async def _setup_event(event_id, **flags):
    """Put the seeded event into a paid + active state with the given feature
    flags, and clear the one seeded guest so counts start clean."""
    defaults = dict(
        is_paid=True, plan_tier="tier300", status="active", seating_enabled=False, walk_in_enabled=False,
        manual_checkin_enabled=False, venue_access_enabled=False,
        section_mode_enabled=False, enforce_table_groups=True,
    )
    defaults.update(flags)
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        for k, v in defaults.items():
            setattr(ev, k, v)
        await s.execute(delete(Guest).where(Guest.event_id == event_id))
        await s.commit()


async def _staff(ctx, event_id, email, *, sections=None, assign=True):
    """A non-admin official, org-member 'staff', optionally assigned to the event
    and restricted to the given section (table-group) ids."""
    async with _Session() as s:
        u = User(name=email.split("@")[0], email=email, role="official")
        s.add(u)
        await s.flush()
        s.add(Membership(org_id=ctx.ids["org_a"], user_id=u.id, role="staff"))
        if assign:
            eu = EventUser(event_id=event_id, user_id=u.id)
            s.add(eu)
            await s.flush()
            for gid in (sections or []):
                s.add(EventUserSection(event_user_id=eu.id, table_group_id=gid))
        await s.commit()
        return u


async def _table(ctx, ev, name, capacity, **extra):
    r = await ctx.client.post(f"/api/events/{ev}/tables",
                              json={"name": name, "capacity": capacity, **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _group(ctx, ev, name, table_ids=None):
    r = await ctx.client.post(f"/api/events/{ev}/table-groups",
                              json={"name": name, "table_ids": table_ids or []})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _guest(ctx, ev, first, last="X", group=None):
    body = {"first_name": first, "last_name": last, "email": f"{first}@g.com"}
    if group:
        body["assigned_table_group_id"] = group
    r = await ctx.client.post(f"/api/events/{ev}/guests", json=body)
    assert r.status_code == 201, r.text
    j = r.json()
    return j["id"], j["qr_token"]


async def _scan(ctx, token):
    r = await ctx.client.post(f"/api/scan/{token}")
    assert r.status_code == 200, r.text
    return r.json()


async def _seat_pairs(event_id):
    """Every occupied (table_id, seat_number) pair currently in the DB."""
    async with _Session() as s:
        rows = (await s.execute(
            select(Guest.table_id, Guest.seat_number)
            .where(Guest.event_id == event_id, Guest.table_id.isnot(None))
        )).all()
    return [(t, n) for t, n in rows]


# ── 1. Seating FCFS: no double-booking, idempotent re-scan, overflow blocked ───

@pytest.mark.asyncio
async def test_seating_no_duplicate_and_idempotent(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, seating_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    await _table(ctx, ev, "Table 1", 3)

    guests = [await _guest(ctx, ev, f"S{i}") for i in range(4)]

    # First three admit and get distinct seats; the fourth has nowhere to sit.
    results = [await _scan(ctx, tok) for _, tok in guests]
    admitted = [r for r in results if r["status"] == "admitted"]
    assert len(admitted) == 3, [r["status"] for r in results]
    assert results[3]["status"] == "no_seat_available", results[3]

    # No (table, seat) pair is shared — the core anti-duplication guarantee.
    pairs = await _seat_pairs(ev)
    assert len(pairs) == 3 and len(set(pairs)) == 3, pairs
    seats = sorted(int(n) for _, n in pairs)
    assert seats == [1, 2, 3], seats

    # Re-scanning an already-admitted guest is idempotent: same seat, no new row.
    first_seat = admitted[0]["seat_number"]
    again = await _scan(ctx, guests[0][1])
    assert again["status"] == "already_admitted"
    assert again["seat_number"] == first_seat
    assert await _seat_pairs(ev) == pairs  # unchanged


# ── 2. Manual seat assignment refuses to double-book ───────────────────────────

@pytest.mark.asyncio
async def test_manual_seat_collision_returns_409(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, seating_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    tid = await _table(ctx, ev, "Head", 5)
    ga, _ = await _guest(ctx, ev, "Ann")
    gb, _ = await _guest(ctx, ev, "Ben")

    ok = await ctx.client.patch(f"/api/events/{ev}/guests/{ga}/seat",
                                json={"table_id": tid, "seat_number": "1"})
    assert ok.status_code == 200, ok.text

    # Same seat for a second guest must be rejected, not silently overwritten.
    clash = await ctx.client.patch(f"/api/events/{ev}/guests/{gb}/seat",
                                   json={"table_id": tid, "seat_number": "1"})
    assert clash.status_code == 409, clash.text

    free = await ctx.client.patch(f"/api/events/{ev}/guests/{gb}/seat",
                                  json={"table_id": tid, "seat_number": "2"})
    assert free.status_code == 200, free.text


# ── 2b. Table capacity guard for table-only (no seat number) assignment ────────

@pytest.mark.asyncio
async def test_table_only_assignment_respects_capacity(ctx):
    """Assigning guests to a table without a seat number must still honour the
    table's capacity — otherwise a table silently over-fills and the surplus
    guests are turned away at the door."""
    ev = ctx.ids["event_a"]
    await _setup_event(ev, seating_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    tid = await _table(ctx, ev, "T", 2)   # capacity 2

    gids = [(await _guest(ctx, ev, n))[0] for n in ("A", "B", "C")]

    # Seating-chart path (assign_seat): first two fit, third is rejected.
    r1 = await ctx.client.patch(f"/api/events/{ev}/guests/{gids[0]}/seat", json={"table_id": tid})
    r2 = await ctx.client.patch(f"/api/events/{ev}/guests/{gids[1]}/seat", json={"table_id": tid})
    r3 = await ctx.client.patch(f"/api/events/{ev}/guests/{gids[2]}/seat", json={"table_id": tid})
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    assert r3.status_code == 409, r3.text

    # Guest-edit-modal path (update_guest) is guarded the same way.
    r4 = await ctx.client.patch(f"/api/events/{ev}/guests/{gids[2]}", json={"table_id": tid})
    assert r4.status_code == 409, r4.text

    # The table never exceeds capacity.
    chart = (await ctx.client.get(f"/api/events/{ev}/tables")).json()
    t = next(x for x in chart if x["id"] == tid)
    assert t["assigned_count"] == 2 and t["capacity"] == 2

    # Re-seating a guest already on the table is still allowed (excludes self).
    reseat = await ctx.client.patch(f"/api/events/{ev}/guests/{gids[0]}/seat",
                                    json={"table_id": tid, "seat_number": "1"})
    assert reseat.status_code == 200, reseat.text


# ── 2c. DB-level backstop: the unique index rejects a duplicate seat ───────────

@pytest.mark.asyncio
async def test_db_rejects_duplicate_seat_even_bypassing_app_checks(ctx):
    """The partial unique index is the concurrency backstop: even a write that
    skips the application-level guards cannot double-book a (table, seat)."""
    from sqlalchemy.exc import IntegrityError
    ev = ctx.ids["event_a"]
    await _setup_event(ev, seating_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    tid = await _table(ctx, ev, "T", 10)
    a, _ = await _guest(ctx, ev, "A")
    b, _ = await _guest(ctx, ev, "B")

    async with _Session() as s:
        (await s.get(Guest, a)).table_id = tid
        (await s.get(Guest, a)).seat_number = "1"
        await s.commit()

    # Forcing B onto the same (table, seat) directly must raise at the DB.
    with pytest.raises(IntegrityError):
        async with _Session() as s:
            g = await s.get(Guest, b)
            g.table_id = tid
            g.seat_number = "1"
            await s.commit()

    # A different seat at the same table is fine.
    async with _Session() as s:
        g = await s.get(Guest, b)
        g.table_id = tid
        g.seat_number = "2"
        await s.commit()


# ── 3. Table-group enforcement ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_table_group_enforced_and_full_group_denied(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, seating_enabled=True, enforce_table_groups=True)
    ctx.login(ctx.ids["superadmin"])
    g_table = await _table(ctx, ev, "VIP table", 1)
    await _table(ctx, ev, "Overflow", 10)          # plenty of seats, but not in-group
    vip = await _group(ctx, ev, "VIPs", [g_table])

    a, atok = await _guest(ctx, ev, "Vip1", group=vip)
    b, btok = await _guest(ctx, ev, "Vip2", group=vip)

    r1 = await _scan(ctx, atok)
    assert r1["status"] == "admitted" and r1["table_name"] == "VIP table"

    # Group is now full — second grouped guest is denied, NOT seated at Overflow.
    r2 = await _scan(ctx, btok)
    assert r2["status"] == "denied", r2
    async with _Session() as s:
        assert (await s.get(Guest, b)).table_id is None

    # An ungrouped guest still seats freely at the open table.
    _, ctok = await _guest(ctx, ev, "Open")
    r3 = await _scan(ctx, ctok)
    assert r3["status"] == "admitted" and r3["table_name"] == "Overflow"


# ── 4. Section scanning ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_section_scanning_routes_and_respects_own_group(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, seating_enabled=True, walk_in_enabled=True,
                       manual_checkin_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    t_men = await _table(ctx, ev, "Men table", 10)
    t_women = await _table(ctx, ev, "Women table", 10)
    men = await _group(ctx, ev, "Men", [t_men])
    women = await _group(ctx, ev, "Women", [t_women])

    # Enable section mode (needs a group to exist) and pin a staffer to "Men".
    on = await ctx.client.patch(f"/api/events/{ev}/features",
                                json={"section_mode_enabled": True})
    assert on.status_code == 200 and on.json()["section_mode_enabled"] is True
    usher = await _staff(ctx, ev, "usher-men@a.com", sections=[men])

    # Usher sees exactly their one section.
    ctx.login(usher)
    secs = await ctx.client.get(f"/api/events/{ev}/my-sections")
    assert [s["name"] for s in secs.json()["sections"]] == ["Men"]

    # A walk-in handled by the Men usher is seated at the Men table.
    w = await ctx.client.post(f"/api/events/{ev}/guests/walk-in",
                              json={"first_name": "Walk", "last_name": "In"})
    assert w.status_code == 200 and w.json()["status"] == "admitted"
    assert w.json()["table_name"] == "Men table"

    # A guest who already belongs to Women keeps Women even when the Men usher
    # checks them in — the section never overrides an explicit assignment.
    ctx.login(ctx.ids["superadmin"])
    gw, _ = await _guest(ctx, ev, "Wendy", group=women)
    ctx.login(usher)
    mc = await ctx.client.post(f"/api/events/{ev}/guests/{gw}/checkin")
    assert mc.status_code == 200 and mc.json()["status"] == "admitted"
    assert mc.json()["table_name"] == "Women table"

    # The Men usher cannot force a walk-in into the Women section.
    blocked = await ctx.client.post(f"/api/events/{ev}/guests/walk-in",
                                    json={"first_name": "Nope", "table_group_id": women})
    assert blocked.status_code == 403, blocked.text


# ── 5. Venue access: zones, ticket rules, occupancy in/out, journey ────────────

async def _zone(ctx, ev, name, mode="both", capacity=None):
    r = await ctx.client.post(f"/api/events/{ev}/zones",
                              json={"name": name, "direction_mode": mode, "capacity": capacity})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _ticket(ctx, ev, name, allowed_zone_ids=None):
    r = await ctx.client.post(f"/api/events/{ev}/ticket-types",
                              json={"name": name, "allowed_zone_ids": allowed_zone_ids})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _scan_zone(ctx, token, zone_id, direction=None):
    body = {"zone_id": zone_id}
    if direction:
        body["direction"] = direction
    r = await ctx.client.post(f"/api/scan/{token}/zone", json=body)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_venue_access_zones_tickets_occupancy_journey(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, venue_access_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    hall = await _zone(ctx, ev, "Main Hall", mode="both", capacity=2)
    vip = await _zone(ctx, ev, "VIP Lounge", mode="both")

    ga_ticket = await _ticket(ctx, ev, "GA", allowed_zone_ids=[hall])   # hall only
    vip_ticket = await _ticket(ctx, ev, "VIP", allowed_zone_ids=None)   # all zones

    g1, t1 = await _guest(ctx, ev, "Ga1")
    g2, t2 = await _guest(ctx, ev, "Ga2")
    g3, t3 = await _guest(ctx, ev, "Vip")
    for gid, tt in ((g1, ga_ticket), (g2, ga_ticket), (g3, vip_ticket)):
        r = await ctx.client.put(f"/api/events/{ev}/guests/{gid}/ticket-type",
                                 json={"ticket_type_id": tt})
        assert r.status_code == 200, r.text

    # GA guest into the Hall → allowed; occupancy ticks to 1.
    r = await _scan_zone(ctx, t1, hall, "in")
    assert r["status"] == "ok" and r["denied"] is False
    assert r["occupancy"] == 1

    # GA ticket is NOT allowed into the VIP zone → denied.
    r = await _scan_zone(ctx, t1, vip, "in")
    assert r["status"] == "denied" and r["denied"] is True

    # Fill the Hall (cap 2) then overflow → capacity denial.
    assert (await _scan_zone(ctx, t2, hall, "in"))["denied"] is False   # 2/2
    over = await _scan_zone(ctx, t3, hall, "in")
    assert over["denied"] is True, over                                # 3rd blocked

    # Occupancy endpoint: Hall holds 2, total inside 2.
    occ = (await ctx.client.get(f"/api/events/{ev}/access/occupancy")).json()
    hall_occ = next(z for z in occ["zones"] if z["id"] == hall)
    assert hall_occ["occupancy"] == 2 and occ["total_inside"] == 2

    # Scan g1 back OUT → occupancy drops to 1.
    out = await _scan_zone(ctx, t1, hall, "out")
    assert out["direction"] == "out" and out["occupancy"] == 1

    # VIP ticket may enter the VIP zone freely.
    assert (await _scan_zone(ctx, t3, vip, "in"))["denied"] is False

    # Journey for g1 = in, (denied vip), out — denied scans are logged too.
    journey = (await ctx.client.get(f"/api/events/{ev}/guests/{g1}/journey")).json()
    dirs = [(s["zone_name"], s["direction"], s["denied"]) for s in journey]
    assert ("Main Hall", "in", False) in dirs
    assert ("Main Hall", "out", False) in dirs
    assert any(d for _, _, d in dirs)  # the denied VIP attempt is recorded


# ── 6. Entry rules: tag-based gates allow/deny with auto zone+direction ─────────

@pytest.mark.asyncio
async def test_entry_rules_tag_gate_allows_and_denies(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, venue_access_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    backstage = await _zone(ctx, ev, "Backstage", mode="both")

    # A "Crew" tag, and a gate at Backstage that only admits Crew.
    tag = (await ctx.client.post(f"/api/events/{ev}/tags", json={"name": "Crew"})).json()["id"]
    rule = await ctx.client.put(f"/api/events/{ev}/zones/{backstage}/tags",
                                json={"tag_ids": [tag]})
    assert rule.status_code == 200, rule.text
    gate = await ctx.client.post(f"/api/events/{ev}/gates",
                                 json={"name": "Stage door", "zone_id": backstage, "direction": "in"})
    assert gate.status_code == 201, gate.text
    gate_id = gate.json()["id"]

    crew_g, crew_tok = await _guest(ctx, ev, "Crew")
    guest_g, guest_tok = await _guest(ctx, ev, "Plain")
    tagged = await ctx.client.put(f"/api/events/{ev}/guests/{crew_g}/tags",
                                  json={"tag_ids": [tag]})
    assert tagged.status_code == 200, tagged.text

    # Crew tag → allowed; the gate auto-supplies zone + direction.
    ok = await ctx.client.post(f"/api/events/{ev}/gates/{gate_id}/scan",
                               json={"qr_token": crew_tok})
    assert ok.status_code == 200, ok.text
    okj = ok.json()
    assert okj["allowed"] is True and okj["zone_name"] == "Backstage" and okj["direction"] == "in"
    assert "Crew" in okj["matched_tags"]

    # No matching tag → denied at the same gate.
    no = await ctx.client.post(f"/api/events/{ev}/gates/{gate_id}/scan",
                               json={"qr_token": guest_tok})
    assert no.status_code == 200 and no.json()["allowed"] is False


# ── 7. Feature-coexistence sanity: seating works alongside each access mode ────

@pytest.mark.asyncio
async def test_seating_coexists_with_each_exclusive_mode(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["superadmin"])

    # Seating + venue access together is allowed (only sections vs venue access
    # are mutually exclusive — proven in test_section_scanning).
    await _setup_event(ev, seating_enabled=True, venue_access_enabled=True)
    feats = (await ctx.client.get(f"/api/events/{ev}")).json()
    assert feats["seating_enabled"] and feats["venue_access_enabled"]

    # Seating + sections together is allowed.
    await _setup_event(ev, seating_enabled=True, venue_access_enabled=False)
    await _table(ctx, ev, "T", 4)
    await _group(ctx, ev, "G")
    on = await ctx.client.patch(f"/api/events/{ev}/features",
                                json={"section_mode_enabled": True})
    assert on.status_code == 200 and on.json()["section_mode_enabled"] is True
