"""Outbound webhooks (Gatsby gap-backlog item): endpoint management, event-type
validation, fan-out queuing, HMAC signing, and the retry/backoff worker."""
import json
from datetime import datetime

import httpx
import pytest
from sqlalchemy import select

from app.models import WebhookDelivery, WebhookEndpoint
from app.services import webhook_outbox
from conftest import _Session


@pytest.mark.asyncio
async def test_owner_can_create_list_and_delete_webhook(ctx):
    ctx.login(ctx.ids["user_a"])
    created = await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "https://example.com/hook", "event_types": ["guest.created", "rsvp.confirmed"],
    })
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["url"] == "https://example.com/hook"
    assert body["secret"]   # full secret shown once
    hook_id = body["id"]

    listing = (await ctx.client.get("/api/organizations/me/webhooks")).json()
    assert len(listing) == 1
    assert "secret" not in listing[0]

    deleted = await ctx.client.delete(f"/api/organizations/me/webhooks/{hook_id}")
    assert deleted.status_code == 204


@pytest.mark.asyncio
async def test_webhook_rejects_unsupported_event_type(ctx):
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "https://example.com/hook", "event_types": ["bogus.event"],
    })
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_webhook_rejects_non_http_url(ctx):
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "ftp://example.com/hook", "event_types": ["guest.created"],
    })
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_guest_created_queues_a_delivery_for_matching_endpoint(ctx):
    ctx.login(ctx.ids["user_a"])
    ev = ctx.ids["event_a"]
    await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "https://example.com/hook", "event_types": ["guest.created"],
    })

    created = await ctx.client.post(f"/api/events/{ev}/guests", json={"first_name": "Ada", "last_name": "Lovelace"})
    assert created.status_code == 201

    async with _Session() as s:
        rows = (await s.execute(select(WebhookDelivery))).scalars().all()
        assert any(r.event_type == "guest.created" for r in rows)


@pytest.mark.asyncio
async def test_no_delivery_queued_without_matching_subscription(ctx):
    ctx.login(ctx.ids["user_a"])
    ev = ctx.ids["event_a"]
    # Subscribe to a DIFFERENT event type only.
    await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "https://example.com/hook", "event_types": ["rsvp.confirmed"],
    })
    await ctx.client.post(f"/api/events/{ev}/guests", json={"first_name": "Bo", "last_name": "B"})

    async with _Session() as s:
        rows = (await s.execute(select(WebhookDelivery))).scalars().all()
        assert not any(r.event_type == "guest.created" for r in rows)


def test_signature_is_deterministic_hmac_sha256():
    body = b'{"event_type":"guest.created","data":{}}'
    sig1 = webhook_outbox.sign_payload("s3cr3t", body)
    sig2 = webhook_outbox.sign_payload("s3cr3t", body)
    assert sig1 == sig2
    assert webhook_outbox.sign_payload("different", body) != sig1


@pytest.mark.asyncio
async def test_process_due_delivers_successfully_and_signs_request(ctx):
    ctx.login(ctx.ids["user_a"])
    created = await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "https://example.com/hook", "event_types": ["guest.created"],
    })
    secret = created.json()["secret"]
    hook_id = created.json()["id"]

    async with _Session() as s:
        s.add(WebhookDelivery(endpoint_id=hook_id, event_type="guest.created",
                               payload=json.dumps({"event_type": "guest.created", "data": {"guest_id": "g1"}})))
        await s.commit()

    captured = {}
    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200)

    delivered = await webhook_outbox.process_due(transport=httpx.MockTransport(handler))
    assert delivered == 1
    sent = captured["request"]
    assert sent.headers["X-Festio-Event-Type"] == "guest.created"
    expected_sig = webhook_outbox.sign_payload(secret, sent.content)
    assert sent.headers["X-Festio-Signature"] == f"sha256={expected_sig}"

    async with _Session() as s:
        row = (await s.execute(select(WebhookDelivery))).scalars().one()
        assert row.status == "delivered"
        assert row.delivered_at is not None


@pytest.mark.asyncio
async def test_process_due_retries_on_failure_with_backoff(ctx):
    ctx.login(ctx.ids["user_a"])
    created = await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "https://example.com/hook", "event_types": ["guest.created"],
    })
    async with _Session() as s:
        s.add(WebhookDelivery(endpoint_id=created.json()["id"], event_type="guest.created",
                               payload=json.dumps({"event_type": "guest.created", "data": {}})))
        await s.commit()

    handler = lambda request: httpx.Response(500)
    await webhook_outbox.process_due(transport=httpx.MockTransport(handler))

    async with _Session() as s:
        row = (await s.execute(select(WebhookDelivery))).scalars().one()
        assert row.status == "pending"   # still retrying
        assert row.attempt_count == 1
        assert row.next_attempt_at > datetime.utcnow()   # backed off into the future


@pytest.mark.asyncio
async def test_process_due_gives_up_after_max_attempts(ctx):
    ctx.login(ctx.ids["user_a"])
    created = await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "https://example.com/hook", "event_types": ["guest.created"],
    })
    async with _Session() as s:
        s.add(WebhookDelivery(
            endpoint_id=created.json()["id"], event_type="guest.created",
            payload=json.dumps({"event_type": "guest.created", "data": {}}),
            attempt_count=webhook_outbox.MAX_ATTEMPTS - 1,
        ))
        await s.commit()

    handler = lambda request: httpx.Response(500)
    await webhook_outbox.process_due(transport=httpx.MockTransport(handler))

    async with _Session() as s:
        row = (await s.execute(select(WebhookDelivery))).scalars().one()
        assert row.status == "failed"
        assert row.attempt_count == webhook_outbox.MAX_ATTEMPTS


@pytest.mark.asyncio
async def test_deliveries_endpoint_lists_history(ctx):
    ctx.login(ctx.ids["user_a"])
    created = await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "https://example.com/hook", "event_types": ["guest.created"],
    })
    hook_id = created.json()["id"]
    async with _Session() as s:
        s.add(WebhookDelivery(endpoint_id=hook_id, event_type="guest.created", payload="{}", status="delivered"))
        await s.commit()

    listing = await ctx.client.get(f"/api/organizations/me/webhooks/{hook_id}/deliveries")
    assert listing.status_code == 200
    assert len(listing.json()) == 1
    assert listing.json()[0]["status"] == "delivered"
