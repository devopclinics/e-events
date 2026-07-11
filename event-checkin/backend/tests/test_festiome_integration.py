"""GuestHub ↔ FestioMe integration and failure-isolation tests."""

import httpx
import pytest
from sqlalchemy import select

from app.main import app
from app.models import Event, FestioMeOutbox, Guest
from app.database import get_db
from conftest import _Session


async def _enable_festiome_addon(event_id: str) -> None:
    """FestioMe is a paid add-on; promote the event so the gated endpoints
    are reachable, mirroring how other add-on tests flip is_paid."""
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.festiome_addon_enabled = True
        await s.commit()
from app.services.festiome_client import (
    FestioMeClient,
    FestioMeEventLink,
    FestioMeUnavailable,
    get_festiome_client,
)


class FakeFestioMeClient:
    configured = True

    def __init__(self, *, unavailable: bool = False):
        self.unavailable = unavailable
        self.enabled_with = None

    async def event_status(self, external_event_ref: str):
        if self.unavailable:
            raise FestioMeUnavailable("offline")
        return FestioMeEventLink(
            enabled=True,
            festiome_id="fm-1",
            name="A Wedding",
            open_url="/festiome/fm-1",
        )

    async def enable_for_event(self, **payload):
        if self.unavailable:
            raise FestioMeUnavailable("offline")
        self.enabled_with = payload
        return FestioMeEventLink(
            enabled=True,
            festiome_id="fm-1",
            name=payload["name"],
            open_url="/festiome/fm-1",
        )

    async def guest_token(self, external_event_ref: str, **payload):
        if self.unavailable:
            raise FestioMeUnavailable("offline")
        return {"token": "guest-session", "expires_at": "2026-09-01T12:00:00Z"}


@pytest.mark.asyncio
async def test_event_admin_can_read_and_enable_festiome(ctx):
    fake = FakeFestioMeClient()
    app.dependency_overrides[get_festiome_client] = lambda: fake
    await _enable_festiome_addon(ctx.ids["event_a"])
    ctx.login(ctx.ids["user_a"])

    status = await ctx.client.get(f'/api/events/{ctx.ids["event_a"]}/festiome/status')
    assert status.status_code == 200
    assert status.json() == {
        "configured": True,
        "available": True,
        "enabled": True,
        "festiome_id": "fm-1",
        "name": "A Wedding",
        "open_url": "/festiome/fm-1",
        "detail": None,
    }

    enabled = await ctx.client.post(f'/api/events/{ctx.ids["event_a"]}/festiome/enable')
    assert enabled.status_code == 200
    assert fake.enabled_with["external_event_ref"] == ctx.ids["event_a"]
    assert fake.enabled_with["external_org_ref"] == ctx.ids["org_a"]
    assert fake.enabled_with["owner_email"] == "alice@a.com"
    db_gen = app.dependency_overrides[get_db]()
    db = await anext(db_gen)
    try:
        event = await db.get(Event, ctx.ids["event_a"])
        assert event.festiome_enabled is True
        assert event.festiome_id == "fm-1"
        assert event.festiome_open_url == "/festiome/fm-1"
    finally:
        await db_gen.aclose()


@pytest.mark.asyncio
async def test_cross_tenant_user_cannot_probe_festiome_status(ctx):
    app.dependency_overrides[get_festiome_client] = lambda: FakeFestioMeClient()
    ctx.login(ctx.ids["user_b"])
    response = await ctx.client.get(f'/api/events/{ctx.ids["event_a"]}/festiome/status')
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_free_event_cannot_use_festiome(ctx):
    """FestioMe is a paid add-on: an unpaid event is refused at the plan gate."""
    app.dependency_overrides[get_festiome_client] = lambda: FakeFestioMeClient()
    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.get(f'/api/events/{ctx.ids["event_a"]}/festiome/status')
    assert response.status_code == 402


@pytest.mark.asyncio
async def test_paid_event_without_addon_optin_is_refused(ctx):
    """A paid event that has not opted into the add-on still cannot use it."""
    app.dependency_overrides[get_festiome_client] = lambda: FakeFestioMeClient()
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True  # paid, but festiome_addon_enabled stays False
        await s.commit()
    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.get(f'/api/events/{ctx.ids["event_a"]}/festiome/status')
    assert response.status_code == 400
    assert "not enabled" in response.json()["detail"]


