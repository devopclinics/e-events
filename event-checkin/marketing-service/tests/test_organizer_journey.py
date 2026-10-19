import importlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import jwt
import pytest
from sqlalchemy import select
from fastapi import HTTPException

from test_marketing_e2e import load_app
from app import organizer_journey as journey, sales_responses as sales


@pytest.fixture
def service(tmp_path):
    client, headers = load_app(tmp_path)
    return importlib.import_module("app.main"), client, headers


def backend_headers():
    at = datetime.now(timezone.utc)
    return {"Authorization": "Bearer " + jwt.encode(dict(sub="festio-backend", email="system@festio.events",
        is_platform_superadmin=True, iss="guesthub", aud="marketing", iat=at, exp=at+timedelta(minutes=5)), "test-secret", algorithm="HS256")}


def evidence(**extra):
    return dict(id="evidence-1", account_id="account-1", org_id="org-1", organizer_event_id="event-1",
        use_case="rsvp", milestone="rsvp_received", source_id="rsvp-1",
        occurred_at="2026-01-01T00:00:00Z", current_owner=True, synthetic=False, **extra)


def test_durable_outcomes_deduplicate_conflicts_and_require_source_authority(service):
    m, client, human = service
    endpoint = "/api/marketing/internal/organizer-milestones"
    body = evidence()
    assert client.post(endpoint, headers=human, json=body).status_code == 403
    headers = backend_headers()
    assert client.post(endpoint, headers=headers, json=body).json() == {"recorded": True, "duplicate": False}
    assert client.post(endpoint, headers=headers, json=body).json()["duplicate"] is True
    assert client.post(endpoint, headers=headers, json={**body, "source_id": "other"}).status_code == 409
    assert client.post(endpoint, headers=headers, json={**body, "id": "test", "synthetic": True}).status_code == 422
    assert client.post(endpoint, headers=headers, json={**body, "current_owner": False}).status_code == 403
    with m.SessionLocal() as db:
        assert len(db.scalars(select(journey.Evidence)).all()) == 1


def test_out_of_order_scoped_evidence_never_treats_configuration_as_value():
    def row(milestone, event="event", org="org"):
        return SimpleNamespace(org_id=org, event_id=event, use_case="rsvp", milestone=milestone, source_id=milestone)
    rows = [row("event_completed"), row("configured"), row("rehearsal")]
    result = journey.summary(rows)
    assert result["completed_events"] == 1 and not result["events"][0]["first_value"]
    rows += [row("rsvp_received"), row("event_completed", "next"), row("configured", "other", "other-org")]
    result = journey.summary(rows)
    assert result == journey.summary(list(reversed(rows)))
    assert result["repeat_event_completed"] and len(result["events"]) == 3
    assert result["metrics"]["event_pass_purchased"] == 0


def test_configuration_keeps_onboarding_and_legacy_activation_is_not_value(service):
    m, client, headers = service
    lead = client.post("/api/marketing/internal/ingest", headers=headers, json=dict(
        email="owner@example.com", email_verified=True, festio_user_id="owner", event_id="reg")).json()
    for kind in ("configured", "activated"):
        result = client.post("/api/marketing/internal/ingest", headers=headers, json=dict(
            email="owner@example.com", festio_user_id="owner", event_id=kind, lifecycle_event=kind)).json()
        assert result["stage"] == "event_created"
    assert client.get(f"/api/marketing/organizer-funnel/{lead['id']}", headers=headers).json()["events"] == []
    fresh = client.post("/api/marketing/internal/ingest", headers=headers, json=dict(
        email="fresh@example.com", email_verified=True, festio_user_id="fresh", event_id="fresh-activation", lifecycle_event="activated")).json()
    assert fresh["stage"] == "event_created"


