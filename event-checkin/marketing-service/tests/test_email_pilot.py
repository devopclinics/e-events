"""Synthetic-only pilot contract tests. No provider or production credentials."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
import jwt
import threading
from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy import select, func

from test_engagement_reliability import service, identity, make_due, get_lead


def signed_ready(m, url, params, data=None, status=200, nonce=None, signing_key=None):
    moment = m.now()
    fields = {"ready": True, "pending": 0, "failed": 0, "reply_routing_ready": True,
              "reply_domain": "reply.example.test", "checked_at": moment.isoformat(), **(data or {})}
    proof = jwt.encode({**fields, "sub": "marketing-email-readiness-response",
                        "iss": "festio-backend", "aud": "marketing-email-readiness-response",
                        "jti": nonce or params["challenge"], "iat": moment,
                        "exp": moment + timedelta(seconds=5)}, signing_key or m.TOKEN_SECRET, algorithm="HS256")
    return httpx.Response(status, request=httpx.Request("GET", url), json={**fields, "proof": proof})


@pytest.fixture
def pilot(service, monkeypatch):
    m, client, headers = service
    launch = m.now() - timedelta(hours=1)
    for key, value in {
        "MARKETING_OUTBOUND_ENABLED": "false", "MARKETING_SCHEDULER_ENABLED": "false",
        "MARKETING_EMAIL_PILOT_ENABLED": "true", "MARKETING_EMAIL_TEST_ENABLED": "false",
        "MARKETING_EMAIL_PILOT_ACCOUNTS": json.dumps([f"account-{i}" for i in range(10)]),
        "MARKETING_EMAIL_TEST_ACCOUNTS": '["account-0"]',
        "MARKETING_EMAIL_PILOT_LAUNCH_AT": launch.isoformat(),
        "MARKETING_REPLY_DOMAIN": "reply.example.test",
        "MARKETING_EMAIL_READINESS_URL": "http://backend:8000/api/internal/marketing/email-readiness",
        "RESEND_API_KEY": "synthetic-provider-key",
    }.items():
        monkeypatch.setenv(key, value)
    with m.SessionLocal() as db:
        pins = {seq.payload["stage"]: {"id": seq.id, "sha256": m.email_pilot.template_fingerprint(seq)}
                for seq in db.scalars(select(m.ModuleRecord).where(m.ModuleRecord.module == "sequences"))}
    monkeypatch.setenv("MARKETING_EMAIL_PILOT_TEMPLATES", json.dumps(pins))
    ready = Mock(side_effect=lambda *a, **k: signed_ready(m, a[0], k["params"]))
    sender = Mock(side_effect=lambda *a, **k: httpx.Response(200, request=httpx.Request("POST", a[0]),
                                                            json={"id": "synthetic-provider-id"}))
    monkeypatch.setattr(m.httpx, "get", ready)
    monkeypatch.setattr(m.httpx, "post", sender)
    return m, client, headers, sender, ready, launch


def add(p, index=0, **extra):
    m, client, headers, _, _, launch = p
    registered = m.now() - timedelta(minutes=10)
    body = {"email": f"fixture-{index}@example.com", "festio_user_id": f"account-{index}",
            "email_verified": True, "organizer_account": True,
            "account_registered_at": registered.isoformat(), "registered_at": registered.isoformat(),
            "occurred_at": m.now().isoformat(), "event_id": f"signup-{index}",
            "lifecycle_event": "signup_consent", "stage": "registered", "consent_email": True, **extra}
    response = client.post("/api/marketing/internal/ingest", headers=headers, json=body)
    assert response.status_code == 200, response.text
    lead_id = response.json()["id"]
    make_due(m, lead_id)
    return lead_id


def run(p, lead_id=None, mode="pilot", dry=False):
    m = p[0]
    with m.SessionLocal() as db:
        return m.run_automation_service(db, identity(m), dry_run=dry, lead_id=lead_id, email_mode=mode)


def objects(p, lead_id):
    m = p[0]
    with m.SessionLocal() as db:
        return (db.get(m.Lead, lead_id), db.scalar(select(m.ModuleRecord).where(
            m.ModuleRecord.module == "sequences", m.ModuleRecord.payload["stage"].as_string() == "registered")))


def test_default_off_and_separate_test_gate(pilot, monkeypatch):
    m, _, _, sender, _, _ = pilot
    lead = add(pilot)
    monkeypatch.delenv("MARKETING_EMAIL_PILOT_ENABLED")
    assert run(pilot, lead)["sent"] == 0
    assert run(pilot, lead, mode="test")["sent"] == 0
    sender.assert_not_called()
    monkeypatch.setenv("MARKETING_EMAIL_TEST_ENABLED", "true")
    assert run(pilot, lead, mode="test")["sent"] == 1
    assert not m.outbound_enabled()


@pytest.mark.parametrize("case", ["before_launch", "unverified", "no_consent", "not_organizer",
                                  "missing_source_proof", "outside_cohort", "historical_lead"])
def test_explicit_new_verified_consent_boundary(pilot, case):
    m, _, _, sender, _, launch = pilot
    extra = {}
    if case == "before_launch":
        extra["account_registered_at"] = (launch - timedelta(seconds=1)).isoformat()
    elif case == "unverified":
        extra["email_verified"] = False
    elif case == "no_consent":
        extra["consent_email"] = False
    elif case == "not_organizer":
        extra["organizer_account"] = False
    elif case == "missing_source_proof":
        extra["account_registered_at"] = None
    elif case == "outside_cohort":
        extra["festio_user_id"] = "not-approved"
    if case == "unverified":
        # Unverified claims are pending prospects, never test recipient leads.
        response = pilot[1].post("/api/marketing/internal/ingest", headers=pilot[2], json={
            "email": "fixture@example.com", "festio_user_id": "account-0",
            "email_verified": False, "consent_email": True, "event_id": "unverified"})
        assert response.json()["pending_identity"]
        assert run(pilot)["sent"] == 0
    else:
        lead = add(pilot, **extra)
        if case == "historical_lead":
            with m.SessionLocal() as db:
                db.get(m.Lead, lead).created_at = launch - timedelta(days=1)
                db.commit()
        assert run(pilot, lead)["sent"] == 0
    sender.assert_not_called()


@pytest.mark.parametrize("accounts", [list(range(11)), ["account-0"] * 2, [], [" "], "account-0"])
def test_invalid_or_unbounded_cohort_is_rejected(pilot, monkeypatch, accounts):
    monkeypatch.setenv("MARKETING_EMAIL_PILOT_ACCOUNTS", json.dumps(accounts))
    with pytest.raises(pilot[0].email_pilot.EmailBlocked):
        run(pilot)
    pilot[3].assert_not_called()


def test_launch_and_consent_boundaries_are_inclusive(pilot):
    m, _, _, sender, _, launch = pilot
    lead = add(pilot, account_registered_at=launch.isoformat(), registered_at=launch.isoformat(),
               occurred_at=launch.isoformat())
    assert run(pilot, lead)["sent"] == 1
    assert sender.call_count == 1


def test_lifetime_cohort_cannot_rotate_at_same_launch(pilot, monkeypatch):
    first = add(pilot)
    assert run(pilot, first)["sent"] == 1
    second = add(pilot, 11)
    monkeypatch.setenv("MARKETING_EMAIL_PILOT_ACCOUNTS", json.dumps(["account-11"]))
    assert run(pilot, second)["sent"] == 0
    assert pilot[3].call_count == 1


def test_rolling_24h_cap_across_sequences_and_email_changes(pilot, monkeypatch):
    m = pilot[0]
    lead_id = add(pilot)
    lead, sequence = objects(pilot, lead_id)
    clock = m.now()
    assert m.send_follow_up(lead, sequence, 0, email_mode="pilot")["status"] == "sent"
    monkeypatch.setattr(m, "now", lambda: clock + timedelta(hours=23, minutes=59))
    with pytest.raises(m.email_pilot.EmailBlocked):
        m.send_follow_up(lead, sequence, 1, email_mode="pilot")
    with m.SessionLocal() as db:
        db.get(m.Lead, lead_id).email = "new-address@example.com"
        db.commit()
    lead, sequence = objects(pilot, lead_id)
    with m.SessionLocal() as db:
        assert not m.email_pilot.eligible(m, db, db.get(m.Lead, lead_id), "pilot")
        registered = m.email_pilot.utc(db.get(m.email_pilot.IdentityEvidence, "account-0").registered_at)
    # A different address must independently acquire verified proof and explicit consent.
    response = pilot[1].post("/api/marketing/internal/ingest", headers=pilot[2], json={
        "event_id": "new-mailbox-consent", "email": "new-address@example.com",
        "festio_user_id": "account-0", "email_verified": True, "organizer_account": True,
        "account_registered_at": registered.isoformat(), "occurred_at": m.now().isoformat(),
        "lifecycle_event": "signup_consent", "consent_email": True})
    assert response.status_code == 200
    lead, sequence = objects(pilot, lead_id)
    with pytest.raises(m.email_pilot.EmailBlocked):
        m.send_follow_up(lead, sequence, 1, email_mode="pilot")
    monkeypatch.setattr(m, "now", lambda: clock + timedelta(hours=24, seconds=2))
    assert m.send_follow_up(lead, sequence, 1, email_mode="pilot")["status"] == "sent"
    assert pilot[3].call_count == 2


def test_concurrent_different_steps_share_atomic_recipient_cap(pilot, monkeypatch):
    m = pilot[0]
    lead, sequence = objects(pilot, add(pilot))
    entered, release = threading.Event(), threading.Event()
    original = pilot[3].side_effect
    def provider(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        return original(*args, **kwargs)
    pilot[3].side_effect = provider
    def send(index):
        try:
            return m.send_follow_up(lead, sequence, index, email_mode="pilot")["status"]
        except m.email_pilot.EmailBlocked:
            return "blocked"
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(send, 0)
        assert entered.wait(3)
        second = pool.submit(send, 1)
        assert second.result(timeout=3) == "blocked"
        release.set()
        assert first.result(timeout=3) == "sent"
    assert pilot[3].call_count == 1


def test_unknown_outcome_blocks_even_after_24h_and_survives_restart(pilot, monkeypatch):
    m = pilot[0]
    lead_id = add(pilot)
    pilot[3].side_effect = httpx.ReadTimeout("synthetic uncertain acceptance")
    assert run(pilot, lead_id)["failed"] == 1
    assert get_lead(m, lead_id).automation_paused
    with m.SessionLocal() as db:
        row = db.get(m.Lead, lead_id)
        row.automation_paused, row.suppression_reason = False, None
        row.next_follow_up_at = m.now() - timedelta(seconds=1)
        db.commit()
    clock = m.now()
    monkeypatch.setattr(m, "now", lambda: clock + timedelta(days=2))
    assert run(pilot, lead_id)["sent"] == 0
    assert pilot[3].call_count == 1
    with m.SessionLocal() as db:
        assert db.scalar(select(m.email_pilot.EmailDispatch.status)) == "uncertain"


@pytest.mark.parametrize("broken", ["missing_reply", "missing_url", "pending", "failed", "stale", "unauthorized"])
def test_unreconciled_stop_and_reply_readiness_fail_closed(pilot, monkeypatch, broken):
    m = pilot[0]
    lead = add(pilot)
    if broken == "missing_reply":
        monkeypatch.delenv("MARKETING_REPLY_DOMAIN")
    elif broken == "missing_url":
        monkeypatch.delenv("MARKETING_EMAIL_READINESS_URL")
    else:
        data = {"ready": True, "pending": 0, "failed": 0, "reply_routing_ready": True,
                "reply_domain": "reply.example.test", "checked_at": m.now().isoformat()}
        if broken in {"pending", "failed"}:
            data[broken] = 1
        elif broken == "stale":
            data["checked_at"] = (m.now() - timedelta(minutes=1)).isoformat()
        pilot[4].side_effect = lambda *a, **k: signed_ready(
            m, a[0], k["params"], data=data, status=403 if broken == "unauthorized" else 200)
    assert run(pilot, lead)["sent"] == 0
    pilot[3].assert_not_called()


@pytest.mark.parametrize("stop", ["reply", "unsubscribe", "bounce", "conversion"])
def test_stops_and_conversion_prevent_later_steps(pilot, monkeypatch, stop):
    m, client, headers = pilot[:3]
    lead = add(pilot)
    assert run(pilot, lead)["sent"] == 1
    if stop == "reply":
        response = client.post("/api/marketing/internal/conversations", headers=headers, json={
            "event_id": "reply", "channel": "email", "event": "message_received",
            "identity_verified": True, "email": "fixture-0@example.com"})
    elif stop == "unsubscribe":
        response = client.post(f"/api/marketing/unsubscribe/{lead}")
    elif stop == "bounce":
        response = client.post("/api/marketing/internal/delivery", headers=headers, json={
            "event_id": "bounce", "email": "fixture-0@example.com", "event": "email.bounced",
            "bounce_type": "hard", "provider_id": "synthetic-provider-id"})
    else:
        response = client.post("/api/marketing/internal/ingest", headers=headers, json={
            "event_id": "paid", "email": "fixture-0@example.com", "festio_user_id": "account-0",
            "email_verified": False, "lifecycle_event": "paid"})
    assert response.status_code == 200
    clock = m.now()
    monkeypatch.setattr(m, "now", lambda: clock + timedelta(days=2))
    make_due(m, lead)
    assert run(pilot, lead)["sent"] == 0
    assert pilot[3].call_count == 1


@pytest.mark.parametrize("stop_during_send", ["reply", "conversion", "unsubscribe"])
def test_newer_state_is_not_overwritten_when_provider_returns(pilot, stop_during_send):
    m, client, headers = pilot[:3]
    lead = add(pilot)
    original = pilot[3].side_effect
    def provider(*args, **kwargs):
        if stop_during_send == "reply":
            response = client.post("/api/marketing/internal/conversations", headers=headers, json={
                "event_id": "reply-during-send", "channel": "email", "event": "message_received",
                "identity_verified": True, "email": "fixture-0@example.com"})
        elif stop_during_send == "unsubscribe":
            response = client.post(f"/api/marketing/unsubscribe/{lead}")
        else:
            response = client.post("/api/marketing/internal/ingest", headers=headers, json={
                "event_id": "paid-during-send", "email": "fixture-0@example.com",
                "festio_user_id": "account-0", "email_verified": False, "lifecycle_event": "paid"})
        assert response.status_code == 200
        return original(*args, **kwargs)
    pilot[3].side_effect = provider
    assert run(pilot, lead)["sent"] == 1
    stored = get_lead(m, lead)
    assert stored.next_follow_up_at is None
    if stop_during_send == "reply":
        assert stored.automation_paused and stored.suppression_reason == "inbound_reply"
    elif stop_during_send == "conversion":
        assert stored.stage == "paid" and stored.consent_email
    else:
        assert stored.unsubscribed and not stored.consent_email


@pytest.mark.parametrize("stopped", [False, True])
def test_linked_event_created_resets_timing_without_changing_consent_or_stop(pilot, stopped):
    m, client, headers = pilot[:3]
    lead = add(pilot)
    with m.SessionLocal() as db:
        row = db.get(m.Lead, lead)
        row.next_follow_up_at = None
        if stopped:
            row.automation_paused, row.suppression_reason = True, "inbound_reply"
        db.commit()
    before = m.now()
    result = client.post("/api/marketing/internal/ingest", headers=headers, json={
        "event_id": "linked-created", "email": "fixture-0@example.com", "festio_user_id": "account-0",
        "email_verified": False, "organizer_account": True, "lifecycle_event": "event_created"})
    assert result.status_code == 200
    stored = get_lead(m, lead)
    assert stored.stage == "event_created" and stored.consent_email
    if stopped:
        assert stored.next_follow_up_at is None and stored.suppression_reason == "inbound_reply"
    else:
        assert m.email_pilot.utc(stored.next_follow_up_at) >= before + timedelta(minutes=59)


def test_pilot_cannot_unlock_legacy_channels_campaigns_or_retention(pilot, monkeypatch):
    m, client, headers = pilot[:3]
    lead = add(pilot)
    social, retention = Mock(), Mock()
    monkeypatch.setattr(m, "run_scheduled_social", social)
    monkeypatch.setattr(m, "run_gdpr_retention", retention)
    assert run(pilot, lead, dry=True)["queued"] == 1
    assert run(pilot, lead, mode="legacy")["sent"] == 0
    assert client.post(f"/api/marketing/leads/{lead}/sms", headers=headers,
                       json={"message": "Must not send"}).status_code == 503
    assert not m.outbound_enabled()
    social.assert_not_called()
    retention.assert_not_called()
    pilot[3].assert_not_called()
    assert client.post("/api/marketing/email-pilot/run", json={}).status_code == 401


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/plain,hello", "ftp://example.test",
                                "mailto:a@example.test?bcc=other@example.test",
                                "https://user:password@example.test", "mailto:a@example.test?subject=%0aBcc:x"])
def test_unsupported_cta_rejected_before_provider_and_claim(pilot, url):
    m = pilot[0]
    lead, sequence = objects(pilot, add(pilot))
    sequence.payload = {"steps": [{"subject": "Synthetic", "body": "Synthetic", "cta_url": url}]}
    with pytest.raises(pilot[0].HTTPException) as exc:
        m.send_follow_up(lead, sequence, 0, email_mode="pilot")
    assert getattr(exc.value, "status_code", None) == 400
    pilot[3].assert_not_called()
    with m.SessionLocal() as db:
        assert db.scalar(select(func.count(m.email_pilot.EmailDispatch.id))) == 0


def test_supported_mailto_is_preserved_not_substituted(pilot):
    assert pilot[0].safe_cta_url("mailto:hello@festio.events?subject=Event") == "mailto:hello@festio.events?subject=Event"


def test_pilot_flags_do_not_unlock_campaign_or_social_execution(pilot):
    m, client, headers = pilot[:3]
    add(pilot)
    with m.SessionLocal() as db:
        record = m.ModuleRecord(module="campaigns", name="Synthetic campaign", status="active",
                                payload={"audience": "Registered without an event",
                                         "steps": [{"subject": "Must not send", "body": "Synthetic"}]},
                                created_by="synthetic")
        db.add(record)
        db.commit()
        campaign_id = record.id
    response = client.post(f"/api/marketing/campaigns/{campaign_id}/execute", headers=headers)
    assert response.status_code == 503
    # Existing social publisher must retain its independent legacy outbound guard.
    import asyncio
    with m.SessionLocal() as db:
        with pytest.raises(m.HTTPException) as exc:
            asyncio.run(m.publish_social(m.SocialPublishIn(platform="linkedin", message="Synthetic"),
                                         identity=identity(m), db=db))
    assert exc.value.status_code == 503
    pilot[3].assert_not_called()


def test_global_cap_also_blocks_legacy_campaign_after_pilot_send(pilot, monkeypatch):
    m = pilot[0]
    lead, sequence = objects(pilot, add(pilot))
    assert m.send_follow_up(lead, sequence, 0, email_mode="pilot")["status"] == "sent"
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    with m.SessionLocal() as db:
        campaign = m.ModuleRecord(module="campaigns", name="Synthetic separate campaign", status="active",
                                 payload={"steps": [{"subject": "Synthetic", "body": "Synthetic"}]},
                                 created_by="synthetic")
        db.add(campaign)
        db.commit()
    with pytest.raises(m.email_pilot.EmailBlocked):
        m.send_follow_up(lead, campaign, 0)
    assert pilot[3].call_count == 1


def test_crashed_inflight_claim_is_paused_not_automatically_retried(pilot, monkeypatch):
    m = pilot[0]
    lead_id = add(pilot)
    lead, sequence = objects(pilot, lead_id)
    claim = m.email_pilot.reserve(m, lead, sequence, 0, "pilot")
    clock = m.now()
    monkeypatch.setattr(m, "now", lambda: clock + timedelta(minutes=3))
    with pytest.raises(m.email_pilot.EmailBlocked):
        m.send_follow_up(lead, sequence, 0, email_mode="pilot")
    assert get_lead(m, lead_id).automation_paused
    with m.SessionLocal() as db:
        assert db.get(m.email_pilot.EmailDispatch, claim).status == "uncertain"
    pilot[3].assert_not_called()


def test_missing_acceptance_id_is_uncertain_not_retryable(pilot):
    m = pilot[0]
    lead_id = add(pilot)
    pilot[3].side_effect = lambda *a, **k: httpx.Response(
        200, request=httpx.Request("POST", a[0]), json={})
    assert run(pilot, lead_id)["failed"] == 1
    assert get_lead(m, lead_id).automation_paused
    with m.SessionLocal() as db:
        assert db.scalar(select(m.email_pilot.EmailDispatch.status)) == "uncertain"
    assert run(pilot, lead_id)["sent"] == 0
    assert pilot[3].call_count == 1


def test_unsubscribe_cannot_be_undone_by_reusing_old_pilot_consent_receipt(pilot):
    m, client, headers = pilot[:3]
    lead_id = add(pilot)
    assert client.post(f"/api/marketing/unsubscribe/{lead_id}").status_code == 200
    # A normal preference change is not a new immutable source registration receipt.
    response = client.put("/api/marketing/internal/preferences/fixture-0@example.com",
                          headers=headers, json={"consent_email": True})
    assert response.status_code == 200
    make_due(m, lead_id)
    assert run(pilot, lead_id)["sent"] == 0
    with m.SessionLocal() as db:
        assert db.get(m.email_pilot.IdentityEvidence, "account-0").consent_event_id is None
    pilot[3].assert_not_called()


def test_no_scheduler_starts_when_legacy_flag_is_absent(pilot, monkeypatch):
    m = pilot[0]
    monkeypatch.delenv("MARKETING_SCHEDULER_ENABLED")
    thread = Mock()
    monkeypatch.setattr(m.threading, "Thread", thread)
    m.start_scheduler()
    thread.assert_not_called()


def test_delete_cleans_identity_proof_but_keeps_send_budget_tombstone(pilot):
    m, client, headers = pilot[:3]
    lead_id = add(pilot)
    assert run(pilot, lead_id)["sent"] == 1
    assert client.delete(f"/api/marketing/leads/{lead_id}", headers=headers).status_code == 204
    with m.SessionLocal() as db:
        assert db.get(m.email_pilot.IdentityEvidence, "account-0") is None
        cap_key = m.email_pilot.key("email:", "fixture-0@example.com")
        assert m.email_pilot.utc(db.get(m.email_pilot.EmailCap, cap_key).blocked_until) > m.now()

def test_pilot_never_falls_back_to_unverified_smtp_delivery(pilot, monkeypatch):
    m = pilot[0]
    lead_id = add(pilot)
    monkeypatch.delenv("RESEND_API_KEY")
    smtp = Mock()
    monkeypatch.setattr(m.smtplib, "SMTP", smtp)
    assert run(pilot, lead_id)["sent"] == 0
    smtp.assert_not_called()
    pilot[3].assert_not_called()


@pytest.mark.parametrize("change", ["subject", "cta", "cadence", "name", "inactive"])
def test_actual_manual_endpoint_rejects_template_drift(pilot, change):
    m, client, headers = pilot[:3]
    lead_id = add(pilot)
    _, sequence = objects(pilot, lead_id)
    with m.SessionLocal() as db:
        current = db.get(m.ModuleRecord, sequence.id)
        if change == "inactive":
            current.status = "draft"
        elif change == "name":
            current.name = "Unapproved fallback title"
        else:
            payload = dict(current.payload)
            if change == "cadence":
                payload["cadence_days"] = 100
            else:
                steps = [dict(x) for x in payload["steps"]]
                steps[0]["subject" if change == "subject" else "cta_url"] = (
                    "Unapproved body" if change == "subject" else "https://unapproved.example.com")
                payload["steps"] = steps
            current.payload = payload
        db.commit()
    response = client.post("/api/marketing/email-pilot/run",
                           params={"lead_id": lead_id, "dry_run": "false"}, headers=headers)
    assert response.status_code == 409 or response.json()["sent"] == 0
    pilot[3].assert_not_called()


def test_unapproved_earlier_sequence_cannot_shadow_pinned_template(pilot):
    m, client, headers = pilot[:3]
    lead_id = add(pilot)
    with m.SessionLocal() as db:
        db.add(m.ModuleRecord(module="sequences", name="Unapproved first", status="active",
               created_at=m.now() - timedelta(days=100), created_by="synthetic",
               payload={"stage": "registered", "steps": [{"subject": "Do not send", "body": "Unapproved"}]}))
        db.commit()
    response = client.post("/api/marketing/email-pilot/run",
                           params={"lead_id": lead_id, "dry_run": "false"}, headers=headers)
    assert response.status_code == 200 and response.json()["sent"] == 1
    assert pilot[3].call_args.kwargs["json"]["subject"] == "Welcome to Festio"


def test_template_change_after_global_claim_is_cancelled_without_retry_spend(pilot):
    m = pilot[0]
    lead_id = add(pilot)
    _, sequence = objects(pilot, lead_id)
    calls = []
    def barrier(*args, **kwargs):
        calls.append(1)
        if len(calls) == 2:
            with m.SessionLocal() as db:
                current = db.get(m.ModuleRecord, sequence.id)
                current.payload = {**current.payload, "cadence_days": 500}
                db.commit()
        return signed_ready(m, args[0], kwargs["params"])
    pilot[4].side_effect = barrier
    assert run(pilot, lead_id)["sent"] == 0
    pilot[3].assert_not_called()
    with m.SessionLocal() as db:
        row = db.scalar(select(m.email_pilot.EmailDispatch))
        assert row.status == "cancelled" and row.attempts == 0


@pytest.mark.parametrize("stop", ["reply", "unsubscribe", "conversion"])
def test_explicit_rejection_cannot_restore_newer_stop_schedule(pilot, stop):
    m, client, headers = pilot[:3]
    lead_id = add(pilot)
    def provider(*args, **kwargs):
        if stop == "reply":
            r = client.post("/api/marketing/internal/conversations", headers=headers, json={
                "event_id": "reply-before-reject", "channel": "email", "event": "message_received",
                "identity_verified": True, "email": "fixture-0@example.com"})
        elif stop == "unsubscribe":
            r = client.post(f"/api/marketing/unsubscribe/{lead_id}")
        else:
            r = client.post("/api/marketing/internal/ingest", headers=headers, json={
                "event_id": "conversion-before-reject", "email": "fixture-0@example.com",
                "festio_user_id": "account-0", "lifecycle_event": "paid", "email_verified": False})
        assert r.status_code == 200
        return httpx.Response(400, request=httpx.Request("POST", args[0]))
    pilot[3].side_effect = provider
    assert run(pilot, lead_id)["failed"] == 1
    assert get_lead(m, lead_id).next_follow_up_at is None


@pytest.mark.parametrize("status", ["uncertain", "sending"])
def test_other_sequence_uncertainty_blocks_pilot_and_campaign(pilot, monkeypatch, status):
    m = pilot[0]
    lead_id = add(pilot)
    with m.SessionLocal() as db:
        db.add(m.SendAttempt(id="older-different-sequence", lead_id=lead_id, status=status, attempts=1,
                            updated_at=m.now() - timedelta(minutes=3)))
        db.commit()
    assert run(pilot, lead_id)["sent"] == 0
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    lead, sequence = objects(pilot, lead_id)
    with pytest.raises(m.email_pilot.EmailBlocked):
        m.send_follow_up(lead, sequence, 0)
    pilot[3].assert_not_called()


@pytest.mark.parametrize("fault", ["unsigned", "wrong_nonce", "wrong_key", "delayed"])
def test_readiness_requires_authenticated_fresh_challenge_bound_proof(pilot, monkeypatch, fault):
    m = pilot[0]
    lead_id = add(pilot)
    clock = m.now()
    def barrier(*args, **kwargs):
        if fault == "unsigned":
            return httpx.Response(200, request=httpx.Request("GET", args[0]), json={
                "ready": True, "pending": 0, "failed": 0, "reply_routing_ready": True,
                "reply_domain": "reply.example.test", "checked_at": m.now().isoformat()})
        response = signed_ready(m, args[0], kwargs["params"],
                                nonce="wrong-nonce" if fault == "wrong_nonce" else None,
                                signing_key="different-synthetic-key" if fault == "wrong_key" else None)
        if fault == "delayed":
            monkeypatch.setattr(m, "now", lambda: clock + timedelta(seconds=6))
        return response
    pilot[4].side_effect = barrier
    assert run(pilot, lead_id)["sent"] == 0
    pilot[3].assert_not_called()


@pytest.mark.parametrize("mode", ["pilot", "test"])
def test_actual_manual_routes_do_not_invoke_other_jobs(pilot, monkeypatch, mode):
    m, client, headers = pilot[:3]
    lead_id = add(pilot)
    monkeypatch.setenv("MARKETING_EMAIL_TEST_ENABLED", "true")
    jobs = [Mock(), Mock(), Mock()]
    monkeypatch.setattr(m, "run_scheduled_social", jobs[0])
    monkeypatch.setattr(m, "run_gdpr_retention", jobs[1])
    monkeypatch.setattr(m.threading, "Thread", jobs[2])
    response = client.post("/api/marketing/email-" + mode + "/run",
                           params={"lead_id": lead_id, "dry_run": "false"}, headers=headers)
    assert response.status_code == 200 and response.json()["sent"] == 1
    assert not m.outbound_enabled()
    for job in jobs:
        job.assert_not_called()


def test_delayed_lifecycle_grant_cannot_undo_explicit_withdrawal(pilot):
    m, client, headers = pilot[:3]
    lead_id = add(pilot)
    for event, consent in [("withdrawal", False), ("older-delayed-grant", True)]:
        r = client.post("/api/marketing/internal/ingest", headers=headers, json={
            "event_id": event, "email": "fixture-0@example.com", "festio_user_id": "account-0",
            "email_verified": True, "lifecycle_event": "signup_consent", "consent_email": consent})
        assert r.status_code == 200
    row = get_lead(m, lead_id)
    assert row.unsubscribed and not row.consent_email and row.next_follow_up_at is None
    assert run(pilot, lead_id)["sent"] == 0
    pilot[3].assert_not_called()


def test_pins_are_required_even_for_dry_run(pilot, monkeypatch):
    lead_id = add(pilot)
    monkeypatch.delenv("MARKETING_EMAIL_PILOT_TEMPLATES")
    response = pilot[1].post("/api/marketing/email-pilot/run",
                            params={"lead_id": lead_id}, headers=pilot[2])
    assert response.status_code == 409
    pilot[3].assert_not_called()


def test_reverified_mailbox_change_after_claim_still_blocks_old_recipient(pilot):
    m, client, headers = pilot[:3]
    lead_id = add(pilot)
    with m.SessionLocal() as db:
        original_registration = m.email_pilot.utc(
            db.get(m.email_pilot.IdentityEvidence, "account-0").registered_at).isoformat()
    calls = []
    def barrier(*args, **kwargs):
        calls.append(1)
        if len(calls) == 2:
            with m.SessionLocal() as db:
                db.get(m.Lead, lead_id).email = "changed@example.com"
                db.commit()
            r = client.post("/api/marketing/internal/ingest", headers=headers, json={
                "event_id": "independently-verified-new-mailbox", "email": "changed@example.com",
                "festio_user_id": "account-0", "email_verified": True, "organizer_account": True,
                "account_registered_at": original_registration, "occurred_at": m.now().isoformat(),
                "lifecycle_event": "signup_consent", "consent_email": True})
            assert r.status_code == 200
        return signed_ready(m, args[0], kwargs["params"])
    pilot[4].side_effect = barrier
    assert run(pilot, lead_id)["sent"] == 0
    pilot[3].assert_not_called()


def test_fresh_source_owner_revocation_removes_pilot_eligibility(pilot):
    m, client, headers = pilot[:3]
    lead_id = add(pilot)
    with m.SessionLocal() as db:
        registration = m.email_pilot.utc(
            db.get(m.email_pilot.IdentityEvidence, "account-0").registered_at).isoformat()
    r = client.post("/api/marketing/internal/ingest", headers=headers, json={
        "event_id": "owner-revoked", "email": "fixture-0@example.com", "festio_user_id": "account-0",
        "email_verified": True, "organizer_account": False, "account_registered_at": registration,
        "occurred_at": m.now().isoformat(), "lifecycle_event": "lead_updated"})
    assert r.status_code == 200
    assert run(pilot, lead_id)["sent"] == 0
    pilot[3].assert_not_called()


def test_launched_template_pins_cannot_rotate_silently(pilot, monkeypatch):
    m = pilot[0]
    lead_id = add(pilot)
    assert run(pilot, lead_id)["sent"] == 1
    _, sequence = objects(pilot, lead_id)
    with m.SessionLocal() as db:
        current = db.get(m.ModuleRecord, sequence.id)
        current.name = "Changed owner-approved-later title"
        db.commit()
        changed_pin = m.email_pilot.template_fingerprint(current)
    pins = m.email_pilot.template_pins()
    pins["registered"]["sha256"] = changed_pin
    monkeypatch.setenv("MARKETING_EMAIL_PILOT_TEMPLATES", json.dumps(pins))
    clock = m.now()
    monkeypatch.setattr(m, "now", lambda: clock + timedelta(hours=25))
    make_due(m, lead_id)
    assert run(pilot, lead_id)["sent"] == 0
    assert pilot[3].call_count == 1


def test_actual_manual_endpoint_never_expands_beyond_ten_accounts(pilot):
    m, client, headers = pilot[:3]
    for i in range(11):
        add(pilot, i)
    response = client.post("/api/marketing/email-pilot/run", params={"dry_run": "false"}, headers=headers)
    assert response.status_code == 200
    assert response.json()["eligible"] == response.json()["sent"] == 10
    recipients = {call.kwargs["json"]["to"][0] for call in pilot[3].call_args_list}
    assert recipients == {f"fixture-{i}@example.com" for i in range(10)}


@pytest.mark.parametrize("status", [302, 500])
def test_ambiguous_provider_status_is_uncertain_in_every_ledger(pilot, status):
    m = pilot[0]
    lead_id = add(pilot)
    pilot[3].side_effect = lambda *a, **k: httpx.Response(status, request=httpx.Request("POST", a[0]))
    assert run(pilot, lead_id)["failed"] == 1
    with m.SessionLocal() as db:
        assert db.scalar(select(m.email_pilot.EmailDispatch.status)) == "uncertain"
        activity = db.scalar(select(m.Activity).where(m.Activity.kind == "email_failed"))
        assert activity.data["outcome_uncertain"] is True
    assert get_lead(m, lead_id).automation_paused
    assert pilot[3].call_count == 1

@pytest.mark.parametrize("invalid_url", ["javascript:invalid", "https://[example.com"])
def test_pinned_invalid_cta_is_known_unsent_not_uncertain(pilot, monkeypatch, invalid_url):
    m, client, headers = pilot[:3]
    lead_id = add(pilot)
    _, sequence = objects(pilot, lead_id)
    with m.SessionLocal() as db:
        current = db.get(m.ModuleRecord, sequence.id)
        payload = dict(current.payload)
        steps = [dict(step) for step in payload["steps"]]
        steps[0]["cta_url"] = invalid_url
        current.payload = {**payload, "steps": steps}
        db.commit()
        digest = m.email_pilot.template_fingerprint(current)
    pins = m.email_pilot.template_pins()
    pins["registered"]["sha256"] = digest
    monkeypatch.setenv("MARKETING_EMAIL_PILOT_TEMPLATES", json.dumps(pins))
    response = client.post("/api/marketing/email-pilot/run",
                           params={"lead_id": lead_id, "dry_run": "false"}, headers=headers)
    assert response.status_code == 400
    stored = get_lead(m, lead_id)
    assert not stored.automation_paused and stored.suppression_reason is None
    with m.SessionLocal() as db:
        assert db.scalar(select(func.count(m.SendAttempt.id))) == 0
        assert db.scalar(select(func.count(m.email_pilot.EmailDispatch.id))) == 0
    pilot[3].assert_not_called()

@pytest.mark.parametrize("verified", [False, True])
def test_delayed_ownership_grant_cannot_reverse_newer_revocation(pilot, monkeypatch, verified):
    m, client, headers = pilot[:3]
    clock = m.now()
    monkeypatch.setattr(m, "now", lambda: clock)
    lead_id = add(pilot)
    with m.SessionLocal() as db:
        registered = m.email_pilot.utc(db.get(m.email_pilot.IdentityEvidence, "account-0").registered_at).isoformat()
    monkeypatch.setattr(m, "now", lambda: clock + timedelta(seconds=30))
    common = {"email": "fixture-0@example.com", "festio_user_id": "account-0",
              "account_registered_at": registered, "lifecycle_event": "event_updated"}
    for event, owner, offset in [("newer-revocation", False, 20), ("older-grant", True, 10)]:
        response = client.post("/api/marketing/internal/ingest", headers=headers, json={
            **common, "event_id": event, "organizer_account": owner, "email_verified": verified,
            "occurred_at": (clock + timedelta(seconds=offset)).isoformat()})
        assert response.status_code == 200
    with m.SessionLocal() as db:
        proof = db.get(m.email_pilot.IdentityEvidence, "account-0")
        assert not proof.organizer
        assert m.email_pilot.utc(proof.ownership_at) == clock + timedelta(seconds=20)
    assert run(pilot, lead_id)["sent"] == 0
    pilot[3].assert_not_called()


def test_ownership_revocation_before_first_verification_is_retained(pilot, monkeypatch):
    m, client, headers = pilot[:3]
    clock = m.now()
    registered = (clock - timedelta(minutes=10)).isoformat()
    monkeypatch.setattr(m, "now", lambda: clock + timedelta(seconds=30))
    with m.SessionLocal() as db:
        linked = m.Lead(email="fixture-0@example.com", festio_user_id="account-0",
                        consent_email=True, registered_at=clock - timedelta(minutes=10),
                        created_at=clock, stage="registered")
        db.add(linked)
        db.commit()
        lead_id = linked.id
    revoked = client.post("/api/marketing/internal/ingest", headers=headers, json={
        "event_id": "revocation-before-proof", "email": "fixture-0@example.com",
        "festio_user_id": "account-0", "email_verified": False, "organizer_account": False,
        "lifecycle_event": "event_updated",
        "occurred_at": (clock + timedelta(seconds=20)).isoformat()})
    assert revoked.status_code == 200 and revoked.json()["id"] == lead_id
    with m.SessionLocal() as db:
        proof = db.get(m.email_pilot.IdentityEvidence, "account-0")
        assert proof.verified_at is None and not proof.organizer
        assert not m.email_pilot.eligible(m, db, db.get(m.Lead, lead_id), "pilot")
    result = client.post("/api/marketing/internal/ingest", headers=headers, json={
        "event_id": "late-first-verification", "email": "fixture-0@example.com",
        "festio_user_id": "account-0", "email_verified": True, "organizer_account": True,
        "account_registered_at": registered, "consent_email": True,
        "occurred_at": (clock + timedelta(seconds=10)).isoformat(),
        "lifecycle_event": "signup_consent"})
    assert result.status_code == 200
    with m.SessionLocal() as db:
        proof = db.get(m.email_pilot.IdentityEvidence, "account-0")
        assert proof.verified_at is not None and not proof.organizer
    assert run(pilot, lead_id)["sent"] == 0
    pilot[3].assert_not_called()


@pytest.mark.parametrize("order", [(True, False), (False, True)])
def test_equal_timestamp_ownership_conflict_revocation_wins(pilot, monkeypatch, order):
    m, client, headers = pilot[:3]
    clock = m.now()
    monkeypatch.setattr(m, "now", lambda: clock)
    lead_id = add(pilot)
    monkeypatch.setattr(m, "now", lambda: clock + timedelta(seconds=30))
    for index, owner in enumerate(order):
        response = client.post("/api/marketing/internal/ingest", headers=headers, json={
            "event_id": f"equal-owner-{index}", "email": "fixture-0@example.com",
            "festio_user_id": "account-0", "email_verified": False,
            "organizer_account": owner, "lifecycle_event": "event_updated",
            "occurred_at": (clock + timedelta(seconds=10)).isoformat()})
        assert response.status_code == 200
    with m.SessionLocal() as db:
        assert not db.get(m.email_pilot.IdentityEvidence, "account-0").organizer
    assert run(pilot, lead_id)["sent"] == 0
    pilot[3].assert_not_called()


@pytest.mark.parametrize("secret", ["", " ", chr(9)])
def test_blank_internal_key_blocks_before_readiness_or_send_claim(pilot, monkeypatch, secret):
    m = pilot[0]
    lead, sequence = objects(pilot, add(pilot))
    monkeypatch.setattr(m, "TOKEN_SECRET", secret)
    with pytest.raises(m.email_pilot.EmailBlocked):
        m.send_follow_up(lead, sequence, email_mode="pilot")
    pilot[3].assert_not_called()
    pilot[4].assert_not_called()
    with m.SessionLocal() as db:
        assert db.scalar(select(func.count(m.SendAttempt.id))) == 0
        assert db.scalar(select(func.count(m.email_pilot.EmailDispatch.id))) == 0


def test_malformed_readiness_url_is_known_blocked_before_claim(pilot, monkeypatch):
    m = pilot[0]
    lead, sequence = objects(pilot, add(pilot))
    monkeypatch.setenv("MARKETING_EMAIL_READINESS_URL", "https://[example.com")
    with pytest.raises(m.email_pilot.EmailBlocked):
        m.send_follow_up(lead, sequence, email_mode="pilot")
    pilot[3].assert_not_called()
    pilot[4].assert_not_called()


def test_multi_recipient_campaign_releases_sqlite_writer_between_durable_claims(pilot, monkeypatch):
    m = pilot[0]
    lead_ids = [add(pilot, index=i) for i in range(2)]
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "true")
    with m.SessionLocal() as db:
        segment = m.ModuleRecord(module="segments", name="Synthetic saved segment",
                                 status="active", created_by="test", payload={})
        db.add(segment)
        db.flush()
        campaign = m.ModuleRecord(module="campaigns", name="Synthetic two-recipient campaign",
            status="active", created_by="test",
            payload={"segment_id": segment.id,
                     "steps": [{"subject": "Synthetic", "body": "Synthetic", "cta_url": "https://example.test"}]})
        db.add(campaign)
        db.commit()
        campaign_id = campaign.id
    with m.SessionLocal() as db:
        result = m.execute_campaign(campaign_id, dry_run=False, identity=identity(m), db=db)
    assert result == {"eligible": 2, "sent": 2, "failed": 0}
    assert pilot[3].call_count == 2
    with m.SessionLocal() as db:
        assert db.scalar(select(func.count(m.email_pilot.EmailDispatch.id))) == 2
        assert db.scalar(select(func.count(m.Activity.id)).where(m.Activity.kind == "email_sent")) == 2
        repeated = m.execute_campaign(campaign_id, dry_run=False, identity=identity(m), db=db)
    assert repeated["sent"] == 0 and pilot[3].call_count == 2
    for lead_id in lead_ids:
        assert run(pilot, lead_id)["sent"] == 0
    assert pilot[3].call_count == 2
