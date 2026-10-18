import asyncio
import importlib
from pathlib import Path
import re
from datetime import timedelta, timezone
from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy import func, select

from test_marketing_e2e import load_app


@pytest.fixture
def service(tmp_path):
    client, headers = load_app(tmp_path)
    return importlib.import_module("app.main"), client, headers


def identity(module):
    return module.Identity(subject="test", email="admin@example.com", name="Admin", is_superadmin=True, role="superadmin")


def due_lead(module, *, consent=True, stage="registered", **extra):
    with module.SessionLocal() as db:
        lead = module.Lead(email=f"lead-{module.uid()}@example.com", consent_email=consent, stage=stage, next_follow_up_at=module.now() - timedelta(minutes=1), stage_changed_at=module.now() - timedelta(days=10), **extra)
        db.add(lead)
        db.commit()
        return lead.id


def run(module, **kwargs):
    with module.SessionLocal() as db:
        return module.run_automation_service(db, identity(module), **kwargs)


def make_due(module, lead_id):
    with module.SessionLocal() as db:
        db.get(module.Lead, lead_id).next_follow_up_at = module.now() - timedelta(seconds=1)
        db.commit()


def get_lead(module, lead_id):
    with module.SessionLocal() as db:
        return db.get(module.Lead, lead_id)


def ingest(client, headers, **values):
    # These fixtures model the trusted adapter after verified authentication.
    return client.post("/api/marketing/internal/ingest", headers=headers, json={"email": "organizer@example.com", "email_verified": True, **values})


def test_lifecycle_receipt_is_atomic_idempotent_and_rejects_reuse(service):
    module, client, headers = service
    event = {"event_id": "registration:1", "lifecycle_event": "registered", "festio_user_id": "account-1", "name": "Organizer"}
    first = ingest(client, headers, **event)
    assert first.status_code == 200
    lead = first.json()
    assert lead["ingest_duplicate"] is False
    assert not lead["consent_email"] and not lead["consent_sms"] and not lead["consent_whatsapp"]
    assert lead["next_follow_up_at"] is None
    second = ingest(client, headers, **event)
    assert second.json()["id"] == lead["id"] and second.json()["ingest_duplicate"] is True
    assert ingest(client, headers, **{**event, "name": "Changed"}).status_code == 409
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.Lead.id))) == 1
        assert db.scalar(select(func.count(module.Activity.id))) == 1
        assert db.scalar(select(func.count(module.IngestReceipt.event_id))) == 1


def test_invalid_lifecycle_rolls_back_receipt_and_can_be_retried(service):
    module, client, headers = service
    bad = ingest(client, headers, event_id="invalid:1", guest_count="not-a-number")
    assert bad.status_code == 400
    with module.SessionLocal() as db:
        assert db.get(module.IngestReceipt, "invalid:1") is None
        assert db.scalar(select(func.count(module.Lead.id))) == 0
    assert ingest(client, headers, event_id="invalid:1", guest_count=20).status_code == 200


def test_lifecycle_preserves_consent_advances_without_regression_and_revokes(service):
    module, client, headers = service
    lead = ingest(client, headers, event_id="reg:1", stage="registered", consent_email=True, consent_whatsapp=True).json()
    advanced = ingest(client, headers, event_id="event:1", lifecycle_event="event_created", stage="event_created").json()
    assert advanced["consent_email"] and advanced["consent_whatsapp"]
    paid = ingest(client, headers, event_id="paid:1", lifecycle_event="paid", stage="paid").json()
    assert paid["stage"] == "paid"
    delayed = ingest(client, headers, event_id="consent:1", lifecycle_event="signup_consent", stage="registered", consent_email=False).json()
    assert delayed["stage"] == "paid" and delayed["consent_email"] is False and delayed["consent_whatsapp"] is True
    assert delayed["next_follow_up_at"] is None
    assert delayed["id"] == lead["id"]
    assert ingest(client, headers, event_id="bad:consent", consent_email="true").status_code == 400


def test_deleted_lead_cannot_be_resurrected_by_old_event(service):
    module, client, headers = service
    event = {"event_id": "deleted:1"}
    lead = ingest(client, headers, **event).json()
    assert client.delete(f"/api/marketing/leads/{lead['id']}", headers=headers).status_code == 204
    repeated = ingest(client, headers, **event).json()
    assert repeated["ingest_duplicate"] and repeated["removed"]
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.Lead.id))) == 0