def test_handoff_backlog_ack_resolution_and_restart_preserve_pause(service, monkeypatch):
    m, client, headers = service
    monkeypatch.setenv("MARKETING_HANDOFF_OWNER", "synthetic-operator@example.com")
    lead = client.post("/api/marketing/internal/ingest", headers=headers, json=dict(
        email="owner@example.com", email_verified=True, festio_user_id="owner", event_id="reg")).json()
    body = dict(event_id="reply", channel="chat", festio_user_id="owner", identity_verified=True)
    assert client.post("/api/marketing/internal/conversations", headers=headers, json=body).status_code == 200
    assert client.post("/api/marketing/internal/conversations", headers=headers, json=body).json()["duplicate"]
    case = client.get("/api/marketing/handoffs", headers=headers).json()[0]
    assert case["notification"] == "unconfigured" and len(case["history"]) == 1
    assert client.patch(f"/api/marketing/leads/{lead['id']}", headers=headers, json={"automation_paused": False}).status_code == 409
    for action in ("acknowledge", "resolve"):
        assert client.post(f"/api/marketing/handoffs/{case['id']}/{action}", headers=headers).json()["automation_paused"] is True
    with m.SessionLocal() as db:
        assert db.get(m.Lead, lead["id"]).automation_paused
        record = db.get(journey.Handoff, case["id"])
        monkeypatch.setenv("MARKETING_HANDOFF_DESTINATION", "synthetic-inbox")
        adapter = Mock()
        adapter.notify.side_effect = TimeoutError()
        assert not journey.notify_handoff(record, adapter)
        assert record.notification == "failed"


def test_template_review_preserves_stored_edits_and_invalidates_pin(service):
    m, client, headers = service
    with m.SessionLocal() as db:
        seq = db.scalar(select(m.ModuleRecord).where(m.ModuleRecord.name == "New registration welcome"))
        seq.payload = {**seq.payload, "steps": [{"subject": "User edited", "body": "My copy"}]}
        db.commit()
        old = m.email_pilot.template_fingerprint(seq)
        sequence_id = seq.id
    m.seed_defaults()
    assert client.get("/api/marketing/template-review", headers=headers).json()["stored_templates_changed"] is False
    endpoint = f"/api/marketing/template-review/{sequence_id}"
    assert client.post(endpoint, headers=headers, json={"expected_fingerprint": "stale"}).status_code == 409
    result = client.post(endpoint, headers=headers, json={"expected_fingerprint": old}).json()
    assert result["fingerprint"] != old and result["requires_new_approval"]
    with m.SessionLocal() as db:
        text = str(db.get(m.ModuleRecord, sequence_id).payload)
        assert "thousands" not in text and "10 minutes" not in text and "free call" not in text


