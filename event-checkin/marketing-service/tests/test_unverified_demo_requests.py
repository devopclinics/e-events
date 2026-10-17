"""Anonymous demo claims must never mutate a trusted Marketing lead."""
import importlib

import pytest
from sqlalchemy import func, select

from test_marketing_e2e import load_app


def _demo_payload(**changes):
    return {
        "event_id": "anonymous-demo:1", "email": "organizer@example.com",
        "name": "Unverified submitter", "phone": "+15555550999",
        "organization": "Unverified organization", "guest_count": 999,
        "stage": "demo_requested", "lifecycle_event": "demo_requested", "source": "website_demo",
        "demo_request_id": "request-1", "preferred_time": "2026-11-02T16:00:00+00:00",
        "timezone": "America/Chicago", "event_name": "Unverified event", "message": "Please arrange a demo",
        "consent_email": True, "consent_sms": False, "consent_whatsapp": True,
        **changes,
    }


@pytest.mark.parametrize("endpoint", ["ingest", "demo-requests"])
@pytest.mark.parametrize("unsubscribed", [False, True])
def test_anonymous_demo_cannot_mutate_existing_lead(tmp_path, endpoint, unsubscribed):
    client, headers = load_app(tmp_path)
    module = importlib.import_module("app.main")
    with module.SessionLocal() as db:
        lead = module.Lead(
            email="organizer@example.com", festio_user_id="trusted-account", name="Real organizer",
            phone="+15555550101", organization="Trusted organization", guest_count=40,
            consent_email=False, consent_sms=True, consent_whatsapp=False, unsubscribed=unsubscribed,
            automation_paused=unsubscribed, suppression_reason="email_hard_bounce", stage="registered",
            owner_email="owner@example.com", source="verified_registration",
        )
        db.add(lead)
        db.commit()
        lead_id = lead.id
    with module.SessionLocal() as db:
        before = module.lead_out(db.get(module.Lead, lead_id))
    # Even spurious identity assertions cannot turn a public demo into a
    # verified association, including for legacy already-queued payloads.
    payload = _demo_payload(identity_verified=True, festio_user_id="trusted-account")
    response = client.post(f"/api/marketing/internal/{endpoint}", headers=headers, json=payload)
    assert response.status_code == 200
    result = response.json()
    assert result["recorded"] is True and result["unmatched"] is True and result["lead_id"] is None
    assert result["duplicate"] is False
    with module.SessionLocal() as db:
        after = module.lead_out(db.get(module.Lead, lead_id))
        changed = [key for key in before if before[key] != after[key]]
        assert changed == [], f"Anonymous demo changed trusted lead fields: {changed}"
        assert db.scalar(select(func.count(module.Lead.id))) == 1
        assert db.scalar(select(func.count(module.Activity.id))) == 0
        prospect = db.get(module.PendingProspect, result["prospect_id"])
        assert prospect.identity_verified is False and prospect.lead_id is None
        assert prospect.festio_user_id is None
        receipt = db.get(module.IngestReceipt, payload["event_id"])
        assert receipt.kind == "demo_request" and receipt.lead_id is None
        assert receipt.prospect_id == prospect.id
        tasks = db.scalars(select(module.ModuleRecord).where(
            module.ModuleRecord.payload["prospect_id"].as_string() == prospect.id,
        )).all()
        assert len(tasks) == 1 and tasks[0].owner_email == prospect.owner_email
        task = tasks[0].payload
        assert task["identity_status"] == "unverified" and "lead_id" not in task
        assert task["booking_confirmed"] is False
        assert task["preferred_time"] == "2026-11-02T16:00:00Z"
        assert task["message"] == payload["message"]
        assert task["consent_claims"] == {"consent_email": True, "consent_sms": False, "consent_whatsapp": True}


@pytest.mark.parametrize("endpoint", ["ingest", "demo-requests"])
def test_new_demo_is_durable_idempotent_and_never_auto_associates(tmp_path, endpoint):
    client, headers = load_app(tmp_path)
    module = importlib.import_module("app.main")
    payload = _demo_payload()
    path = f"/api/marketing/internal/{endpoint}"
    first = client.post(path, headers=headers, json=payload)
    assert first.status_code == 200
    result = first.json()
    assert result["recorded"] and result["lead_id"] is None
    replay = client.post(path, headers=headers, json=payload).json()
    assert replay["duplicate"] and replay["prospect_id"] == result["prospect_id"]
    assert client.post(path, headers=headers, json={**payload, "name": "Changed claim"}).status_code == 409
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.Lead.id))) == 0
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 1
        assert db.scalar(select(func.count(module.IngestReceipt.event_id))) == 1
        assert db.scalar(select(func.count(module.ModuleRecord.id)).where(
            module.ModuleRecord.payload["prospect_id"].as_string() == result["prospect_id"],
        )) == 1
    # Later registration matching BOTH the claimed email and phone still must
    # not import the old anonymous consent claims or pause the trusted lead.
    registered = client.post("/api/marketing/internal/ingest", headers=headers, json={
        "event_id": "registered:1", "email": payload["email"], "phone": payload["phone"],
        "festio_user_id": "new-verified-account", "lifecycle_event": "registered", "email_verified": True,
    }).json()
    assert registered["stage"] == "registered" and not registered["automation_paused"]
    assert registered["suppression_reason"] is None and registered["next_follow_up_at"] is None
    assert not any(registered[field] for field in ("consent_email", "consent_sms", "consent_whatsapp"))
    with module.SessionLocal() as db:
        prospect = db.get(module.PendingProspect, result["prospect_id"])
        assert prospect.lead_id is None and prospect.identity_verified is False
        assert db.get(module.IngestReceipt, payload["event_id"]).lead_id is None
    assert client.post(path, headers=headers, json=payload).json()["lead_id"] is None