def test_demo_creates_one_review_task_with_requested_details_not_booking(service):
    module, client, headers = service
    event = {"event_id": "demo:1", "lifecycle_event": "demo_requested", "stage": "demo_requested", "phone": "+15555550101", "organization": "Example", "preferred_time": "2026-11-01T12:00:00Z", "timezone": "UTC", "event_name": "Launch", "message": "Help with invitations", "demo_request_id": "request-1"}
    lead = ingest(client, headers, **event).json()
    assert lead["automation_paused"] and lead["handoff_requested_at"]
    assert lead["demo_at"] is None
    assert ingest(client, headers, **event).json()["ingest_duplicate"]
    with module.SessionLocal() as db:
        tasks = db.scalars(select(module.ModuleRecord).where(module.ModuleRecord.module == "tasks", module.ModuleRecord.payload["lead_id"].as_string() == lead["id"])).all()
        assert len(tasks) == 1
        assert tasks[0].payload["booking_confirmed"] is False
        assert tasks[0].payload["preferred_time"] == event["preferred_time"]
        assert tasks[0].payload["message"] == event["message"]


@pytest.mark.parametrize("channel", ["email", "whatsapp", "chat", "sms"])
def test_conversation_pauses_all_automatic_followups_and_is_deduplicated(service, monkeypatch, channel):
    module, client, headers = service
    lead = ingest(client, headers, event_id="reg:1", consent_email=True, consent_whatsapp=True).json()
    body = {"event_id": f"reply:{channel}", "channel": channel, "event": "message_received", "identity_verified": True, "email": lead["email"], "message": "Private transcript must not be retained"}
    result = client.post("/api/marketing/internal/conversations", headers=headers, json=body)
    assert result.json() == {"recorded": True, "duplicate": False, "lead_id": lead["id"]}
    assert client.post("/api/marketing/internal/conversations", headers=headers, json=body).json()["duplicate"]
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    make_due(module, lead["id"])
    sender = Mock()
    monkeypatch.setattr(module, "send_follow_up", sender)
    assert run(module)["eligible"] == 0
    sender.assert_not_called()
    stored = get_lead(module, lead["id"])
    assert stored.automation_paused and stored.last_inbound_at and stored.handoff_requested_at
    with module.SessionLocal() as db:
        activities = db.scalars(select(module.Activity)).all()
        assert "Private transcript" not in str([activity.data for activity in activities])
        assert len([row for row in activities if row.kind == f"{channel}_message_received"]) == 1


def test_new_verified_phone_prospect_is_durable_and_later_associated(service):
    module, client, headers = service
    body = {"event_id": "reply:unknown", "channel": "whatsapp", "identity_verified": True, "phone": "+15555550101", "event": "opt_out"}
    response = client.post("/api/marketing/internal/conversations", headers=headers, json=body).json()
    assert response["recorded"] and response["unmatched"] and response["lead_id"] is None
    with module.SessionLocal() as db:
        assert db.get(module.IngestReceipt, body["event_id"]) is not None
        assert db.get(module.PendingProspect, response["prospect_id"]).opted_out
    lead = ingest(client, headers, event_id="reg:1", phone=body["phone"], consent_whatsapp=True).json()
    assert lead["automation_paused"] and lead["consent_whatsapp"] is False
    replay = client.post("/api/marketing/internal/conversations", headers=headers, json=body).json()
    assert replay["duplicate"] and replay["lead_id"] == lead["id"] and not replay["unmatched"]
    ingest(client, headers, email="other@example.com", event_id="reg:2", phone=body["phone"])
    assert client.post("/api/marketing/internal/conversations", headers=headers, json={**body, "event_id": "reply:ambiguous"}).status_code == 409
    assert client.post("/api/marketing/internal/conversations", json=body).status_code == 401


def test_opt_out_and_delivery_deduplication(service):
    module, client, headers = service
    lead = ingest(client, headers, event_id="reg:1", consent_email=True, consent_whatsapp=True).json()
    body = {"event_id": "whatsapp:stop", "channel": "whatsapp", "event": "opt_out", "identity_verified": True, "email": lead["email"]}
    assert client.post("/api/marketing/internal/conversations", headers=headers, json=body).status_code == 200
    row = get_lead(module, lead["id"])
    assert row.consent_whatsapp is False and row.automation_paused
    delivery = {"event_id": "delivery:1", "email": lead["email"], "event": "email.bounced", "bounce_type": "hard"}
    assert client.post("/api/marketing/internal/delivery", headers=headers, json=delivery).json() == {"recorded": True}
    assert client.post("/api/marketing/internal/delivery", headers=headers, json=delivery).json()["duplicate"]
    row = get_lead(module, lead["id"])
    assert not row.consent_email and row.unsubscribed
    assert row.suppression_reason == "email_hard_bounce"


