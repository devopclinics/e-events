import base64
import hashlib
import hmac
import time

import pytest

from app.config import settings


@pytest.mark.asyncio
async def test_resend_webhook_acknowledges_when_secret_not_configured(ctx, monkeypatch):
    monkeypatch.setattr(settings, "resend_webhook_secret", "")

    resp = await ctx.client.post(
        "/api/webhooks/resend",
        json={"type": "email.delivered", "data": {"email_id": "email_123", "to": ["guest@example.com"]}},
    )

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


@pytest.mark.asyncio
async def test_resend_webhook_rejects_invalid_signature(ctx, monkeypatch):
    secret = "whsec_" + base64.b64encode(b"test-secret").decode()
    monkeypatch.setattr(settings, "resend_webhook_secret", secret)

    resp = await ctx.client.post(
        "/api/webhooks/resend",
        content=b'{"type":"email.bounced"}',
        headers={
            "content-type": "application/json",
            "svix-id": "msg_123",
            "svix-timestamp": str(int(time.time())),
            "svix-signature": "v1,invalid",
        },
    )

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_resend_webhook_accepts_valid_signature(ctx, monkeypatch):
    secret_bytes = b"test-secret"
    secret = "whsec_" + base64.b64encode(secret_bytes).decode()
    monkeypatch.setattr(settings, "resend_webhook_secret", secret)
    payload = b'{"type":"email.opened","data":{"email_id":"email_123"}}'
    svix_id = "msg_123"
    svix_timestamp = str(int(time.time()))
    signed_payload = b".".join([svix_id.encode(), svix_timestamp.encode(), payload])
    signature = base64.b64encode(
        hmac.new(secret_bytes, signed_payload, hashlib.sha256).digest()
    ).decode()

    resp = await ctx.client.post(
        "/api/webhooks/resend",
        content=payload,
        headers={
            "content-type": "application/json",
            "svix-id": svix_id,
            "svix-timestamp": svix_timestamp,
            "svix-signature": f"v1,{signature}",
        },
    )

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


@pytest.mark.asyncio
async def test_resend_webhook_persists_and_links_by_tags(ctx, monkeypatch):
    monkeypatch.setattr(settings, "resend_webhook_secret", "")
    ctx.login(ctx.ids["user_a"])

    guest = (await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")).json()[0]
    resp = await ctx.client.post(
        "/api/webhooks/resend",
        json={
            "id": "evt_delivered_1",
            "type": "email.delivered",
            "created_at": "2026-07-06T12:00:00.000Z",
            "data": {
                "email_id": "email_123",
                "to": [guest["email"]],
                "subject": "Ticket",
                "tags": [
                    {"name": "event_id", "value": ctx.ids["event_a"]},
                    {"name": "guest_id", "value": guest["id"]},
                    {"name": "message_kind", "value": "invitation"},
                ],
            },
        },
    )

    assert resp.status_code == 200
    guests = (await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")).json()
    linked = next(g for g in guests if g["id"] == guest["id"])
    assert linked["email_delivery_status"] == "delivered"
    assert linked["email_delivery_kind"] == "invitation"


@pytest.mark.asyncio
async def test_resend_webhook_links_by_event_and_recipient_without_guest_tag(ctx, monkeypatch):
    monkeypatch.setattr(settings, "resend_webhook_secret", "")
    ctx.login(ctx.ids["user_a"])

    guest = (await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")).json()[0]
    resp = await ctx.client.post(
        "/api/webhooks/resend",
        json={
            "id": "evt_delivered_by_recipient_1",
            "type": "email.delivered",
            "created_at": "2026-07-06T12:00:00.000Z",
            "data": {
                "email_id": "email_recipient_123",
                "to": [guest["email"]],
                "subject": "Ticket",
                "tags": [
                    {"name": "event_id", "value": ctx.ids["event_a"]},
                    {"name": "message_kind", "value": "invitation"},
                ],
            },
        },
    )

    assert resp.status_code == 200
    guests = (await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")).json()
    linked = next(g for g in guests if g["id"] == guest["id"])
    assert linked["email_delivery_status"] == "delivered"
    assert linked["email_delivery_kind"] == "invitation"
