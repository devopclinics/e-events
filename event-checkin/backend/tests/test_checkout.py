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