def test_default_off_gate_and_consent_cannot_be_bypassed(service, monkeypatch):
    module, client, headers = service
    lead_id = due_lead(module)
    due_lead(module, consent=False)
    monkeypatch.setenv("MARKETING_SKIP_CONSENT_CHECK", "true")
    sender = Mock()
    monkeypatch.setattr(module, "send_follow_up", sender)
    result = run(module)
    assert result["disabled"] and result["eligible"] == 1 and result["queued"] == 0
    assert run(module, dry_run=True)["queued"] == 1
    sender.assert_not_called()
    assert client.post(f"/api/marketing/leads/{lead_id}/sms", headers=headers, json={"message": "Test"}).status_code == 503
    assert client.post("/api/marketing/social/publish", headers=headers, json={"platform": "linkedin", "message": "Test"}).status_code == 503
    assert client.get("/api/marketing/providers", headers=headers).json()["outbound_enabled"] is False


def test_failed_attempt_does_not_advance_and_seeded_delays_are_used(service, monkeypatch):
    module, client, headers = service
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    lead_id = due_lead(module)
    sender = Mock(side_effect=[{"status": "failed", "provider": "none"}, {"status": "sent", "provider": "test"}, {"status": "sent", "provider": "test"}])
    monkeypatch.setattr(module, "send_follow_up", sender)
    assert run(module)["failed"] == 1
    with module.SessionLocal() as db:
        snapshot = module.lead_automation_map(db, [db.get(module.Lead, lead_id)])[lead_id]
        assert snapshot["step"] == 0 and snapshot["complete"] is False
        assert snapshot["last_touch_status"] == "failed"
    make_due(module, lead_id)
    before = module.now()
    assert run(module)["sent"] == 1
    next_time = get_lead(module, lead_id).next_follow_up_at.replace(tzinfo=timezone.utc)
    assert timedelta(hours=24) <= next_time - before < timedelta(hours=24, seconds=3)
    make_due(module, lead_id)
    before = module.now()
    assert run(module)["sent"] == 1
    next_time = get_lead(module, lead_id).next_follow_up_at.replace(tzinfo=timezone.utc)
    assert timedelta(hours=48) <= next_time - before < timedelta(hours=48, seconds=3)
    assert [call.args[2] for call in sender.call_args_list] == [0, 0, 1]


def test_completed_sequence_stops_immediately_and_delivery_updates_do_not_advance(service, monkeypatch):
    module, client, headers = service
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    lead_id = due_lead(module, stage="unique")
    with module.SessionLocal() as db:
        seq = module.ModuleRecord(module="sequences", name="One step", status="active", created_by="test", payload={"stage": "unique", "steps": [{"subject": "Hi", "delay_hours": 0}]})
        db.add(seq)
        db.commit()
        seq_id = seq.id
        db.add(module.Activity(lead_id=lead_id, kind="email_delivered", summary="Webhook", data={"sequence_id": seq_id}))
        db.commit()
    monkeypatch.setattr(module, "send_follow_up", Mock(return_value={"status": "sent", "provider": "test"}))
    assert run(module)["sent"] == 1
    assert get_lead(module, lead_id).next_follow_up_at is None
    with module.SessionLocal() as db:
        assert module.lead_automation_map(db, [db.get(module.Lead, lead_id)])[lead_id]["complete"]


def test_retry_is_bounded_and_ambiguous_outcome_is_not_retried(service, monkeypatch):
    module, client, headers = service
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    monkeypatch.setenv("MARKETING_MAX_SEND_ATTEMPTS", "2")
    first_id = due_lead(module)
    sender = Mock(return_value={"status": "failed", "provider": "none"})
    monkeypatch.setattr(module, "send_follow_up", sender)
    run(module)
    make_due(module, first_id)
    run(module)
    assert get_lead(module, first_id).suppression_reason == "delivery_retry_exhausted"
    second_id = due_lead(module)
    sender.side_effect = httpx.ReadTimeout("Outcome unknown")
    run(module)
    assert get_lead(module, second_id).suppression_reason == "delivery_outcome_unknown"
    make_due(module, second_id)
    run(module)
    assert sender.call_count == 3


