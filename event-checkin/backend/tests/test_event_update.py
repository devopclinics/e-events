from datetime import datetime

import pytest


@pytest.mark.asyncio
async def test_event_update_can_clear_nullable_fields_without_clearing_required_fields(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    populated = await ctx.client.put(
        f"/api/events/{event_id}",
        json={
            "event_end_date": "2026-09-01T21:00:00",
            "venue_name": "Community Hall",
            "description": "Doors open at six.",
        },
    )
    assert populated.status_code == 200
    assert populated.json()["venue_name"] == "Community Hall"

    cleared = await ctx.client.put(
        f"/api/events/{event_id}",
        json={
            "event_end_date": None,
            "venue_name": None,
            "description": None,
            "name": None,
            "event_date": None,
            "timezone": None,
            "checkin_base_url": None,
        },
    )
    assert cleared.status_code == 200
    body = cleared.json()
    assert body["event_end_date"] is None
    assert body["venue_name"] is None
    assert body["description"] is None
    assert body["name"] == "A Wedding"
    assert datetime.fromisoformat(body["event_date"]) == datetime(2026, 9, 1)
    assert body["checkin_base_url"] == "http://x"
