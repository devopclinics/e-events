import pytest

from app.models import Event
from app.routers.public_sites import _website_connections
from conftest import _Session


@pytest.mark.asyncio
async def test_festiome_organizer_route_becomes_guest_entry(ctx):
    """event.festiome_open_url is an in-app relative route (e.g.
    "/festiome?group=…"), meant for the SPA's own router. The website
    connections catalog feeds Link/NavigationItem fields that both require
    a real absolute URL — a bare relative path there 422s Publish (seen
    live on the Al-Azeemah event: "must be an http(s) ... destination")."""
    event_id = ctx.ids["event_a"]
    async with _Session() as session:
        event = await session.get(Event, event_id)
        event.rsvp_enabled = True
        event.rsvp_token = "demo"
        event.festiome_addon_enabled = True
        event.festiome_open_url = "/festiome?group=55ad2036-6acc-46ee-b573-61ec3015b500"
        event.checkin_base_url = "https://staging.festio.events"
        await session.commit()

        event = await session.get(Event, event_id)
        connections = await _website_connections(event, session)

        assert connections["festiome"]["url"] == "https://staging.festio.events/rsvp/demo?recover=1&destination=festiome"
        assert connections["festiome"]["available"] is True


@pytest.mark.asyncio
async def test_festiome_catalog_uses_verified_guest_entry_even_with_stored_url(ctx):
    event_id = ctx.ids["event_a"]
    async with _Session() as session:
        event = await session.get(Event, event_id)
        event.rsvp_enabled = True
        event.rsvp_token = "demo"
        event.festiome_addon_enabled = True
        event.festiome_open_url = "https://community.example.com/festiome/abc"
        event.checkin_base_url = "https://staging.festio.events"
        await session.commit()

        event = await session.get(Event, event_id)
        connections = await _website_connections(event, session)

        assert connections["festiome"]["url"] == "https://staging.festio.events/rsvp/demo?recover=1&destination=festiome"
