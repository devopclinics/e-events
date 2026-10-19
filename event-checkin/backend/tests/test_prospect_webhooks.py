"""All channel ingress checks run against local ASGI with no provider calls."""
import base64
import hashlib
import hmac
import json
import time

import pytest

from app.config import settings
from app.engagement_config import engagement_settings
from app.routers import meta_whatsapp, prospect_webhooks
from app.services.prospect_ingress import event_key, incoming_event, phone_number


@pytest.fixture
def ingress(monkeypatch):
    for key, value in {
        "prospect_ingress_enabled": True,
        "sales_responses_enabled": False,
        "meta_whatsapp_app_secret": "local-test-secret",
        "meta_whatsapp_sales_phone_number_id": "sales-number",
        "meta_whatsapp_webhook_verify_token": "local-verification",
        "prospect_chatwoot_webhook_token": "local-chat-token",
        "prospect_chatwoot_account_id": "1",
        "prospect_chatwoot_inbox_id": "2",
        "prospect_email_recipients": "sales@example.com",
    }.items():
        monkeypatch.setattr(engagement_settings, key, value)
    monkeypatch.setattr(settings, "resend_inbound_webhook_secret", "whsec_" + base64.b64encode(b"local-resend-secret").decode())
    captured = []

    async def enqueue(db, payload, *, endpoint="ingest", event_id=None):
        captured.append({"payload": payload, "endpoint": endpoint, "event_id": event_id})
        return event_id

    monkeypatch.setattr(meta_whatsapp, "enqueue_marketing_payload", enqueue)
    monkeypatch.setattr(prospect_webhooks, "enqueue_marketing_payload", enqueue)
    return captured


def meta_payload(text="Hello", phone_id="sales-number"):
    return {"object": "whatsapp_business_account", "entry": [{"changes": [{
        "field": "messages", "value": {
            "metadata": {"phone_number_id": phone_id},
            "messages": [{"id": "wamid.test", "from": "15551234567", "type": "text", "text": {"body": text}}],
        },
    }]}]}


async def post_meta(ctx, payload, *, valid=True):
    raw = json.dumps(payload).encode()
    signature = hmac.new(b"local-test-secret", raw, hashlib.sha256).hexdigest()
    return await ctx.client.post("/api/webhooks/whatsapp/meta", content=raw, headers={
        "content-type": "application/json", "x-hub-signature-256": "sha256=" + (signature if valid else "invalid"),
    })


