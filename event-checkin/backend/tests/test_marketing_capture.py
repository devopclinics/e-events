"""CRM capture stays local/durable; no test calls Marketing or email providers."""
import json
from datetime import datetime, timedelta
from unittest.mock import AsyncMock
from urllib.parse import quote

import httpx
import pytest
from fastapi import BackgroundTasks
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from starlette.requests import Request

from app import auth
from app.config import settings
from app.engagement_config import engagement_settings
from app.models import DemoRequest, MarketingOutbox, User
from app.routers import demo
from app.schemas import DemoRequestCreate
from app.services import marketing_client, marketing_outbox
from conftest import _Session


async def _rows():
    async with _Session() as db:
        return (await db.execute(select(MarketingOutbox).order_by(MarketingOutbox.created_at))).scalars().all()


def _request(attribution=None):
    headers = [] if attribution is None else [(b"x-festio-attribution", quote(json.dumps(attribution)).encode())]
    return Request({"type": "http", "headers": headers})


def _demo_body(**changes):
    return {"contact_name": "Test Prospect", "email": "prospect@example.com", "phone": "+15555550123",
            "organization": "Example", "event_name": "Example event", "guest_count": 100,
            "preferred_time": "2026-11-02T10:00:00-06:00", "timezone": "America/Chicago",
            "message": "Please explain check-in", **changes}


async def test_capture_is_transactional_and_reuses_event_id(ctx):
    async with _Session() as db:
        await marketing_client.enqueue_marketing_payload(db, {"email": "test@example.com"}, event_id="stable-event")
        await db.rollback()
    assert await _rows() == []
    async with _Session() as db:
        await marketing_client.enqueue_marketing_payload(db, {"email": "test@example.com", "consent_email": False}, event_id="stable-event")
        await db.commit()
        await marketing_client.enqueue_marketing_payload(db, {"email": "test@example.com", "consent_email": True}, event_id="stable-event")
        await db.commit()
    rows = await _rows()
    assert len(rows) == 1
    assert rows[0].payload["event_id"] == rows[0].id == "stable-event"
    assert rows[0].payload["consent_email"] is False
    assert rows[0].payload["occurred_at"].endswith("+00:00")
    assert rows[0].status == "pending"


async def test_marketing_dispatch_is_disabled_by_default(ctx, monkeypatch):
    monkeypatch.setattr(engagement_settings, "marketing_outbox_enabled", False)
    async with _Session() as db:
        await marketing_client.enqueue_marketing_payload(db, {"email": "test@example.com"})
        await db.commit()
    def forbidden(request):
        pytest.fail("Disabled outbox attempted a network request")
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(forbidden)) == 0
    assert (await _rows())[0].attempts == 0


@pytest.mark.parametrize("failure", ["http", "timeout", "unmatched"])
async def test_outbox_retries_then_recovers_with_same_identity(ctx, monkeypatch, failure):
    monkeypatch.setattr(engagement_settings, "marketing_outbox_enabled", True)
    monkeypatch.setattr(settings, "planner_internal_token", "local-test-token")
    monkeypatch.setattr(settings, "marketing_service_url", "http://marketing.test")
    async with _Session() as db:
        event_id = await marketing_client.enqueue_marketing_payload(db, {"email": "test@example.com", "email_verified": True})
        await db.commit()
    sent = []
    def failing(request):
        sent.append(json.loads(request.content))
        if failure == "timeout":
            raise httpx.ReadTimeout("simulated outage", request=request)
        return httpx.Response(503, json={"detail": "unavailable"}) if failure == "http" else httpx.Response(200, json={"recorded": False})
    before = datetime.utcnow()
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(failing)) == 0
    row = (await _rows())[0]
    assert row.status == "retry" and row.attempts == 1
    assert row.next_attempt_at > before
    assert row.delivered_at is None
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(failing)) == 0
    assert len(sent) == 1, "Backoff must prevent immediate redispatch"
    async with _Session() as db:
        row = await db.get(MarketingOutbox, event_id)
        row.next_attempt_at = datetime.utcnow() - timedelta(seconds=1)
        await db.commit()
    def success(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "test-lead", "ingest_duplicate": False})
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(success)) == 1
    row = (await _rows())[0]
    assert row.status == "delivered" and row.attempts == 2 and row.last_error is None
    assert sent[0] == sent[1], "Retries must replay the same immutable payload, ID, and occurrence time"
    assert set(row.payload) == {"event_id", "occurred_at", "lifecycle_event"}
    assert "email" not in row.payload, "Delivered rows retain an idempotency tombstone, not lead PII"
    async with _Session() as db:
        await marketing_client.enqueue_marketing_payload(db, {"email": "test@example.com"}, event_id=event_id)
        await db.commit()
    assert "email" not in (await _rows())[0].payload, "A replay must not repopulate scrubbed data"
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(success)) == 0


