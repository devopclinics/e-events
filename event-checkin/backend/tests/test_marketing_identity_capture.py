"""Backend lifecycle events carry explicit provenance, never guessed trust."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.models import MarketingOutbox
from app.services import marketing_client
from conftest import _Session


def user():
    return SimpleNamespace(id="local-user", firebase_uid="known-uid", email="owner@example.com", name="Owner", email_verified=True)


@pytest.mark.parametrize("value", [False, None, 1, "true", {}, []])
async def test_helper_requires_literal_true_not_user_or_truthy_fields(ctx, value):
    async with _Session() as db:
        await marketing_client.ingest_marketing_lead(db, user(), email_verified=value, event_id="proof-test")
        await db.commit()
        row = await db.get(MarketingOutbox, "proof-test")
        assert row.payload["email_verified"] is False


async def test_helper_defaults_safe_and_protects_authoritative_identity(ctx):
    async with _Session() as db:
        await marketing_client.ingest_marketing_lead(db, user(), event_id="identity-default",
            email="victim@example.com", festio_user_id="victim-uid", name="Spoofed")
        await db.commit()
        row = await db.get(MarketingOutbox, "identity-default")
        assert row.payload["email_verified"] is False
        assert row.payload["email"] == "owner@example.com"
        assert row.payload["festio_user_id"] == "known-uid" and row.payload["name"] == "Owner"


async def test_helper_preserves_explicit_verified_claim(ctx):
    async with _Session() as db:
        await marketing_client.ingest_marketing_lead(db, user(), email_verified=True, event_id="verified-proof")
        await db.commit()
        assert (await db.get(MarketingOutbox, "verified-proof")).payload["email_verified"] is True


async def test_org_background_capture_never_forwards_arbitrary_verification(monkeypatch):
    db = SimpleNamespace(scalar=AsyncMock(return_value=SimpleNamespace(user_id="local-user")), get=AsyncMock(return_value=user()))
    capture = AsyncMock()
    monkeypatch.setattr(marketing_client, "enqueue_marketing_payload", capture)
    await marketing_client.ingest_org_lifecycle(db, "org-id", stage="paid", email_verified=True,
        email="victim@example.com", festio_user_id="victim-uid")
    payload = capture.await_args.args[1]
    assert payload["email_verified"] is False
    assert payload["email"] == "owner@example.com" and payload["festio_user_id"] == "known-uid"
