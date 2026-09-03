import base64
import hashlib
import hmac
import time

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import ConsentSignature, Event, Guest, GuestExperienceProgress, InboundEmail, InboundEmailWebhookReceipt
from app.services.inbound_email_outbox import process_due
from conftest import _Session


def _headers(payload: bytes, secret_bytes: bytes, svix_id: str = "msg_inbound_1") -> dict:
    timestamp = str(int(time.time()))
    signed = b".".join([svix_id.encode(), timestamp.encode(), payload])
    signature = base64.b64encode(hmac.new(secret_bytes, signed, hashlib.sha256).digest()).decode()
    return {
        "content-type": "application/json",
        "svix-id": svix_id,
        "svix-timestamp": timestamp,
        "svix-signature": f"v1,{signature}",
    }


@pytest.mark.asyncio
async def test_inbound_webhook_fails_closed_without_secret(ctx, monkeypatch):
    monkeypatch.setattr(settings, "resend_inbound_webhook_secret", "")
    monkeypatch.setattr(settings, "resend_webhook_secret", "")
    response = await ctx.client.post("/api/webhooks/resend/inbound", json={"type": "email.received"})
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_unknown_inbound_token_is_audited_without_processing(ctx, monkeypatch):
    secret_bytes = b"inbound-test-secret"
    monkeypatch.setattr(
        settings,
        "resend_inbound_webhook_secret",
        "whsec_" + base64.b64encode(secret_bytes).decode(),
    )
    payload = (
        b'{"type":"email.received","created_at":"2026-08-29T12:00:00Z",'
        b'"data":{"email_id":"received_unknown_1","from":"sender@example.com",'
        b'"to":["consent+unknown@inbound.festio.events"],"subject":"Done"}}'
    )
    response = await ctx.client.post(
        "/api/webhooks/resend/inbound", content=payload, headers=_headers(payload, secret_bytes)
    )
    assert response.status_code == 200
    async with _Session() as db:
        row = await db.scalar(select(InboundEmail).where(InboundEmail.resend_email_id == "received_unknown_1"))
        assert row.processing_status == "invalid"
        assert row.failure_code == "unknown_inbound_token"


@pytest.mark.asyncio
async def test_replayed_resend_email_creates_receipt_not_second_email(ctx, monkeypatch):
    secret_bytes = b"inbound-replay-secret"
    monkeypatch.setattr(settings, "resend_inbound_webhook_secret", "whsec_" + base64.b64encode(secret_bytes).decode())
    payload = b'{"type":"email.received","data":{"email_id":"received_replay_1","to":["x+unknown@inbound.festio.events"]}}'
    first = await ctx.client.post("/api/webhooks/resend/inbound", content=payload, headers=_headers(payload, secret_bytes, "msg_replay_1"))
    second = await ctx.client.post("/api/webhooks/resend/inbound", content=payload, headers=_headers(payload, secret_bytes, "msg_replay_2"))
    assert first.status_code == second.status_code == 200
    async with _Session() as db:
        emails = (await db.execute(select(InboundEmail).where(InboundEmail.resend_email_id == "received_replay_1"))).scalars().all()
        receipts = (await db.execute(select(InboundEmailWebhookReceipt).where(InboundEmailWebhookReceipt.resend_email_id == "received_replay_1"))).scalars().all()
        assert len(emails) == 1
        assert len(receipts) == 2
        assert sum(1 for row in receipts if row.is_duplicate) == 1