async def test_permanent_failure_is_retained_for_review(ctx, monkeypatch):
    monkeypatch.setattr(engagement_settings, "marketing_outbox_enabled", True)
    monkeypatch.setattr(settings, "planner_internal_token", "local-test-token")
    async with _Session() as db:
        event_id = await marketing_client.enqueue_marketing_payload(db, {"email": "test@example.com"})
        row = await db.get(MarketingOutbox, event_id)
        row.attempts = marketing_outbox.MAX_ATTEMPTS - 1
        await db.commit()
    transport = httpx.MockTransport(lambda request: httpx.Response(400, text="private provider detail"))
    assert await marketing_outbox.process_due(transport=transport) == 0
    row = (await _rows())[0]
    assert row.status == "failed" and row.attempts == marketing_outbox.MAX_ATTEMPTS
    assert row.last_error == "HTTP 400"
    assert await marketing_outbox.process_due(transport=transport) == 0


async def test_registration_is_durable_without_http_or_implied_consent(ctx, monkeypatch):
    monkeypatch.setattr(auth, "_ensure_firebase", lambda: None)
    monkeypatch.setattr(auth.firebase_auth, "verify_id_token", lambda token: {
        "uid": "test-new-user", "email": "new@example.com", "name": "New User",
    })
    def forbidden():
        pytest.fail("Authentication attempted to contact Marketing")
    monkeypatch.setattr(marketing_client, "_service_token", forbidden)
    async with _Session() as db:
        user = await auth.get_current_user(_request(), HTTPAuthorizationCredentials(scheme="Bearer", credentials="test"), db)
        assert user.firebase_uid == "test-new-user"
    rows = await _rows()
    assert len(rows) == 1 and rows[0].payload["stage"] == "registered"
    assert not any(key.startswith("consent_") for key in rows[0].payload)
    # The auth-state listener can win the race before the signup form's
    # checkbox request. That later explicit request must still be captured.
    async with _Session() as db:
        await auth.get_current_user(_request({"source": "campaign", "consent_email": True, "consent_sms": False, "consent_whatsapp": False}),
                                    HTTPAuthorizationCredentials(scheme="Bearer", credentials="test"), db)
        await auth.get_current_user(_request({"consent_email": False}),
                                    HTTPAuthorizationCredentials(scheme="Bearer", credentials="test"), db)
    rows = await _rows()
    assert len(rows) == 2
    consent = next(row.payload for row in rows if row.payload["lifecycle_event"] == "signup_consent")
    assert consent["consent_email"] is True and consent["consent_whatsapp"] is False
    # First consent event remains immutable; subsequent preference changes use
    # the preferences endpoint, never a replayed signup header.
    assert consent["consent_sms"] is False


@pytest.mark.parametrize("attribution", [[], {"consent_email": "true", "consent_whatsapp": 1}, {"source": ["invalid"]}])
async def test_registration_does_not_coerce_consent(ctx, attribution):
    async with _Session() as db:
        user = await db.get(User, ctx.ids["user_a"].id)
        await auth._capture_registration(db, user, _request(attribution))
        await db.commit()
    rows = await _rows()
    assert len(rows) == 1
    assert not any(key.startswith("consent_") for key in rows[0].payload)


async def test_demo_persists_request_and_crm_before_transactional_email(ctx, monkeypatch):
    calls = []
    async def email(*args):
        async with _Session() as db:
            assert await db.scalar(select(DemoRequest.id)), "Email cannot be queued before durable capture"
        calls.append(args)
    monkeypatch.setattr(demo, "send_simple_email", email)
    monkeypatch.setattr(settings, "demo_recipient_emails", "operator@example.com")
    response = await ctx.client.post("/api/demo-requests", json=_demo_body(consent_email=True, consent_sms=False, consent_whatsapp=False))
    assert response.status_code == 201
    assert response.json()["status"] == "requested"
    assert "not yet confirmed" in response.json()["message"]
    async with _Session() as db:
        request = await db.get(DemoRequest, response.json()["request_id"])
        assert request.preferred_time == datetime(2026, 11, 2, 16)
        assert request.status == "requested" and request.message == "Please explain check-in"
    rows = await _rows()
    assert len(rows) == 1 and rows[0].payload["demo_request_id"] == request.id
    assert rows[0].payload["lifecycle_event"] == "demo_requested"
    assert rows[0].payload["consent_email"] is True
    assert rows[0].payload["consent_whatsapp"] is False
    assert len(calls) == 2
    assert "not a confirmed booking" in calls[0][2]
    assert all(call[4] is None for call in calls), "No calendar invite for an unconfirmed request"


async def test_demo_without_checkbox_does_not_infer_phone_consent(ctx, monkeypatch):
    monkeypatch.setattr(demo, "send_simple_email", AsyncMock())
    assert (await ctx.client.post("/api/demo-requests", json=_demo_body())).status_code == 201
    assert not any(key.startswith("consent_") for key in (await _rows())[0].payload)


