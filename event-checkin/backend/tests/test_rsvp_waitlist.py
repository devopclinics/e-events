"""Capacity waitlist (Gatsby gap-backlog item): RSVPs beyond capacity are
queued instead of rejected, and a freed spot (decline/staff-reject/delete)
auto-promotes the longest-waiting queued guest. Staff can also see the queue
and manually promote a specific guest out of order."""
import pytest
from sqlalchemy import delete, select

from app.models import Event, Guest
from app.routers import guests as guests_mod
from conftest import _Session


async def _event(event_id, *, capacity, require_approval=False, multi_invitee=False):
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.rsvp_enabled = True
        ev.invite_mode = "open"
        ev.rsvp_require_approval = require_approval
        ev.rsvp_email_required = False
        ev.rsvp_capacity = capacity
        ev.rsvp_multi_invitee_enabled = multi_invitee
        ev.is_paid = True
        await s.execute(delete(Guest).where(Guest.event_id == event_id))
        await s.commit()


def _capture_email(monkeypatch):
    calls = []
    async def fake(to, subject, html, *args, **kwargs):
        calls.append((to, subject))
    monkeypatch.setattr(guests_mod, "send_simple_email", fake)
    return calls


@pytest.mark.asyncio
async def test_rsvp_waitlists_once_capacity_reached(ctx):
    ev = ctx.ids["event_a"]
    await _event(ev, capacity=1)

    first = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Ada", "last_name": "A", "email": "ada@x.com",
    })
    assert first.status_code == 201
    assert first.json()["rsvp_status"] == "confirmed"

    second = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Bo", "last_name": "B", "email": "bo@x.com",
    })
    assert second.status_code == 201, second.text
    body = second.json()
    assert body["rsvp_status"] == "waitlisted"

    async with _Session() as s:
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev, Guest.email == "bo@x.com"))).scalar_one()
        assert guest.waitlisted_at is not None
        assert guest.qr_generated_at is None
        assert guest.invite_sent_at is None


@pytest.mark.asyncio
async def test_multi_invitee_rsvp_waitlists_whole_party_together(ctx):
    ev = ctx.ids["event_a"]
    await _event(ev, capacity=2, multi_invitee=True)

    # Fills the only remaining spot with a single-guest submission.
    r1 = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Ada", "last_name": "A", "email": "ada@x.com",
    })
    assert r1.status_code == 201 and r1.json()["rsvp_status"] == "confirmed"

    # Party of 2 (submitter + 1 invitee) no longer fits — must waitlist BOTH,
    # not split the party across confirmed/waitlisted.
    r2 = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Cy", "last_name": "C", "email": "cy@x.com",
        "invitees": [{"full_name": "Dee D", "email": "dee@x.com"}],
    })
    assert r2.status_code == 201, r2.text
    assert r2.json()["rsvp_status"] == "waitlisted"

    async with _Session() as s:
        guests = (await s.execute(
            select(Guest).where(Guest.event_id == ev, Guest.email.in_(["cy@x.com", "dee@x.com"]))
        )).scalars().all()
        assert len(guests) == 2
        assert all(g.rsvp_status == "waitlisted" for g in guests)
        assert all(g.waitlisted_at is not None for g in guests)


@pytest.mark.asyncio
async def test_declined_guest_no_longer_blocks_capacity(ctx):
    """Regression: _rsvp_count previously counted declined guests toward
    capacity, so a decline never actually freed the spot it should have."""
    ev = ctx.ids["event_a"]
    await _event(ev, capacity=1)

    first = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Ada", "last_name": "A", "email": "ada@x.com",
    })
    guest_id = first.json()["id"]

    ctx.login(ctx.ids["superadmin"])
    reject = await ctx.client.post(f"/api/events/{ev}/guests/{guest_id}/reject")
    assert reject.status_code == 200

    second = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Bo", "last_name": "B", "email": "bo@x.com",
    })
    assert second.status_code == 201
    assert second.json()["rsvp_status"] == "confirmed"   # not waitlisted — spot was freed


@pytest.mark.asyncio
async def test_reject_promotes_longest_waiting_guest(ctx, monkeypatch):
    ev = ctx.ids["event_a"]
    await _event(ev, capacity=1)
    calls = _capture_email(monkeypatch)

    first = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Ada", "last_name": "A", "email": "ada@x.com",
    })
    confirmed_id = first.json()["id"]
    second = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Bo", "last_name": "B", "email": "bo@x.com",
    })
    assert second.json()["rsvp_status"] == "waitlisted"
    waitlisted_id = second.json()["id"]

    ctx.login(ctx.ids["superadmin"])
    reject = await ctx.client.post(f"/api/events/{ev}/guests/{confirmed_id}/reject")
    assert reject.status_code == 200

    async with _Session() as s:
        promoted = await s.get(Guest, waitlisted_id)
        assert promoted.rsvp_status == "confirmed"
        assert promoted.waitlisted_at is None
        assert promoted.qr_generated_at is not None