def test_inflight_claim_prevents_overlapping_dispatch_and_crash_retry(service, monkeypatch):
    module, client, headers = service
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    lead_id = due_lead(module)
    with module.SessionLocal() as db:
        seq = db.scalar(select(module.ModuleRecord).where(module.ModuleRecord.name == "New registration welcome"))
        claim = module.claim_sequence_step(db, db.get(module.Lead, lead_id), seq, 0)
        claim_id = claim.id
    sender = Mock()
    monkeypatch.setattr(module, "send_follow_up", sender)
    assert run(module)["queued"] == 0
    with module.SessionLocal() as db:
        db.get(module.SendAttempt, claim_id).updated_at = module.now() - timedelta(minutes=3)
        db.commit()
    assert run(module)["queued"] == 0
    assert get_lead(module, lead_id).suppression_reason == "delivery_outcome_unknown"
    sender.assert_not_called()


def test_image_off_defaults_prevent_scheduler_sends_and_retention(service, monkeypatch):
    module, client, headers = service
    dockerfile = Path(__file__).parents[1] / "Dockerfile"
    defaults = dict(re.findall(r"(MARKETING_(?:OUTBOUND|SCHEDULER)_ENABLED)=(\w+)", dockerfile.read_text()))
    assert defaults == {"MARKETING_OUTBOUND_ENABLED": "false", "MARKETING_SCHEDULER_ENABLED": "false"}
    for name, value in defaults.items():
        monkeypatch.setenv(name, value)
    lead_id = due_lead(module)
    thread, sender, retention = Mock(), Mock(), Mock()
    monkeypatch.setattr(module.threading, "Thread", thread)
    monkeypatch.setattr(module, "send_follow_up", sender)
    monkeypatch.setattr(module, "run_gdpr_retention", retention)

    module.start_scheduler()
    result = run(module)

    thread.assert_not_called()
    sender.assert_not_called()
    retention.assert_not_called()
    assert result["disabled"] and result["sent"] == 0
    assert get_lead(module, lead_id) is not None


def test_scheduler_uses_plain_service_with_no_fastapi_query_defaults(service, monkeypatch):
    module, client, headers = service
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    due_lead(module)
    sender = Mock(return_value={"status": "sent", "provider": "test"})
    monkeypatch.setattr(module, "send_follow_up", sender)
    calls = 0

    class StopScheduler(BaseException):
        pass

    class Tick:
        def wait(self, interval):
            nonlocal calls
            calls += 1
            if calls > 1:
                raise StopScheduler()

    monkeypatch.setattr(module.threading, "Event", Tick)
    with pytest.raises(StopScheduler):
        module.scheduled_automation()
    sender.assert_called_once()


def configure_email_readiness(module, monkeypatch, domain="replies.example.com"):
    monkeypatch.setenv("MARKETING_REPLY_DOMAIN", domain)
    monkeypatch.setenv("MARKETING_EMAIL_READINESS_URL", "http://backend:8000/api/internal/marketing/email-readiness")
    def signed_readiness(*args, **kwargs):
        import jwt
        moment = module.now()
        fields = {"ready": True, "pending": 0, "failed": 0, "reply_routing_ready": True,
                  "reply_domain": domain, "checked_at": moment.isoformat()}
        proof = jwt.encode({**fields, "sub": "marketing-email-readiness-response",
                            "iss": "festio-backend", "aud": "marketing-email-readiness-response",
                            "jti": kwargs["params"]["challenge"], "iat": moment,
                            "exp": moment + timedelta(seconds=5)}, module.TOKEN_SECRET, algorithm="HS256")
        return httpx.Response(200, request=httpx.Request("GET", args[0]), json={**fields, "proof": proof})
    monkeypatch.setattr(module.httpx, "get", Mock(side_effect=signed_readiness))


