"""Cross-group search and multi-emoji reactions."""
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


def user(sub: str) -> dict:
    return {"Authorization": f"Bearer {sub}"}


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
async def test_search_spans_every_group_the_member_belongs_to(api):
    g1 = (await api.post("/v1/groups", json={"name": "Wedding"}, headers=user("host"))).json()
    g2 = (await api.post("/v1/groups", json={"name": "Book Club"}, headers=user("host"))).json()
    c1 = (await api.get(f"/v1/groups/{g1['id']}/channels", headers=user("host"))).json()[0]
    c2 = (await api.get(f"/v1/groups/{g2['id']}/channels", headers=user("host"))).json()[0]
    await api.post(f"/v1/channels/{c1['id']}/messages", headers=user("host"), json={"body": "the venue is confirmed"})
    await api.post(f"/v1/channels/{c2['id']}/messages", headers=user("host"), json={"body": "next book is confirmed too"})

    scoped = (await api.get(f"/v1/groups/{g1['id']}/search?q=confirmed", headers=user("host"))).json()
    assert len(scoped["items"]) == 1

    everywhere = (await api.get("/v1/members/me/search?q=confirmed", headers=user("host"))).json()
    assert len(everywhere["items"]) == 2
    assert {g1["id"], g2["id"]} == {m["group_id"] for m in everywhere["items"]}


@pytest.mark.asyncio
async def test_search_excludes_groups_the_caller_left(api):
    g1 = (await api.post("/v1/groups", json={"name": "Wedding"}, headers=user("host"))).json()
    c1 = (await api.get(f"/v1/groups/{g1['id']}/channels", headers=user("host"))).json()[0]
    invite = (await api.post(f"/v1/groups/{g1['id']}/invitations", json={}, headers=user("host"))).json()
    await api.post(f"/v1/invitations/{invite['token']}/accept", headers=user("second"))
    await api.post(f"/v1/channels/{c1['id']}/messages", headers=user("host"), json={"body": "hello there"})

    before = (await api.get("/v1/members/me/search?q=hello", headers=user("second"))).json()
    assert len(before["items"]) == 1

    left = await api.post(f"/v1/groups/{g1['id']}/leave", headers=user("second"))
    assert left.status_code == 204

    everywhere = (await api.get("/v1/members/me/search?q=hello", headers=user("second"))).json()
    assert everywhere["items"] == []


@pytest.mark.asyncio
async def test_multiple_emoji_reactions_coexist_on_one_message(api):
    group = (await api.post("/v1/groups", json={"name": "Reunion"}, headers=user("host"))).json()
    channel = (await api.get(f"/v1/groups/{group['id']}/channels", headers=user("host"))).json()[0]
    msg = (await api.post(f"/v1/channels/{channel['id']}/messages", headers=user("host"), json={"body": "hi"})).json()

    await api.post(f"/v1/messages/{msg['id']}/reactions", headers=user("host"), json={"emoji": "👍"})
    result = (await api.post(f"/v1/messages/{msg['id']}/reactions", headers=user("host"), json={"emoji": "😂"})).json()

    reactions = {r["emoji"]: r["count"] for r in result["reactions"]}
    assert reactions == {"👍": 1, "😂": 1}
