"""In-memory SQLite fixtures for dashboard-service — no Postgres, no Firebase.

Mirrors backend/tests/conftest.py's approach: override get_db + the auth
dependency so the app runs against a throwaway schema per test.
"""
import asyncio
import uuid
from datetime import datetime

import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db
from app.auth import current_user
from app.models import Event, Guest, Membership, Organization, ScanEvent, User

_engine = create_async_engine(
    "sqlite+aiosqlite://",
    poolclass=StaticPool,
    connect_args={"check_same_thread": False},
)
_Session = async_sessionmaker(_engine, expire_on_commit=False)

_current = {"user": None}


def pytest_sessionfinish(session, exitstatus):
    try:
        asyncio.run(_engine.dispose())
    except Exception:
        pass


async def _override_get_db():
    async with _Session() as s:
        yield s


async def _override_current_user():
    return _current["user"]


def _uid() -> str:
    return str(uuid.uuid4())


class Ctx:
    def __init__(self, client, org_id, event_id):
        self.client = client
        self.org_id = org_id
        self.event_id = event_id

    async def add_guest(self, session, **kwargs):
        defaults = dict(
            id=_uid(), event_id=self.event_id, first_name="Test", last_name="Guest",
            rsvp_status="confirmed", admitted=False,
        )
        defaults.update(kwargs)
        g = Guest(**defaults)
        session.add(g)
        await session.flush()
        return g

    async def add_scan(self, session, guest_id, direction, scanned_at, **kwargs):
        defaults = dict(
            id=_uid(), event_id=self.event_id, guest_id=guest_id,
            direction=direction, scanned_at=scanned_at, denied=False,
        )
        defaults.update(kwargs)
        s = ScanEvent(**defaults)
        session.add(s)
        await session.flush()
        return s


@pytest_asyncio.fixture
async def ctx():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    org_id, event_id, user_id = _uid(), _uid(), _uid()
    async with _Session() as s:
        s.add(Organization(id=org_id, name="Test Org", is_active=True))
        s.add(User(id=user_id, email="admin@test.com", is_active=True))
        s.add(Membership(id=_uid(), org_id=org_id, user_id=user_id, role="owner"))
        s.add(Event(
            id=event_id, org_id=org_id, name="Test Event",
            event_date=datetime(2026, 8, 2, 16, 0), timezone="America/Chicago",
        ))
        await s.commit()

    _current["user"] = User(id=user_id, email="admin@test.com", is_active=True, is_platform_superadmin=False)

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[current_user] = _override_current_user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        c = Ctx(client, org_id, event_id)
        c.session_factory = _Session
        yield c

    app.dependency_overrides.clear()