def test_unverified_demo_requires_authority_and_records_no_unsupplied_consent(tmp_path):
    client, headers = load_app(tmp_path)
    module = importlib.import_module("app.main")
    payload = {key: value for key, value in _demo_payload().items() if not key.startswith("consent_")}
    assert client.post("/api/marketing/internal/demo-requests", json=payload).status_code == 401
    invalid = client.post("/api/marketing/internal/demo-requests", headers=headers,
                          json={**payload, "consent_email": "true"})
    assert invalid.status_code == 400
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.IngestReceipt.event_id))) == 0
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 0
    result = client.post("/api/marketing/internal/demo-requests", headers=headers, json=payload).json()
    with module.SessionLocal() as db:
        task = db.scalar(select(module.ModuleRecord).where(
            module.ModuleRecord.payload["prospect_id"].as_string() == result["prospect_id"],
        ))
        assert task.payload["consent_claims"] == {}


def test_legacy_demo_stage_fallback_uses_pending_capture(tmp_path):
    client, headers = load_app(tmp_path)
    module = importlib.import_module("app.main")
    payload = _demo_payload()
    del payload["lifecycle_event"]
    result = client.post("/api/marketing/internal/ingest", headers=headers, json=payload).json()
    assert result["recorded"] and result["lead_id"] is None
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.Lead.id))) == 0
        assert db.get(module.PendingProspect, result["prospect_id"]).identity_verified is False


def test_demo_receipt_and_review_roll_back_together(tmp_path, monkeypatch):
    client, headers = load_app(tmp_path)
    module = importlib.import_module("app.main")
    original_audit = module.audit
    def fail(*args, **kwargs):
        raise RuntimeError("simulated capture failure")
    monkeypatch.setattr(module, "audit", fail)
    with pytest.raises(RuntimeError, match="capture failure"):
        client.post("/api/marketing/internal/demo-requests", headers=headers, json=_demo_payload())
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.IngestReceipt.event_id))) == 0
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 0
        assert db.scalar(select(func.count(module.ModuleRecord.id)).where(
            module.ModuleRecord.created_by == "demo_request_ingest",
        )) == 0
    monkeypatch.setattr(module, "audit", original_audit)
    assert client.post("/api/marketing/internal/demo-requests", headers=headers, json=_demo_payload()).json()["recorded"]


@pytest.mark.parametrize("removed", [False, True])
def test_old_accepted_demo_receipt_is_acknowledged_without_reapplying(tmp_path, removed):
    client, headers = load_app(tmp_path)
    module = importlib.import_module("app.main")
    payload = _demo_payload()
    with module.SessionLocal() as db:
        lead = module.Lead(email=payload["email"], name="Original lead", consent_email=False)
        db.add(lead)
        db.flush()
        lead_id = lead.id
        receipt, _ = module.receipt_for(db, payload["event_id"], "lifecycle", payload)
        receipt.lead_id = lead_id
        if removed:
            db.delete(lead)
        db.commit()
    with module.SessionLocal() as db:
        before = module.lead_out(db.get(module.Lead, lead_id)) if not removed else None
    response = client.post("/api/marketing/internal/ingest", headers=headers, json=payload)
    assert response.status_code == 200
    assert response.json() == {"recorded": True, "legacy_demo_receipt": True,
                               "ingest_duplicate": True, "id": lead_id}
    assert client.post("/api/marketing/internal/ingest", headers=headers,
                       json={**payload, "name": "Changed payload"}).status_code == 409
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 0
        assert db.scalar(select(func.count(module.Activity.id))) == 0
        after = module.lead_out(db.get(module.Lead, lead_id)) if not removed else None
        assert after == before
        assert db.scalar(select(func.count(module.Lead.id))) == (0 if removed else 1)


def test_old_demo_receipt_without_lead_id_does_not_fabricate_acknowledgement(tmp_path):
    client, headers = load_app(tmp_path)
    module = importlib.import_module("app.main")
    payload = _demo_payload()
    with module.SessionLocal() as db:
        module.receipt_for(db, payload["event_id"], "lifecycle", payload)
        db.commit()
    result = client.post("/api/marketing/internal/ingest", headers=headers, json=payload).json()
    # The outbox requires a nonempty retained ID for historical acceptance,
    # so a damaged/incomplete receipt remains retry/review-visible.
    assert result["legacy_demo_receipt"] is True and result["id"] is None
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.Lead.id))) == 0
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 0
