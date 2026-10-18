"""Initial browser acquisition headers survive auth/signup request ordering."""
import json
import importlib.util
from pathlib import Path
import socket
import sys
from urllib.parse import quote

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from starlette.requests import Request

from app import auth
from app.models import MarketingOutbox, User
from app.services import marketing_client
from conftest import _Session


def request(attribution):
    return Request({
        "type": "http",
        "headers": [] if attribution is None else [
            (b"x-festio-attribution", quote(json.dumps(attribution)).encode()),
        ],
    })


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Acquisition tests must never use the network")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket.socket, "connect_ex", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)


@pytest.fixture
def marketing_service(monkeypatch, tmp_path):
    monkeypatch.setenv("MARKETING_DATABASE_URL", f"sqlite:///{tmp_path / 'marketing.db'}")
    monkeypatch.setenv("MARKETING_INTERNAL_TOKEN", "offline-acquisition-test-token")
    monkeypatch.setenv("MARKETING_SCHEDULER_ENABLED", "false")
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "false")
    path = Path(__file__).resolve().parents[2] / "marketing-service/app/main.py"
    from types import ModuleType
    package = ModuleType("isolated_acquisition_marketing")
    package.__path__ = [str(path.parent)]
    monkeypatch.setitem(sys.modules, package.__name__, package)
    spec = importlib.util.spec_from_file_location(package.__name__ + ".main", path)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    identity = module.Identity(subject="offline-test", email="operator@example.com", name="Operator",
                               is_superadmin=True, role="superadmin")
    module.app.dependency_overrides[module.decode_identity] = lambda: identity
    # Do not enter TestClient's context: no application lifespan or scheduler.
    client = TestClient(module.app)
    try:
        yield module, client
    finally:
        client.close()
        module.engine.dispose()


@pytest.mark.parametrize("signup_request_first", [False, True])
async def test_first_acquisition_and_explicit_consent_survive_auth_race(ctx, monkeypatch, signup_request_first):
    monkeypatch.setattr(auth, "_ensure_firebase", lambda: None)
    monkeypatch.setattr(auth.firebase_auth, "verify_id_token", lambda token: {
        "uid": "acquisition-race-user", "email": "acquisition@example.com", "name": "Acquired User",
        "email_verified": True,
    })
    monkeypatch.setattr(marketing_client, "_service_token", lambda: pytest.fail("Auth must not dispatch Marketing"))
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="offline-test")
    acquisition = {
        "source": "newsletter", "medium": "email", "campaign": "autumn-events",
        "referrer": "https://example.com/article", "landing_page": "https://festio.events/pricing",
    }
    signup = {**acquisition, "consent_email": True, "consent_sms": False, "consent_whatsapp": False}
    initial_requests = [signup, acquisition] if signup_request_first else [acquisition, signup]
    async with _Session() as db:
        for values in initial_requests:
            await auth.get_current_user(request(values), credentials, db)
        initial = (await db.execute(select(MarketingOutbox))).scalars().all()
        snapshots = {row.id: dict(row.payload) for row in initial}
        # Ordinary later logins/API calls cannot replace the first acquisition
        # event or implicitly replay the signup checkbox.
        await auth.get_current_user(request({**acquisition, "source": "later-login", "campaign": "later"}), credentials, db)

    async with _Session() as db:
        rows = (await db.execute(select(MarketingOutbox))).scalars().all()
    assert len(rows) == 2
    assert {row.id: row.payload for row in rows} == snapshots
    by_event = {row.payload["lifecycle_event"]: row.payload for row in rows}
    assert set(by_event) == {"registered", "signup_consent"}
    for payload in by_event.values():
        assert {key: payload[key] for key in acquisition} == acquisition
    assert not any(key.startswith("consent_") for key in by_event["registered"])
    assert {key: value for key, value in by_event["signup_consent"].items() if key.startswith("consent_")} == {
        "consent_email": True, "consent_sms": False, "consent_whatsapp": False,
    }