def inbound(channel="chat", event_id="inbound-1", **extra):
    return dict(event_id=event_id, channel=channel, contact_id="provider-contact", destination="sales",
                received_at=(datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat(),
                intent="setup", authenticated=True, direction="inbound", **extra)


@pytest.fixture
def channels(service, monkeypatch):
    for channel in ("CHAT", "WHATSAPP"):
        monkeypatch.setenv("MARKETING_SALES_"+channel+"_DESTINATION", "sales")
    return service[0]


def test_reply_default_off_no_provider_call_and_no_email_identity_link(channels):
    with channels.SessionLocal() as db:
        reply = sales.ingest(db, inbound(email="someone@example.com", phone="+15555550100"))
        adapter = Mock()
        assert sales.dispatch(db, reply.id, adapter) == "disabled"
        adapter.send.assert_not_called()
        assert db.scalars(select(channels.Lead)).all() == []


def test_reply_idempotency_limits_optout_and_no_echo(channels, monkeypatch):
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    monkeypatch.setenv("MARKETING_SALES_CHAT_ENABLED", "true")
    with channels.SessionLocal() as db:
        body = inbound()
        reply = sales.ingest(db, body)
        assert sales.ingest(db, body).id == reply.id
        adapter = Mock()
        adapter.send.return_value = {"status": "accepted", "provider_id": "synthetic"}
        assert sales.dispatch(db, reply.id, adapter) == "accepted"
        assert sales.dispatch(db, reply.id, adapter) == "blocked"
        assert adapter.send.call_count == 1
        with pytest.raises(HTTPException):
            sales.ingest(db, {**body, "direction": "outbound"})
        for i in range(2,5):
            assert sales.ingest(db, inbound(event_id=str(i))).status == "prepared"
        assert sales.ingest(db, inbound(event_id="5")).status == "limited"
        assert sales.ingest(db, {**inbound(event_id="stop"), "intent": "opt_out"}).status == "suppressed"
        assert sales.dispatch(db, "2", adapter) == "suppressed"
        assert sales.ingest(db, inbound(event_id="reopen", consent=True)).status == "suppressed"


def test_unknown_provider_outcome_requires_reconciliation(channels, monkeypatch):
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    monkeypatch.setenv("MARKETING_SALES_CHAT_ENABLED", "true")
    with channels.SessionLocal() as db:
        reply = sales.ingest(db, inbound())
        adapter = Mock()
        adapter.send.side_effect = TimeoutError()
        assert sales.dispatch(db, reply.id, adapter) == "unknown"
    with channels.SessionLocal() as db:
        assert sales.dispatch(db, reply.id, adapter) == "reconciliation_required"
        assert adapter.send.call_count == 1
        with pytest.raises(HTTPException):
            sales.reconcile(db, reply.id)
        assert sales.reconcile(db, reply.id, provider_id="confirmed-synthetic") == "accepted"


def test_whatsapp_rechecks_window_at_dispatch_and_retry(channels, monkeypatch):
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    monkeypatch.setenv("MARKETING_SALES_WHATSAPP_ENABLED", "true")
    monkeypatch.setenv("MARKETING_SALES_WHATSAPP_SENDER", "synthetic-sender")
    start = datetime.now(timezone.utc)
    with channels.SessionLocal() as db:
        reply = sales.ingest(db, inbound("whatsapp", consent=True))
        adapter = Mock()
        adapter.send.return_value = {"status": "rejected"}
        assert sales.dispatch(db, reply.id, adapter) == "rejected"
        monkeypatch.setattr(sales, "clock", lambda: start+timedelta(hours=25))
        assert sales.dispatch(db, reply.id, adapter) == "outside_service_window"
        assert adapter.send.call_count == 1
        template = {"approved": True, "id": "approved-id", "content": {"text": "Approved factual next step"}}
        monkeypatch.setenv("MARKETING_SALES_WHATSAPP_TEMPLATE", "approved-id")
        monkeypatch.setenv("MARKETING_SALES_WHATSAPP_TEMPLATE_SHA256", journey.fingerprint(template["content"]))
        assert sales.dispatch(db, reply.id, adapter, template=template) == "rejected"
        assert adapter.send.call_count == 2
        row = db.get(sales.Conversation, reply.conversation_id)
        row.consent = 0
        db.commit()
        assert sales.dispatch(db, reply.id, adapter, template=template) == "outside_service_window"


def test_concurrent_dispatch_claims_contact_provider_at_most_once(channels, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    monkeypatch.setenv("MARKETING_SALES_CHAT_ENABLED", "true")
    with channels.SessionLocal() as db:
        reply_id = sales.ingest(db, inbound()).id
    barrier = Barrier(2)
    adapter = Mock()
    adapter.send.return_value = {"status": "accepted", "provider_id": "synthetic-only"}
    def worker():
        with channels.SessionLocal() as db:
            barrier.wait(timeout=5)
            return sales.dispatch(db, reply_id, adapter)
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(lambda _: worker(), range(2)))
    assert "accepted" in result and adapter.send.call_count == 1


def test_retention_is_separate_default_off_consent_safe_and_cancel_aware(service, monkeypatch):
    m, client, headers = service
    lead = client.post("/api/marketing/internal/ingest", headers=headers, json=dict(
        email="owner@example.com", email_verified=True, festio_user_id="owner", event_id="reg", consent_email=True)).json()
    endpoint = f"/api/marketing/organizer-retention/{lead['id']}"
    assert client.get(endpoint, headers=headers).json()["eligible"] is False
    with m.SessionLocal() as db:
        db.add(journey.Evidence(id="completion", fingerprint="x", account_id="owner", org_id="org",
            event_id="event", use_case="rsvp", milestone="event_completed", source_id="ended", occurred_at="2026-01-01T00:00:00Z"))
        db.commit()
    monkeypatch.setenv("MARKETING_ORGANIZER_RETENTION_ENABLED", "true")
    result = client.get(endpoint, headers=headers).json()
    assert result["eligible"] and result["sends"] == 0
    with m.SessionLocal() as db:
        db.add(journey.Evidence(id="cancel", fingerprint="x", account_id="owner", org_id="org",
            event_id="event", use_case="rsvp", milestone="event_cancelled", source_id="cancelled", occurred_at="2026-01-01T00:00:00Z"))
        db.commit()
    assert client.get(endpoint, headers=headers).json()["eligible"] is False


@pytest.mark.parametrize("patch", [{"authenticated": False}, {"destination": "guests"},
    {"direction": "outbound"}, {"received_at": "2099-01-01T00:00:00Z"}])
def test_untrusted_metadata_never_prepares_response(channels, patch):
    with channels.SessionLocal() as db:
        with pytest.raises(HTTPException):
            sales.ingest(db, {**inbound(), **patch})
        assert db.scalars(select(sales.Reply)).all() == []
