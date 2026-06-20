import pytest
from sqlalchemy import select

from app.models import Event, Guest
from conftest import _Session


@pytest.mark.asyncio
async def test_menu_dashboard_allows_guests_without_email(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        ev.menu_enabled = True

        guest = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        guest.email = None
        await s.commit()

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/menu/dashboard")

    assert r.status_code == 200
    assert r.json()["guests"][0]["email"] is None
