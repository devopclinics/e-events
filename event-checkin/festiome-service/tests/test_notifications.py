"""Push-notification wiring: NotificationJob creation on message/DM/join/
moderation events, and the worker that consumes them via messaging-service."""
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import Header
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import Identity, current_identity
from app.database import Base, get_db
from app.main import _process_notification_jobs, app
from app.models import NotificationJob

SERVICE_TOKEN = "svc-secret"
SVC = {"Authorization": f"Bearer {SERVICE_TOKEN}"}


def user(sub: str) -> dict:
    return {"Authorization": f"Bearer {sub}"}


def guest(ref: str) -> dict:
    return {"Authorization": f"Bearer guest:{ref}"}


class FakeMessagingClient:
    def __init__(self):
        self.calls = []

    async def send_push(self, event_id, *, guest_ids, title, body):
        self.calls.append({"event_id": event_id, "guest_ids": guest_ids, "title": title, "body": body})


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

    fake_client = FakeMessagingClient()

    app.dependency_overrides[get_db] = database_override
    app.dependency_overrides[current_identity] = identity_override
    monkeypatch.setattr("app.main._rate_limit", no_network)
    monkeypatch.setattr("app.main._publish", no_network)
    monkeypatch.setattr("app.main.settings.upload_dir", str(tmp_path))
    monkeypatch.setattr("app.auth.settings.internal_service_token", SERVICE_TOKEN)
    monkeypatch.setattr("app.main.get_messaging_client", lambda: fake_client)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.fake_messaging = fake_client
        client.sessions = sessions
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


@pytest.mark.asyncio
async def test_message_queues_push_job_and_worker_delivers(api):
    link = await _event_with_guest(api)
    group_id = link["festiome_id"]
    channel = (await api.get(f"/v1/groups/{group_id}/channels", headers=user("host"))).json()[0]

    posted = await api.post(f"/v1/channels/{channel['id']}/messages", headers=user("host"), json={"body": "Ceremony starts at 4pm"})
    assert posted.status_code == 201

    async with api.sessions() as db:
        jobs = (await db.execute(select(NotificationJob))).scalars().all()
        assert len(jobs) == 1 and jobs[0].kind == "channel_message" and jobs[0].status == "queued"
        await _process_notification_jobs(db)
        await db.commit()
        refreshed = (await db.execute(select(NotificationJob))).scalars().all()
        assert refreshed[0].status == "sent"

    assert len(api.fake_messaging.calls) == 1
    call = api.fake_messaging.calls[0]
    assert call["event_id"] == "evt-1"
    assert call["guest_ids"] == ["g1"]


@pytest.mark.asyncio
async def test_dm_queues_push_job(api):
    link = await _event_with_guest(api)
    group_id = link["festiome_id"]
    members = (await api.get(f"/v1/groups/{group_id}/members", headers=user("host"))).json()
    guest_member_id = next(m["id"] for m in members if m["display_name"] == "Guest One")
    dm = await api.post(f"/v1/groups/{group_id}/dms", headers=user("host"), json={"member_id": guest_member_id})
    assert dm.status_code == 201
    channel_id = dm.json()["id"]

    posted = await api.post(f"/v1/channels/{channel_id}/messages", headers=user("host"), json={"body": "hey"})
    assert posted.status_code == 201

    async with api.sessions() as db:
        jobs = (await db.execute(select(NotificationJob))).scalars().all()
        assert len(jobs) == 1 and jobs[0].kind == "dm"
        await _process_notification_jobs(db)

    assert len(api.fake_messaging.calls) == 1
    assert api.fake_messaging.calls[0]["guest_ids"] == ["g1"]


@pytest.mark.asyncio
async def test_non_guest_member_job_is_skipped_not_sent(api):
    link = await _event_with_guest(api)
    group_id = link["festiome_id"]
    await api.put("/internal/v1/guesthub/event-links/evt-1/users/official-uid",
                  headers=SVC, json={"name": "Event Official", "email": "official@example.test", "role": "member"})
    channel = (await api.get(f"/v1/groups/{group_id}/channels", headers=user("host"))).json()[0]

    posted = await api.post(f"/v1/channels/{channel['id']}/messages", headers=user("host"), json={"body": "hi all"})
    assert posted.status_code == 201

    async with api.sessions() as db:
        await _process_notification_jobs(db)
        await db.commit()
        jobs = (await db.execute(select(NotificationJob))).scalars().all()
        # host's own membership never gets a job (author excluded); official
        # (user-kind) is skipped; guest g1 gets sent.
        statuses = {j.status for j in jobs}
        assert "sent" in statuses
        skipped = [j for j in jobs if j.status == "skipped"]
        assert len(skipped) == 1


@pytest.mark.asyncio
async def test_join_request_decision_sends_push(api):
    await _event_with_guest(api)
    sub = (await api.post("/v1/events/evt-1/subgroups", headers=user("host"),
           json={"name": "Dance Floor", "join_policy": "request"})).json()
    requested = await api.post(f"/v1/groups/{sub['id']}/join", headers=guest("g1"), json={})
    assert requested.json()["status"] == "requested"
    pending = (await api.get(f"/v1/groups/{sub['id']}/join-requests", headers=user("host"))).json()
    request_id = pending[0]["id"]

    approved = await api.post(f"/v1/groups/{sub['id']}/join-requests/{request_id}/approve", headers=user("host"), json={"role": "member"})
    assert approved.status_code == 200

    assert len(api.fake_messaging.calls) == 1
    assert api.fake_messaging.calls[0]["guest_ids"] == ["g1"]
    assert "approved" in api.fake_messaging.calls[0]["body"]


@pytest.mark.asyncio
async def test_moderation_resolution_sends_push_to_reporter(api):
    link = await _event_with_guest(api)
    group_id = link["festiome_id"]
    channel = (await api.get(f"/v1/groups/{group_id}/channels", headers=user("host"))).json()[0]
    msg = (await api.post(f"/v1/channels/{channel['id']}/messages", headers=user("host"), json={"body": "hmm"})).json()

    reported = await api.post(f"/v1/messages/{msg['id']}/reports", headers=guest("g1"), json={"reason": "spam"})
    assert reported.status_code == 201
    report_id = reported.json()["id"]

    resolved = await api.patch(f"/v1/groups/{group_id}/reports/{report_id}", headers=user("host"),
                               json={"status": "resolved", "resolution_note": "handled"})
    assert resolved.status_code == 200

    assert len(api.fake_messaging.calls) == 1
    assert api.fake_messaging.calls[0]["guest_ids"] == ["g1"]