async def test_existing_user_verified_upgrade_preserves_acquisition_without_header(ctx, monkeypatch, marketing_service):
    module, client = marketing_service
    monkeypatch.setattr(auth, "_ensure_firebase", lambda: None)
    monkeypatch.setattr(auth.firebase_auth, "verify_id_token", lambda token: {
        "uid": "existing-owner", "email": "alice@a.com", "email_verified": True,
    })
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="offline-test")
    acquisition = {
        "source": "partner", "medium": "referral", "campaign": "original-partner",
        "referrer": "https://partner.example.com", "landing_page": "https://festio.events/original",
    }
    with module.SessionLocal() as db:
        lead = module.Lead(email="alice@a.com", name="Alice", stage="paid", **acquisition,
                           consent_email=False, consent_sms=True, unsubscribed=True,
                           automation_paused=True, suppression_reason="email_hard_bounce")
        db.add(lead)
        db.commit()
        lead_id = lead.id
    async with _Session() as db:
        user = await db.get(User, ctx.ids["user_a"].id)
        user.firebase_uid = "existing-owner"
        # A pre-v2 immutable receipt must not block fresh identity proof.
        legacy_id = marketing_client.lifecycle_event_id("registered", user.id)
        await marketing_client.enqueue_marketing_payload(db, {
            "email": user.email, "festio_user_id": user.firebase_uid, "stage": "registered", **acquisition,
        }, event_id=legacy_id)
        await db.commit()
        legacy_snapshot = dict((await db.get(MarketingOutbox, legacy_id)).payload)
        login_request = request(None)
        await auth.get_current_user(login_request, credentials, db)
        await auth.get_current_user(request(None), credentials, db)
        assert login_request.state.verified_email_identity == (user.id, user.email)
        rows = (await db.execute(select(MarketingOutbox))).scalars().all()
        assert len(rows) == 2
        assert (await db.get(MarketingOutbox, legacy_id)).payload == legacy_snapshot
        verified_id = marketing_client.lifecycle_event_id("registered", user.id, "verified-email-v2")
        captured = (await db.get(MarketingOutbox, verified_id)).payload
        assert captured["email_verified"] is True
        assert not any(field.startswith("consent_") for field in captured)

    response = client.post("/api/marketing/internal/ingest", json=captured)
    assert response.status_code == 200
    result = response.json()
    assert result["id"] == lead_id and result["festio_user_id"] == "existing-owner"
    assert {key: result[key] for key in acquisition} == acquisition
    assert result["stage"] == "paid" and result["unsubscribed"] and result["automation_paused"]
    assert result["suppression_reason"] == "email_hard_bounce"
    assert not result["consent_email"] and result["consent_sms"] and not result["consent_whatsapp"]
    assert result["next_follow_up_at"] is None
    assert client.post("/api/marketing/internal/ingest", json=captured).json()["ingest_duplicate"] is True
    assert not any(key in captured for key in acquisition), "Missing attribution is not a website acquisition claim"
    with module.SessionLocal() as db:
        assert db.get(module.IngestReceipt, verified_id).lead_id == lead_id
        assert db.scalar(select(func.count(module.Activity.id))) == 1
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 0


@pytest.mark.parametrize("attribution", [None, {
    "source": "newsletter", "medium": "email", "campaign": "autumn-events",
    "referrer": "https://example.com/article", "landing_page": "https://festio.events/pricing",
}])
async def test_new_verified_user_retains_real_acquisition_or_create_only_default(ctx, monkeypatch, marketing_service, attribution):
    module, client = marketing_service
    monkeypatch.setattr(auth, "_ensure_firebase", lambda: None)
    monkeypatch.setattr(auth.firebase_auth, "verify_id_token", lambda token: {
        "uid": "new-acquisition-user", "email": "acquisition@example.com", "email_verified": True,
    })
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="offline-test")
    async with _Session() as db:
        await auth.get_current_user(request(attribution), credentials, db)
        captured = (await db.scalar(select(MarketingOutbox))).payload
    response = client.post("/api/marketing/internal/ingest", json=captured)
    assert response.status_code == 200
    result = response.json()
    expected = attribution or {"source": "website"}
    assert {key: result[key] for key in expected} == expected
    assert captured["email_verified"] is True
    assert not any(result[field] for field in ("consent_email", "consent_sms", "consent_whatsapp"))
    assert result["next_follow_up_at"] is None
    if attribution is None:
        assert "source" not in captured
