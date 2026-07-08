"""Gift registry surfaces on the guest's ticket when the event has it enabled."""
import pytest
from sqlalchemy import select

from conftest import _Session
from app.models import Event, Guest


async def _guest_with_registry(event_id, *, enabled):
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.registry_enabled = enabled
        ev.registry_token = "reg-token-123" if enabled else None
        ev.registry_message = "Your presence is enough — but if you'd like to gift, here's our list."
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        await s.commit()
        return guest.qr_token


@pytest.mark.asyncio
async def test_ticket_surfaces_registry_when_enabled(ctx):
    qr = await _guest_with_registry(ctx.ids["event_a"], enabled=True)
    r = await ctx.client.get(f"/api/scan/{qr}/ticket")
    assert r.status_code == 200
    ev = r.json()["event"]
    assert ev["registry_enabled"] is True
    assert ev["registry_token"] == "reg-token-123"
    assert ev["registry_message"]


@pytest.mark.asyncio
async def test_ticket_hides_registry_when_disabled(ctx):
    qr = await _guest_with_registry(ctx.ids["event_a"], enabled=False)
    r = await ctx.client.get(f"/api/scan/{qr}/ticket")
    assert r.status_code == 200
    ev = r.json()["event"]
    assert ev["registry_enabled"] is False
    assert ev["registry_token"] is None
