import importlib
import os
import sys
from datetime import datetime, timedelta, timezone

import jwt
from fastapi.testclient import TestClient


def load_app(tmp_path):
    os.environ["MARKETING_DATABASE_URL"] = f"sqlite:///{tmp_path / 'marketing.db'}"
    os.environ["MARKETING_INTERNAL_TOKEN"] = "test-secret"
    sys.modules.pop("app.main", None)
    module = importlib.import_module("app.main")
    token = jwt.encode({
        "sub": "e2e-admin", "email": "muritala@festio.events", "name": "Muritala",
        "is_platform_superadmin": True, "iss": "guesthub", "aud": "marketing",
        "iat": datetime.now(timezone.utc), "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
    }, "test-secret", algorithm="HS256")
    return TestClient(module.app), {"Authorization": f"Bearer {token}"}


def test_complete_lead_workflow(tmp_path):
    client, headers = load_app(tmp_path)
    created = client.post("/api/marketing/leads", headers=headers, json={
        "email": "e2e-organizer@example.com", "name": "E2E Organizer",
        "source": "linkedin", "campaign": "breakfast-e2e", "consent_email": True,
    })
    assert created.status_code == 200
    lead = created.json()
    assert lead["registered_at"]

    assert client.patch(f"/api/marketing/leads/{lead['id']}", headers=headers, json={"stage": "qualified"}).status_code == 200
    assert client.post(f"/api/marketing/leads/{lead['id']}/activity", headers=headers, json={"kind": "note", "summary": "E2E note"}).status_code == 200
    assert len(client.get(f"/api/marketing/leads/{lead['id']}/activity", headers=headers).json()) >= 3

    view = client.post("/api/marketing/saved-views", headers=headers, json={"name": "LinkedIn leads", "filters": {"source": "linkedin"}})
    assert view.status_code == 200
    assert client.post("/api/marketing/leads/bulk", headers=headers, json={"ids": [lead["id"]], "action": "tag", "value": "e2e"}).json() == {"updated": 1}
    assert "e2e-organizer@example.com" in client.get("/api/marketing/export/leads.csv", headers=headers).text
    assert client.get("/api/marketing/analytics?days=30", headers=headers).json()["sources"]["linkedin"] == 1
    assert client.delete(f"/api/marketing/leads/{lead['id']}", headers=headers).status_code == 204


def test_preferences_delivery_and_social_validation(tmp_path):
    client, headers = load_app(tmp_path)
    email = "preferences@example.com"
    saved = client.put(f"/api/marketing/internal/preferences/{email}", headers=headers, json={"consent_email": True, "consent_sms": False})
    assert saved.status_code == 200
    assert saved.json()["consent_email"] is True
    assert client.get(f"/api/marketing/internal/preferences/{email}", headers=headers).json()["unsubscribed"] is False

    delivered = client.post("/api/marketing/internal/delivery", headers=headers, json={"email": email, "event": "email.delivered", "provider_id": "email_e2e"})
    assert delivered.json() == {"recorded": True}
    lead = client.get("/api/marketing/leads?q=preferences", headers=headers).json()[0]
    assert client.get(f"/api/marketing/leads/{lead['id']}/activity", headers=headers).json()[0]["kind"] == "email_delivered"

    social = client.post("/api/marketing/social/publish", headers=headers, json={"platform": "linkedin", "message": "Provider-safe E2E", "dry_run": True})
    assert social.json() == {"status": "validated", "platform": "linkedin", "dry_run": True}


def test_unsubscribe_bounce_and_sms_stop(tmp_path):
    client, headers = load_app(tmp_path)
    created = client.post("/api/marketing/leads", headers=headers, json={
        "email": "consent@example.com", "name": "Consent Test", "phone": "+15551234567",
        "consent_email": True, "consent_sms": True,
    }).json()
    unsubscribed = client.get(f"/api/marketing/unsubscribe/{created['id']}")
    assert unsubscribed.status_code == 200
    assert "You've been unsubscribed" in unsubscribed.text
    lead = client.get("/api/marketing/leads?q=consent", headers=headers).json()[0]
    assert lead["consent_email"] is False and lead["unsubscribed"] is True

    client.patch(f"/api/marketing/leads/{created['id']}", headers=headers, json={"consent_email": True, "unsubscribed": False})
    client.post("/api/marketing/internal/delivery", headers=headers, json={"email": "consent@example.com", "event": "email.bounced", "bounce_type": "soft"})
    assert client.get("/api/marketing/leads?q=consent", headers=headers).json()[0]["consent_email"] is True
    client.post("/api/marketing/internal/delivery", headers=headers, json={"email": "consent@example.com", "event": "email.complained"})
    assert client.get("/api/marketing/leads?q=consent", headers=headers).json()[0]["consent_email"] is False

    stopped = client.post("/api/marketing/sms/webhook", json={"payload": {"sender": {"contact": {"identifierValue": "+15551234567"}}, "body": {"text": {"text": "STOP"}}}})
    assert stopped.json() == {"recorded": True, "unsubscribed": True}
    assert client.get("/api/marketing/leads?q=consent", headers=headers).json()[0]["consent_sms"] is False


