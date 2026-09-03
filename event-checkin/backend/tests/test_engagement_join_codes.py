import re

import pytest

from app.config import settings
from app.models import Event
from app.routers.engagement import _new_live_join_code
from conftest import _Session


def test_generated_live_join_codes_are_six_unambiguous_alphanumerics():
    codes = [_new_live_join_code() for _ in range(200)]
    assert all(re.fullmatch(r"[A-HJ-NP-Z2-9]{6}", code) for code in codes)
    assert Event.__table__.c.engagement_join_code.unique is True


@pytest.mark.asyncio
async def test_short_live_join_code_is_stable_resolvable_and_authorized(ctx, monkeypatch):
    event_id = ctx.ids["event_a"]
    async with _Session() as session:
        event = await session.get(Event, event_id)
        event.engagement_enabled = True
        await session.commit()

    monkeypatch.setattr(settings, "public_base_url", "https://staging.festio.events")
    ctx.login(ctx.ids["user_a"])

    first = await ctx.client.get(f"/api/events/{event_id}/live/join-info")
    assert first.status_code == 200
    payload = first.json()
    assert re.fullmatch(r"[A-Z0-9]{6}", payload["code"])
    assert payload["url"] == f"https://staging.festio.events/l/{payload['code']}"

    second = await ctx.client.get(f"/api/events/{event_id}/live/join-info")
    assert second.status_code == 200
    assert second.json() == payload

    resolved = await ctx.client.get(f"/api/events/live/join/{payload['code'].lower()}")
    assert resolved.status_code == 200
    assert resolved.json() == {"event_id": event_id}

    public_info = await ctx.client.get(f"/api/events/{event_id}/live/public-join-info")
    assert public_info.status_code == 200
    assert public_info.json() == payload

    encoded_urls = []
    monkeypatch.setattr(
        "app.routers.engagement.generate_qr_for_url",
        lambda url: encoded_urls.append(url) or b"\x89PNG\r\n\x1a\nshort-link-test",
    )
    qr = await ctx.client.get(f"/api/events/{event_id}/live/join-qr.png")
    assert qr.status_code == 200
    assert qr.headers["content-type"] == "image/png"
    assert qr.content.startswith(b"\x89PNG")
    assert encoded_urls == [payload["url"]]

    ctx.login(ctx.ids["user_b"])
    forbidden = await ctx.client.get(f"/api/events/{event_id}/live/join-info")
    assert forbidden.status_code == 403

    missing = await ctx.client.get("/api/events/live/join/ABC")
    assert missing.status_code == 404

    async with _Session() as session:
        event = await session.get(Event, event_id)
        event.engagement_enabled = False
        await session.commit()
    disabled = await ctx.client.get(f"/api/events/live/join/{payload['code']}")
    assert disabled.status_code == 404


@pytest.mark.asyncio
async def test_presenter_share_link_uses_short_opaque_code(ctx, monkeypatch):
    event_id = ctx.ids["event_a"]
    async with _Session() as session:
        event = await session.get(Event, event_id)
        event.engagement_enabled = True
        await session.commit()

    monkeypatch.setattr(settings, "engagement_internal_token", "test-live-secret")
    monkeypatch.setattr(settings, "public_base_url", "https://staging.festio.events")
    ctx.login(ctx.ids["user_a"])
    created = await ctx.client.post(f"/api/events/{event_id}/live/share-link", json={"role": "presenter", "hours": 12})
    assert created.status_code == 200
    payload = created.json()
    assert re.fullmatch(r"[A-Za-z0-9_-]{16}", payload["code"])
    assert payload["url"] == f"https://staging.festio.events/p/{payload['code']}"
    assert "token=" not in payload["url"]

    resolved = await ctx.client.get(f"/api/events/live/share/{payload['code']}")
    assert resolved.status_code == 200
    assert resolved.json()["token"] == payload["token"]
    assert resolved.json()["role"] == "presenter"

    missing = await ctx.client.get("/api/events/live/share/not-a-real-code")
    assert missing.status_code == 404
