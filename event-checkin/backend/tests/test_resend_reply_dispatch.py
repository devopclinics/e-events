"""Offline contract tests for the single-authentication inbound dispatcher."""
import base64
import hashlib
import hmac
import json
import time

import pytest
from sqlalchemy import select

from app.config import settings
from app.engagement_config import engagement_settings
from app.models import InboundEmail, InboundEmailWebhookReceipt, MarketingOutbox
from app.routers import resend_webhooks
from app.services.prospect_ingress import event_key
from conftest import _Session
from test_auth_acquisition_capture import marketing_service

SECRET = b"dispatcher-synthetic-svix"
INTERNAL = "dispatcher-synthetic-internal"
HEX = "0123456789abcdef0123456789abcdef"


def token(lead_hex=HEX, *, secret=INTERNAL):
    signature = hmac.new(secret.encode(), f"festio-marketing-reply:v1:{lead_hex}".encode(), hashlib.sha256).digest()[:16]
    return f"v1.{lead_hex}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def address(lead_hex=HEX):
    return f"reply+{token(lead_hex)}@inbound.example.com"


def message(**data):
    return {"type": "email.received", "data": {
        "email_id": "dispatcher-email", "to": [address()],
        "from": "Owner <owner@example.com>", "subject": "unsubscribe", **data,
    }}


@pytest.fixture
def routing(monkeypatch):
    monkeypatch.setattr(settings, "resend_inbound_webhook_secret", "whsec_" + base64.b64encode(SECRET).decode())
    monkeypatch.setattr(settings, "planner_internal_token", INTERNAL)
    monkeypatch.setattr(engagement_settings, "prospect_email_recipients", "reply@inbound.example.com")
    monkeypatch.setattr(engagement_settings, "prospect_ingress_enabled", True)


async def post(ctx, value, *, svix_id="dispatcher-event", valid=True, stamp=None, raw=None, sign_secret=SECRET):
    raw = json.dumps(value).encode() if raw is None else raw
    stamp = str(int(time.time())) if stamp is None else str(stamp)
    signature = base64.b64encode(hmac.new(sign_secret, b".".join([svix_id.encode(), stamp.encode(), raw]), hashlib.sha256).digest()).decode()
    return await ctx.client.post("/api/webhooks/resend/inbound", content=raw, headers={
        "content-type": "application/json", "svix-id": svix_id, "svix-timestamp": stamp,
        "svix-signature": "v1," + (signature if valid else "forged"),
    })


async def rows(model):
    async with _Session() as db:
        return list((await db.scalars(select(model))).all())


@pytest.mark.asyncio
async def test_authenticated_dispatch_verifies_raw_body_once_and_does_not_trust_identity(ctx, routing, monkeypatch):
    original = resend_webhooks._verify_svix_signature
    calls = []
    def verify(raw, headers, secret):
        calls.append(raw)
        return original(raw, headers, secret)
    monkeypatch.setattr(resend_webhooks, "_verify_svix_signature", verify)
    value = message(identity_verified=True, festio_user_id="another-account", channel="guest")
    assert (await post(ctx, value)).status_code == 200
    assert len(calls) == 1
    outbox = await rows(MarketingOutbox)
    assert len(outbox) == 1 and outbox[0].endpoint == "conversations"
    payload = outbox[0].payload
    assert payload["identity_verified"] is False and "festio_user_id" not in payload
    assert payload["reply_token"] == token() and payload["email"] == "owner@example.com"
    assert payload["event"] == "opt_out"
    assert "subject" not in payload and not await rows(InboundEmail)


@pytest.mark.asyncio
async def test_duplicate_provider_email_and_svix_replay_capture_once(ctx, routing):
    for event_id in ["dispatcher-event", "dispatcher-event", "dispatcher-redelivery"]:
        assert (await post(ctx, message(), svix_id=event_id)).status_code == 200
    outbox = await rows(MarketingOutbox)
    assert len(outbox) == 1
    assert outbox[0].id == event_key("resend-inbound", "dispatcher-email")
    assert not await rows(InboundEmail)


@pytest.mark.asyncio
@pytest.mark.parametrize("valid,stamp", [(False, None), (True, 1), (True, 9999999999)])
async def test_invalid_signature_and_expired_replay_write_nothing(ctx, routing, valid, stamp):
    assert (await post(ctx, message(), valid=valid, stamp=stamp)).status_code == 400
    assert not await rows(MarketingOutbox) and not await rows(InboundEmail)


