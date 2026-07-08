"""Floor-plan designer: admin edit, live occupancy, and client share links."""
import pytest
from sqlalchemy import select

from conftest import _Session
from app.models import Event, Guest, SeatingTable


async def _paid(event_id):
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.status = "active"
        ev.seating_enabled = True
        await s.commit()


async def _tables(event_id, specs):
    ids = []
    async with _Session() as s:
        for name, cap in specs:
            t = SeatingTable(event_id=event_id, name=name, capacity=cap)
            s.add(t)
            await s.flush()
            ids.append(t.id)
        await s.commit()
    return ids


@pytest.mark.asyncio
async def test_admin_get_and_save_layout(ctx):
    ev = ctx.ids["event_a"]
    await _paid(ev)
    t1, t2 = await _tables(ev, [("Head Table", 8), ("Table 2", 10)])
    ctx.login(ctx.ids["superadmin"])

    got = await ctx.client.get(f"/api/events/{ev}/floor-plan")
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["editable"] is True
    assert {t["name"] for t in body["tables"]} == {"Head Table", "Table 2"}
    assert all(t["pos_x"] is None for t in body["tables"])  # not placed yet

    save = await ctx.client.put(f"/api/events/{ev}/floor-plan", json={
        "width": 1400, "height": 900, "bg_opacity": 30,
        "tables": [
            {"id": t1, "pos_x": 100, "pos_y": 120, "shape": "round", "rotation": 0},
            {"id": t2, "pos_x": 400, "pos_y": 120, "shape": "rect", "rotation": 90},
        ],
        "elements": [
            {"type": "stage", "label": "Stage", "pos_x": 200, "pos_y": 20, "width": 300, "height": 60},
            {"type": "entrance", "label": "Entrance", "pos_x": 0, "pos_y": 800},
        ],
    })
    assert save.status_code == 200, save.text
    out = save.json()
    assert out["width"] == 1400 and out["bg_opacity"] == 30
    placed = {t["id"]: t for t in out["tables"]}
    assert placed[t1]["pos_x"] == 100 and placed[t1]["shape"] == "round"
    assert placed[t2]["shape"] == "rect" and placed[t2]["rotation"] == 90
    assert {e["type"] for e in out["elements"]} == {"stage", "entrance"}


@pytest.mark.asyncio
async def test_layout_shows_live_occupancy(ctx):
    ev = ctx.ids["event_a"]
    await _paid(ev)
    (t1,) = await _tables(ev, [("Head Table", 8)])
    async with _Session() as s:
        g = (await s.execute(select(Guest).where(Guest.event_id == ev))).scalars().first()
        g.table_id = t1
        g.seat_number = "1"
        await s.commit()
    ctx.login(ctx.ids["superadmin"])
    body = (await ctx.client.get(f"/api/events/{ev}/floor-plan")).json()
    head = next(t for t in body["tables"] if t["id"] == t1)
    assert head["seated"] == 1


@pytest.mark.asyncio
async def test_never_placed_tables_do_not_break(ctx):
    ev = ctx.ids["event_a"]
    await _paid(ev)
    await _tables(ev, [("A", 4)])
    ctx.login(ctx.ids["superadmin"])
    # save that omits the table still works (partial layout)
    r = await ctx.client.put(f"/api/events/{ev}/floor-plan", json={"width": 1000})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_share_links_view_and_edit(ctx):
    ev = ctx.ids["event_a"]
    await _paid(ev)
    (t1,) = await _tables(ev, [("Head Table", 8)])
    ctx.login(ctx.ids["superadmin"])
    await ctx.client.put(f"/api/events/{ev}/floor-plan", json={
        "tables": [{"id": t1, "pos_x": 50, "pos_y": 60}],
    })

    share = (await ctx.client.post(f"/api/events/{ev}/floor-plan/share")).json()
    view_tok, edit_tok = share["share_token"], share["edit_token"]
    assert view_tok and edit_tok and view_tok != edit_tok

    # Client view link: read-only, no tokens leaked.
    ctx.login(None)  # simulate anonymous — token endpoints require no auth
    v = await ctx.client.get(f"/api/floor/{view_tok}")
    assert v.status_code == 200
    vb = v.json()
    assert vb["editable"] is False
    assert vb["share_token"] is None and vb["edit_token"] is None
    assert next(t for t in vb["tables"] if t["id"] == t1)["pos_x"] == 50

    # View link cannot save.
    blocked = await ctx.client.put(f"/api/floor/{view_tok}", json={"tables": [{"id": t1, "pos_x": 999}]})
    assert blocked.status_code == 403

    # Edit link can save.
    e = await ctx.client.get(f"/api/floor/{edit_tok}")
    assert e.json()["editable"] is True
    ok = await ctx.client.put(f"/api/floor/{edit_tok}", json={"tables": [{"id": t1, "pos_x": 777}]})
    assert ok.status_code == 200
    assert next(t for t in ok.json()["tables"] if t["id"] == t1)["pos_x"] == 777


@pytest.mark.asyncio
async def test_bad_token_rejected(ctx):
    r = await ctx.client.get("/api/floor/not-a-real-token")
    assert r.status_code == 404
