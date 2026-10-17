"""Only endpoint-specific, affirmative receipts may scrub durable CRM events."""
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


ENDPOINTS = ("ingest", "conversations", "delivery", "demo-requests")
LEAD_ID = "00000000-0000-0000-0000-000000000001"
PROSPECT_ACK = {"recorded": True, "duplicate": False, "lead_id": None, "unmatched": True, "prospect_id": "retained-prospect"}
LEGACY_DEMO = {"source": "website_demo", "lifecycle_event": "demo_requested"}
LEGACY_RECEIPT_ACK = {"recorded": True, "legacy_demo_receipt": True, "ingest_duplicate": True, "id": LEAD_ID}
DISPATCH_CASES = [(endpoint, False) for endpoint in ENDPOINTS] + [("ingest", True)]


@pytest.fixture(autouse=True)
def offline_dispatch(monkeypatch):
    monkeypatch.setattr(engagement_settings, "marketing_outbox_enabled", True)
    monkeypatch.setattr(settings, "marketing_service_url", "http://marketing.test")
    monkeypatch.setattr(settings, "planner_internal_token", "offline-outbox-test-placeholder")
    monkeypatch.setattr(marketing_outbox, "_service_token", lambda: "offline-outbox-test-token")


@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize("result", [
    {}, None, [], True, "ok",
    {"recorded": None}, {"recorded": False}, {"recorded": 0},
    {"recorded": 1}, {"recorded": "true"}, {"recorded": []}, {"recorded": {}},
])
async def test_deliver_rejects_missing_or_malformed_ack(endpoint, result):
    row = SimpleNamespace(endpoint=endpoint, payload={"event_id": "ack-event"})
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=json.dumps(result), headers={"Content-Type": "application/json"}))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        with pytest.raises(ValueError):
            await marketing_outbox._deliver(row, client)


@pytest.mark.parametrize("lead_id", [None, "", " \t\n", 0, 1, True, [], {}])
async def test_ingest_requires_nonempty_string_id_even_with_recorded_true(lead_id):
    row = SimpleNamespace(endpoint="ingest", payload={"event_id": "ack-event"})
    result = {"id": lead_id, "recorded": True, "removed": True, "ingest_duplicate": True}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=result))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        with pytest.raises(ValueError):
            await marketing_outbox._deliver(row, client)


@pytest.mark.parametrize("recorded", [None, False, 0, 1, "true", [], {}])
async def test_ingest_id_does_not_override_explicit_invalid_recorded_flag(recorded):
    row = SimpleNamespace(endpoint="ingest", payload={"event_id": "ack-event"})
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"id": LEAD_ID, "recorded": recorded}))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        with pytest.raises(ValueError):
            await marketing_outbox._deliver(row, client)


@pytest.mark.parametrize("endpoint", ("conversations", "delivery"))
async def test_receipt_endpoint_does_not_accept_ingest_response(endpoint):
    row = SimpleNamespace(endpoint=endpoint, payload={"event_id": "ack-event"})
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"id": LEAD_ID}))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        with pytest.raises(ValueError):
            await marketing_outbox._deliver(row, client)


def _successful_ack(endpoint):
    if endpoint == "demo-requests":
        return PROSPECT_ACK
    return {"id": LEAD_ID, "ingest_duplicate": False} if endpoint == "ingest" else {"recorded": True}


async def _enqueue(endpoint, *, attempts=0, extra=None):
    async with _Session() as db:
        event_id = await marketing_client.enqueue_marketing_payload(db, {
            "email": "prospect@example.com", "message": "Recoverable request details",
            "email_verified": True,
            "occurred_at": "2026-10-01T10:00:00+00:00",
            **(extra or {}),
        }, endpoint=endpoint, event_id="ack-event")
        row = await db.get(MarketingOutbox, event_id)
        row.attempts = attempts
        original = dict(row.payload)
        await db.commit()
    return event_id, original


async def _read(event_id):
    async with _Session() as db:
        return await db.get(MarketingOutbox, event_id)