@pytest.mark.asyncio
@pytest.mark.parametrize("updates", [
    {"to": []}, {"to": None}, {"to": {}}, {"to": [123]},
    {"to": ["reply@inbound.example.com"]},
    {"to": ["reply+invalid@inbound.example.com"]},
    {"to": ["reply+" + token()[:-1] + "!@inbound.example.com"]},
    {"to": [address(), "consent+guest@inbound.example.com"]},
    {"to": [address(), address("a" * 32)]},
    {"to": [address()], "cc": ["consent+guest@inbound.example.com"]},
    {"to": [address() + ", consent+guest@inbound.example.com"]},
    {"to": [address()], "cc": [None]},
    {"to": [address()], "from": "a@example.com, b@example.com"},
    {"to": [address()], "from": None},
    {"email_id": None}, {"email_id": 123}, {"subject": {}},
    {"to": ["reply+" + token() + "@inbound.example.com\r\nx-test: injected"]},
])
async def test_malformed_missing_and_mixed_recipients_fail_closed(ctx, routing, updates):
    assert (await post(ctx, message(**updates))).status_code == 400
    assert not await rows(MarketingOutbox) and not await rows(InboundEmail)


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [[], None, "string", {"type": "email.received", "data": []}, {"type": "email.received"}])
async def test_malformed_provider_event_fails_closed(ctx, routing, value):
    assert (await post(ctx, value)).status_code == 400
    assert not await rows(MarketingOutbox) and not await rows(InboundEmail)


@pytest.mark.asyncio
async def test_invalid_utf8_fails_closed(ctx, routing):
    assert (await post(ctx, None, raw=b"\xff")).status_code == 400
    assert not await rows(MarketingOutbox)


@pytest.mark.asyncio
async def test_prospect_gate_disabled_does_not_reclassify_as_guest(ctx, routing, monkeypatch):
    monkeypatch.setattr(engagement_settings, "prospect_ingress_enabled", False)
    assert (await post(ctx, message())).status_code == 503
    assert not await rows(MarketingOutbox) and not await rows(InboundEmail)
    assert (await post(ctx, message(to=["consent+unknown@inbound.example.com"]), svix_id="guest")).status_code == 200
    guest = await rows(InboundEmail)
    assert len(guest) == 1 and guest[0].failure_code == "unknown_inbound_token"


@pytest.mark.asyncio
async def test_existing_guest_authority_fallback_is_not_extended_to_prospects(ctx, routing, monkeypatch):
    monkeypatch.setattr(settings, "resend_inbound_webhook_secret", "")
    monkeypatch.setattr(settings, "resend_webhook_secret", "whsec_" + base64.b64encode(SECRET).decode())
    assert (await post(ctx, message())).status_code == 503
    assert (await post(ctx, message(to=["consent+unknown@inbound.example.com"]))).status_code == 200
    assert not await rows(MarketingOutbox) and len(await rows(InboundEmail)) == 1


@pytest.mark.asyncio
async def test_exact_domain_and_untrusted_body_cannot_reclassify_guest(ctx, routing):
    value = message(to=[address().replace("@inbound.example.com", "@other.example.com")],
                    identity_verified=True, reply_token=token(), recipient=address(), channel="email")
    assert (await post(ctx, value)).status_code == 200
    assert not await rows(MarketingOutbox)
    assert len(await rows(InboundEmail)) == 1


@pytest.mark.asyncio
async def test_case_sensitive_token_domain_case_insensitive_and_duplicate_recipient(ctx, routing):
    recipient = address().replace("@inbound.example.com", "@INBOUND.EXAMPLE.COM")
    assert (await post(ctx, message(to=[recipient, recipient]))).status_code == 200
    assert (await rows(MarketingOutbox))[0].payload["reply_token"] == token()


@pytest.mark.asyncio
@pytest.mark.parametrize("secret", ["", " ", chr(9)])
async def test_missing_internal_signing_authority_fails_closed(ctx, routing, monkeypatch, secret):
    monkeypatch.setattr(settings, "planner_internal_token", secret)
    crafted = f"reply+{token(secret=secret)}@inbound.example.com"
    assert (await post(ctx, message(to=[crafted]))).status_code == 400
    assert not await rows(MarketingOutbox) and not await rows(InboundEmail)

@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["to", "cc"])
@pytest.mark.parametrize("malformed", [{}, 0, False])
async def test_falsey_nonrecipient_fields_are_rejected(ctx, routing, field, malformed):
    assert (await post(ctx, message(**{field: malformed}))).status_code == 400
    assert not await rows(MarketingOutbox) and not await rows(InboundEmail)


@pytest.mark.asyncio
@pytest.mark.parametrize("cc_kind", ["absent", "null", "empty_list"])
async def test_legacy_guest_optional_cc_preserves_guest_path_and_receipts(ctx, routing, monkeypatch, cc_kind):
    calls = []
    original = resend_webhooks._inbound_token
    def guest_token(recipients):
        calls.append(recipients)
        return original(recipients)
    monkeypatch.setattr(resend_webhooks, "_inbound_token", guest_token)
    value = message(to=["consent+unknown@inbound.example.com"])
    if cc_kind != "absent":
        value["data"]["cc"] = None if cc_kind == "null" else []
    for receipt_id in ["guest-first", "guest-first", "guest-redelivery"]:
        assert (await post(ctx, value, svix_id=receipt_id)).status_code == 200
    assert calls == [["consent+unknown@inbound.example.com"]]
    guests = await rows(InboundEmail)
    receipts = await rows(InboundEmailWebhookReceipt)
    assert len(guests) == 1 and guests[0].processing_status == "invalid"
    assert guests[0].failure_code == "unknown_inbound_token" and guests[0].cc_addresses == []
    assert len(receipts) == 2 and sum(bool(row.is_duplicate) for row in receipts) == 1
    assert not await rows(MarketingOutbox)


