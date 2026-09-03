"""Test fixtures for tenant-isolation tests.

Uses an in-memory SQLite DB and overrides get_db + get_current_user, so no
Postgres, Firebase, or app lifespan (migrations/poller) is involved.
"""
import asyncio
from datetime import datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db
from app.auth import get_current_user
from app.models import Organization, Membership, User, Event, Guest
from app.config import settings


# backend/.env carries REAL provider credentials (this checkout IS the staging
# deploy — see OPERATIONS.md). Settings loads them unconditionally, and
# services/email_service.py + services/messaging.py prefer whichever provider
# has a non-empty key, so any unmocked send in a test would hit the real
# account. Confirmed live during development: an unmocked test send got a real
# 200 from https://api.resend.com/emails. This autouse fixture makes every
# outbound-message provider structurally unreachable by default — a test that
# genuinely wants to exercise a provider must explicitly monkeypatch it back.
@pytest.fixture(autouse=True)
def _no_real_outbound_messages(monkeypatch):
    for field in (
        "resend_api_key", "bird_email_api_base", "bird_access_key", "bird_workspace_id",
        "smtp_host", "twilio_account_sid", "twilio_auth_token", "signalhouse_api_key",
    ):
        monkeypatch.setattr(settings, field, "")


# entitlements._rate_cache is module-level global state (see entitlements.py's
# channel_weight) populated by the Console credit-rate admin endpoints. Any
# test that saves a rate would otherwise leak it into every later test in the
# same process — reset it before and after each test.
@pytest.fixture(autouse=True)
def _reset_credit_rate_cache():
    from app import entitlements
    entitlements._rate_cache.clear()
    yield
    entitlements._rate_cache.clear()


# Outbox-style modules (festiome_outbox, webhook_outbox, and main.py's public-API
# audit middleware) import AsyncSessionLocal directly rather than via the
# get_db dependency, so app.dependency_overrides[get_db] never touches them —
# without this, any test that runs one of those code paths tries a real
# connection to the Compose Postgres host ("db"), which doesn't resolve outside
# the container and fails with a DNS error. `from x import y` binds `y` in the
# importing module's namespace at import time, so app.database.AsyncSessionLocal
# must be patched separately in each module that already imported it.
@pytest.fixture(autouse=True)
def _outbox_modules_use_test_db(monkeypatch):
    from app import main as main_module
    from app.services import festiome_outbox, webhook_outbox, scheduled_communication_outbox, inbound_email_outbox
    from services import shortlinks
    for module in (main_module, festiome_outbox, webhook_outbox, scheduled_communication_outbox, inbound_email_outbox, shortlinks):
        monkeypatch.setattr(module, "AsyncSessionLocal", _Session)

_engine = create_async_engine(
    "sqlite+aiosqlite://",
    poolclass=StaticPool,
    connect_args={"check_same_thread": False},
)
_Session = async_sessionmaker(_engine, expire_on_commit=False)

# The "logged-in" user for the current request (set via ctx.login()).
_current = {"user": None}


def pytest_sessionfinish(session, exitstatus):
    """Dispose the shared in-memory engine so aiosqlite's (non-daemon) connection
    worker thread stops. Without this the interpreter blocks at shutdown, which
    made the whole suite appear to hang when run in a single process."""
    try:
        asyncio.run(_engine.dispose())
    except Exception:
        pass


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
    # Unit/integration tests must not attempt to resolve Compose-only service
    # hostnames when an invite happens to enqueue an email.
    settings.design_service_url = ""
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