def test_resend_stable_idempotency_key_and_no_config_is_failure(service, monkeypatch):
    module, client, headers = service
    configure_email_readiness(module, monkeypatch)
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    lead_id = due_lead(module)
    with module.SessionLocal() as db:
        lead = db.get(module.Lead, lead_id)
        sequence = db.scalar(select(module.ModuleRecord).where(module.ModuleRecord.name == "New registration welcome"))
        assert module.send_follow_up(lead, sequence)["status"] == "failed"
        monkeypatch.setenv("RESEND_API_KEY", "synthetic-test-key")
        provider = Mock(side_effect=[
            httpx.Response(400, request=httpx.Request("POST", "https://example.invalid")),
            httpx.Response(200, request=httpx.Request("POST", "https://example.invalid"), json={"id": "fake-provider-id"}),
        ])
        monkeypatch.setattr(module.httpx, "post", provider)
        with pytest.raises(httpx.HTTPStatusError):
            module.send_follow_up(lead, sequence, 0)
        assert module.send_follow_up(lead, sequence, 0)["status"] == "sent"
        with pytest.raises(module.email_pilot.EmailBlocked):
            module.send_follow_up(lead, sequence, 0)
        assert provider.call_count == 2  # One explicit rejection, one accepted; never resubmit accepted work.
        assert provider.call_args_list[0].kwargs["headers"]["Idempotency-Key"] == provider.call_args_list[1].kwargs["headers"]["Idempotency-Key"]


def test_sms_webhook_authentication_fails_closed(service, monkeypatch):
    module, client, headers = service
    monkeypatch.delenv("SIGNALHOUSE_WEBHOOK_TOKEN")
    assert client.post("/api/marketing/sms/webhook", json={}).status_code == 503
    monkeypatch.setenv("SIGNALHOUSE_WEBHOOK_TOKEN", "test-token")
    assert client.post("/api/marketing/sms/webhook", json={}).status_code == 401


def test_parallel_workers_send_a_sequence_step_once(service, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from time import sleep

    module, client, headers = service
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    due_lead(module)

    def provider(*args):
        sleep(0.1)
        return {"status": "sent", "provider": "test"}

    sender = Mock(side_effect=provider)
    monkeypatch.setattr(module, "send_follow_up", sender)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: run(module), range(2)))
    assert sum(result["sent"] for result in results) == 1
    sender.assert_called_once()
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.SendAttempt.id))) == 1


def test_existing_database_gets_safe_additive_migration(tmp_path):
    import sqlite3

    client, headers = load_app(tmp_path)
    lead = client.post("/api/marketing/leads", headers=headers, json={"email": "legacy@example.com", "consent_email": True}).json()
    module = importlib.import_module("app.main")
    module.engine.dispose()
    with sqlite3.connect(tmp_path / "marketing.db") as db:
        for column in ("consent_whatsapp", "automation_paused", "suppression_reason", "last_inbound_at", "handoff_requested_at"):
            db.execute(f"ALTER TABLE marketing_leads DROP COLUMN {column}")
    client, headers = load_app(tmp_path)
    upgraded = client.get("/api/marketing/leads?q=legacy", headers=headers).json()[0]
    assert upgraded["id"] == lead["id"] and upgraded["consent_email"]
    assert upgraded["consent_whatsapp"] is False and upgraded["automation_paused"] is False
    assert upgraded["suppression_reason"] is None


def test_provider_sent_webhook_does_not_consume_an_extra_step(service, monkeypatch):
    module, client, headers = service
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    lead_id = due_lead(module)
    sender = Mock(return_value={"status": "sent", "provider": "test", "provider_id": "sent-1"})
    monkeypatch.setattr(module, "send_follow_up", sender)
    run(module)
    client.post("/api/marketing/internal/delivery", headers=headers, json={"event_id": "provider:sent-1", "email": get_lead(module, lead_id).email, "event": "email.sent", "provider_id": "sent-1"})
    with module.SessionLocal() as db:
        assert module.lead_automation_map(db, [db.get(module.Lead, lead_id)])[lead_id]["step"] == 1
    make_due(module, lead_id)
    run(module)
    assert [call.args[2] for call in sender.call_args_list] == [0, 1]


def test_international_phone_normalization_does_not_infer_country(service):
    module, client, headers = service
    lead = ingest(client, headers, event_id="phone:1", phone="+1 (555) 555-0101").json()
    assert lead["phone"] == "+15555550101"
    body = {"event_id": "phone:reply", "channel": "whatsapp", "identity_verified": True, "phone": "+15555550101"}
    assert client.post("/api/marketing/internal/conversations", headers=headers, json=body).json()["lead_id"] == lead["id"]
    created = client.post("/api/marketing/leads", headers=headers, json={"email": "formatted@example.com", "phone": "+44 7700-900-123"}).json()
    assert created["phone"] == "+447700900123"
    updated = client.patch(f"/api/marketing/leads/{created['id']}", headers=headers, json={"phone": "+44 (7700) 900 124"}).json()
    assert updated["phone"] == "+447700900124"
    local = ingest(client, headers, email="local@example.com", event_id="phone:local", phone="5555550101").json()
    assert local["phone"] == "5555550101"
    assert client.post("/api/marketing/internal/conversations", headers=headers, json={"event_id": "local:reply", "channel": "whatsapp", "identity_verified": True, "phone": local["phone"]}).json()["unmatched"] is True