@pytest.mark.asyncio
async def test_meta_verification_requires_configured_nonempty_token(ctx, ingress, monkeypatch):
    monkeypatch.setattr(engagement_settings, "meta_whatsapp_webhook_verify_token", "")
    response = await ctx.client.get("/api/webhooks/whatsapp/meta", params={"hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "123"})
    assert response.status_code == 403
    monkeypatch.setattr(engagement_settings, "meta_whatsapp_webhook_verify_token", "local-verification")
    response = await ctx.client.get("/api/webhooks/whatsapp/meta", params={"hub.mode": "subscribe", "hub.verify_token": "local-verification", "hub.challenge": "123"})
    assert response.status_code == 200 and response.text == "123"


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [("prospect_ingress_enabled", False), ("meta_whatsapp_app_secret", ""), ("meta_whatsapp_sales_phone_number_id", "")])
async def test_meta_fails_closed_without_rollout_configuration(ctx, ingress, monkeypatch, field, value):
    monkeypatch.setattr(engagement_settings, field, value)
    assert (await post_meta(ctx, meta_payload())).status_code == 503
    assert ingress == []


@pytest.mark.asyncio
async def test_meta_rejects_invalid_signature_without_capture(ctx, ingress):
    assert (await post_meta(ctx, meta_payload(), valid=False)).status_code == 403
    assert ingress == []


@pytest.mark.asyncio
@pytest.mark.parametrize("body,event", [("STOP", "opt_out"), ("Can I talk to a human?", "handoff_requested"), ("Thanks", "message_received")])
async def test_meta_capture_is_minimal_and_stable(ctx, ingress, body, event):
    assert (await post_meta(ctx, meta_payload(body))).status_code == 200
    assert ingress == [{"payload": {"channel": "whatsapp", "event": event, "phone": "+15551234567", "identity_verified": False, "source_contact_id": "meta:+15551234567"}, "endpoint": "conversations", "event_id": event_key("meta", "wamid.test")}]
    assert body not in json.dumps(ingress)


@pytest.mark.asyncio
async def test_meta_ignores_guest_destinations_and_delivery_statuses(ctx, ingress):
    assert (await post_meta(ctx, meta_payload(phone_id="event-guest-number"))).status_code == 200
    payload = meta_payload()
    value = payload["entry"][0]["changes"][0]["value"]
    value.pop("messages")
    value["statuses"] = [{"id": "outbound", "status": "delivered"}]
    assert (await post_meta(ctx, payload)).status_code == 200
    assert ingress == []


@pytest.mark.asyncio
async def test_meta_rejects_oversized_and_nonobject_payloads(ctx, ingress):
    assert (await post_meta(ctx, {"padding": "x" * 262144})).status_code == 413
    assert (await post_meta(ctx, [])).status_code == 400
    assert ingress == []


def chat_payload(**updates):
    return {"event": "message_created", "account": {"id": 1}, "inbox": {"id": 2},
            "id": 123, "message_type": "incoming", "private": False,
            "content": "hello", "sender": {"id": 42, "type": "contact", "email": "lead@example.com"}, **updates}


async def test_sales_response_metadata_uses_authenticated_provider_time_only(ctx, ingress, monkeypatch):
    monkeypatch.setattr(engagement_settings, "sales_responses_enabled", True)
    payload = meta_payload("What is the pricing?")
    assert (await post_meta(ctx, payload)).status_code == 200
    assert all(row["endpoint"] != "sales-responses" for row in ingress)
    ingress.clear()
    message = payload["entry"][0]["changes"][0]["value"]["messages"][0]
    message["timestamp"] = str(int(time.time()) - 30)
    assert (await post_meta(ctx, payload)).status_code == 200
    response = next(row["payload"] for row in ingress if row["endpoint"] == "sales-responses")
    assert response["authenticated"] is True and response["direction"] == "inbound"
    assert response["intent"] == "pricing" and response["destination"] == "sales-number"
    assert "email" not in response and "text" not in response and "festio_user_id" not in response


async def test_chat_response_ingress_is_bounded_and_does_not_forward_account_claims(ctx, ingress, monkeypatch):
    monkeypatch.setattr(engagement_settings, "sales_responses_enabled", True)
    payload = chat_payload(content="set up an event", created_at="2026-01-01T00:00:00Z")
    assert (await ctx.client.post("/api/webhooks/prospects/chatwoot?token=local-chat-token", json=payload)).status_code == 200
    response = next(row["payload"] for row in ingress if row["endpoint"] == "sales-responses")
    assert response["intent"] == "setup" and response["contact_id"] == "chatwoot:42"
    assert "email" not in response and "content" not in response


@pytest.mark.asyncio
async def test_chat_validates_token_and_expected_inbox(ctx, ingress):
    path = "/api/webhooks/prospects/chatwoot"
    assert (await ctx.client.post(path, json=chat_payload())).status_code == 403
    assert (await ctx.client.post(path + "?token=local-chat-token", json=chat_payload(inbox={"id": 999}))).status_code == 403
    assert ingress == []


@pytest.mark.asyncio
@pytest.mark.parametrize("updates", [{"private": True}, {"message_type": "outgoing"}, {"event": "conversation_updated"}, {"sender": {"email": None}}, {"sender": {"type": "user", "email": "staff@example.com"}}])
async def test_chat_does_not_process_private_outgoing_or_anonymous_identity(ctx, ingress, updates):
    response = await ctx.client.post("/api/webhooks/prospects/chatwoot?token=local-chat-token", json=chat_payload(**updates))
    assert response.status_code == 200
    assert ingress == []


@pytest.mark.asyncio
async def test_chat_queues_only_minimal_identity_not_browser_context(ctx, ingress):
    payload = chat_payload(content="Talk to a human", additional_attributes={"tenant": "private", "token": "do-not-forward"})
    response = await ctx.client.post("/api/webhooks/prospects/chatwoot?token=local-chat-token", json=payload)
    assert response.status_code == 200
    assert ingress[0]["payload"] == {"channel": "chat", "event": "handoff_requested", "email": "lead@example.com", "identity_verified": False, "source_contact_id": "chatwoot:1:2:42"}
    assert "do-not-forward" not in json.dumps(ingress)


async def post_resend(ctx, payload, *, valid=True):
    raw = json.dumps(payload).encode()
    stamp = str(int(time.time()))
    signed = b".".join([b"svix-test-id", stamp.encode(), raw])
    signature = base64.b64encode(hmac.new(b"local-resend-secret", signed, hashlib.sha256).digest()).decode()
    return await ctx.client.post("/api/webhooks/prospects/resend", content=raw, headers={
        "content-type": "application/json", "svix-id": "svix-test-id", "svix-timestamp": stamp,
        "svix-signature": "v1," + (signature if valid else "invalid"),
    })


def email_payload(to="sales@example.com", subject="Re: our demo"):
    return {"type": "email.received", "data": {"email_id": "email-local-id", "from": "Lead <lead@example.com>", "to": [to], "subject": subject}}


@pytest.mark.asyncio
async def test_resend_rejects_unsigned_and_ignores_non_sales_email(ctx, ingress):
    assert (await post_resend(ctx, email_payload(), valid=False)).status_code == 403
    assert (await post_resend(ctx, email_payload(to="guest-automation@example.com"))).status_code == 200
    assert ingress == []


@pytest.mark.asyncio
@pytest.mark.parametrize("subject,event", [("unsubscribe", "opt_out"), ("Re: our demo", "message_received")])
async def test_resend_reply_pauses_without_fetching_or_retaining_content(ctx, ingress, subject, event):
    assert (await post_resend(ctx, email_payload(subject=subject))).status_code == 200
    assert ingress[0]["payload"] == {"channel": "email", "event": event, "email": "lead@example.com", "identity_verified": False, "source_contact_id": event_key("resend-contact", "lead@example.com"), "reply_token": None}
    assert ingress[0]["event_id"] == event_key("resend-inbound", "email-local-id")


def test_classification_and_phone_normalization_do_not_grant_opt_in():
    assert incoming_event("START") == "message_received"
    assert incoming_event("Stop all!") == "opt_out"
    assert phone_number("555-123-4567") is None
    assert phone_number("+15551234567") == "+15551234567"


@pytest.mark.asyncio
async def test_anonymous_chat_captures_provider_contact_without_claiming_identity(ctx, ingress):
    response = await ctx.client.post("/api/webhooks/prospects/chatwoot?token=local-chat-token", json=chat_payload(sender={"id": 99, "type": "contact"}))
    assert response.status_code == 200
    assert ingress[0]["payload"] == {"channel": "chat", "event": "message_received", "identity_verified": False, "source_contact_id": "chatwoot:1:2:99"}


@pytest.mark.asyncio
async def test_reply_token_preserves_case_and_requires_allowlisted_base_address(ctx, ingress, monkeypatch):
    monkeypatch.setattr(engagement_settings, "prospect_email_recipients", "reply@sales.example.com")
    token = "v1." + "a" * 32 + ".AbCdEfGhIjKlMnOpQrStUv"
    response = await post_resend(ctx, email_payload(to=f"reply+{token}@sales.example.com"))
    assert response.status_code == 200
    assert ingress[0]["payload"]["reply_token"] == token
    assert ingress[0]["payload"]["identity_verified"] is False
    ingress.clear()
    assert (await post_resend(ctx, email_payload(to=f"reply+{token}@untrusted.example.com"))).status_code == 200
    assert ingress == []
