"""Gamification (points ledger, leaderboard, anti-gaming caps) and
matchmaking (profile fields, shared-tag suggested connections)."""
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

class FakeRedis:
    """Enough of redis.asyncio.Redis's surface for _rate_limit/_award_points
    fixed-window counters to run for real in tests, without a real server."""
    def __init__(self):
        self.values: dict[str, int] = {}

    async def incr(self, key):
        self.values[key] = self.values.get(key, 0) + 1
        return self.values[key]

    async def expire(self, key, seconds):
        return True

    async def publish(self, channel, message):
        return 0


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
    monkeypatch.setattr("app.main._publish", no_network)
    monkeypatch.setattr("app.main.settings.upload_dir", str(tmp_path))
    monkeypatch.setattr("app.auth.settings.internal_service_token", SERVICE_TOKEN)
    monkeypatch.setattr("app.main.redis", FakeRedis())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
    await engine.dispose()


async def _event_with_guest(api, event="evt-1", host="host", guest_ref="g1"):
    link = await api.post("/internal/v1/guesthub/event-links", headers=SVC, json={
        "external_event_ref": event, "external_org_ref": "org-1", "name": "A Wedding",
        "owner": {"subject": host, "name": "Host", "email": "host@a.com"},
    })
    assert link.status_code == 201, link.text
    member = await api.put(f"/internal/v1/guesthub/event-links/{event}/members/{guest_ref}",
                           headers=SVC, json={"name": "Guest One", "email": "g1@a.com"})
    assert member.status_code == 200, member.text
    return link.json()


# ── Gamification ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_message_and_reaction_and_poll_vote_award_points(api):
    link = await _event_with_guest(api)
    group_id = link["festiome_id"]
    channel = (await api.get(f"/v1/groups/{group_id}/channels", headers=guest("g1"))).json()[0]

    posted = await api.post(f"/v1/channels/{channel['id']}/messages", headers=guest("g1"), json={"body": "hi"})
    assert posted.status_code == 201
    msg_id = posted.json()["id"]
    await api.post(f"/v1/messages/{msg_id}/reactions", headers=guest("g1"), json={"emoji": "👍"})

    poll_msg = await api.post(f"/v1/channels/{channel['id']}/polls", headers=user("host"),
                              json={"question": "Cake or pie?", "options": ["Cake", "Pie"]})
    assert poll_msg.status_code == 201
    option_id = poll_msg.json()["options"][0]["id"]
    await api.post(f"/v1/polls/{poll_msg.json()['id']}/votes", headers=guest("g1"), json={"option_ids": [option_id]})

    board = (await api.get(f"/v1/groups/{group_id}/leaderboard", headers=guest("g1"))).json()
    me = next(row for row in board["items"] if row["display_name"] == "Guest One")
    # message (+1) + reaction (+1) + poll vote (+2) = 4
    assert me["points"] == 4


@pytest.mark.asyncio
async def test_group_join_awards_points_once_not_on_rejoin(api):
    await _event_with_guest(api)
    sub = (await api.post("/v1/events/evt-1/subgroups", headers=user("host"),
           json={"name": "Dance Floor", "join_policy": "open"})).json()

    joined = await api.post(f"/v1/groups/{sub['id']}/join", headers=guest("g1"), json={})
    assert joined.json()["status"] == "joined"
    await api.post(f"/v1/groups/{sub['id']}/leave", headers=guest("g1"))
    rejoined = await api.post(f"/v1/groups/{sub['id']}/join", headers=guest("g1"), json={})
    assert rejoined.json()["status"] == "joined"

    board = (await api.get(f"/v1/groups/{sub['id']}/leaderboard", headers=guest("g1"))).json()
    # Joining the sub-group creates a fresh Member there (display_name "G1",
    # from the guest identity's own name — distinct from "Guest One", the
    # primary-group Member set up by _event_with_guest).
    me = next(row for row in board["items"] if row["display_name"] == "G1")
    assert me["points"] == 5  # not 10 — the rejoin didn't re-award


@pytest.mark.asyncio
async def test_message_points_are_capped_per_day(api):
    link = await _event_with_guest(api)
    group_id = link["festiome_id"]
    channel = (await api.get(f"/v1/groups/{group_id}/channels", headers=guest("g1"))).json()[0]

    for i in range(18):
        r = await api.post(f"/v1/channels/{channel['id']}/messages", headers=guest("g1"), json={"body": f"msg {i}"})
        assert r.status_code == 201

    board = (await api.get(f"/v1/groups/{group_id}/leaderboard", headers=guest("g1"))).json()
    me = next(row for row in board["items"] if row["display_name"] == "Guest One")
    assert me["points"] == 15  # capped, not 18


@pytest.mark.asyncio
async def test_dm_messages_do_not_award_points(api):
    link = await _event_with_guest(api)
    group_id = link["festiome_id"]
    members = (await api.get(f"/v1/groups/{group_id}/members", headers=user("host"))).json()
    guest_member_id = next(m["id"] for m in members if m["display_name"] == "Guest One")
    dm = await api.post(f"/v1/groups/{group_id}/dms", headers=user("host"), json={"member_id": guest_member_id})
    await api.post(f"/v1/channels/{dm.json()['id']}/messages", headers=user("host"), json={"body": "hey"})

    board = (await api.get(f"/v1/groups/{group_id}/leaderboard", headers=user("host"))).json()
    assert board["items"] == []


