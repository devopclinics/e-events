"""Configurable group access: sub-groups, open/request/closed joining, rules."""
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
    monkeypatch.setattr("app.main.settings.upload_dir", str(tmp_path))
    monkeypatch.setattr("app.auth.settings.internal_service_token", SERVICE_TOKEN)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
    await engine.dispose()


async def _event_with_guest(api, event="evt-1", host="host", guest_ref="g1"):
    """Provision an event primary group (owner=host) and one confirmed guest."""
    link = await api.post("/internal/v1/guesthub/event-links", headers=SVC, json={
        "external_event_ref": event, "external_org_ref": "org-1", "name": "A Wedding",
        "owner": {"subject": host, "name": "Host", "email": "host@a.com"},
    })
    assert link.status_code == 201, link.text
    member = await api.put(f"/internal/v1/guesthub/event-links/{event}/members/{guest_ref}",
                           headers=SVC, json={"name": "Guest One", "email": "g1@a.com"})
    assert member.status_code == 200, member.text
    return link.json()


@pytest.mark.asyncio
async def test_open_subgroup_self_join_and_directory_visibility(api):
    await _event_with_guest(api)
    # Host opens an open-join sub-group and a closed one.
    open_grp = (await api.post("/v1/events/evt-1/subgroups", headers=user("host"),
                json={"name": "Dance Floor", "join_policy": "open"})).json()
    closed_grp = (await api.post("/v1/events/evt-1/subgroups", headers=user("host"),
                  json={"name": "Family Only", "join_policy": "closed", "visibility": "unlisted"})).json()
    assert open_grp["is_primary"] is False and open_grp["join_policy"] == "open"

    # Guest sees the primary group and the listed open sub-group, but not the
    # unlisted closed one they don't belong to.
    directory = (await api.get("/v1/events/evt-1/groups", headers=guest("g1"))).json()
    names = {g["name"]: g for g in directory}
    assert "A Wedding" in names and "Dance Floor" in names
    assert "Family Only" not in names
    assert names["Dance Floor"]["is_member"] is False

    # Open join succeeds and is idempotent.
    joined = await api.post(f"/v1/groups/{open_grp['id']}/join", headers=guest("g1"), json={})
    assert joined.status_code == 200 and joined.json()["status"] == "joined"
    again = await api.post(f"/v1/groups/{open_grp['id']}/join", headers=guest("g1"), json={})
    assert again.json()["status"] == "already_member"

    # The closed sub-group refuses self-join even for an event guest.
    denied = await api.post(f"/v1/groups/{closed_grp['id']}/join", headers=guest("g1"), json={})
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_non_event_member_cannot_discover_or_join(api):
    await _event_with_guest(api)
    open_grp = (await api.post("/v1/events/evt-1/subgroups", headers=user("host"),
                json={"name": "Open", "join_policy": "open"})).json()
    # A stranger who is not a confirmed guest is refused discovery and join.
    assert (await api.get("/v1/events/evt-1/groups", headers=guest("stranger"))).status_code == 404
    assert (await api.post(f"/v1/groups/{open_grp['id']}/join", headers=guest("stranger"), json={})).status_code == 404


@pytest.mark.asyncio
async def test_request_to_join_approve_and_deny(api):
    await _event_with_guest(api)
    await api.put("/internal/v1/guesthub/event-links/evt-1/members/g2", headers=SVC,
                  json={"name": "Guest Two", "email": "g2@a.com"})
    grp = (await api.post("/v1/events/evt-1/subgroups", headers=user("host"),
           json={"name": "VIP", "join_policy": "request"})).json()

    # Guest one requests; the request is idempotent while pending.
    r1 = await api.post(f"/v1/groups/{grp['id']}/join", headers=guest("g1"), json={"message": "please"})
    assert r1.json()["status"] == "requested"
    assert (await api.post(f"/v1/groups/{grp['id']}/join", headers=guest("g1"), json={})).json()["status"] == "already_requested"

    # Guest two requests too.
    await api.post(f"/v1/groups/{grp['id']}/join", headers=guest("g2"), json={})

    pending = (await api.get(f"/v1/groups/{grp['id']}/join-requests", headers=user("host"))).json()
    assert len(pending) == 2
    by_ref = {p["identity_ref"]: p for p in pending}

    approved = await api.post(f"/v1/groups/{grp['id']}/join-requests/{by_ref['g1']['id']}/approve",
                              headers=user("host"), json={"role": "member"})
    assert approved.status_code == 200
    denied = await api.post(f"/v1/groups/{grp['id']}/join-requests/{by_ref['g2']['id']}/deny", headers=user("host"))
    assert denied.status_code == 204

    # g1 is now a member; g2 is not.
    dir_g1 = {g["name"]: g for g in (await api.get("/v1/events/evt-1/groups", headers=guest("g1"))).json()}
    assert dir_g1["VIP"]["is_member"] is True
    dir_g2 = {g["name"]: g for g in (await api.get("/v1/events/evt-1/groups", headers=guest("g2"))).json()}
    assert dir_g2["VIP"]["is_member"] is False and dir_g2["VIP"]["has_pending_request"] is False

    assert (await api.get(f"/v1/groups/{grp['id']}/join-requests", headers=user("host"))).json() == []
    decided = (await api.get(f"/v1/groups/{grp['id']}/join-requests", headers=user("host"), params={"status": "denied"})).json()
    assert len(decided) == 1 and decided[0]["identity_ref"] == "g2"

    # A guest cannot moderate requests.
    assert (await api.get(f"/v1/groups/{grp['id']}/join-requests", headers=guest("g1"))).status_code == 403