def test_parallel_duplicate_demo_events_commit_one_task(service):
    from concurrent.futures import ThreadPoolExecutor

    module, client, headers = service
    body = {"event_id": "demo:parallel", "lifecycle_event": "demo_requested", "message": "Requested details"}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: ingest(client, headers, **body), range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert sorted(response.json()["ingest_duplicate"] for response in responses) == [False, True]
    lead_id = responses[0].json()["id"]
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.ModuleRecord.id)).where(module.ModuleRecord.module == "tasks", module.ModuleRecord.payload["lead_id"].as_string() == lead_id)) == 1
    assert client.delete(f"/api/marketing/leads/{lead_id}", headers=headers).status_code == 204
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.ModuleRecord.id)).where(module.ModuleRecord.module == "tasks", module.ModuleRecord.payload["lead_id"].as_string() == lead_id)) == 0


@pytest.mark.parametrize("channel", ["email", "chat"])
def test_unverified_identity_claim_never_changes_existing_lead(service, channel):
    module, client, headers = service
    lead = ingest(client, headers, event_id="existing:1", consent_email=True).json()
    body = {"event_id": f"unverified:{channel}", "channel": channel, "email": lead["email"], "event": "opt_out", "source_contact_id": f"test:{channel}:contact"}
    result = client.post("/api/marketing/internal/conversations", headers=headers, json=body).json()
    assert result["recorded"] and result["unmatched"] and result["lead_id"] is None
    stored = get_lead(module, lead["id"])
    assert stored.consent_email and not stored.automation_paused and not stored.unsubscribed
    # A later matching account event still cannot verify someone else's claim.
    updated = ingest(client, headers, event_id="later:1", stage="event_created").json()
    assert not updated["automation_paused"]
    replay = client.post("/api/marketing/internal/conversations", headers=headers, json=body).json()
    assert replay["duplicate"] and replay["unmatched"]


def test_anonymous_chat_creates_one_private_review_task(service):
    module, client, headers = service
    body = {"event_id": "anonymous:1", "channel": "chat", "source_contact_id": "chatwoot:1:2:3"}
    first = client.post("/api/marketing/internal/conversations", headers=headers, json=body).json()
    second = client.post("/api/marketing/internal/conversations", headers=headers, json={**body, "event_id": "anonymous:2"}).json()
    assert first["recorded"] and first["prospect_id"] == second["prospect_id"]
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 1
        assert db.scalar(select(func.count(module.Lead.id))) == 0
        tasks = db.scalars(select(module.ModuleRecord).where(module.ModuleRecord.module == "tasks", module.ModuleRecord.payload["prospect_id"].as_string() == first["prospect_id"])).all()
        assert len(tasks) == 1 and tasks[0].owner_email


def test_reply_token_binds_email_reply_and_outbound_reply_to(service, monkeypatch):
    from app.reply_routing import make_reply_token

    module, client, headers = service
    lead = ingest(client, headers, event_id="email:lead", consent_email=True).json()
    token = make_reply_token(lead["id"], module.TOKEN_SECRET)
    body = {"event_id": "token:reply", "channel": "email", "email": lead["email"], "reply_token": token}
    assert client.post("/api/marketing/internal/conversations", headers=headers, json=body).json()["lead_id"] == lead["id"]
    assert get_lead(module, lead["id"]).automation_paused
    mismatch = client.post("/api/marketing/internal/conversations", headers=headers, json={**body, "event_id": "token:mismatch", "email": "attacker@example.com"})
    assert mismatch.status_code == 403
    malformed = client.post("/api/marketing/internal/conversations", headers=headers, json={**body, "event_id": "token:invalid", "reply_token": "invalid"})
    assert malformed.status_code == 403
    new_id = due_lead(module)
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    configure_email_readiness(module, monkeypatch)
    monkeypatch.setenv("RESEND_API_KEY", "test-only")
    provider = Mock(return_value=httpx.Response(200, request=httpx.Request("POST", "https://example.invalid"), json={"id": "reply-provider"}))
    monkeypatch.setattr(module.httpx, "post", provider)
    with module.SessionLocal() as db:
        seq = db.scalar(select(module.ModuleRecord).where(module.ModuleRecord.name == "New registration welcome"))
        module.send_follow_up(db.get(module.Lead, new_id), seq)
    assert provider.call_args.kwargs["json"]["reply_to"].endswith("@replies.example.com")
    assert make_reply_token(new_id, module.TOKEN_SECRET) in provider.call_args.kwargs["json"]["reply_to"]