@pytest.mark.asyncio
async def test_inbound_automation_creation_requires_sender_and_completion_rules(ctx):
    async with _Session() as db:
        event = await db.get(Event, ctx.ids["event_a"])
        event.is_paid = True
        event.purchased_addons = ["addon_experience"]
        event.experience_enabled = True
        await db.commit()
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]
    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={"name": "Inbound", "steps": [{"key": "external_consent", "type": "consent", "title": "Consent", "blocks_checkin": True}]},
    )
    assert workflow.status_code == 201
    step_id = workflow.json()["steps"][0]["id"]
    published = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish"
    )
    assert published.status_code == 200
    response = await ctx.client.post(
        f"/api/events/{event_id}/experience/inbound-automations",
        json={
            "name": "External Consent Completion",
            "step_id": step_id,
            "status": "active",
            "sender_rules": [{"sender_kind": "forwarder", "match_type": "email", "value": "organizer@example.com"}],
            "completion_rules": {"match": "all", "conditions": [{"field": "subject", "operator": "contains", "value": "Consent Completed"}]},
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["inbound_address"].endswith("@inbound.festio.events")
    assert "+" in response.json()["inbound_address"]
    assert len(response.json()["inbound_address"].split("@", 1)[0]) <= 64


@pytest.mark.asyncio
async def test_valid_inbound_email_completes_consent_step_without_fake_signature(ctx, monkeypatch):
    secret_bytes = b"inbound-e2e-secret"
    monkeypatch.setattr(settings, "resend_inbound_webhook_secret", "whsec_" + base64.b64encode(secret_bytes).decode())
    async with _Session() as db:
        event = await db.get(Event, ctx.ids["event_a"])
        event.is_paid = True
        event.purchased_addons = ["addon_experience"]
        event.experience_enabled = True
        guest = (await db.execute(select(Guest).where(Guest.event_id == event.id))).scalars().first()
        guest.first_name = "Ada"
        guest.last_name = "Test"
        guest.email = "ada-test@example.com"
        await db.commit()
        guest_id = guest.id

    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]
    workflow = (await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={"name": "External Consent", "steps": [{"key": "consent", "type": "consent", "title": "Consent", "blocks_checkin": True}]},
    )).json()
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow['id']}/publish")).status_code == 200
    step_id = workflow["steps"][0]["id"]
    automation = (await ctx.client.post(
        f"/api/events/{event_id}/experience/inbound-automations",
        json={
            "name": "External Consent Completion",
            "step_id": step_id,
            "status": "active",
            "sender_rules": [
                {"sender_kind": "forwarder", "match_type": "email", "value": "organizer@gmail.com"},
                {"sender_kind": "original", "match_type": "domain", "value": "provider.example"},
            ],
            "completion_rules": {"match": "all", "conditions": [
                {"field": "subject", "operator": "contains", "value": "Consent Completed"},
                {"field": "body", "operator": "contains", "value": "successfully submitted"},
            ]},
        },
    )).json()
    payload = (
        '{"type":"email.received","data":{"email_id":"received_consent_1",'
        f'"from":"organizer@gmail.com","to":["{automation["inbound_address"]}"],'
        '"subject":"Consent Completed"}}'
    ).encode()
    assert (await ctx.client.post(
        "/api/webhooks/resend/inbound",
        content=payload,
        headers=_headers(payload, secret_bytes, "msg_consent_1"),
    )).status_code == 200

    async def fetcher(_email_id):
        return {
            "from": "organizer@gmail.com",
            "to": [automation["inbound_address"]],
            "subject": "Consent Completed - Ada Test",
            "message_id": "<consent-provider-1>",
            "text": """Your consent has been successfully submitted.
---------- Forwarded message ---------
From: Provider <notifications@provider.example>
Guest Name: Ada Test
Guest Email: ada-test@example.com
""",
            "headers": {"Authentication-Results": "mx; dkim=pass header.i=@gmail.com"},
            "attachments": [],
        }

    assert await process_due(fetcher=fetcher) == 1
    async with _Session() as db:
        inbound = await db.scalar(select(InboundEmail).where(InboundEmail.resend_email_id == "received_consent_1"))
        progress = await db.scalar(select(GuestExperienceProgress).where(
            GuestExperienceProgress.guest_id == guest_id,
            GuestExperienceProgress.step_id == step_id,
        ))
        signature = await db.scalar(select(ConsentSignature).where(ConsentSignature.guest_id == guest_id))
        assert inbound.processing_status == "completed"
        assert inbound.match_method == "email"
        assert progress.status == "completed"
        assert progress.completed_by_source == "inbound_email"
        assert signature is None

    audit = await ctx.client.get(f"/api/events/{event_id}/experience/inbound-automations/audit")
    assert audit.status_code == 200, audit.text
    record = next(item for item in audit.json() if item["id"] == inbound.id)
    assert record["guest_id"] == guest_id
    assert record["guest_name"] == "Ada Test"
    assert record["guest_email"] == "ada-test@example.com"
    assert record["automation_name"] == "External Consent Completion"
    assert record["processing_status"] == "completed"
    assert record["match_method"] == "email"
    assert "text" not in record
