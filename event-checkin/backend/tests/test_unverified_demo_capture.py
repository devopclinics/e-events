"""Public demo requests are durable unverified claims, not lead authority."""
import importlib.util
from pathlib import Path
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import settings
from app.models import DemoRequest, MarketingOutbox
from app.routers import demo
from conftest import _Session


def _body(**changes):
    return {"contact_name": "Unverified submitter", "email": "organizer@example.com",
            "phone": "+15555550999", "organization": "Unverified organization",
            "event_name": "Demo event", "guest_count": 999,
            "preferred_time": "2026-11-02T10:00:00-06:00", "timezone": "America/Chicago",
            "message": "Please arrange a demo", **changes}


async def test_public_demo_is_unverified_durable_and_retry_safe(ctx, monkeypatch):
    emails = AsyncMock()
    monkeypatch.setattr(demo, "send_simple_email", emails)
    monkeypatch.setattr(settings, "demo_recipient_emails", "operator@example.com")
    body = _body(consent_email=True, consent_sms=False, consent_whatsapp=True)
    headers = {"Idempotency-Key": "unverified-demo-submission"}
    first = await ctx.client.post("/api/demo-requests", json=body, headers=headers)
    repeated = await ctx.client.post("/api/demo-requests", json=body, headers=headers)
    assert first.status_code == repeated.status_code == 201 and first.json() == repeated.json()
    assert first.json()["status"] == "requested" and "not yet confirmed" in first.json()["message"]
    assert (await ctx.client.post("/api/demo-requests", json={**body, "contact_name": "Changed"},
                                  headers=headers)).status_code == 409
    async with _Session() as db:
        assert await db.scalar(select(func.count(DemoRequest.id))) == 1
        rows = (await db.execute(select(MarketingOutbox))).scalars().all()
        assert len(rows) == 1
        row = rows[0]
        assert row.endpoint == "demo-requests" and row.status == "pending"
        assert row.payload["identity_verified"] is False
        assert row.payload["source"] == "website_demo" and "stage" not in row.payload
        assert "festio_user_id" not in row.payload
        assert row.payload["demo_request_id"] == first.json()["request_id"]
        assert row.payload["consent_email"] is True and row.payload["consent_sms"] is False
    assert emails.await_count == 2, "Retry must not repeat confirmation or operator messages"
    confirmation = emails.await_args_list[0].args
    assert "not a confirmed booking" in confirmation[2]
    assert confirmation[3:6] == (None, None, None), "A request is not a calendar invitation"


async def test_actual_public_payload_cannot_update_existing_marketing_lead(ctx, monkeypatch, tmp_path):
    """Pass the real captured public payload through the isolated service ASGI app."""
    monkeypatch.setattr(demo, "send_simple_email", AsyncMock())
    response = await ctx.client.post("/api/demo-requests", json=_body(
        consent_email=True, consent_sms=False, consent_whatsapp=True,
    ))
    assert response.status_code == 201
    async with _Session() as db:
        captured = await db.scalar(select(MarketingOutbox))
    monkeypatch.setenv("MARKETING_DATABASE_URL", f"sqlite:///{tmp_path / 'marketing.db'}")
    monkeypatch.setenv("MARKETING_INTERNAL_TOKEN", "offline-demo-test-token")
    monkeypatch.setenv("MARKETING_SCHEDULER_ENABLED", "false")
    monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED", "false")
    service_path = Path(__file__).resolve().parents[2] / "marketing-service/app/main.py"
    spec = importlib.util.spec_from_file_location("isolated_demo_marketing", service_path)
    module = importlib.util.module_from_spec(spec)
    # Import independently so the backend's app package and configuration stay
    # untouched. This service uses only the test's separate temporary SQLite DB.
    import sys
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    identity = module.Identity(subject="offline-test", email="operator@example.com", name="Operator",
                               is_superadmin=True, role="superadmin")
    module.app.dependency_overrides[module.decode_identity] = lambda: identity
    try:
        with module.SessionLocal() as db:
            lead = module.Lead(email="organizer@example.com", name="Trusted owner", phone="+15555550101",
                               consent_email=False, consent_sms=True, consent_whatsapp=False,
                               stage="registered", suppression_reason="email_hard_bounce")
            db.add(lead)
            db.commit()
            lead_id = lead.id
        with module.SessionLocal() as db:
            before = module.lead_out(db.get(module.Lead, lead_id))
        client = TestClient(module.app)
        accepted = client.post(f"/api/marketing/internal/{captured.endpoint}", json=captured.payload)
        assert accepted.status_code == 200
        result = accepted.json()
        assert result["recorded"] is True and result["lead_id"] is None
        assert client.post(f"/api/marketing/internal/{captured.endpoint}",
                           json=captured.payload).json()["duplicate"] is True
        with module.SessionLocal() as db:
            assert module.lead_out(db.get(module.Lead, lead_id)) == before
            assert db.scalar(select(func.count(module.Lead.id))) == 1
            assert db.scalar(select(func.count(module.PendingProspect.id))) == 1
            prospect = db.get(module.PendingProspect, result["prospect_id"])
            assert prospect.identity_verified is False and prospect.lead_id is None
    finally:
        module.engine.dispose()
