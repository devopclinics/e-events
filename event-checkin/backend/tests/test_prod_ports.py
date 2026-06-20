"""Ported-from-prod fixes: seat assignment for pre-assigned guests, name-based
guest dedup, invite_status tracking, and the super-admin MMS toggle."""
import pytest
from sqlalchemy import select, delete

from app.models import Event, Guest
from conftest import _Session


async def _prep(event_id, *, seating=False, active=False, mms=False):
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.seating_enabled = seating
        if active:
            ev.status = "active"
        await s.execute(delete(Guest).where(Guest.event_id == event_id))
        await s.commit()


@pytest.mark.asyncio
async def test_seat_assigned_for_pre_assigned_table(ctx):
    """A guest pre-assigned to a table but with no seat gets a seat at scan time
    (the bug: previously skipped entirely)."""
    await _prep(ctx.ids["event_a"], seating=True, active=True)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    t = (await ctx.client.post(f"/api/events/{ev}/tables", json={"name": "T1", "capacity": 5})).json()
    g = (await ctx.client.post(f"/api/events/{ev}/guests", json={"first_name": "Pre", "last_name": "Seated"})).json()
    # Pre-assign a table but NO seat, directly.
    async with _Session() as s:
        guest = await s.get(Guest, g["id"])
        guest.table_id = t["id"]
        guest.seat_number = None
        await s.commit()

    r = await ctx.client.post(f"/api/scan/{g['qr_token']}")
    assert r.json()["status"] == "admitted"
    assert r.json()["table_name"] == "T1"
    assert r.json()["seat_number"]            # got a seat within the pre-assigned table


@pytest.mark.asyncio
async def test_import_dedup_by_name_not_email(ctx):
    """Re-importing the same person with a different email must NOT duplicate."""
    await _prep(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    csv1 = "first_name,last_name,email\nAda,Lovelace,ada@x.com\n"
    r1 = (await ctx.client.post(f"/api/events/{ev}/guests/upload",
          files={"file": ("a.csv", csv1, "text/csv")})).json()
    assert r1["added"] == 1

    # Same name, different email → should be treated as the same guest (no dup).
    csv2 = "first_name,last_name,email\nada,LOVELACE,changed@x.com\n"
    r2 = (await ctx.client.post(f"/api/events/{ev}/guests/upload",
          files={"file": ("b.csv", csv2, "text/csv")})).json()
    assert r2["added"] == 0
    async with _Session() as s:
        n = len((await s.execute(select(Guest).where(Guest.event_id == ev))).scalars().all())
    assert n == 1


@pytest.mark.asyncio
async def test_import_backfills_missing_email(ctx):
    await _prep(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    # First import: name only, no email.
    await ctx.client.post(f"/api/events/{ev}/guests/upload",
                          files={"file": ("a.csv", "first_name,last_name,phone\nSam,Lee,\n", "text/csv")})
    # Second import: same name, now WITH an email → backfilled, not duplicated.
    await ctx.client.post(f"/api/events/{ev}/guests/upload",
                          files={"file": ("b.csv", "first_name,last_name,email\nSam,Lee,sam@x.com\n", "text/csv")})
    async with _Session() as s:
        rows = (await s.execute(select(Guest).where(Guest.event_id == ev))).scalars().all()
    assert len(rows) == 1 and rows[0].email == "sam@x.com"


@pytest.mark.asyncio
async def test_invite_status_sent_and_failed(ctx):
    await _prep(ctx.ids["event_a"])
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    with_email = (await ctx.client.post(f"/api/events/{ev}/guests",
                  json={"first_name": "Has", "last_name": "Email", "email": "has@x.com"})).json()
    no_contact = (await ctx.client.post(f"/api/events/{ev}/guests",
                  json={"first_name": "No", "last_name": "Contact"})).json()

    r = await ctx.client.post(f"/api/events/{ev}/guests/send-batch", json={"force": True})
    assert r.status_code == 200
    async with _Session() as s:
        a = await s.get(Guest, with_email["id"])
        b = await s.get(Guest, no_contact["id"])
    assert a.invite_status == "sent"
    assert b.invite_status == "failed"


@pytest.mark.asyncio
async def test_mms_toggle_superadmin_only(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])            # org owner, not platform superadmin
    assert (await ctx.client.patch(f"/api/admin/events/{ev}/mms", json={"active": True})).status_code == 403

    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.patch(f"/api/admin/events/{ev}/mms", json={"active": True})
    assert r.status_code == 200 and r.json()["notify_mms"] is True
    async with _Session() as s:
        assert (await s.get(Event, ev)).notify_mms is True