def test_campaign_segment_dry_run_and_automation_preview(tmp_path):
    client, headers = load_app(tmp_path)
    client.post("/api/marketing/leads", headers=headers, json={"email": "paid@example.com", "name": "Paid", "stage": "paid", "consent_email": True})
    client.post("/api/marketing/leads", headers=headers, json={"email": "free@example.com", "name": "Free", "stage": "registered", "consent_email": True})
    segment = client.post("/api/marketing/modules/segments", headers=headers, json={"name": "Paid only", "status": "active", "payload": {"field": "stage", "operator": "equals", "value": "paid"}}).json()
    campaign = client.post("/api/marketing/modules/campaigns", headers=headers, json={"name": "Paid launch", "status": "draft", "payload": {"segment_id": segment["id"], "subject": "Paid event offer", "body": "Your paid event includes add-ons.", "cta_url": "https://festio.events"}}).json()
    result = client.post(f"/api/marketing/campaigns/{campaign['id']}/execute?dry_run=true", headers=headers).json()
    assert result["eligible"] == 1
    assert result["recipients"][0]["email"] == "paid@example.com"
    automation = client.post("/api/marketing/automation/run?dry_run=true", headers=headers).json()
    assert automation["dry_run"] is True


def test_forms_merge_tags_demo_and_gdpr(tmp_path):
    client, headers = load_app(tmp_path)
    first = client.post("/api/marketing/leads", headers=headers, json={"email":"primary@example.com","name":"Primary","tags":["vip"],"consent_email":True}).json()
    duplicate = client.post("/api/marketing/leads", headers=headers, json={"email":"duplicate@example.com","phone":"+15550001111","tags":["duplicate"]}).json()
    merged = client.post("/api/marketing/leads/merge", headers=headers, json={"target_id":first["id"],"source_id":duplicate["id"]})
    assert merged.status_code == 200
    assert merged.json()["phone"] == "+15550001111"
    assert set(merged.json()["tags"]) == {"vip","duplicate"}
    assert client.patch("/api/marketing/tags/vip", headers=headers, json={"name":"priority"}).json()["updated"] == 1
    assert {row["name"] for row in client.get("/api/marketing/tags", headers=headers).json()} == {"priority","duplicate"}
    demo = client.post(f"/api/marketing/leads/{first['id']}/demo", headers=headers, json={"starts_at":"2026-08-12T15:00:00Z","duration_minutes":45})
    assert demo.status_code == 200 and "calendar.google.com" in demo.json()["calendar_url"]
    deletion = client.post(f"/api/marketing/leads/{first['id']}/gdpr-delete", headers=headers)
    assert deletion.json()["scheduled"] is True

    form = client.post("/api/marketing/modules/forms", headers=headers, json={"name":"Partner lead form","status":"active","payload":{"fields":["name","email"]}}).json()
    token = form["payload"]["public_token"]
    assert client.get(f"/api/marketing/forms/{token}").status_code == 200
    # Public capture fails closed when Turnstile is not configured.
    assert client.post(f"/api/marketing/forms/{token}/submit", json={"name":"Bot","email":"bot@example.com"}).status_code == 503


def test_owner_scoped_access_only_sees_assigned_leads(tmp_path):
    client, headers = load_app(tmp_path)
    client.post("/api/marketing/leads", headers=headers, json={"email":"mine@example.com","owner_email":"sales@example.com"})
    hidden = client.post("/api/marketing/leads", headers=headers, json={"email":"hidden@example.com","owner_email":"other@example.com"}).json()
    client.post("/api/marketing/access", headers=headers, json={"email":"sales@example.com","role":"marketer","owner_scoped":True})
    token = jwt.encode({"sub":"sales-user","email":"sales@example.com","name":"Sales","iss":"guesthub","aud":"marketing","iat":datetime.now(timezone.utc),"exp":datetime.now(timezone.utc)+timedelta(minutes=10)},"test-secret",algorithm="HS256")
    sales_headers={"Authorization":f"Bearer {token}"}
    rows=client.get("/api/marketing/leads",headers=sales_headers).json()
    assert [row["email"] for row in rows] == ["mine@example.com"]
    assert client.get(f"/api/marketing/leads/{hidden['id']}/activity",headers=sales_headers).status_code == 404
