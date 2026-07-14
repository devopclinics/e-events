"""Private channels (selected members + staff oversight) and direct messages."""
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


def user(sub: str) -> dict:
    return {"Authorization": f"Bearer {sub}"}


def guest(ref: str) -> dict:
    return {"Authorization": f"Bearer guest:{ref}"}


@pytest_asyncio.fixture
async def api(monkeypatch, tmp_path):
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
            ref = raw[len("guest:"):]
            return Identity(ref, f"{ref}@guest.test", ref.title(), "guest")
        return Identity(raw, f"{raw}@example.test", raw.title(), "user")

    async def no_network(*args, **kwargs):
        return None

    app.dependency_overrides[get_db] = database_override
    app.dependency_overrides[current_identity] = identity_override
    monkeypatch.setattr("app.main._rate_limit", no_network)
    monkeypatch.setattr("app.main._publish", no_network)
    monkeypatch.setattr("app.auth.settings.internal_service_token", SERVICE_TOKEN)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
    await engine.dispose()


async def _event(api, event="evt-1", host="host", guests=("g1", "g2", "g3")):
    """Primary group owned by `host` with the given confirmed guests. Returns
    (group_id, {guest_ref: member_id, 'host': owner_member_id})."""
    link = (await api.post("/internal/v1/guesthub/event-links", headers=SVC, json={
        "external_event_ref": event, "external_org_ref": "org-1", "name": "A Wedding",
        "owner": {"subject": host, "name": "Host", "email": "host@a.com"},
    })).json()
    for ref in guests:
        r = await api.put(f"/internal/v1/guesthub/event-links/{event}/members/{ref}",
                          headers=SVC, json={"name": ref.upper(), "email": f"{ref}@a.com"})
        assert r.status_code == 200, r.text
    group_id = link["festiome_id"]
    members = (await api.get(f"/v1/groups/{group_id}/members", headers=user(host))).json()
    ids = {m["display_name"]: m["id"] for m in members}
    lookup = {"host": ids["Host"]}
    for ref in guests:
        lookup[ref] = ids[ref.upper()]
    return group_id, lookup


def _names(channels):
    return {c["name"] for c in channels}


@pytest.mark.asyncio
async def test_private_channel_scoped_to_selected_members(api):
    group_id, ids = await _event(api)
    # Host creates a private channel with only g1 enrolled.
    ch = (await api.post(f"/v1/groups/{group_id}/channels", headers=user("host"), json={
        "name": "Haflah Parents", "is_private": True, "member_ids": [ids["g1"]],
    })).json()
    assert ch["is_private"] is True and ch["member_count"] == 2  # g1 + creator

    # g1 (enrolled) sees it; g2 (not enrolled) does not; host keeps oversight.
    assert "Haflah Parents" in _names((await api.get(f"/v1/groups/{group_id}/channels", headers=guest("g1"))).json())
    assert "Haflah Parents" not in _names((await api.get(f"/v1/groups/{group_id}/channels", headers=guest("g2"))).json())
    assert "Haflah Parents" in _names((await api.get(f"/v1/groups/{group_id}/channels", headers=user("host"))).json())

    # g2 cannot read or post to a channel they aren't in.
    assert (await api.get(f"/v1/channels/{ch['id']}/messages", headers=guest("g2"))).status_code == 404
    assert (await api.post(f"/v1/channels/{ch['id']}/messages", headers=guest("g2"), json={"body": "hi"})).status_code == 404
    # g1 can post.
    assert (await api.post(f"/v1/channels/{ch['id']}/messages", headers=guest("g1"), json={"body": "hi"})).status_code == 201


@pytest.mark.asyncio
async def test_add_and_leave_private_channel(api):
    group_id, ids = await _event(api)
    ch = (await api.post(f"/v1/groups/{group_id}/channels", headers=user("host"), json={
        "name": "Support", "is_private": True, "member_ids": [ids["g1"]],
    })).json()
    # Host adds g2.
    added = await api.post(f"/v1/channels/{ch['id']}/members", headers=user("host"),
                           json={"member_ids": [ids["g2"]]})
    assert added.status_code == 201
    assert "Support" in _names((await api.get(f"/v1/groups/{group_id}/channels", headers=guest("g2"))).json())
    # g2 removes themselves and loses visibility.
    left = await api.delete(f"/v1/channels/{ch['id']}/members/{ids['g2']}", headers=guest("g2"))
    assert left.status_code == 204
    assert "Support" not in _names((await api.get(f"/v1/groups/{group_id}/channels", headers=guest("g2"))).json())
    # A non-member cannot add people.
    assert (await api.post(f"/v1/channels/{ch['id']}/members", headers=guest("g3"),
                           json={"member_ids": [ids["g2"]]})).status_code in (403, 404)


@pytest.mark.asyncio
async def test_direct_message_is_private_and_deduplicated(api):
    group_id, ids = await _event(api)
    dm = (await api.post(f"/v1/groups/{group_id}/dms", headers=guest("g1"),
                         json={"member_id": ids["g2"]})).json()
    assert dm["is_dm"] is True and dm["member_count"] == 2
    assert dm["name"] == "G2"  # titled by the counterpart from g1's view

    # Re-opening returns the same channel (find-or-create).
    again = (await api.post(f"/v1/groups/{group_id}/dms", headers=guest("g1"),
                            json={"member_id": ids["g2"]})).json()
    assert again["id"] == dm["id"]

    # g2 sees the DM, titled by g1; host (staff) does NOT — no oversight on DMs.
    g2_channels = (await api.get(f"/v1/groups/{group_id}/channels", headers=guest("g2"))).json()
    dm_row = next((c for c in g2_channels if c["id"] == dm["id"]), None)
    assert dm_row is not None and dm_row["name"] == "G1"
    host_channels = (await api.get(f"/v1/groups/{group_id}/channels", headers=user("host"))).json()
    assert all(c["id"] != dm["id"] for c in host_channels)

    # An uninvolved guest cannot read the DM.
    assert (await api.get(f"/v1/channels/{dm['id']}/messages", headers=guest("g3"))).status_code == 404
    # Both participants can exchange messages.
    assert (await api.post(f"/v1/channels/{dm['id']}/messages", headers=guest("g1"), json={"body": "hey"})).status_code == 201
    assert (await api.post(f"/v1/channels/{dm['id']}/messages", headers=guest("g2"), json={"body": "hi"})).status_code == 201


@pytest.mark.asyncio
async def test_cannot_dm_self_and_open_channel_has_no_roster(api):
    group_id, ids = await _event(api)
    assert (await api.post(f"/v1/groups/{group_id}/dms", headers=guest("g1"),
                           json={"member_id": ids["g1"]})).status_code == 400
    general = (await api.get(f"/v1/groups/{group_id}/channels", headers=user("host"))).json()[0]
    assert (await api.get(f"/v1/channels/{general['id']}/members", headers=user("host"))).status_code == 400
