"""Only an exact durable pending-identity receipt can acknowledge a claim."""
import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest

from app.config import settings
from app.engagement_config import engagement_settings
from app.models import MarketingOutbox
from app.services import marketing_client, marketing_outbox
from conftest import _Session


ACK = {"recorded": True, "pending_identity": True, "duplicate": False,
       "ingest_duplicate": False, "event_id": "pending-ack-event", "lead_id": None,
       "unmatched": True, "prospect_id": "pending-review-prospect"}
PAYLOAD = {"event_id": "pending-ack-event", "email": "owner@example.com", "name": "Claimed name",
           "festio_user_id": "claiming-uid", "lifecycle_event": "registered", "consent_email": True}


@pytest.fixture(autouse=True)
def offline_dispatch(monkeypatch):
    monkeypatch.setattr(engagement_settings, "marketing_outbox_enabled", True)
    monkeypatch.setattr(settings, "marketing_service_url", "http://marketing.test")
    monkeypatch.setattr(settings, "planner_internal_token", "offline-test-placeholder")
    monkeypatch.setattr(marketing_outbox, "_service_token", lambda: "offline-test-token")


@pytest.mark.parametrize("result", [
    *[{key: value for key, value in ACK.items() if key != missing} for missing in ACK],
    *[{**ACK, field: value} for field in ("recorded", "pending_identity", "unmatched")
      for value in (None, False, 0, 1, "true", [], {})],
    *[{**ACK, field: value} for field in ("duplicate", "ingest_duplicate")
      for value in (None, True, 0, 1, "false", [], {})],
    *[{**ACK, field: value} for field in ("prospect_id", "event_id")
      for value in (None, "", " \t", 1, True, [], {})],
    {**ACK, "event_id": "different-event"}, {**ACK, "lead_id": "existing-lead"},
    {**ACK, "id": "existing-lead"}, {**ACK, "id": None},
    {**{key: value for key, value in ACK.items() if key != "pending_identity"}, "id": "lead"},
])
async def test_pending_identity_receipt_rejects_missing_malformed_or_unbound_fields(result):
    row = SimpleNamespace(endpoint="ingest", payload=PAYLOAD)
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=result))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        with pytest.raises(ValueError):
            await marketing_outbox._deliver(row, client)


@pytest.mark.parametrize("duplicate", [False, True])
@pytest.mark.parametrize("verification", [None, False, True])
async def test_exact_pending_receipt_delivers_and_scrubs_only_after_durable_acceptance(ctx, duplicate, verification):
    original = {**PAYLOAD}
    if verification is not None:
        original["email_verified"] = verification
    async with _Session() as db:
        await marketing_client.enqueue_marketing_payload(db, original)
        await db.commit()
    sent = []
    def respond(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={**ACK, "duplicate": duplicate, "ingest_duplicate": duplicate})
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(respond)) == 1
    async with _Session() as db:
        row = await db.get(MarketingOutbox, original["event_id"])
        assert row.status == "delivered" and row.delivered_at is not None
        assert row.payload == {key: sent[0][key] for key in ("event_id", "occurred_at", "lifecycle_event")}


async def test_bad_pending_ack_retains_payload_then_replays_same_claim(ctx):
    async with _Session() as db:
        await marketing_client.enqueue_marketing_payload(db, PAYLOAD)
        await db.commit()
    sent = []
    def respond(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={**ACK, "pending_identity": "true"})
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(respond)) == 0
    async with _Session() as db:
        row = await db.get(MarketingOutbox, PAYLOAD["event_id"])
        assert row.status == "retry" and row.payload == sent[0]
        row.next_attempt_at = datetime.utcnow() - timedelta(seconds=1)
        await db.commit()
    def replay(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={**ACK, "duplicate": True, "ingest_duplicate": True})
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(replay)) == 1
    assert sent[0] == sent[1]


@pytest.mark.parametrize("extra", [
    {}, {"email_verified": False}, {"email_verified": 1}, {"email_verified": "true"},
    {"lifecycle_event": "signup_consent"}, {"lifecycle_event": "paid"},
    {"lifecycle_event": "paid", "festio_user_id": None},
])
@pytest.mark.parametrize("duplicate", [None, False, 0, 1, "true"])
async def test_unverified_claim_never_accepts_fresh_or_ambiguous_lead_ack(extra, duplicate):
    body = {**PAYLOAD, **extra}
    row = SimpleNamespace(endpoint="ingest", payload=body)
    result = {"id": "legacy-lead"}
    if duplicate is not None:
        result["ingest_duplicate"] = duplicate
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=result))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        with pytest.raises(ValueError):
            await marketing_outbox._deliver(row, client)


@pytest.mark.parametrize("removed", [False, True])
async def test_old_unverified_lifecycle_exact_receipt_replay_accepts_retained_lead_id(removed):
    row = SimpleNamespace(endpoint="ingest", payload=PAYLOAD)
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={
        "id": "historical-lead", "ingest_duplicate": True, "removed": removed,
    }))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        await marketing_outbox._deliver(row, client)


@pytest.mark.parametrize("lifecycle", ["event_created", "event_updated", "activated", "paid", "customer"])
async def test_exact_subject_only_milestone_can_accept_lead_receipt(lifecycle):
    body = {key: value for key, value in {**PAYLOAD, "lifecycle_event": lifecycle}.items()
            if not key.startswith("consent_")}
    row = SimpleNamespace(endpoint="ingest", payload=body)
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"id": "linked-lead", "ingest_duplicate": False}))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        await marketing_outbox._deliver(row, client)