@pytest.mark.parametrize(("endpoint", "legacy_demo"), DISPATCH_CASES)
@pytest.mark.parametrize("result", [{}, {"recorded": None}])
async def test_invalid_ack_retains_payload_then_retries_same_event(ctx, endpoint, legacy_demo, result):
    event_id, original = await _enqueue(endpoint, extra=LEGACY_DEMO if legacy_demo else None)
    sent = []

    def invalid_ack(request):
        assert request.url.path == f"/api/marketing/internal/{endpoint}"
        sent.append(json.loads(request.content))
        return httpx.Response(200, json=result)

    before = datetime.utcnow()
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(invalid_ack)) == 0
    row = await _read(event_id)
    assert row.status == "retry" and row.attempts == 1
    assert row.delivered_at is None and row.last_error == "ValueError"
    assert row.payload == original
    assert row.next_attempt_at > before
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(invalid_ack)) == 0
    assert len(sent) == 1, "Malformed receipts must respect the retry backoff"

    async with _Session() as db:
        row = await db.get(MarketingOutbox, event_id)
        row.next_attempt_at = datetime.utcnow() - timedelta(seconds=1)
        await db.commit()

    def valid_ack(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json=PROSPECT_ACK if legacy_demo else _successful_ack(endpoint))

    assert await marketing_outbox.process_due(transport=httpx.MockTransport(valid_ack)) == 1
    row = await _read(event_id)
    assert row.status == "delivered" and row.attempts == 2
    assert row.delivered_at is not None and row.last_error is None
    assert sent == [original, original]
    assert row.payload == {key: original[key] for key in ("event_id", "occurred_at", "lifecycle_event") if key in original}


@pytest.mark.parametrize(("endpoint", "legacy_demo"), DISPATCH_CASES)
async def test_invalid_ack_exhaustion_retains_payload_for_review(ctx, endpoint, legacy_demo, caplog):
    event_id, original = await _enqueue(endpoint, attempts=marketing_outbox.MAX_ATTEMPTS - 1, extra=LEGACY_DEMO if legacy_demo else None)
    result = {"recorded": None, "detail": "private acknowledgement details"}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=result))
    assert await marketing_outbox.process_due(transport=transport) == 0
    row = await _read(event_id)
    assert row.status == "failed" and row.attempts == marketing_outbox.MAX_ATTEMPTS
    assert row.payload == original and row.delivered_at is None
    assert row.last_error == "ValueError"
    assert result["detail"] not in caplog.text
    assert original["email"] not in caplog.text
    assert await marketing_outbox.process_due(transport=transport) == 0
    assert (await _read(event_id)).attempts == marketing_outbox.MAX_ATTEMPTS


@pytest.mark.parametrize(("endpoint", "result"), [
    ("ingest", {"id": LEAD_ID, "email": "prospect@example.com", "ingest_duplicate": False}),
    ("ingest", {"id": LEAD_ID, "ingest_duplicate": True}),
    ("ingest", {"id": LEAD_ID, "removed": True, "ingest_duplicate": True}),
    ("conversations", {"recorded": True, "duplicate": False, "lead_id": LEAD_ID}),
    ("conversations", {"recorded": True, "duplicate": True, "lead_id": LEAD_ID}),
    ("conversations", {"recorded": True, "duplicate": False, "lead_id": None, "unmatched": True, "prospect_id": "retained-prospect"}),
    ("conversations", {"recorded": True, "duplicate": True, "lead_id": None, "unmatched": True, "prospect_id": "retained-prospect"}),
    ("delivery", {"recorded": True}),
    ("delivery", {"recorded": True, "duplicate": True}),
    ("demo-requests", PROSPECT_ACK),
    ("demo-requests", {**PROSPECT_ACK, "duplicate": True}),
])
async def test_real_service_ack_shapes_deliver_and_scrub_payload(ctx, endpoint, result):
    # A deleted lead's ingestion tombstone and a durable unmatched prospect are
    # valid captures. Neither should be retried merely because no live lead exists.
    event_id, original = await _enqueue(endpoint)
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=result))
    assert await marketing_outbox.process_due(transport=transport) == 1
    row = await _read(event_id)
    assert row.status == "delivered" and row.attempts == 1
    assert row.delivered_at is not None and row.last_error is None
    assert row.payload == {key: original[key] for key in ("event_id", "occurred_at", "lifecycle_event") if key in original}


