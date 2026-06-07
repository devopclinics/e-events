"""Test fixtures for tenant-isolation tests.

Uses an in-memory SQLite DB and overrides get_db + get_current_user, so no
Postgres, Firebase, or app lifespan (migrations/poller) is involved.
"""
from datetime import datetime

import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db
from app.auth import get_current_user
from app.models import Organization, Membership, User, Event, Guest

_engine = create_async_engine(
    "sqlite+aiosqlite://",
    poolclass=StaticPool,
    connect_args={"check_same_thread": False},
)
_Session = async_sessionmaker(_engine, expire_on_commit=False)

# The "logged-in" user for the current request (set via ctx.login()).
_current = {"user": None}


async def _override_get_db():
    async with _Session() as s:
        yield s


async def _override_current_user():
    return _current["user"]


class Ctx:
    """Handle returned to tests: the HTTP client, seeded ids, and a login switch."""
    def __init__(self, client):
        self.client = client
        self.ids = {}

    def login(self, user):
        _current["user"] = user


@pytest_asyncio.fixture
async def ctx():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    async with _Session() as s:
        org_a = Organization(name="Org A", slug="org-a")
        org_b = Organization(name="Org B", slug="org-b")
        s.add_all([org_a, org_b])
        await s.flush()

        user_a = User(name="Alice", email="alice@a.com", role="official")
        user_b = User(name="Bob", email="bob@b.com", role="official")
        superadmin = User(name="Op", email="op@x.com", role="official", is_platform_superadmin=True)
        s.add_all([user_a, user_b, superadmin])
        await s.flush()

        s.add_all([
            Membership(org_id=org_a.id, user_id=user_a.id, role="owner"),
            Membership(org_id=org_b.id, user_id=user_b.id, role="owner"),
        ])
        event_a = Event(
            org_id=org_a.id, name="A Wedding", couples_name="A & A",
            event_date=datetime(2026, 9, 1), checkin_base_url="http://x",
        )
        s.add(event_a)
        await s.flush()
        s.add(Guest(event_id=event_a.id, first_name="G", last_name="One", email="g@a.com"))
        await s.commit()

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_current_user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        c = Ctx(client)
        c.ids = {
            "org_a": org_a.id, "org_b": org_b.id,
            "user_a": user_a, "user_b": user_b, "superadmin": superadmin,
            "event_a": event_a.id,
        }
        yield c

    app.dependency_overrides.clear()
    _current["user"] = None
