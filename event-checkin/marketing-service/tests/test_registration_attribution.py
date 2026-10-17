"""Identity-proof refreshes must not rewrite a lead's first acquisition."""
import pytest
from sqlalchemy import func, select

from test_engagement_reliability import service  # noqa: F401


ATTRIBUTION = {
    "source": "partner", "medium": "referral", "campaign": "original-partner",
    "referrer": "https://partner.example.com", "landing_page": "https://festio.events/original",
}


def post(client, headers, **values):
    return client.post("/api/marketing/internal/ingest", headers=headers, json={
        "event_id": "verified-registration-upgrade", "lifecycle_event": "registered", "stage": "registered",
        "email": "owner@example.com", "festio_user_id": "verified-owner", "email_verified": True,
        **values,
    })


@pytest.mark.parametrize("lifecycle", ["registered", "signup_consent"])
@pytest.mark.parametrize("existing_source", ["partner", "website"])
@pytest.mark.parametrize("incoming", [
    {"source": "website"},  # Already queued pre-fix no-header registration.
    {"source": "newsletter", "medium": "email", "campaign": "later-login",
     "referrer": "https://other.example.com", "landing_page": "https://festio.events/later"},
])
def test_registration_preserves_established_acquisition_and_records_proof(service, lifecycle, existing_source, incoming):
    module, client, headers = service
    acquisition = {**ATTRIBUTION, "source": existing_source}
    with module.SessionLocal() as db:
        lead = module.Lead(email="owner@example.com", stage="paid", **acquisition,
                           consent_email=False, consent_sms=True, unsubscribed=True,
                           automation_paused=True, suppression_reason="email_hard_bounce")
        db.add(lead)
        db.commit()
        lead_id = lead.id
    response = post(client, headers, lifecycle_event=lifecycle, **incoming)
    assert response.status_code == 200
    result = response.json()
    assert result["id"] == lead_id and result["festio_user_id"] == "verified-owner"
    assert {key: result[key] for key in acquisition} == acquisition
    assert result["stage"] == "paid" and result["unsubscribed"] and result["automation_paused"]
    assert result["suppression_reason"] == "email_hard_bounce"
    assert not result["consent_email"] and result["consent_sms"] and not result["consent_whatsapp"]
    assert result["next_follow_up_at"] is None
    assert post(client, headers, lifecycle_event=lifecycle, **incoming).json()["ingest_duplicate"] is True
    assert post(client, headers, lifecycle_event=lifecycle, **{**incoming, "campaign": "changed-replay"}).status_code == 409
    with module.SessionLocal() as db:
        assert db.get(module.IngestReceipt, "verified-registration-upgrade").lead_id == lead_id
        assert db.scalar(select(func.count(module.Activity.id))) == 1
        assert db.scalar(select(func.count(module.PendingProspect.id))) == 0


@pytest.mark.parametrize("lifecycle", ["registered", "signup_consent"])
def test_later_registration_preserves_even_bare_website_first_touch(service, lifecycle):
    module, client, headers = service
    first = post(client, headers, event_id="first-auth-listener").json()
    assert first["source"] == "website"
    assert not any(first[key] for key in ATTRIBUTION if key != "source")
    response = post(client, headers, lifecycle_event=lifecycle, consent_email=True, **ATTRIBUTION)
    assert response.status_code == 200
    result = response.json()
    assert result["id"] == first["id"]
    assert {key: result[key] for key in ATTRIBUTION} == {key: first[key] for key in ATTRIBUTION}
    assert result["consent_email"] is True
    assert not result["consent_sms"] and not result["consent_whatsapp"]


@pytest.mark.parametrize("context_field", ["medium", "campaign", "referrer", "landing_page"])
def test_any_existing_website_acquisition_context_prevents_source_replacement(service, context_field):
    module, client, headers = service
    with module.SessionLocal() as db:
        db.add(module.Lead(email="owner@example.com", source="website",
                           **{context_field: ATTRIBUTION[context_field]}))
        db.commit()
    result = post(client, headers, **ATTRIBUTION).json()
    assert result["source"] == "website"
    assert result[context_field] == ATTRIBUTION[context_field]


@pytest.mark.parametrize("lifecycle", ["registered", "signup_consent"])
@pytest.mark.parametrize("acquisition", [
    {"source": "partner"}, {"source": "partner", "campaign": "original"},
    {"source": "", "campaign": "original"},
])
def test_registration_keeps_partial_acquisition_tuple_without_mixing_later_touch(service, lifecycle, acquisition):
    module, client, headers = service
    with module.SessionLocal() as db:
        lead = module.Lead(email="owner@example.com", **acquisition)
        db.add(lead)
        db.commit()
        before = {key: getattr(lead, key) for key in ATTRIBUTION}
    response = post(client, headers, lifecycle_event=lifecycle, **{**ATTRIBUTION, "source": "newsletter"})
    assert response.status_code == 200
    assert {key: response.json()[key] for key in ATTRIBUTION} == before


@pytest.mark.parametrize("lifecycle", ["registered", "signup_consent"])
def test_registration_populates_wholly_empty_legacy_acquisition_tuple(service, lifecycle):
    module, client, headers = service
    with module.SessionLocal() as db:
        db.add(module.Lead(email="owner@example.com", source=""))
        db.commit()
    response = post(client, headers, lifecycle_event=lifecycle, **ATTRIBUTION)
    assert response.status_code == 200
    assert {key: response.json()[key] for key in ATTRIBUTION} == ATTRIBUTION


def test_new_registration_captures_rich_first_acquisition(service):
    _, client, headers = service
    response = post(client, headers, **ATTRIBUTION)
    assert response.status_code == 200
    assert {key: response.json()[key] for key in ATTRIBUTION} == ATTRIBUTION


def test_deliberate_profile_update_retains_acquisition_edit_behavior(service):
    _, client, headers = service
    first = post(client, headers, **ATTRIBUTION).json()
    changed = {key: f"updated-{value}" for key, value in ATTRIBUTION.items()}
    response = post(client, headers, event_id="deliberate-update", lifecycle_event="lead_updated", **changed)
    assert response.status_code == 200 and response.json()["id"] == first["id"]
    assert {key: response.json()[key] for key in changed} == changed


def test_deliberate_admin_edit_retains_acquisition_edit_behavior(service):
    _, client, headers = service
    first = post(client, headers, **ATTRIBUTION).json()
    changed = {key: f"updated-{value}" for key, value in ATTRIBUTION.items()}
    response = client.patch(f"/api/marketing/leads/{first['id']}", headers=headers, json=changed)
    assert response.status_code == 200 and response.json()["id"] == first["id"]
    assert {key: response.json()[key] for key in changed} == changed