@pytest.mark.parametrize("endpoint", ("ingest", "demo-requests"))
@pytest.mark.parametrize("result", [
    {"recorded": True}, {"id": LEAD_ID, "ingest_duplicate": False},
    *[{key: value for key, value in PROSPECT_ACK.items() if key != missing}
      for missing in ("recorded", "unmatched", "lead_id", "prospect_id")],
    *[{**PROSPECT_ACK, "recorded": value} for value in (None, 1, "true")],
    *[{**PROSPECT_ACK, "unmatched": value} for value in (None, 1, "true")],
    *[{**PROSPECT_ACK, "prospect_id": value} for value in (None, "", " \t", True, 1, [], {})],
    {**PROSPECT_ACK, "lead_id": LEAD_ID},
])
async def test_public_demo_requires_explicit_retained_unverified_prospect(endpoint, result):
    row = SimpleNamespace(endpoint=endpoint, payload={"event_id": "ack-event", **LEGACY_DEMO})
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=result))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        with pytest.raises(ValueError):
            await marketing_outbox._deliver(row, client)


@pytest.mark.parametrize("payload", [
    {}, {"source": "website_demo"}, {"lifecycle_event": "demo_requested"},
    {"source": "verified_account", "lifecycle_event": "demo_requested"},
    {"source": "website_demo", "lifecycle_event": "registered", "stage": "demo_requested"},
])
async def test_pending_prospect_ack_cannot_replace_normal_ingest_identity(payload):
    row = SimpleNamespace(endpoint="ingest", payload={"event_id": "ack-event", **payload})
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=PROSPECT_ACK))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        with pytest.raises(ValueError):
            await marketing_outbox._deliver(row, client)


@pytest.mark.parametrize("payload", [
    LEGACY_DEMO,
    {"source": "website_demo", "stage": "demo_requested"},
    {"source": "website_demo", "lifecycle_event": "demo_requested", "stage": "registered"},
])
@pytest.mark.parametrize("duplicate", [False, True])
async def test_legacy_demo_accepts_only_the_pending_prospect_service_contract(ctx, payload, duplicate):
    event_id, original = await _enqueue("ingest", extra=payload)
    result = {**PROSPECT_ACK, "duplicate": duplicate, "ingest_duplicate": duplicate}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=result))
    assert await marketing_outbox.process_due(transport=transport) == 1
    row = await _read(event_id)
    assert row.status == "delivered" and row.delivered_at is not None
    assert row.payload == {key: original[key] for key in ("event_id", "occurred_at", "lifecycle_event") if key in original}


@pytest.mark.parametrize("removed", [False, True])
async def test_legacy_demo_already_recorded_before_upgrade_accepts_explicit_receipt(ctx, removed):
    event_id, original = await _enqueue("ingest", extra=LEGACY_DEMO)
    result = {**LEGACY_RECEIPT_ACK, "removed": removed}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=result))
    assert await marketing_outbox.process_due(transport=transport) == 1
    row = await _read(event_id)
    assert row.status == "delivered" and row.delivered_at is not None
    assert row.payload == {key: original[key] for key in ("event_id", "occurred_at", "lifecycle_event") if key in original}


@pytest.mark.parametrize("result", [
    *[{key: value for key, value in LEGACY_RECEIPT_ACK.items() if key != missing}
      for missing in LEGACY_RECEIPT_ACK],
    *[{**LEGACY_RECEIPT_ACK, field: value}
      for field in ("recorded", "legacy_demo_receipt", "ingest_duplicate")
      for value in (None, False, 0, 1, "true")],
    *[{**LEGACY_RECEIPT_ACK, "id": value} for value in (None, "", " \t", True, 1, [], {})],
])
async def test_legacy_demo_old_receipt_requires_all_affirmative_markers(result):
    row = SimpleNamespace(endpoint="ingest", payload={"event_id": "ack-event", **LEGACY_DEMO})
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=result))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        with pytest.raises(ValueError):
            await marketing_outbox._deliver(row, client)


async def test_new_demo_endpoint_cannot_acknowledge_with_a_legacy_lead_receipt():
    row = SimpleNamespace(endpoint="demo-requests", payload={"event_id": "ack-event", **LEGACY_DEMO})
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=LEGACY_RECEIPT_ACK))
    async with httpx.AsyncClient(base_url="http://marketing.test", transport=transport) as client:
        with pytest.raises(ValueError):
            await marketing_outbox._deliver(row, client)