@pytest.mark.asyncio
async def test_festiome_outage_degrades_status_without_affecting_guesthub(ctx):
    app.dependency_overrides[get_festiome_client] = lambda: FakeFestioMeClient(unavailable=True)
    await _enable_festiome_addon(ctx.ids["event_a"])
    ctx.login(ctx.ids["user_a"])

    response = await ctx.client.get(f'/api/events/{ctx.ids["event_a"]}/festiome/status')
    assert response.status_code == 200
    assert response.json()["available"] is False
    assert "GuestHub is unaffected" in response.json()["detail"]

    # GuestHub's own health path remains independent from FestioMe.
    health = await ctx.client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_client_uses_only_internal_versioned_contract():
    seen = []

    async def handler(request: httpx.Request):
        seen.append((request.method, request.url.path, request.headers.get("authorization")))
        if request.method == "GET":
            return httpx.Response(404)
        return httpx.Response(201, json={"id": "fm-2", "enabled": True})

    client = FestioMeClient(
        "http://festiome.test",
        "secret",
        transport=httpx.MockTransport(handler),
    )
    status = await client.event_status("event-1")
    assert status.enabled is False
    await client.enable_for_event(
        external_event_ref="event-1",
        external_org_ref="org-1",
        name="Festio Launch",
        owner_subject="user-1",
        owner_name="Owner",
        owner_email="owner@example.com",
    )
    assert seen == [
        ("GET", "/internal/v1/guesthub/event-links/event-1", "Bearer secret"),
        ("POST", "/internal/v1/guesthub/event-links", "Bearer secret"),
    ]


@pytest.mark.asyncio
async def test_client_member_guest_token_and_announcement_contracts():
    seen = []

    async def handler(request: httpx.Request):
        seen.append((request.method, request.url.path, request.json if hasattr(request, "json") else None))
        return httpx.Response(200, json={"token": "t", "expires_at": "soon", "id": "m1"})

    # httpx Request has no json() helper; record bodies through paths/methods.
    async def simple_handler(request: httpx.Request):
        seen.append((request.method, request.url.path))
        return httpx.Response(200, json={"token": "t", "expires_at": "soon", "id": "m1"})

    client = FestioMeClient("http://festiome.test", "secret", transport=httpx.MockTransport(simple_handler))
    await client.upsert_guest("e1", guest_ref="g1", name="Guest One", email=None, phone=None, status="confirmed")
    await client.remove_guest("e1", "g1")
    await client.guest_token("e1", guest_ref="g1", name="Guest One", email=None)
    await client.publish_announcement(
        "e1", idempotency_key="a1", title="Update", body="Changed", kind="schedule",
        urgent=False, source_ref="s1",
    )
    assert seen == [
        ("PUT", "/internal/v1/guesthub/event-links/e1/members/g1"),
        ("DELETE", "/internal/v1/guesthub/event-links/e1/members/g1"),
        ("POST", "/internal/v1/guesthub/event-links/e1/guest-token"),
        ("POST", "/internal/v1/guesthub/event-links/e1/announcements"),
    ]


@pytest.mark.asyncio
async def test_guest_pass_exchange_requires_confirmed_matching_pass(ctx):
    fake = FakeFestioMeClient()
    app.dependency_overrides[get_festiome_client] = lambda: fake
    await _enable_festiome_addon(ctx.ids["event_a"])
    db_gen = app.dependency_overrides[get_db]()
    db = await anext(db_gen)
    try:
        guest = await db.scalar(select(Guest).where(Guest.event_id == ctx.ids["event_a"]))
        guest.rsvp_status = "confirmed"
        await db.commit()
        token = guest.qr_token
    finally:
        await db_gen.aclose()

    response = await ctx.client.post(
        f'/api/events/{ctx.ids["event_a"]}/festiome/guest-token',
        json={"pass_token": token},
    )
    assert response.status_code == 200
    assert response.json()["token"] == "guest-session"

    denied = await ctx.client.post(
        f'/api/events/{ctx.ids["event_a"]}/festiome/guest-token',
        json={"pass_token": "00000000-0000-0000-0000-000000000000"},
    )
    assert denied.status_code == 404


@pytest.mark.asyncio
async def test_announcement_is_queued_without_calling_festiome(ctx):
    await _enable_festiome_addon(ctx.ids["event_a"])
    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.post(
        f'/api/events/{ctx.ids["event_a"]}/festiome/announcements',
        json={"title": "Room change", "body": "Meet in room B", "kind": "schedule"},
    )
    assert response.status_code == 202

    db_gen = app.dependency_overrides[get_db]()
    db = await anext(db_gen)
    try:
        row = await db.scalar(select(FestioMeOutbox).where(FestioMeOutbox.event_id == ctx.ids["event_a"]))
        assert row.command == "announcement.publish"
        assert row.status == "pending"
        assert row.payload["body"] == "Meet in room B"
    finally:
        await db_gen.aclose()
