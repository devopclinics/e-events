"""Table capacity is enforced consistently across EVERY admission path.

The bug class this guards against: a table gets overloaded (or a seat gets
double-booked) because one path doesn't count what another already did. Here we
fill a capacity-2 table through a *mix* of paths — pre-assigned, QR scan, manual
check-in, self check-in, walk-in — and prove the next guest is always turned away
and the table never exceeds capacity.

All paths funnel through perform_admission -> assign_next_seat -> _seat_state,
which counts every guest physically on the table. These tests lock that in.
"""
import pytest
from sqlalchemy import delete, func, select

from conftest import _Session
from app.models import Event, Guest, TableGroup

# Reuse the end-to-end helpers (same tests/ dir, so importable).
from test_e2e_full import _setup_event, _table, _group, _guest

CODE = "CAP123"


async def _prep(ctx, ev, capacity=2):
    """Capacity-N table T inside group G; walk-ins + manual + self check-in on;
    G is the walk-in group; group enforcement on so nobody overflows elsewhere."""
    await _setup_event(
        ev, seating_enabled=True, walk_in_enabled=True,
        manual_checkin_enabled=True, self_checkin_enabled=True,
        enforce_table_groups=True,
    )
    ctx.login(ctx.ids["superadmin"])
    t = await _table(ctx, ev, "Head Table", capacity)
    g = await _group(ctx, ev, "G", [t])
    async with _Session() as s:
        e = await s.get(Event, ev)
        e.walk_in_table_group_id = g
        e.event_code = CODE
        await s.commit()
    return t, g


async def _seated(table_id):
    """How many guests physically hold a numbered seat on this table."""
    async with _Session() as s:
        return await s.scalar(
            select(func.count(Guest.id)).where(
                Guest.table_id == table_id, Guest.seat_number.isnot(None)
            )
        )


def _blocked(payload):
    return payload["status"] in ("denied", "no_seat_available", "not_active", "invalid")


@pytest.mark.asyncio
async def test_qr_scan_fills_then_blocks(ctx):
    ev = ctx.ids["event_a"]
    t, g = await _prep(ctx, ev, capacity=2)
    g1, tok1 = await _guest(ctx, ev, "A", group=g)
    g2, tok2 = await _guest(ctx, ev, "B", group=g)
    g3, tok3 = await _guest(ctx, ev, "C", group=g)

    assert (await ctx.client.post(f"/api/scan/{tok1}")).json()["status"] == "admitted"
    assert (await ctx.client.post(f"/api/scan/{tok2}")).json()["status"] == "admitted"
    third = (await ctx.client.post(f"/api/scan/{tok3}")).json()
    assert _blocked(third), third
    assert await _seated(t) == 2


@pytest.mark.asyncio
async def test_walk_ins_fill_then_block(ctx):
    ev = ctx.ids["event_a"]
    t, g = await _prep(ctx, ev, capacity=2)
    w = lambda n: ctx.client.post(f"/api/events/{ev}/guests/walk-in", json={"first_name": n})
    assert (await w("W1")).json()["status"] == "admitted"
    assert (await w("W2")).json()["status"] == "admitted"
    assert _blocked((await w("W3")).json())
    assert await _seated(t) == 2


@pytest.mark.asyncio
async def test_mixed_paths_all_count_against_capacity(ctx):
    """The real-world failure: two seats taken by DIFFERENT paths, and every other
    path must still see the table as full."""
    ev = ctx.ids["event_a"]
    t, g = await _prep(ctx, ev, capacity=2)

    # Seat 1: a pre-assigned guest (admin set table + seat, never "checked in").
    pre, _ = await _guest(ctx, ev, "Pre", group=g)
    r = await ctx.client.patch(f"/api/events/{ev}/guests/{pre}",
                               json={"table_id": t, "seat_number": "1"})
    assert r.status_code == 200, r.text

    # Seat 2: a walk-in at the door.
    assert (await ctx.client.post(f"/api/events/{ev}/guests/walk-in",
            json={"first_name": "Walk"})).json()["status"] == "admitted"
    assert await _seated(t) == 2  # table now full via two different paths

    # Every remaining path must be blocked and must NOT overflow the table.
    gq, tokq = await _guest(ctx, ev, "Qr", group=g)
    gm, _ = await _guest(ctx, ev, "Man", group=g)
    gs, _ = await _guest(ctx, ev, "Self", group=g)

    assert _blocked((await ctx.client.post(f"/api/scan/{tokq}")).json())
    assert _blocked((await ctx.client.post(f"/api/events/{ev}/guests/{gm}/checkin")).json())
    assert _blocked((await ctx.client.post(f"/api/e/{CODE}/checkin/{gs}")).json())

    assert await _seated(t) == 2  # still exactly capacity — nobody slipped in


@pytest.mark.asyncio
async def test_manual_assignment_cannot_double_book_a_seat(ctx):
    ev = ctx.ids["event_a"]
    t, g = await _prep(ctx, ev, capacity=2)
    g1, _ = await _guest(ctx, ev, "One", group=g)
    g2, _ = await _guest(ctx, ev, "Two", group=g)

    assert (await ctx.client.patch(f"/api/events/{ev}/guests/{g1}",
            json={"table_id": t, "seat_number": "1"})).status_code == 200
    clash = await ctx.client.patch(f"/api/events/{ev}/guests/{g2}",
                                   json={"table_id": t, "seat_number": "1"})
    assert clash.status_code == 409, clash.text


@pytest.mark.asyncio
async def test_manual_seat_out_of_range_rejected(ctx):
    """A seat number beyond the table's capacity is rejected (400) — this is what
    makes concurrent manual assignment overflow-proof, since only 1..capacity
    seats can ever be used."""
    ev = ctx.ids["event_a"]
    t, g = await _prep(ctx, ev, capacity=2)
    g1, _ = await _guest(ctx, ev, "One", group=g)
    bad = await ctx.client.patch(f"/api/events/{ev}/guests/{g1}",
                                 json={"table_id": t, "seat_number": "99"})
    assert bad.status_code == 400, bad.text
    assert await _seated(t) == 0
    # ...but a seat within range still works.
    ok = await ctx.client.patch(f"/api/events/{ev}/guests/{g1}",
                                json={"table_id": t, "seat_number": "2"})
    assert ok.status_code == 200, ok.text


@pytest.mark.asyncio
async def test_manual_assignment_cannot_overfill_table(ctx):
    ev = ctx.ids["event_a"]
    t, g = await _prep(ctx, ev, capacity=2)
    g1, _ = await _guest(ctx, ev, "One", group=g)
    g2, _ = await _guest(ctx, ev, "Two", group=g)
    g3, _ = await _guest(ctx, ev, "Three", group=g)

    assert (await ctx.client.patch(f"/api/events/{ev}/guests/{g1}",
            json={"table_id": t, "seat_number": "1"})).status_code == 200
    assert (await ctx.client.patch(f"/api/events/{ev}/guests/{g2}",
            json={"table_id": t, "seat_number": "2"})).status_code == 200
    full = await ctx.client.patch(f"/api/events/{ev}/guests/{g3}",
                                  json={"table_id": t, "seat_number": "3"})
    assert full.status_code == 409, full.text
    assert await _seated(t) == 2
