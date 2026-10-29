import asyncio
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

from app import main
from app.auth import Identity
from app.provider_errors import stripe_onboarding_error
from app.schemas import StripeAccountIn


@pytest.mark.parametrize("step", ["create", "link"])
def test_onboarding_exposes_provider_reason_and_reference(monkeypatch, caplog, step):
    response = httpx.Response(400, headers={"request-id": "req_Example123"}, json={
        "error": {"code": "account_create_activation_required", "message":
                  "Activate Connect before creating accounts for Academy and owner@example.com."}})
    client = AsyncMock()
    client.post.return_value = response
    context = AsyncMock()
    context.__aenter__.return_value = client
    monkeypatch.setattr(main.httpx, "AsyncClient", lambda **kwargs: context)
    monkeypatch.setattr(main, "provider_ready", lambda name: True)
    db = AsyncMock()
    async def run():
        with pytest.raises(HTTPException) as caught:
            if step == "create":
                await main.create_stripe_account("event", StripeAccountIn(
                    business_name="Academy", email="owner@example.com", country="US"),
                    Identity("admin", "event", "org", "admin"), db)
            else:
                await main.stripe_account_link("acct_example")
        assert caught.value.status_code == 502
        assert "Activate Connect" in caught.value.detail
        assert "account_create_activation_required" in caught.value.detail
        assert "req_Example123" in caught.value.detail
        assert "owner@example.com" not in caught.value.detail
        if step == "create":
            assert "Academy" not in caught.value.detail
        db.commit.assert_not_awaited()
    asyncio.run(run())
    assert "owner@example.com" not in caplog.text


@pytest.mark.parametrize("body", [b"upstream unavailable", b'{"error":null}', b'{"error":{"message":42}}'])
def test_malformed_error_has_safe_fallback(body):
    error = stripe_onboarding_error(httpx.Response(502, content=body), "create payout account")
    assert error.status_code == 502
    assert "Stripe did not provide an error description" in error.detail


def test_credentials_and_unsafe_reference_are_redacted():
    error = stripe_onboarding_error(httpx.Response(400, json={"error": {
        "message": "Invalid key sk_live_Secret123 for owner@example.com", "code": "unsafe\nvalue"}},
        headers={"request-id": "invalid reference"}), "create payout account")
    assert "Secret123" not in error.detail
    assert "owner@example.com" not in error.detail
    assert "unsafe" not in error.detail
    assert "invalid reference" not in error.detail
