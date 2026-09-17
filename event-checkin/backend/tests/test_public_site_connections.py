import pytest

from app.models import Event
from app.routers.public_sites import _resolve_navigation
from conftest import _Session


def test_resolve_navigation_refreshes_system_links_and_preserves_manual_state():
    content = {
        "contact_email": "events@example.com",
        "navigation": [
            {"id": "venue", "label": "Find us", "destination_type": "venue", "url": "https://stale.example", "enabled": True},
            {"id": "live", "label": "Live", "destination_type": "festio_live", "url": "https://stale.example/live", "enabled": True},
            {"id": "contact", "label": "Contact", "destination_type": "contact", "url": "", "enabled": True},
            {"id": "custom", "label": "Partner", "destination_type": "custom", "url": "https://partner.example", "enabled": False},
        ],
    }
    connections = {
        "venue": {"url": "https://maps.example/current", "available": True},
        "festio_live": {"url": "", "available": False},
        "contact": {"url": "", "available": False},
    }

    resolved = _resolve_navigation(content, connections)

    assert resolved["navigation"][0]["url"] == "https://maps.example/current"
    assert resolved["navigation"][1]["url"] == ""
    assert resolved["navigation"][1]["enabled"] is True
    assert resolved["navigation"][2]["url"] == "mailto:events@example.com"
    assert resolved["navigation"][3] == content["navigation"][3]
    assert content["navigation"][0]["url"] == "https://stale.example"


@pytest.mark.asyncio
async def test_website_connection_catalog_uses_current_event_setup(ctx, monkeypatch):
    event_id = ctx.ids["event_a"]
    async with _Session() as session:
        event = await session.get(Event, event_id)
        event.checkin_base_url = "https://staging.festio.events"
        event.venue_name = "NCNMO Centre"
        event.venue_address = "12 Community Road, Chicago"
        event.rsvp_enabled = True
        event.rsvp_token = "rsvp-demo"
        event.speaker_enabled = True
        event.speaker_token = "speaker-demo"
        event.engagement_enabled = True
        event.engagement_join_code = "LIVE26"
        event.festiome_addon_enabled = True
        event.festiome_open_url = "https://community.example/ncnmo"
        await session.commit()

    monkeypatch.setattr("app.config.settings.public_base_url", "https://staging.festio.events")
    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.get(f"/api/events/{event_id}/website/connections")

    assert response.status_code == 200
    connections = response.json()["connections"]
    assert connections["venue"]["url"] == "https://www.google.com/maps/search/?api=1&query=12+Community+Road%2C+Chicago"
    assert connections["speakers"]["url"] == "https://staging.festio.events/speakers/speaker-demo"
    assert connections["rsvp"]["url"] == "https://staging.festio.events/rsvp/rsvp-demo"
    assert connections["festio_live"]["url"] == "https://staging.festio.events/l/LIVE26"
    assert connections["festiome"]["url"] == "https://community.example/ncnmo"
    assert connections["rsvp"]["configure_url"] == "/guests-redesign?tab=invite"

    ctx.login(ctx.ids["user_b"])
    forbidden = await ctx.client.get(f"/api/events/{event_id}/website/connections")
    assert forbidden.status_code == 404