async def test_failed_demo_capture_does_not_schedule_emails(ctx, monkeypatch):
    async def fail(*args, **kwargs):
        raise RuntimeError("simulated local storage error")
    monkeypatch.setattr(demo, "enqueue_marketing_payload", fail)
    background = BackgroundTasks()
    async with _Session() as db:
        with pytest.raises(RuntimeError, match="storage error"):
            await demo.submit_demo_request(DemoRequestCreate(**_demo_body()), background, db)
        await db.rollback()
    assert background.tasks == []
    async with _Session() as db:
        assert await db.scalar(select(DemoRequest.id)) is None


@pytest.mark.parametrize("changes", [{"timezone": "Not/AZone"}, {"consent_email": "true"}, {"consent_whatsapp": 1}])
async def test_demo_invalid_timezone_and_nonboolean_consent_rejected(ctx, changes):
    assert (await ctx.client.post("/api/demo-requests", json=_demo_body(**changes))).status_code == 422
    assert await _rows() == []


async def test_resend_receipt_and_marketing_mirror_dedupe_together(ctx, signed_resend):
    payload = {"type": "email.delivered", "created_at": "2026-10-01T10:00:00Z",
               "data": {"email_id": "provider-message", "to": ["prospect@example.com"]}}
    for _ in range(2):
        assert (await signed_resend(payload, svix_id="receipt-stable")).status_code == 200
    rows = await _rows()
    assert len(rows) == 1 and rows[0].endpoint == "delivery"
    assert rows[0].payload["provider_id"] == "provider-message"
    assert rows[0].payload["occurred_at"] == "2026-10-01T10:00:00+00:00"


async def test_demo_submission_retry_is_idempotent(ctx, monkeypatch):
    send = AsyncMock()
    monkeypatch.setattr(demo, "send_simple_email", send)
    monkeypatch.setattr(settings, "demo_recipient_emails", "operator@example.com")
    headers = {"Idempotency-Key": "test-demo-submission"}
    first = await ctx.client.post("/api/demo-requests", json=_demo_body(), headers=headers)
    second = await ctx.client.post("/api/demo-requests", json=_demo_body(), headers=headers)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert len(await _rows()) == 1
    assert send.await_count == 2, "One acknowledgement and one operator email, not one set per retry"
    changed = await ctx.client.post("/api/demo-requests", json=_demo_body(contact_name="Other Name"), headers=headers)
    assert changed.status_code == 409 and send.await_count == 2


async def test_demo_public_requests_are_rate_limited(ctx, monkeypatch):
    monkeypatch.setattr(demo, "send_simple_email", AsyncMock())
    from app import ratelimit
    monkeypatch.setattr(ratelimit, "_ENABLED", True)
    monkeypatch.setattr(ratelimit, "_REDIS_URL", "")
    monkeypatch.setattr(ratelimit.time, "time", lambda: 2000000000)
    statuses = [(await ctx.client.post("/api/demo-requests", json=_demo_body(), headers={"Idempotency-Key": "rate-test-submission"})).status_code for _ in range(6)]
    assert statuses == [201] * 5 + [429]
    assert len(await _rows()) == 1


@pytest.mark.parametrize("bounce_type", ["Transient", "Permanent", "soft", "hard"])
async def test_signed_bounce_classification_survives_crm_bridge(ctx, signed_resend, monkeypatch, bounce_type):
    response = await signed_resend({
        "type": "email.bounced", "data": {
            "email_id": "bounced-message", "to": ["prospect@example.com"], "bounce": {"type": bounce_type},
        },
    })
    assert response.status_code == 200
    rows = await _rows()
    assert len(rows) == 1 and rows[0].payload["bounce_type"] == bounce_type.lower()
    monkeypatch.setattr(engagement_settings, "marketing_outbox_enabled", True)
    monkeypatch.setattr(settings, "planner_internal_token", "local-test-token")
    forwarded = []
    def receiver(request):
        assert request.url.path == "/api/marketing/internal/delivery"
        forwarded.append(json.loads(request.content))
        return httpx.Response(200, json={"recorded": True})
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(receiver)) == 1
    assert forwarded[0]["bounce_type"] == bounce_type.lower()


async def test_signup_attribution_is_bounded_to_marketing_columns(ctx):
    attribution = {key: "x" * 600 for key in ("source", "medium", "campaign", "referrer", "landing_page")}
    attribution["consent_email"] = True
    async with _Session() as db:
        user = await db.get(User, ctx.ids["user_a"].id)
        await auth._capture_registration(db, user, _request(attribution))
        await db.commit()
    rows = await _rows()
    assert len(rows) == 2
    for row in rows:
        assert {key: len(row.payload[key]) for key in attribution if key != "consent_email"} == {
            "source": 100, "medium": 100, "campaign": 160, "referrer": 500, "landing_page": 500,
        }


async def test_verification_after_event_creation_captures_owned_event(ctx):
    async with _Session() as db:
        user=await db.get(User,ctx.ids['user_a'].id)
        await auth._capture_registration(db,user,_request({'consent_email':True}),email_verified=True)
        await db.commit()
    rows=await _rows()
    event_rows=[r for r in rows if r.payload.get('stage')=='event_created']
    assert len(event_rows)==1
    assert event_rows[0].payload['email_verified'] is True
    assert event_rows[0].payload['organizer_account'] is True