@pytest.mark.asyncio
@pytest.mark.parametrize("secret", ["", " ", chr(9)])
async def test_missing_or_blank_receiving_authority_cannot_accept_prospect(ctx, routing, monkeypatch, secret):
    monkeypatch.setattr(settings, "resend_inbound_webhook_secret", secret)
    monkeypatch.setattr(settings, "resend_webhook_secret", "whsec_" + base64.b64encode(SECRET).decode())
    # Empty settings use the existing guest fallback. Whitespace decodes as an
    # empty Svix key in the unchanged legacy verifier: prospect dispatch must
    # still reject it, even with an otherwise matching synthetic signature.
    signing = SECRET if not secret else b""
    assert (await post(ctx, message(), sign_secret=signing)).status_code == 503
    assert not await rows(MarketingOutbox) and not await rows(InboundEmail)


@pytest.mark.asyncio
async def test_actual_marketing_token_matches_backend_and_dispatch_round_trip(ctx, routing, marketing_service, monkeypatch):
    import importlib
    module, client = marketing_service
    reply = importlib.import_module(module.__package__ + ".reply_routing")
    monkeypatch.setattr(settings, "planner_internal_token", module.TOKEN_SECRET)
    result = client.post("/api/marketing/internal/ingest", json={
        "event_id": "shared-key:lead", "festio_user_id": "synthetic-owner",
        "email": "owner@example.com", "email_verified": True, "consent_email": True,
    })
    assert result.status_code == 200
    lead = result.json()
    actual_token = reply.make_reply_token(lead["id"], module.TOKEN_SECRET)
    from app.services.resend_inbound_routing import _valid_token
    assert _valid_token(actual_token)
    assert reply.verify_reply_token(actual_token, settings.planner_internal_token) == lead["id"]
    tag_start = actual_token.rfind(".") + 1
    letter = next(i for i in range(tag_start, len(actual_token)) if actual_token[i].isalpha())
    changed_case = actual_token[:letter] + actual_token[letter].swapcase() + actual_token[letter + 1:]
    assert not _valid_token(changed_case)
    forged = actual_token[:-1] + ("A" if actual_token[-1] != "A" else "B")
    assert not _valid_token(forged)
    value = message(to=[f"reply+{actual_token}@inbound.example.com"],
                    identity_verified=True, festio_user_id="attacker-account",
                    account_id="attacker-account", reply_token="attacker-token")
    value["identity_verified"] = True
    value["festio_user_id"] = "attacker-account"
    assert (await post(ctx, value)).status_code == 200
    payload = (await rows(MarketingOutbox))[0].payload
    assert payload["identity_verified"] is False
    assert not any(key in payload for key in ["festio_user_id", "account_id"])
    assert payload["reply_token"] == actual_token
    accepted = client.post("/api/marketing/internal/conversations", json=payload)
    replay = client.post("/api/marketing/internal/conversations", json=payload)
    assert accepted.status_code == replay.status_code == 200
    assert accepted.json()["lead_id"] == lead["id"] and replay.json()["duplicate"]
    with module.SessionLocal() as db:
        row = db.get(module.Lead, lead["id"])
        assert row.festio_user_id == "synthetic-owner" and row.automation_paused
        assert row.unsubscribed and not row.consent_email


@pytest.mark.asyncio
@pytest.mark.parametrize("secret", ["", " ", chr(9)])
async def test_actual_marketing_and_backend_reject_blank_reply_keys(ctx, routing, marketing_service, monkeypatch, secret):
    import importlib
    module, client = marketing_service
    reply = importlib.import_module(module.__package__ + ".reply_routing")
    monkeypatch.setattr(settings, "planner_internal_token", secret)
    monkeypatch.setattr(module, "TOKEN_SECRET", secret)
    lead_id = "01234567-89ab-cdef-0123-456789abcdef"
    crafted = token(secret=secret)
    from app.services.resend_inbound_routing import _valid_token
    assert reply.make_reply_token(lead_id, module.TOKEN_SECRET) is None
    assert reply.verify_reply_token(crafted, settings.planner_internal_token) is None
    assert not _valid_token(crafted)
    rejected = client.post("/api/marketing/internal/conversations", json={
        "event_id": "blank-key:reply", "channel": "email", "email": "owner@example.com",
        "reply_token": crafted, "identity_verified": True, "festio_user_id": "attacker",
    })
    assert rejected.status_code == 403
