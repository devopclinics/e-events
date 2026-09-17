import pytest

from app.models import Event, ExperienceStep, ExperienceWorkflow, GuestSpeaker
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
    assert resolved["navigation"][1]["enabled"] is False
    assert resolved["navigation"][1]["requested_enabled"] is True
    assert resolved["navigation"][0]["requested_enabled"] is True
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
        event.experience_enabled = True
        event.live_program_enabled = True
        session.add(GuestSpeaker(event_id=event_id, name="Dr. Amina Bello", title="Educator", bio="Community educator", photo_url="https://cdn.example/speaker.webp", sort_order=1, is_active=True))
        workflow = ExperienceWorkflow(event_id=event_id, name="Convention programme", status="published", version=1, is_default=True)
        session.add(workflow)
        await session.flush()
        session.add(ExperienceStep(workflow_id=workflow.id, key="opening", type="custom", title="Opening session", description="Welcome and keynote", sort_order=10, required=False, enabled=True, starts_offset_seconds=86400 + 9 * 3600, duration_seconds=3600, is_segment=True, config={"program": {"category": "Community", "venue": "Main Hall", "audience": "All guests", "speaker": "Dr. Amina Bello"}}))
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

    source_response = await ctx.client.get(f"/api/events/{event_id}/website/content-sources")
    assert source_response.status_code == 200
    source = source_response.json()
    assert source["speakers"][0]["name"] == "Dr. Amina Bello"
    assert source["sessions"][0]["title"] == "Opening session"
    assert source["sessions"][0]["track"] == "Community"
    assert source["sessions"][0]["venue"] == "Main Hall"
    assert source["sessions"][0]["speaker"] == "Dr. Amina Bello"

    ctx.login(ctx.ids["user_b"])
    forbidden = await ctx.client.get(f"/api/events/{event_id}/website/connections")
    assert forbidden.status_code == 404
