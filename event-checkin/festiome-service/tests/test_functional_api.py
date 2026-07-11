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
        subject = authorization.removeprefix("Bearer ")
        return Identity(subject, f"{subject}@example.test", subject.title())

    async def no_network(*args, **kwargs):
        return None

    app.dependency_overrides[get_db] = database_override
    app.dependency_overrides[current_identity] = identity_override
    monkeypatch.setattr("app.main._rate_limit", no_network)
    monkeypatch.setattr("app.main._publish", no_network)
    monkeypatch.setattr("app.main.settings.upload_dir", str(tmp_path))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.asyncio
async def test_group_membership_roles_and_ownership(api):
    group = (await api.post("/v1/groups", json={"name": "Launch"})).json()
    invite = (await api.post(f"/v1/groups/{group['id']}/invitations", json={})).json()
    joined = (await api.post(f"/v1/invitations/{invite['token']}/accept", headers={"Authorization": "Bearer second"})).json()

    assert (await api.patch(f"/v1/groups/{group['id']}/members/{joined['id']}", json={"role": "moderator"})).json()["role"] == "moderator"
    assert (await api.post(f"/v1/groups/{group['id']}/transfer-ownership", json={"member_id": joined["id"]})).status_code == 200
    assert (await api.post(f"/v1/groups/{group['id']}/leave")).status_code == 204
    assert (await api.get(f"/v1/groups/{group['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_messages_attachments_mentions_search_and_moderation(api):
    group = (await api.post("/v1/groups", json={"name": "Messages"})).json()
    channel = (await api.get(f"/v1/groups/{group['id']}/channels")).json()[0]
    owner = (await api.get(f"/v1/groups/{group['id']}/members")).json()[0]
    uploaded = (await api.post(f"/v1/channels/{channel['id']}/attachments",
                files={"file": ("safe.png", b"\x89PNG\r\n\x1a\npng-content", "image/png")})).json()
    created = (await api.post(f"/v1/channels/{channel['id']}/messages", json={
        "body": "hello searchable", "mention_member_ids": [owner["id"]],
        "attachments": [uploaded],
    })).json()
    assert created["attachments"][0]["filename"] == "safe.png"
    assert (await api.get(uploaded["url"])).content == b"\x89PNG\r\n\x1a\npng-content"
    assert (await api.patch(f"/v1/messages/{created['id']}", json={"body": "hello edited searchable"})).json()["edited_at"]
    assert len((await api.get(f"/v1/groups/{group['id']}/search", params={"q": "searchable"})).json()["items"]) == 1
    report = (await api.post(f"/v1/messages/{created['id']}/reports", json={"reason": "test"})).json()
    assert (await api.patch(f"/v1/groups/{group['id']}/reports/{report['id']}", json={"status": "resolved"})).json()["status"] == "resolved"
    assert (await api.delete(f"/v1/messages/{created['id']}")).status_code == 204


@pytest.mark.asyncio
async def test_polls_preferences_unread_and_cross_channel_reply_validation(api):
    group = (await api.post("/v1/groups", json={"name": "Polls"})).json()
    first = (await api.get(f"/v1/groups/{group['id']}/channels")).json()[0]
    second = (await api.post(f"/v1/groups/{group['id']}/channels", json={"name": "Elsewhere"})).json()
    message = (await api.post(f"/v1/channels/{first['id']}/messages", json={"body": "one"})).json()
    invalid = await api.post(f"/v1/channels/{second['id']}/messages", json={"body": "bad", "parent_id": message["id"]})
    assert invalid.status_code == 400
    poll = (await api.post(f"/v1/channels/{first['id']}/polls", json={"question": "Choose", "options": ["A", "B"]})).json()
    vote = await api.post(f"/v1/polls/{poll['id']}/votes", json={"option_ids": [poll["options"][0]["id"]]})
    assert vote.json()["options"][0]["votes"] == 1
    prefs = await api.put("/v1/notification-preferences", params={"group_id": group["id"]}, json={"digest": "weekly", "muted_channel_ids": [second["id"]]})
    assert prefs.json()["digest"] == "weekly"
    assert "unread_count" in (await api.get(f"/v1/groups/{group['id']}/channels")).json()[0]