@pytest.mark.parametrize("change", ["due", "stage"])
def test_stale_due_snapshot_releases_claim_without_spending_retry(service, monkeypatch, change):
    module, client, headers = service
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    lead_id = due_lead(module)
    with module.SessionLocal() as db:
        seq = db.scalar(select(module.ModuleRecord).where(module.ModuleRecord.name == "New registration welcome"))
        seq_id = seq.id
        db.add(module.Activity(lead_id=lead_id, kind="email_sent", summary="A concurrent worker completed step zero", actor="scheduler", data={"sequence_id": seq_id, "step_index": 0}))
        db.commit()
    original_claim = module.claim_sequence_step

    def interleaved_claim(db, lead, sequence, step_index):
        assert step_index == 1
        claim = original_claim(db, lead, sequence, step_index)
        with module.SessionLocal() as other:
            changed = other.get(module.Lead, lead.id)
            if change == "due":
                changed.next_follow_up_at = module.now() + timedelta(hours=24)
            else:
                changed.stage = "paid"
            other.commit()
        return claim

    monkeypatch.setattr(module, "claim_sequence_step", interleaved_claim)
    sender = Mock()
    monkeypatch.setattr(module, "send_follow_up", sender)
    assert run(module)["queued"] == 0
    sender.assert_not_called()
    with module.SessionLocal() as db:
        assert db.get(module.SendAttempt, f"{lead_id}/{seq_id}/1") is None


def test_owner_scoped_staff_cannot_read_edit_or_delete_other_demo_tasks(service):
    import jwt

    module, client, headers = service
    lead = ingest(client, headers, event_id="private:demo", lifecycle_event="demo_requested", message="Private organizer details").json()
    tasks = client.get("/api/marketing/modules/tasks", headers=headers).json()
    task = next(task for task in tasks if task["payload"].get("lead_id") == lead["id"])
    client.post("/api/marketing/access", headers=headers, json={"email": "sales@example.com", "role": "manager", "owner_scoped": True})
    token = jwt.encode({"sub": "sales", "email": "sales@example.com", "email_verified": True, "iss": "guesthub", "aud": "marketing", "iat": module.now(), "exp": module.now() + timedelta(minutes=10)}, "test-secret", algorithm="HS256")
    scoped = {"Authorization": f"Bearer {token}"}
    assert task["id"] not in {row["id"] for row in client.get("/api/marketing/modules/tasks", headers=scoped).json()}
    assert client.patch(f"/api/marketing/modules/tasks/{task['id']}", headers=scoped, json={"status": "complete"}).status_code == 404
    assert client.delete(f"/api/marketing/modules/tasks/{task['id']}", headers=scoped).status_code == 404


def test_consent_evidence_records_only_explicit_channels_once(service):
    module, client, headers = service
    event = {"event_id": "consent:evidence", "lifecycle_event": "signup_consent", "stage": "registered", "consent_email": True, "occurred_at": "2026-10-16T12:00:00Z", "source": "signup_form"}
    lead = ingest(client, headers, **event).json()
    ingest(client, headers, **event)
    with module.SessionLocal() as db:
        evidence = db.scalars(select(module.Activity).where(module.Activity.lead_id == lead["id"], module.Activity.kind == "consent_recorded")).all()
        assert len(evidence) == 1
        assert evidence[0].data["requested"] == {"consent_email": True}
        assert evidence[0].data["effective"] == {"consent_email": True}
        assert evidence[0].data["occurred_at"] == event["occurred_at"]
        assert evidence[0].data["source"] == event["source"]


def test_identity_verified_requires_a_real_boolean(service):
    module, client, headers = service
    response = client.post("/api/marketing/internal/conversations", headers=headers, json={"event_id": "bad:verified", "channel": "chat", "source_contact_id": "test:1", "identity_verified": "true"})
    assert response.status_code == 422


