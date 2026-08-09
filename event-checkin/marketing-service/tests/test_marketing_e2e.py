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
