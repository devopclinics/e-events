"""Synthetic read-only readiness and source-provenance contracts."""
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.config import settings
from app.engagement_config import engagement_settings
from app.models import MarketingOutbox
from app.services import marketing_client
from conftest import _Session


@pytest.fixture
def readiness_config(monkeypatch):
    monkeypatch.setattr(settings, "planner_internal_token", "synthetic-readiness-key")
    monkeypatch.setattr(settings, "resend_inbound_webhook_secret", "synthetic-webhook-key")
    monkeypatch.setattr(engagement_settings, "marketing_outbox_enabled", True)
    monkeypatch.setattr(engagement_settings, "prospect_ingress_enabled", True)
    monkeypatch.setattr(engagement_settings, "prospect_email_recipients", "reply@reply.example.test")


def auth(**overrides):
    now = datetime.now(timezone.utc)
    claims = {"sub": "marketing-email-readiness", "iss": "marketing-service",
              "aud": "marketing-email-readiness", "jti": "a" * 32, "iat": now, "exp": now + timedelta(seconds=30),
              **overrides}
    return {"Authorization": "Bearer " + jwt.encode(claims, settings.planner_internal_token,
                                                    algorithm="HS256")}


async def test_readiness_is_read_only_and_ready_only_with_reconciled_outbox(ctx, readiness_config):
    response = await ctx.client.get("/api/internal/marketing/email-readiness",
                                    params={"reply_domain": "reply.example.test", "challenge": "a" * 32}, headers=auth())
    assert response.status_code == 200
    assert response.json()["ready"] is True
    assert response.json()["pending"] == response.json()["failed"] == 0
    proof = jwt.decode(response.json()["proof"], settings.planner_internal_token,
                       algorithms=["HS256"], audience="marketing-email-readiness-response",
                       issuer="festio-backend")
    assert proof["jti"] == "a" * 32 and proof["ready"] is True
    assert proof["pending"] == proof["failed"] == 0
    async with _Session() as db:
        assert await db.get(MarketingOutbox, "does-not-exist") is None


@pytest.mark.parametrize("status", ["pending", "retry", "failed", "unknown"])
async def test_any_unreconciled_event_blocks_including_historical_backlog(ctx, readiness_config, status):
    async with _Session() as db:
        db.add(MarketingOutbox(id="synthetic-old-stop", endpoint="delivery", payload={},
                              status=status, created_at=datetime(2020, 1, 1)))
        await db.commit()
    response = await ctx.client.get("/api/internal/marketing/email-readiness",
                                    params={"reply_domain": "reply.example.test", "challenge": "a" * 32}, headers=auth())
    assert response.status_code == 200 and response.json()["ready"] is False
    assert response.json()["failed" if status not in {"pending", "retry"} else "pending"] == 1
    async with _Session() as db:
        assert (await db.get(MarketingOutbox, "synthetic-old-stop")).status == status


@pytest.mark.parametrize("missing", ["recipient", "signature", "ingress", "outbox"])
async def test_reply_readiness_requires_all_existing_routes(ctx, readiness_config, monkeypatch, missing):
    if missing == "recipient":
        monkeypatch.setattr(engagement_settings, "prospect_email_recipients", "different@example.test")
    elif missing == "signature":
        monkeypatch.setattr(settings, "resend_inbound_webhook_secret", "")
    else:
        monkeypatch.setattr(engagement_settings,
                            "prospect_ingress_enabled" if missing == "ingress" else "marketing_outbox_enabled",
                            False)
    response = await ctx.client.get("/api/internal/marketing/email-readiness",
                                    params={"reply_domain": "reply.example.test", "challenge": "a" * 32}, headers=auth())
    assert response.json()["ready"] is False and response.json()["reply_routing_ready"] is False


@pytest.mark.parametrize("bad", ["missing", "wrong_audience", "expired", "wrong_subject"])
async def test_readiness_has_purpose_bound_authentication(ctx, readiness_config, bad):
    headers = {} if bad == "missing" else auth(**{
        "wrong_audience": {"aud": "marketing"}, "expired": {"exp": datetime.now(timezone.utc) - timedelta(seconds=1)},
        "wrong_subject": {"sub": "ordinary-user"},
    }[bad])
    response = await ctx.client.get("/api/internal/marketing/email-readiness",
                                    params={"reply_domain": "reply.example.test", "challenge": "a" * 32}, headers=headers)
    assert response.status_code == (401 if bad == "missing" else 403)


async def test_source_proof_comes_from_owner_membership_and_account_creation(ctx):
    user = ctx.ids["user_a"]
    async with _Session() as db:
        await marketing_client.ingest_marketing_lead(
            db, user, email_verified=True, event_id="synthetic-source-proof",
            organizer_account=False, account_registered_at="2000-01-01T00:00:00Z")
        await db.commit()
        payload = (await db.get(MarketingOutbox, "synthetic-source-proof")).payload
        assert payload["organizer_account"] is True
        assert payload["account_registered_at"] == user.created_at.isoformat()
        assert payload["email_verified"] is True

async def test_readiness_response_cannot_be_requested_for_another_challenge(ctx, readiness_config):
    response = await ctx.client.get("/api/internal/marketing/email-readiness",
                                    params={"reply_domain": "reply.example.test", "challenge": "b" * 32},
                                    headers=auth())
    assert response.status_code == 403

@pytest.mark.parametrize("recipient", [
    "reply@reply.example.test;other@example.test",
    "reply@reply.example.test\\r\\n",
    "reply+not-a-base@reply.example.test",
])
async def test_readiness_uses_exact_same_recipient_parser_as_dispatcher(ctx, readiness_config, monkeypatch, recipient):
    monkeypatch.setattr(engagement_settings, "prospect_email_recipients", recipient.replace("\\\\r", "\\r").replace("\\\\n", "\\n"))
    response = await ctx.client.get("/api/internal/marketing/email-readiness",
        params={"reply_domain": "reply.example.test", "challenge": "a" * 32}, headers=auth())
    assert response.status_code == 200
    assert response.json()["ready"] is False and response.json()["reply_routing_ready"] is False

@pytest.mark.parametrize("secret", [" ", chr(9)])
async def test_blank_receiving_authority_is_not_ready(ctx, readiness_config, monkeypatch, secret):
    monkeypatch.setattr(settings, "resend_inbound_webhook_secret", secret)
    response = await ctx.client.get("/api/internal/marketing/email-readiness",
        params={"reply_domain": "reply.example.test", "challenge": "a" * 32}, headers=auth())
    assert response.status_code == 200
    assert not response.json()["ready"] and not response.json()["reply_routing_ready"]

@pytest.mark.parametrize("secret", ["", " ", chr(9)])
async def test_blank_internal_readiness_key_cannot_authenticate_or_sign(ctx, readiness_config, monkeypatch, secret):
    monkeypatch.setattr(settings, "planner_internal_token", secret)
    response = await ctx.client.get("/api/internal/marketing/email-readiness",
        params={"reply_domain": "reply.example.test", "challenge": "a" * 32}, headers=auth() if secret else {})
    assert response.status_code == 503
    assert "proof" not in response.json()
