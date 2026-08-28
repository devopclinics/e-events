"""Connections, meetups, channel editing, and organizer community health."""
from datetime import datetime, timedelta
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import Header
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import Identity, current_identity
from app.database import Base, get_db
from app.main import app


SERVICE_TOKEN = "svc-secret"
SVC = {"Authorization": f"Bearer {SERVICE_TOKEN}"}


def user(subject):
    return {"Authorization": f"Bearer {subject}"}


def guest(subject):
    return {"Authorization": f"Bearer guest:{subject}"}


@pytest_asyncio.fixture
async def api(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def database_override():
        async with sessions() as session:
            yield session

    async def identity_override(authorization: str = Header(default="Bearer owner")):
        raw = authorization.removeprefix("Bearer ")
        if raw.startswith("guest:"):
            ref = raw.removeprefix("guest:")
            return Identity(ref, f"{ref}@guest.test", ref.title(), "guest")
        return Identity(raw, f"{raw}@example.test", raw.title(), "user")

    async def no_network(*args, **kwargs):
        return None

    app.dependency_overrides[get_db] = database_override
    app.dependency_overrides[current_identity] = identity_override
    monkeypatch.setattr("app.main._publish", no_network)
    monkeypatch.setattr("app.auth.settings.internal_service_token", SERVICE_TOKEN)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
    await engine.dispose()


async def setup_event(api):
    created = await api.post("/internal/v1/guesthub/event-links", headers=SVC, json={
        "external_event_ref": "evt-network", "external_org_ref": "org-1", "name": "Community Event",
        "owner": {"subject": "owner", "name": "Owner", "email": "owner@example.test"},
    })
    assert created.status_code == 201, created.text
    for ref in ("alice", "bob"):
        response = await api.put(
            f"/internal/v1/guesthub/event-links/evt-network/members/{ref}", headers=SVC,
            json={"name": ref.title(), "email": f"{ref}@example.test"},
        )
        assert response.status_code == 200, response.text
    return created.json()["festiome_id"]


@pytest.mark.asyncio
async def test_connection_request_and_accept(api):
    group_id = await setup_event(api)
    members = (await api.get(f"/v1/groups/{group_id}/members", headers=guest("alice"))).json()
    bob_id = next(member["id"] for member in members if member["display_name"] == "Bob")

    requested = await api.post(f"/v1/groups/{group_id}/connections/{bob_id}", headers=guest("alice"))
    assert requested.status_code == 201, requested.text
    assert requested.json()["status"] == "pending"

    incoming = (await api.get(f"/v1/groups/{group_id}/connections", headers=guest("bob"))).json()[0]
    assert incoming["direction"] == "incoming"
    accepted = await api.patch(
        f"/v1/connections/{incoming['id']}", headers=guest("bob"), json={"status": "accepted"},
    )
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"


@pytest.mark.asyncio
async def test_meetup_create_rsvp_and_capacity(api):
    group_id = await setup_event(api)
    start = (datetime.utcnow() + timedelta(hours=2)).isoformat()
    created = await api.post(f"/v1/groups/{group_id}/meetups", headers=guest("alice"), json={
        "title": "Coffee and community", "location": "Atrium", "starts_at": start, "capacity": 2,
    })
    assert created.status_code == 201, created.text
    meetup = created.json()
    assert meetup["attendee_count"] == 1 and meetup["my_status"] == "going"

    joined = await api.post(
        f"/v1/meetups/{meetup['id']}/rsvp", headers=guest("bob"), json={"status": "going"},
    )
    assert joined.status_code == 200
    assert joined.json()["attendee_count"] == 2


@pytest.mark.asyncio
async def test_channel_update_and_community_overview(api):
    group_id = await setup_event(api)
    channel = (await api.get(f"/v1/groups/{group_id}/channels", headers=user("owner"))).json()[0]
    updated = await api.patch(
        f"/v1/channels/{channel['id']}", headers=user("owner"),
        json={"name": "Session 3 Formal Opening", "description": "Official session community"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["slug"] == "session-3-formal-opening"

    posted = await api.post(
        f"/v1/channels/{channel['id']}/messages", headers=guest("alice"), json={"body": "Excited to be here"},
    )
    assert posted.status_code == 201
    overview = await api.get(f"/v1/groups/{group_id}/community-overview", headers=user("owner"))
    assert overview.status_code == 200, overview.text
    payload = overview.json()
    assert payload["member_count"] == 3
    assert payload["messages_7d"] == 1
    assert payload["channels"][0]["name"] == "Session 3 Formal Opening"