@pytest.mark.asyncio
async def test_leaderboard_orders_by_points_desc_and_includes_me_outside_top(api):
    link = await _event_with_guest(api)
    group_id = link["festiome_id"]
    for ref in ["g2", "g3", "g4"]:
        await api.put(f"/internal/v1/guesthub/event-links/evt-1/members/{ref}", headers=SVC, json={"name": ref.title(), "email": f"{ref}@a.com"})
    channel = (await api.get(f"/v1/groups/{group_id}/channels", headers=guest("g2"))).json()[0]
    for ref, n in [("g2", 3), ("g3", 1), ("g4", 2)]:
        for i in range(n):
            await api.post(f"/v1/channels/{channel['id']}/messages", headers=guest(ref), json={"body": f"{ref}-{i}"})

    board = (await api.get(f"/v1/groups/{group_id}/leaderboard?limit=2", headers=guest("g3"))).json()
    assert [row["display_name"] for row in board["items"][:2]] == ["G2", "G4"]
    assert board["me"]["display_name"] == "G3" and board["me"]["points"] == 1


# ── Matchmaking ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_profile_tags_are_normalized_and_capped(api):
    group = (await api.post("/v1/groups", json={"name": "Reunion"}, headers=user("host"))).json()
    updated = await api.patch(f"/v1/profile?group_id={group['id']}", headers=user("host"), json={
        "display_name": "Host", "bio": "I like long walks",
        "interest_tags": ["  Hiking ", "HIKING", "Photography"] + [f"tag{i}" for i in range(10)],
    })
    assert updated.status_code == 200
    body = updated.json()
    assert body["bio"] == "I like long walks"
    assert body["interest_tags"][:2] == ["hiking", "photography"]
    assert len(body["interest_tags"]) == 10  # capped


@pytest.mark.asyncio
async def test_suggested_connections_ranks_by_shared_tags_and_excludes_taglessmembers(api):
    link = await _event_with_guest(api)
    group_id = link["festiome_id"]
    await api.put("/internal/v1/guesthub/event-links/evt-1/members/g2", headers=SVC, json={"name": "G2", "email": "g2@a.com"})
    await api.put("/internal/v1/guesthub/event-links/evt-1/members/g3", headers=SVC, json={"name": "G3", "email": "g3@a.com"})

    await api.patch(f"/v1/profile?group_id={group_id}", headers=guest("g1"), json={
        "display_name": "Guest One", "interest_tags": ["hiking", "photography", "coffee"]})
    await api.patch(f"/v1/profile?group_id={group_id}", headers=guest("g2"), json={
        "display_name": "G2", "interest_tags": ["hiking", "coffee"]})
    await api.patch(f"/v1/profile?group_id={group_id}", headers=guest("g3"), json={
        "display_name": "G3", "interest_tags": ["skiing"]})
    # host never sets tags — must not appear.

    matches = (await api.get(f"/v1/groups/{group_id}/matches", headers=guest("g1"))).json()["items"]
    assert [m["display_name"] for m in matches] == ["G2"]
    assert matches[0]["shared_tags"] == ["coffee", "hiking"]
    assert matches[0]["score"] == 2


@pytest.mark.asyncio
async def test_no_tags_means_no_suggestions(api):
    group = (await api.post("/v1/groups", json={"name": "Reunion"}, headers=user("host"))).json()
    invite = (await api.post(f"/v1/groups/{group['id']}/invitations", json={}, headers=user("host"))).json()
    await api.post(f"/v1/invitations/{invite['token']}/accept", headers=user("second"))
    await api.patch(f"/v1/profile?group_id={group['id']}", headers=user("second"), json={
        "display_name": "Second", "interest_tags": ["hiking"]})

    mine = (await api.get(f"/v1/groups/{group['id']}/matches", headers=user("host"))).json()["items"]
    assert mine == []  # host has no tags of their own


# ── Discoverability ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_non_discoverable_member_hidden_from_non_staff_but_visible_to_staff(api):
    group = (await api.post("/v1/groups", json={"name": "Reunion"}, headers=user("host"))).json()
    invite = (await api.post(f"/v1/groups/{group['id']}/invitations", json={}, headers=user("host"))).json()
    await api.post(f"/v1/invitations/{invite['token']}/accept", headers=user("hidden"))
    await api.patch(f"/v1/profile?group_id={group['id']}", headers=user("hidden"), json={
        "display_name": "Hidden", "discoverable": False})

    as_host = (await api.get(f"/v1/groups/{group['id']}/members", headers=user("host"))).json()
    assert "Hidden" in [m["display_name"] for m in as_host]  # staff still sees everyone

    invite2 = (await api.post(f"/v1/groups/{group['id']}/invitations", json={}, headers=user("host"))).json()
    await api.post(f"/v1/invitations/{invite2['token']}/accept", headers=user("plain"))
    as_plain_member = (await api.get(f"/v1/groups/{group['id']}/members", headers=user("plain"))).json()
    assert "Hidden" not in [m["display_name"] for m in as_plain_member]


@pytest.mark.asyncio
async def test_non_discoverable_member_excluded_from_suggestions(api):
    group = (await api.post("/v1/groups", json={"name": "Reunion"}, headers=user("host"))).json()
    invite = (await api.post(f"/v1/groups/{group['id']}/invitations", json={}, headers=user("host"))).json()
    await api.post(f"/v1/invitations/{invite['token']}/accept", headers=user("hidden"))
    await api.patch(f"/v1/profile?group_id={group['id']}", headers=user("hidden"), json={
        "display_name": "Hidden", "interest_tags": ["hiking"], "discoverable": False})
    await api.patch(f"/v1/profile?group_id={group['id']}", headers=user("host"), json={
        "display_name": "Host", "interest_tags": ["hiking"]})

    matches = (await api.get(f"/v1/groups/{group['id']}/matches", headers=user("host"))).json()["items"]
    assert matches == []
