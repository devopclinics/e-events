from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from unittest.mock import AsyncMock

import pytest

from app.config import settings
from services import email_service, messaging
from services.outbound_safety import recipient_allowed


@pytest.fixture(autouse=True)
def recipient_guard(monkeypatch):
    monkeypatch.setattr(settings, "outbound_recipient_safety_enabled", True)
    monkeypatch.setattr(settings, "outbound_allowed_emails", "synthetic.qa@example.test")
    monkeypatch.setattr(settings, "outbound_allowed_phones", "+15550001111")


def test_guard_fails_closed_for_staging_non_allowlisted_recipients():
    assert recipient_allowed("email", "customer@example.com") is False
    assert recipient_allowed("email", "synthetic.qa@example.test, customer@example.com") is False
    assert recipient_allowed("sms", "+1 (555) 999-9999") is False
    assert recipient_allowed("whatsapp", "whatsapp:+15559999999") is False


def test_guard_allows_only_normalized_synthetic_recipients():
    assert recipient_allowed("email", "Synthetic QA <SYNTHETIC.QA@example.test>") is True
    assert recipient_allowed("sms", "+1 (555) 000-1111") is True
    assert recipient_allowed("whatsapp", "whatsapp:+15550001111") is True


@pytest.mark.asyncio
async def test_email_provider_is_not_called_for_denied_recipient(monkeypatch):
    provider = AsyncMock()
    delivery = AsyncMock()
    charge = AsyncMock(return_value=True)
    monkeypatch.setattr(settings, "resend_api_key", "test-provider-key")
    monkeypatch.setattr(email_service, "_send_via_resend", provider)
    monkeypatch.setattr(email_service, "_record_email_delivery", delivery)
    monkeypatch.setattr(email_service, "_charge_email_credit", charge)
    msg = MIMEMultipart("alternative")
    msg["To"] = "customer@example.com"
    msg["Subject"] = "Blocked staging send"
    msg.attach(MIMEText("test", "plain"))

    await email_service._send(msg)

    provider.assert_not_awaited()
    charge.assert_not_awaited()
    assert delivery.await_args.kwargs["status"] == "blocked_recipient_safety"


@pytest.mark.asyncio
async def test_email_provider_receives_allowed_synthetic_recipient(monkeypatch):
    provider = AsyncMock(return_value={"id": "synthetic-send"})
    delivery = AsyncMock()
    charge = AsyncMock(return_value=True)
    monkeypatch.setattr(settings, "resend_api_key", "test-provider-key")
    monkeypatch.setattr(email_service, "_send_via_resend", provider)
    monkeypatch.setattr(email_service, "_record_email_delivery", delivery)
    monkeypatch.setattr(email_service, "_charge_email_credit", charge)
    msg = MIMEMultipart("alternative")
    msg["To"] = "synthetic.qa@example.test"
    msg["Subject"] = "Allowed staging send"
    msg.attach(MIMEText("test", "plain"))

    await email_service._send(msg)

    provider.assert_awaited_once()
    charge.assert_awaited_once()


@pytest.mark.asyncio
async def test_sms_provider_boundary_denies_customer_and_allows_synthetic(monkeypatch):
    provider = AsyncMock(return_value={"status": "queued"})
    monkeypatch.setattr(settings, "messaging_provider", "signalhouse")
    monkeypatch.setattr(settings, "signalhouse_api_key", "test-key")
    monkeypatch.setattr(settings, "signalhouse_from_number", "+15550002222")
    monkeypatch.setattr(messaging, "_signalhouse_request", provider)

    await messaging.send_custom_sms(phone="+15559999999", body="must not send")
    provider.assert_not_awaited()

    await messaging.send_custom_sms(phone="+15550001111", body="synthetic only")
    provider.assert_awaited_once()
