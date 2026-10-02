"""Guest check-out: the checkout_enabled toggle gates the exit scan, and a
checkout records an exit + (with experience on) completes the check_out step."""
import uuid
import pytest
from sqlalchemy import delete, select

from app.models import Event, Guest, ScanEvent
from conftest import _Session


async def _admitted_guest(ctx, ev):
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.is_paid = True
        event.status = "active"
        event.checkout_enabled = False
        event.manual_checkin_enabled = False
        await s.commit()
    g = (await ctx.client.post(
        f"/api/events/{ev}/guests",
        json={"first_name": "Ada", "last_name": "Lovelace"},
    )).json()
    async with _Session() as s:
        guest = await s.get(Guest, g["id"])
        guest.admitted = True
        guest.qr_token = guest.qr_token or str(uuid.uuid4())
        await s.commit()
        return guest.id, guest.qr_token


@pytest.mark.asyncio
async def test_checkout_gated_by_flag(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])
    _, qr = await _admitted_guest(ctx, ev)

    # Disabled by default → the exit scan is refused (can't bypass via the API).
    r = await ctx.client.post(f"/api/scan/{qr}/checkout")
    assert r.json()["status"] == "checkout_disabled"

    # Enable via /features (a free toggle — not billing-gated).
    r = await ctx.client.patch(f"/api/events/{ev}/features", json={"checkout_enabled": True})
    assert r.status_code == 200 and r.json()["checkout_enabled"] is True

    # Now the exit scan works, and a second one reports already-checked-out.
    r = await ctx.client.post(f"/api/scan/{qr}/checkout")
    assert r.json()["status"] == "checked_out"
    r = await ctx.client.post(f"/api/scan/{qr}/checkout")
    assert r.json()["status"] == "already_checked_out"

    async with _Session() as s:
        outs = (await s.execute(
            select(ScanEvent).where(ScanEvent.guest_id.is_not(None), ScanEvent.direction == "out")
        )).scalars().all()
        assert any(o.direction == "out" for o in outs)


@pytest.mark.asyncio
async def test_manual_search_can_checkout_guest_without_manual_checkin(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])
    guest_id, _ = await _admitted_guest(ctx, ev)

    enabled = await ctx.client.patch(
        f"/api/events/{ev}/features",
        json={"checkout_enabled": True},
    )
    assert enabled.status_code == 200
    assert enabled.json()["checkout_enabled"] is True
    assert enabled.json()["manual_checkin_enabled"] is False

    search = await ctx.client.get(f"/api/events/{ev}/guests/search?q=lovelace")
    assert search.status_code == 200
    assert search.json()[0]["id"] == guest_id
    assert search.json()[0]["checked_out"] is False

    checkout = await ctx.client.post(f"/api/events/{ev}/guests/{guest_id}/checkout")
    assert checkout.status_code == 200
    assert checkout.json()["status"] == "checked_out"

    repeated = await ctx.client.post(f"/api/events/{ev}/guests/{guest_id}/checkout")
    assert repeated.json()["status"] == "already_checked_out"

    refreshed = await ctx.client.get(f"/api/events/{ev}/guests/search?q=lovelace")
    assert refreshed.json()[0]["checked_out"] is True


async def _named_guest(ctx, ev, first, admitted=True):
    response = await ctx.client.post(f"/api/events/{ev}/guests", json={"first_name": first, "last_name": "Demo"})
    assert response.status_code == 201, response.text
    guest = response.json()
    if admitted:
        async with _Session() as s:
            row = await s.get(Guest, guest["id"])
            row.admitted = True
            await s.commit()
    return guest


@pytest.mark.asyncio
async def test_checkout_unaffected_without_guardian_config(ctx):
    """junior_guardian_handoff_enabled on, but this guest has no configured
    entries — checkout must behave exactly as if the feature didn't exist."""
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])
    _, qr = await _admitted_guest(ctx, ev)
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.checkout_enabled = True
        event.junior_guardian_handoff_enabled = True
        await s.commit()

    r = await ctx.client.post(f"/api/scan/{qr}/checkout")
    assert r.json()["status"] == "checked_out"


@pytest.mark.asyncio
async def test_checkout_guardian_required_denies_without_and_wrong_token(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])
    child, guardian, stranger = (
        await _named_guest(ctx, ev, "Child"),
        await _named_guest(ctx, ev, "Guardian"),
        await _named_guest(ctx, ev, "Stranger"),
    )
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.is_paid = True
        event.status = "active"
        event.checkout_enabled = True
        event.junior_guardian_handoff_enabled = True
        event.guardian_authorizations = {child["id"]: [
            {"guardian_guest_id": guardian["id"], "relationship": "Parent"},
            {"guardian_guest_id": stranger["id"], "relationship": "Family friend", "source": "rsvp_other"},
        ]}
        await s.commit()

    no_token = await ctx.client.post(f"/api/scan/{child['qr_token']}/checkout")
    assert no_token.json()["status"] == "guardian_required"
    assert no_token.json()["guardian_candidates"] == [{
        "guardian_guest_id": guardian["id"], "name": "Guardian Demo", "relationship": "Parent",
    }]

    wrong_token = await ctx.client.post(
        f"/api/scan/{child['qr_token']}/checkout", json={"guardian_token": stranger["qr_token"]},
    )
    assert wrong_token.json()["status"] == "guardian_required"

    async with _Session() as s:
        outs = (await s.execute(
            select(ScanEvent).where(ScanEvent.guest_id == child["id"], ScanEvent.direction == "out")
        )).scalars().all()
        assert outs == []


@pytest.mark.asyncio
async def test_checkout_succeeds_with_correct_guardian(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])
    child, guardian = await _named_guest(ctx, ev, "Child"), await _named_guest(ctx, ev, "Guardian")
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.is_paid = True
        event.status = "active"
        event.checkout_enabled = True
        event.junior_guardian_handoff_enabled = True
        event.guardian_authorizations = {child["id"]: [{"guardian_guest_id": guardian["id"], "relationship": "Parent"}]}
        await s.commit()

    r = await ctx.client.post(
        f"/api/scan/{child['qr_token']}/checkout", json={"guardian_token": guardian["qr_token"]},
    )
    assert r.json()["status"] == "checked_out"
    assert r.json()["guardian_name"] == "Guardian Demo"
    assert r.json()["guardian_verification_method"] == "guardian_qr_checkout"

    async with _Session() as s:
        row = (await s.execute(
            select(ScanEvent).where(ScanEvent.guest_id == child["id"], ScanEvent.direction == "out")
        )).scalar_one()
        assert row.guardian_guest_id == guardian["id"]
        assert row.guardian_relationship == "Parent"


@pytest.mark.asyncio
async def test_manual_checkout_guardian_required_and_success(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])
    child, guardian = await _named_guest(ctx, ev, "Child"), await _named_guest(ctx, ev, "Guardian")
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.is_paid = True
        event.status = "active"
        event.checkout_enabled = True
        event.junior_guardian_handoff_enabled = True
        event.guardian_authorizations = {child["id"]: [{"guardian_guest_id": guardian["id"], "relationship": "Parent"}]}
        await s.commit()

    denied = await ctx.client.post(f"/api/events/{ev}/guests/{child['id']}/checkout")
    assert denied.json()["status"] == "guardian_required"

    ok = await ctx.client.post(
        f"/api/events/{ev}/guests/{child['id']}/checkout", json={"guardian_token": guardian["qr_token"]},
    )
    assert ok.json()["status"] == "checked_out"
