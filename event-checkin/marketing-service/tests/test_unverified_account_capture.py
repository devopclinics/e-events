"""Lifecycle producer authority is not proof of email ownership."""
import importlib
from datetime import timedelta

import pytest
from sqlalchemy import func, select, update

from test_marketing_e2e import load_app


@pytest.fixture
def service(tmp_path):
    client, headers = load_app(tmp_path)
    return importlib.import_module("app.main"), client, headers


def payload(**changes):
    return {
        "event_id": "unverified:registration:1", "lifecycle_event": "registered",
        "stage": "registered", "email": "owner@example.com", "festio_user_id": "claiming-uid",
        "name": "Claimed name", "phone": "+15555550999", "organization": "Claimed organization",
        "source": "claimed_source", "campaign": "claimed_campaign", "consent_email": True,
        "consent_sms": False, "consent_whatsapp": True, **changes,
    }


def post(client, headers, body):
    return client.post("/api/marketing/internal/ingest", headers=headers, json=body)


def seed_lead(module, **changes):
    with module.SessionLocal() as db:
        lead = module.Lead(
            email="owner@example.com", festio_user_id="real-uid", name="Real owner",
            phone="+15555550101", organization="Real organization", source="verified_registration",
            consent_email=False, consent_sms=True, consent_whatsapp=False,
            **changes,
        )
        db.add(lead)
        db.commit()
        return lead.id


def snapshot(module, lead_id):
    with module.SessionLocal() as db:
        return module.lead_out(db.get(module.Lead, lead_id))


@pytest.mark.parametrize("verification", [None, False, "true", 1, {}, []])
@pytest.mark.parametrize("lifecycle", ["registered", "signup_consent", "paid"])
def test_missing_or_untrusted_email_proof_never_matches_existing_email(service, verification, lifecycle):
    module, client, headers = service
    lead_id = seed_lead(module, unsubscribed=True, automation_paused=True, suppression_reason="email_hard_bounce")
    before = snapshot(module, lead_id)
    body = payload(lifecycle_event=lifecycle, stage=lifecycle)
    if verification is not None:
        body["email_verified"] = verification
    # A generic trust flag, valid internal JWT or matching claimed email cannot
    # substitute for the backend adapter's explicit verified-email assertion.
    body["identity_verified"] = True
    response = post(client, headers, body)
    assert response.status_code == 200
    ack = response.json()
    assert ack == {"recorded": True, "pending_identity": True, "duplicate": False,
                   "ingest_duplicate": False, "event_id": body["event_id"],
                   "lead_id": None, "unmatched": True, "prospect_id": ack["prospect_id"]}
    assert snapshot(module, lead_id) == before
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.Lead.id))) == 1
        assert db.scalar(select(func.count(module.Activity.id))) == 0
        prospect = db.get(module.PendingProspect, ack["prospect_id"])
        assert prospect.identity_verified is False and prospect.lead_id is None
        assert prospect.email == body["email"] and prospect.festio_user_id == body["festio_user_id"]
        receipt = db.get(module.IngestReceipt, body["event_id"])
        assert receipt.kind == "lifecycle" and receipt.lead_id is None and receipt.prospect_id == prospect.id
        tasks = db.scalars(select(module.ModuleRecord).where(module.ModuleRecord.created_by == "lifecycle_ingest")).all()
        assert len(tasks) == 1
        assert tasks[0].payload["consent_claims"] == {"consent_email": True, "consent_sms": False, "consent_whatsapp": True}
        assert tasks[0].payload["identity_status"] == "unverified"
        assert tasks[0].payload["automation_paused"] is True and "lead_id" not in tasks[0].payload
        assert tasks[0].payload["name"] == body["name"]