@pytest.mark.asyncio
async def test_rules_must_be_accepted_before_posting(api):
    await _event_with_guest(api)
    grp = (await api.post("/v1/events/evt-1/subgroups", headers=user("host"),
           json={"name": "Bus A", "join_policy": "open", "rules": "Be kind."})).json()
    assert grp["rules_version"] == 1

    await api.post(f"/v1/groups/{grp['id']}/join", headers=guest("g1"), json={})
    channel = (await api.get(f"/v1/groups/{grp['id']}/channels", headers=guest("g1"))).json()[0]

    # Posting is blocked until the guest accepts the rules.
    blocked = await api.post(f"/v1/channels/{channel['id']}/messages", headers=guest("g1"), json={"body": "hi"})
    assert blocked.status_code == 403 and "rules" in blocked.json()["detail"].lower()

    group_view = (await api.get(f"/v1/groups/{grp['id']}", headers=guest("g1"))).json()
    assert group_view["rules_accepted"] is False

    accept = await api.post(f"/v1/groups/{grp['id']}/accept-rules", headers=guest("g1"))
    assert accept.json()["rules_accepted"] is True
    ok = await api.post(f"/v1/channels/{channel['id']}/messages", headers=guest("g1"), json={"body": "hi"})
    assert ok.status_code == 201

    # Editing the rules re-locks posting until re-accepted.
    await api.patch(f"/v1/groups/{grp['id']}", headers=user("host"), json={"rules": "Be kind and quiet."})
    relocked = await api.post(f"/v1/channels/{channel['id']}/messages", headers=guest("g1"), json={"body": "again"})
    assert relocked.status_code == 403
    await api.post(f"/v1/groups/{grp['id']}/accept-rules", headers=guest("g1"))
    assert (await api.post(f"/v1/channels/{channel['id']}/messages", headers=guest("g1"), json={"body": "again"})).status_code == 201


@pytest.mark.asyncio
async def test_internal_admin_manages_subgroups_and_requests(api):
    """GuestHub organizer tooling (service-authed) drives sub-groups without a
    personal FestioMe login."""
    await _event_with_guest(api)
    created = await api.post("/internal/v1/guesthub/event-links/evt-1/subgroups", headers=SVC,
                             json={"name": "Shuttle", "join_policy": "request"})
    assert created.status_code == 201
    grp = created.json()

    listed = (await api.get("/internal/v1/guesthub/event-links/evt-1/subgroups", headers=SVC)).json()
    assert [g["name"] for g in listed] == ["Shuttle"] and listed[0]["is_primary"] is False

    # A guest requests to join; the organizer sees and approves it via internal API.
    await api.post(f"/v1/groups/{grp['id']}/join", headers=guest("g1"), json={"message": "seat please"})
    pending = (await api.get(f"/internal/v1/guesthub/event-links/evt-1/subgroups/{grp['id']}/join-requests", headers=SVC)).json()
    assert len(pending) == 1 and pending[0]["identity_ref"] == "g1"

    approved = await api.post(
        f"/internal/v1/guesthub/event-links/evt-1/subgroups/{grp['id']}/join-requests/{pending[0]['id']}/approve",
        headers=SVC, json={"role": "member"})
    assert approved.status_code == 200
    dir_g1 = {g["name"]: g for g in (await api.get("/v1/events/evt-1/groups", headers=guest("g1"))).json()}
    assert dir_g1["Shuttle"]["is_member"] is True

    # Update policy + rules via internal API.
    patched = await api.patch(f"/internal/v1/guesthub/event-links/evt-1/subgroups/{grp['id']}", headers=SVC,
                              json={"join_policy": "open", "rules": "Be on time."})
    assert patched.status_code == 200
    body = patched.json()
    assert body["join_policy"] == "open" and body["rules_version"] == 1

    # A sub-group from another event cannot be touched through this event's link.
    await _event_with_guest(api, event="evt-2", host="host2", guest_ref="gz")
    other = (await api.post("/internal/v1/guesthub/event-links/evt-2/subgroups", headers=SVC,
             json={"name": "Other", "join_policy": "open"})).json()
    cross = await api.patch(f"/internal/v1/guesthub/event-links/evt-1/subgroups/{other['id']}", headers=SVC,
                            json={"join_policy": "closed"})
    assert cross.status_code == 404


@pytest.mark.asyncio
async def test_primary_group_stays_closed_and_isolated(api):
    link = await _event_with_guest(api)
    primary_id = link["festiome_id"]
    # A sub-group exists, but the integration contract still targets the primary.
    await api.post("/v1/events/evt-1/subgroups", headers=user("host"), json={"name": "Side", "join_policy": "open"})
    synced = await api.put("/internal/v1/guesthub/event-links/evt-1/members/g3", headers=SVC, json={"name": "Guest Three"})
    assert synced.json()["group_id"] == primary_id

    # The primary roster is not self-joinable and cannot be opened up.
    assert (await api.post(f"/v1/groups/{primary_id}/join", headers=guest("g1"), json={})).status_code == 403
    reject = await api.patch(f"/v1/groups/{primary_id}", headers=user("host"), json={"join_policy": "open"})
    assert reject.status_code == 400