def test_anonymous_prospect_later_contact_claim_updates_task_without_identity_upgrade(service):
    module, client, headers = service
    existing = ingest(client, headers, event_id="known:lead", consent_email=True).json()
    body = {"event_id": "chat:anonymous", "channel": "chat", "source_contact_id": "chatwoot:1:2:visitor"}
    first = client.post("/api/marketing/internal/conversations", headers=headers, json=body).json()
    later = client.post("/api/marketing/internal/conversations", headers=headers, json={**body, "event_id": "chat:contact", "email": existing["email"], "phone": "+1 (555) 555-0101"}).json()
    assert later["prospect_id"] == first["prospect_id"] and later["unmatched"]
    with module.SessionLocal() as db:
        prospect = db.get(module.PendingProspect, first["prospect_id"])
        assert prospect.email == existing["email"] and prospect.phone == "+15555550101"
        assert not prospect.identity_verified and prospect.lead_id is None
        tasks = db.scalars(select(module.ModuleRecord).where(module.ModuleRecord.module == "tasks", module.ModuleRecord.payload["prospect_id"].as_string() == prospect.id)).all()
        assert len(tasks) == 1 and tasks[0].payload["email"] == existing["email"]
        assert tasks[0].payload["phone"] == "+15555550101" and tasks[0].payload["identity_status"] == "unverified"
    assert not get_lead(module, existing["id"]).automation_paused


def test_stale_sequence_completion_cannot_clear_new_lifecycle_schedule(service, monkeypatch):
    from sqlalchemy.sql.dml import Update

    module, client, headers = service
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    lead_id = due_lead(module, stage="empty_sequence")
    with module.SessionLocal() as db:
        db.add(module.ModuleRecord(module="sequences", name="No steps", status="active", created_by="test", payload={"stage": "empty_sequence", "steps": []}))
        db.commit()
    future = module.now() + timedelta(hours=1)
    with module.SessionLocal() as db:
        original_execute = db.execute
        advanced = False

        def execute_with_lifecycle_advance(statement, *args, **kwargs):
            nonlocal advanced
            if isinstance(statement, Update) and statement.table.name == "marketing_leads" and not advanced:
                advanced = True
                with module.SessionLocal() as lifecycle_db:
                    lead = lifecycle_db.get(module.Lead, lead_id)
                    lead.stage = "event_created"
                    lead.next_follow_up_at = future
                    lifecycle_db.commit()
            return original_execute(statement, *args, **kwargs)

        monkeypatch.setattr(db, "execute", execute_with_lifecycle_advance)
        module.run_automation_service(db, identity(module))
        assert advanced
    row = get_lead(module, lead_id)
    assert row.stage == "event_created"
    assert row.next_follow_up_at.replace(tzinfo=timezone.utc) == future

def test_reply_binding_fails_closed_before_receipts_and_identity_fallback(service):
    from app.reply_routing import make_reply_token

    module, client, headers = service
    lead = ingest(client, headers, event_id="bound:lead", consent_email=True).json()
    bound = make_reply_token(lead["id"], module.TOKEN_SECRET)
    baseline = get_lead(module, lead["id"])
    original_state = (baseline.automation_paused, baseline.consent_email, baseline.unsubscribed)
    body = {"event_id": "bound:attack", "channel": "email", "email": lead["email"], "reply_token": bound, "event": "opt_out"}
    for changes, expected in [
        ({"email": "attacker@example.com", "identity_verified": True}, 403),
        ({"reply_token": "invalid", "identity_verified": True}, 403),
        ({"festio_user_id": "another-account", "identity_verified": True}, 409),
        ({"channel": "chat", "identity_verified": True}, 403),
    ]:
        response = client.post("/api/marketing/internal/conversations", headers=headers, json={**body, **changes})
        assert response.status_code == expected
        current = get_lead(module, lead["id"])
        assert (current.automation_paused, current.consent_email, current.unsubscribed) == original_state
    # Reuse the rejected event ID: no poisoned receipt prevents the valid stop.
    first = client.post("/api/marketing/internal/conversations", headers=headers, json=body)
    second = client.post("/api/marketing/internal/conversations", headers=headers, json=body)
    assert first.status_code == second.status_code == 200
    assert first.json()["lead_id"] == lead["id"] and second.json()["duplicate"]
    current = get_lead(module, lead["id"])
    assert current.automation_paused and current.unsubscribed and not current.consent_email