@pytest.mark.parametrize("verification", [None, False])
def test_pending_registration_is_deduplicated_and_never_promoted_or_replayed(service, verification):
    module, client, headers = service
    body = payload()
    if verification is not None:
        body["email_verified"] = verification
    first = post(client, headers, body).json()
    replay = post(client, headers, body).json()
    assert replay == {**first, "duplicate": True, "ingest_duplicate": True}
    assert post(client, headers, {**body, "name": "Changed claim"}).status_code == 409
    assert post(client, headers, {**body, "email_verified": True}).status_code == 409
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.Lead.id))) == 0
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 1
        assert db.scalar(select(func.count(module.ModuleRecord.id)).where(module.ModuleRecord.created_by == "lifecycle_ingest")) == 1
    verified = post(client, headers, {
        "event_id": "verified-v2:registration:1", "lifecycle_event": "registered",
        "email": body["email"], "phone": body["phone"], "festio_user_id": body["festio_user_id"],
        "email_verified": True, "name": "Verified owner",
    }).json()
    assert verified["name"] == "Verified owner" and verified["festio_user_id"] == body["festio_user_id"]
    assert not any(verified[field] for field in ("consent_email", "consent_sms", "consent_whatsapp"))
    assert verified["next_follow_up_at"] is None and not verified["automation_paused"]
    assert post(client, headers, body).json() == replay
    with module.SessionLocal() as db:
        prospect = db.get(module.PendingProspect, first["prospect_id"])
        assert prospect.lead_id is None and prospect.identity_verified is False
        assert db.get(module.IngestReceipt, body["event_id"]).lead_id is None
        assert db.scalar(select(func.count(module.Activity.id)).where(module.Activity.kind == "consent_recorded")) == 0
    fresh_consent = post(client, headers, {
        "event_id": "verified-v2:consent:1", "lifecycle_event": "signup_consent", "email": body["email"],
        "festio_user_id": body["festio_user_id"], "email_verified": True, "consent_email": True,
    }).json()
    assert fresh_consent["consent_email"] is True
    assert fresh_consent["consent_sms"] is False and fresh_consent["consent_whatsapp"] is False


@pytest.mark.parametrize("event_id", [None, "", " \t", 1, True, [], {}, "x" * 129])
def test_unverified_capture_requires_durable_valid_event_id(service, event_id):
    module, client, headers = service
    body = payload(event_id=event_id)
    assert post(client, headers, body).status_code == 400
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.IngestReceipt.event_id))) == 0
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 0
        assert db.scalar(select(func.count(module.ModuleRecord.id)).where(module.ModuleRecord.created_by == "lifecycle_ingest")) == 0


@pytest.mark.parametrize("lifecycle, expected_stage", [
    ("event_created", "event_created"), ("event_updated", "event_created"),
    ("activated", "activated"), ("paid", "paid"), ("customer", "customer"),
])
def test_known_uid_background_milestones_ignore_email_profile_and_attribution_claims(service, lifecycle, expected_stage):
    module, client, headers = service
    lead_id = seed_lead(module, next_follow_up_at=module.now() + timedelta(days=1))
    with module.SessionLocal() as db:
        other = module.Lead(email="other@example.com", name="Other owner", consent_email=True)
        db.add(other)
        db.commit()
        other_id = other.id
    before, other_before = snapshot(module, lead_id), snapshot(module, other_id)
    body = {key: value for key, value in payload(
        festio_user_id="real-uid", email="other@example.com", lifecycle_event=lifecycle,
        stage="customer", email_verified=False,
    ).items() if not key.startswith("consent_")}
    response = post(client, headers, body)
    assert response.status_code == 200
    result = response.json()
    assert result["id"] == lead_id and result["stage"] == expected_stage
    after = snapshot(module, lead_id)
    changed = {key for key in before if before[key] != after[key]}
    assert changed <= {"stage", "stage_changed_at", "score", "last_active_at", "updated_at"}
    assert snapshot(module, other_id) == other_before
    assert post(client, headers, body).json()["ingest_duplicate"] is True
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 0
        assert db.scalar(select(func.count(module.Activity.id))) == 1


