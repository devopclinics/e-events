"""Initial browser acquisition headers survive auth/signup request ordering."""
import json
from urllib.parse import quote

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from starlette.requests import Request

from app import auth
from app.models import MarketingOutbox
from app.services import marketing_client
from conftest import _Session


def request(attribution):
    return Request({
        "type": "http",
        "headers": [(b"x-festio-attribution", quote(json.dumps(attribution)).encode())],
    })


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