@pytest.mark.asyncio
async def test_delete_guest_promotes_waitlist(ctx):
    ev = ctx.ids["event_a"]
    await _event(ev, capacity=1)

    first = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Ada", "last_name": "A", "email": "ada@x.com",
    })
    confirmed_id = first.json()["id"]
    second = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Bo", "last_name": "B", "email": "bo@x.com",
    })
    waitlisted_id = second.json()["id"]

    ctx.login(ctx.ids["superadmin"])
    delete_resp = await ctx.client.delete(f"/api/events/{ev}/guests/{confirmed_id}")
    assert delete_resp.status_code == 204

    async with _Session() as s:
        promoted = await s.get(Guest, waitlisted_id)
        assert promoted.rsvp_status == "confirmed"
        assert promoted.waitlisted_at is None


@pytest.mark.asyncio
async def test_deleting_a_waitlisted_guest_does_not_promote_anyone(ctx):
    """Removing a guest who never held a spot must not trigger a promotion."""
    ev = ctx.ids["event_a"]
    await _event(ev, capacity=1)

    first = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Ada", "last_name": "A", "email": "ada@x.com",
    })
    confirmed_id = first.json()["id"]
    second = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Bo", "last_name": "B", "email": "bo@x.com",
    })
    third = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Cy", "last_name": "C", "email": "cy@x.com",
    })
    waitlisted_id_2 = second.json()["id"]
    waitlisted_id_3 = third.json()["id"]

    ctx.login(ctx.ids["superadmin"])
    delete_resp = await ctx.client.delete(f"/api/events/{ev}/guests/{waitlisted_id_2}")
    assert delete_resp.status_code == 204

    async with _Session() as s:
        still_confirmed = await s.get(Guest, confirmed_id)
        assert still_confirmed.rsvp_status == "confirmed"
        still_waitlisted = await s.get(Guest, waitlisted_id_3)
        assert still_waitlisted.rsvp_status == "waitlisted"   # untouched, no promotion happened


@pytest.mark.asyncio
async def test_list_waitlist_returns_queue_in_order(ctx):
    ev = ctx.ids["event_a"]
    await _event(ev, capacity=1)

    await ctx.client.post(f"/api/invite/{ev}/rsvp", json={"first_name": "Ada", "last_name": "A", "email": "ada@x.com"})
    b = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={"first_name": "Bo", "last_name": "B", "email": "bo@x.com"})
    c = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={"first_name": "Cy", "last_name": "C", "email": "cy@x.com"})

    ctx.login(ctx.ids["superadmin"])
    listed = await ctx.client.get(f"/api/events/{ev}/waitlist")
    assert listed.status_code == 200
    ids = [g["id"] for g in listed.json()]
    assert ids == [b.json()["id"], c.json()["id"]]


@pytest.mark.asyncio
async def test_manual_promote_picks_specific_guest_out_of_order(ctx):
    ev = ctx.ids["event_a"]
    await _event(ev, capacity=1)

    await ctx.client.post(f"/api/invite/{ev}/rsvp", json={"first_name": "Ada", "last_name": "A", "email": "ada@x.com"})
    b = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={"first_name": "Bo", "last_name": "B", "email": "bo@x.com"})
    c = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={"first_name": "Cy", "last_name": "C", "email": "cy@x.com"})
    b_id, c_id = b.json()["id"], c.json()["id"]

    ctx.login(ctx.ids["superadmin"])
    # Promote C even though B has been waiting longer — staff's explicit choice.
    promote = await ctx.client.post(f"/api/events/{ev}/guests/{c_id}/promote")
    assert promote.status_code == 200
    assert promote.json()["rsvp_status"] == "confirmed"

    async with _Session() as s:
        c_guest = await s.get(Guest, c_id)
        b_guest = await s.get(Guest, b_id)
        assert c_guest.rsvp_status == "confirmed"
        assert b_guest.rsvp_status == "waitlisted"   # untouched — still queued


@pytest.mark.asyncio
async def test_promote_rejects_guest_not_on_waitlist(ctx):
    ev = ctx.ids["event_a"]
    await _event(ev, capacity=1)
    confirmed = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Ada", "last_name": "A", "email": "ada@x.com",
    })
    ctx.login(ctx.ids["superadmin"])
    resp = await ctx.client.post(f"/api/events/{ev}/guests/{confirmed.json()['id']}/promote")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_waitlist_promotion_respects_approval_requirement(ctx):
    """If the event requires approval, a promoted guest lands as 'pending'
    (for staff review) rather than being auto-confirmed."""
    ev = ctx.ids["event_a"]
    await _event(ev, capacity=1, require_approval=True)

    first = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Ada", "last_name": "A", "email": "ada@x.com",
    })
    assert first.json()["rsvp_status"] == "pending"
    confirmed_id = first.json()["id"]

    second = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Bo", "last_name": "B", "email": "bo@x.com",
    })
    assert second.json()["rsvp_status"] == "waitlisted"
    waitlisted_id = second.json()["id"]

    ctx.login(ctx.ids["superadmin"])
    reject = await ctx.client.post(f"/api/events/{ev}/guests/{confirmed_id}/reject")
    assert reject.status_code == 200

    async with _Session() as s:
        promoted = await s.get(Guest, waitlisted_id)
        assert promoted.rsvp_status == "pending"
        assert promoted.waitlisted_at is None
        assert promoted.qr_generated_at is None   # no ticket until staff approves