@pytest.mark.parametrize("lifecycle", ["registered", "signup_consent", "demo_requested", "lead_updated", "paid"])
def test_known_uid_still_cannot_apply_unverified_registration_or_consent(service, lifecycle):
    module, client, headers = service
    lead_id = seed_lead(module)
    before = snapshot(module, lead_id)
    result = post(client, headers, payload(festio_user_id="real-uid", lifecycle_event=lifecycle)).json()
    assert result["pending_identity"] is True
    assert snapshot(module, lead_id) == before


@pytest.mark.parametrize("removed", [False, True])
def test_exact_pre_fix_receipt_replay_is_ack_only_even_after_deletion(service, removed):
    module, client, headers = service
    body = payload()
    lead_id = seed_lead(module)
    with module.SessionLocal() as db:
        receipt, _ = module.receipt_for(db, body["event_id"], "lifecycle", body)
        receipt.lead_id = lead_id
        if removed:
            db.delete(db.get(module.Lead, lead_id))
        db.commit()
    before = None if removed else snapshot(module, lead_id)
    response = post(client, headers, body)
    assert response.status_code == 200
    assert response.json()["id"] == lead_id and response.json()["ingest_duplicate"] is True
    if removed:
        assert response.json()["removed"] is True
    else:
        assert snapshot(module, lead_id) == before
    assert post(client, headers, {**body, "email_verified": True}).status_code == 409
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.Lead.id))) == (0 if removed else 1)
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 0
        assert db.scalar(select(func.count(module.Activity.id))) == 0


def test_pending_capture_is_atomic(service, monkeypatch):
    module, client, headers = service
    original = module.audit
    def fail(*args, **kwargs):
        raise RuntimeError("simulated transaction failure")
    monkeypatch.setattr(module, "audit", fail)
    with pytest.raises(RuntimeError, match="transaction failure"):
        post(client, headers, payload())
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.IngestReceipt.event_id))) == 0
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 0
        assert db.scalar(select(func.count(module.ModuleRecord.id)).where(module.ModuleRecord.created_by == "lifecycle_ingest")) == 0
    monkeypatch.setattr(module, "audit", original)
    assert post(client, headers, payload()).json()["recorded"] is True


def test_verified_account_cannot_replace_existing_uid(service):
    module, client, headers = service
    lead_id = seed_lead(module)
    before = snapshot(module, lead_id)
    assert post(client, headers, payload(email_verified=True)).status_code == 409
    assert snapshot(module, lead_id) == before
    with module.SessionLocal() as db:
        assert db.get(module.IngestReceipt, payload()["event_id"]) is None


@pytest.mark.parametrize("winner", ["claiming-uid", "other-uid"])
@pytest.mark.parametrize("winner_email", ["owner@example.com", "changed@example.com"])
def test_verified_link_compare_and_set_reconciles_winner_before_profile_mutation(service, monkeypatch, winner, winner_email):
    module, client, headers = service
    with module.SessionLocal() as db:
        lead = module.Lead(email="owner@example.com", name="Original owner")
        db.add(lead)
        db.commit()
        lead_id = lead.id
    original = module.resolve_ingest_lead
    def resolve_with_competing_link(db, **kwargs):
        row = original(db, **kwargs)
        # Model a competing transaction winning after the ORM read. Updating
        # through SQL without session sync intentionally leaves row stale.
        db.execute(update(module.Lead).where(module.Lead.id == row.id).values(
            festio_user_id=winner, email=winner_email,
        ).execution_options(synchronize_session=False))
        db.commit()
        return row
    monkeypatch.setattr(module, "resolve_ingest_lead", resolve_with_competing_link)
    response = post(client, headers, payload(email_verified=True))
    accepted = winner == "claiming-uid" and winner_email == "owner@example.com"
    assert response.status_code == (200 if accepted else 409)
    after = snapshot(module, lead_id)
    assert after["festio_user_id"] == winner
    assert after["email"] == winner_email
    if not accepted:
        assert after["name"] == "Original owner" and not after["consent_email"]


