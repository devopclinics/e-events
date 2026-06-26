from sqlalchemy import delete

import pytest

from app.models import Event, Guest
from conftest import _Session


@pytest.mark.asyncio
async def test_public_rsvp_link_uses_event_token(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.rsvp_token = "share-token-123"
        event.rsvp_require_approval = True
        await s.execute(delete(Guest).where(Guest.event_id == ev))
        await s.commit()

    page = await ctx.client.get("/api/invite/link/share-token-123")
    assert page.status_code == 200
    payload = page.json()
    assert payload["id"] == ev
    assert payload["rsvp_token"] == "share-token-123"

    response = await ctx.client.post(
        "/api/invite/link/share-token-123/rsvp",
        json={
            "first_name": "Prospect",
            "last_name": "Guest",
            "email": "prospect@example.com",
        },
    )
    assert response.status_code == 201
    assert response.json()["rsvp_status"] == "pending"

    missing = await ctx.client.get("/api/invite/link/not-real")
    assert missing.status_code == 404
