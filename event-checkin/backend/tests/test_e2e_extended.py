"""Second wave of end-to-end coverage, closing the gaps left by test_e2e_full:

  * auto-assign + self-check-in both go through the shared seating flow;
  * couple pairing seats partners together and coexists with the unique index;
  * venue-access direction modes (entry/exit), peak + flow analytics, gate-out
    occupancy decrement, and ticket-type capacity;
  * a legacy event with both Entry rules and Section scanning forced on (the
    runtime can't enable both, but old data might already have both) still
    scans without crashing.

Reuses the HTTP/DB helpers from test_e2e_full.
"""
import pytest
from sqlalchemy import select

from app.models import Event, Guest
from conftest import _Session
from test_e2e_full import (
    _setup_event, _staff, _table, _group, _guest, _scan, _seat_pairs,
    _zone, _ticket, _scan_zone,
)


# ── Gap 3a: auto-assign seats everyone via the shared FCFS picker, no dupes ─────

@pytest.mark.asyncio
async def test_auto_assign_seats_all_without_duplicates(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, seating_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    await _table(ctx, ev, "T1", 2)
    await _table(ctx, ev, "T2", 2)
    for n in ("A", "B", "C"):
        await _guest(ctx, ev, n)

    res = (await ctx.client.post(f"/api/events/{ev}/seating/auto-assign")).json()
    assert res["assigned"] == 3 and res["unassigned"] == 0, res

    pairs = await _seat_pairs(ev)
    assert len(pairs) == 3 and len(set(pairs)) == 3, pairs  # every seat distinct


# ── Gap 3b: self-check-in runs the same admission flow (seat + capacity) ────────

@pytest.mark.asyncio
async def test_self_checkin_admits_and_seats(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, seating_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    await _table(ctx, ev, "T", 5)
    gid, _ = await _guest(ctx, ev, "Self")

    async with _Session() as s:
        e = await s.get(Event, ev)
        e.self_checkin_enabled = True
        e.event_code = "ABC123"
        await s.commit()

    r = await ctx.client.post(f"/api/e/ABC123/checkin/{gid}")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "admitted" and j["table_name"] == "T" and j["seat_number"]

    # Idempotent: a second self-check-in doesn't re-seat or duplicate.
    again = (await ctx.client.post(f"/api/e/ABC123/checkin/{gid}")).json()
    assert again["status"] == "already_admitted" and again["seat_number"] == j["seat_number"]


# ── Gap 3c: couple pairing seats partners together, coexists with unique index ─

@pytest.mark.asyncio
async def test_couple_pairing_seats_partners_together(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, seating_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    await _table(ctx, ev, "Sweetheart", 4)
    a, atok = await _guest(ctx, ev, "Romeo")
    b, btok = await _guest(ctx, ev, "Juliet")
    async with _Session() as s:
        ga, gb = await s.get(Guest, a), await s.get(Guest, b)
        ga.partner_guest_id = b
        gb.partner_guest_id = a
        await s.commit()

    # Romeo scanned first: gets a seat and holds the adjacent one for Juliet.
    r1 = await _scan(ctx, atok)
    assert r1["status"] == "admitted"
    async with _Session() as s:
        ga = await s.get(Guest, a)
        assert ga.held_seat is not None and ga.held_seat != ga.seat_number

    # Juliet scanned next: joins Romeo's table at the held seat — adjacent, distinct.
    r2 = await _scan(ctx, btok)
    assert r2["status"] == "admitted" and r2["table_name"] == "Sweetheart"
    pairs = await _seat_pairs(ev)
    assert len(pairs) == 2 and len(set(pairs)) == 2, pairs
    tables = {t for t, _ in pairs}
    assert len(tables) == 1  # same table
    seats = sorted(int(n) for _, n in pairs)
    assert seats[1] - seats[0] == 1  # adjacent


# ── Gap 4a: zone direction modes force in/out regardless of request ─────────────

@pytest.mark.asyncio
async def test_zone_direction_modes_force_direction(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, venue_access_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    entry = await _zone(ctx, ev, "Entrance", mode="entry")
    exit_z = await _zone(ctx, ev, "Exit", mode="exit")
    _, tok = await _guest(ctx, ev, "Mover")

    # Entry-only zone forces "in" even if "out" is requested.
    r = await _scan_zone(ctx, tok, entry, direction="out")
    assert r["direction"] == "in", r
    # Exit-only zone forces "out".
    r = await _scan_zone(ctx, tok, exit_z, direction="in")
    assert r["direction"] == "out", r


# ── Gap 4b: peak + flow analytics reflect the scan log ─────────────────────────

@pytest.mark.asyncio
async def test_peak_and_flow_analytics(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, venue_access_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    hall = await _zone(ctx, ev, "Hall", mode="both")
    bar = await _zone(ctx, ev, "Bar", mode="both")
    _, t1 = await _guest(ctx, ev, "P1")
    _, t2 = await _guest(ctx, ev, "P2")
    # Two guests walk Hall -> Bar.
    for tok in (t1, t2):
        await _scan_zone(ctx, tok, hall, "in")
        await _scan_zone(ctx, tok, bar, "in")

    peak = (await ctx.client.get(f"/api/events/{ev}/access/peak?bucket_minutes=15")).json()
    assert sum(b["ins"] for b in peak) == 4  # four "in" scans logged

    flow = (await ctx.client.get(f"/api/events/{ev}/access/flow")).json()
    edges = {(e["from_zone"], e["to_zone"]): e["count"] for e in flow}
    assert edges.get((None, "Hall")) == 2      # both entered at Hall
    assert edges.get(("Hall", "Bar")) == 2     # both moved Hall -> Bar


# ── Gap 4c: ticket-type capacity is enforced at assignment ─────────────────────

@pytest.mark.asyncio
async def test_ticket_type_capacity_enforced(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, venue_access_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    vip = await _ticket(ctx, ev, "VIP", allowed_zone_ids=None)
    # Force capacity = 1 on the ticket.
    await ctx.client.put(f"/api/events/{ev}/ticket-types/{vip}", json={"capacity": 1})
    a, _ = await _guest(ctx, ev, "A")
    b, _ = await _guest(ctx, ev, "B")

    ok = await ctx.client.put(f"/api/events/{ev}/guests/{a}/ticket-type", json={"ticket_type_id": vip})
    assert ok.status_code == 200, ok.text
    sold_out = await ctx.client.put(f"/api/events/{ev}/guests/{b}/ticket-type", json={"ticket_type_id": vip})
    assert sold_out.status_code == 409, sold_out.text

    # Re-saving the same ticket on the already-holding guest is still fine.
    resave = await ctx.client.put(f"/api/events/{ev}/guests/{a}/ticket-type", json={"ticket_type_id": vip})
    assert resave.status_code == 200, resave.text


# ── Gap 4d: a gate pinned to "out" decrements zone occupancy ────────────────────

@pytest.mark.asyncio
async def test_gate_out_decrements_occupancy(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, venue_access_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    hall = await _zone(ctx, ev, "Hall", mode="both")
    _, tok = await _guest(ctx, ev, "G")

    await _scan_zone(ctx, tok, hall, "in")   # occupancy 1
    out_gate = (await ctx.client.post(f"/api/events/{ev}/gates",
                json={"name": "Out door", "zone_id": hall, "direction": "out"})).json()["id"]
    res = await ctx.client.post(f"/api/events/{ev}/gates/{out_gate}/scan", json={"qr_token": tok})
    assert res.status_code == 200 and res.json()["direction"] == "out"

    occ = (await ctx.client.get(f"/api/events/{ev}/access/occupancy")).json()
    hall_occ = next(z for z in occ["zones"] if z["id"] == hall)
    assert hall_occ["occupancy"] == 0, occ


# ── Gap 5: a legacy event with both modes forced on still scans (no crash) ──────

@pytest.mark.asyncio
async def test_legacy_both_modes_on_still_scans(ctx):
    ev = ctx.ids["event_a"]
    await _setup_event(ev, seating_enabled=True)
    ctx.login(ctx.ids["superadmin"])
    await _table(ctx, ev, "T", 5)

    # Force the (normally impossible) both-on state directly, simulating data
    # created before the mutual-exclusion guard existed.
    async with _Session() as s:
        e = await s.get(Event, ev)
        e.venue_access_enabled = True
        e.section_mode_enabled = True
        await s.commit()

    # A plain QR scan still admits + seats (the QR path is independent of both flags).
    _, tok = await _guest(ctx, ev, "Legacy")
    r = await _scan(ctx, tok)
    assert r["status"] == "admitted" and r["table_name"] == "T"

    # And a zone scan still works on the same event.
    z = await _zone(ctx, ev, "Z", mode="both")
    _, tok2 = await _guest(ctx, ev, "Zoned")
    zr = await _scan_zone(ctx, tok2, z, "in")
    assert zr["denied"] is False

    # The API still refuses to *re-enable* the second mode (guard holds).
    blocked = await ctx.client.patch(f"/api/events/{ev}/features", json={"section_mode_enabled": True})
    assert blocked.status_code == 400, blocked.text