def token_headers(module, **claims):
    import jwt
    token = jwt.encode({
        "sub": "human-uid", "email": "staff@example.com", "name": "Human name",
        "iss": "guesthub", "aud": "marketing", "iat": module.now(),
        "exp": module.now() + timedelta(minutes=10), **claims,
    }, "test-secret", algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("verification", [None, False, 0, 1, "true", {}, []])
@pytest.mark.parametrize("superadmin", [False, True])
def test_human_marketing_session_needs_literal_verified_claim_before_access_or_grant_mutation(service, verification, superadmin):
    module, client, _ = service
    with module.SessionLocal() as db:
        grant = module.AccessGrant(email="staff@example.com", name="Unbound grant", granted_by="admin@example.com")
        db.add(grant)
        db.commit()
        grant_id = grant.id
    claims = {"is_platform_superadmin": superadmin}
    if verification is not None:
        claims["email_verified"] = verification
    response = client.get("/api/marketing/me", headers=token_headers(module, **claims))
    assert response.status_code == 403
    with module.SessionLocal() as db:
        grant = db.get(module.AccessGrant, grant_id)
        assert grant.subject is None and grant.name == "Unbound grant"


@pytest.mark.parametrize("superadmin", [False, True])
def test_verified_human_marketing_session_preserves_normal_access(service, superadmin):
    module, client, _ = service
    with module.SessionLocal() as db:
        db.add(module.AccessGrant(email="staff@example.com", granted_by="admin@example.com"))
        db.commit()
    response = client.get("/api/marketing/me", headers=token_headers(module, email_verified=True, is_platform_superadmin=superadmin))
    assert response.status_code == 200
    assert response.json()["role"] == ("superadmin" if superadmin else "marketer")


def test_exact_legacy_backend_service_principal_remains_compatible_without_email_claim(service):
    module, client, _ = service
    headers = token_headers(module, sub="festio-backend", email="system@festio.events", is_platform_superadmin=True)
    assert client.get("/api/marketing/me", headers=headers).status_code == 200
    assert post(client, headers, payload()).json()["pending_identity"] is True


@pytest.mark.parametrize("changes", [
    {"sub": "other-service"}, {"email": "admin@festio.events"},
    {"email": "SYSTEM@festio.events"}, {"is_platform_superadmin": "true"},
    {"is_platform_superadmin": 1}, {"is_platform_superadmin": False},
])
def test_service_exception_requires_exact_signed_principal(service, changes):
    module, client, _ = service
    claims = {"sub": "festio-backend", "email": "system@festio.events", "is_platform_superadmin": True, **changes}
    assert client.get("/api/marketing/me", headers=token_headers(module, **claims)).status_code == 403


def test_verified_subject_cannot_apply_profile_or_consent_to_a_different_stored_email(service):
    module, client, headers = service
    lead_id = seed_lead(module)
    before = snapshot(module, lead_id)
    body = payload(email_verified=True, festio_user_id="real-uid", email="new-verified@example.com")
    assert post(client, headers, body).status_code == 409
    assert snapshot(module, lead_id) == before
    with module.SessionLocal() as db:
        assert db.get(module.IngestReceipt, body["event_id"]) is None
        assert db.scalar(select(func.count(module.Activity.id))) == 0


def test_verified_email_can_match_legacy_mixed_case_without_creating_another_lead(service):
    module, client, headers = service
    with module.SessionLocal() as db:
        lead = module.Lead(email="OwNeR@Example.COM", name="Legacy lead")
        db.add(lead)
        db.commit()
        lead_id = lead.id
    response = post(client, headers, payload(email_verified=True))
    assert response.status_code == 200
    assert response.json()["id"] == lead_id and response.json()["festio_user_id"] == "claiming-uid"
    with module.SessionLocal() as db:
        assert db.scalar(select(func.count(module.Lead.id))) == 1
