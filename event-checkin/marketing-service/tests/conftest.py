"""Service tests use only temporary SQLite databases and stubbed transports."""
import smtplib
import os

import httpx
import pytest


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for name in list(os.environ):
        if name.startswith(("MARKETING_SALES_", "MARKETING_HANDOFF_", "MARKETING_ORGANIZER_", "MARKETING_JOURNEY_")):
            monkeypatch.delenv(name, raising=False)
    for name in (
        "RESEND_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD",
        "TURNSTILE_SECRET_KEY", "SIGNALHOUSE_API_KEY", "SIGNALHOUSE_FROM_NUMBER",
        "MARKETING_SKIP_CONSENT_CHECK", "MARKETING_OUTBOUND_ENABLED",
        "MARKETING_REPLY_DOMAIN", "MARKETING_MAX_SEND_ATTEMPTS", "MARKETING_INITIAL_DELAY_MINUTES",
        "MARKETING_SOCIAL_ENCRYPTION_KEY", "LINKEDIN_ACCESS_TOKEN", "LINKEDIN_REFRESH_TOKEN",
        "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_AUTHOR_URN",
        "META_ACCESS_TOKEN", "META_APP_ID", "META_APP_SECRET", "META_FACEBOOK_PAGE_ID",
        "META_INSTAGRAM_USER_ID", "BIRD_ACCESS_KEY", "BIRD_WORKSPACE_ID", "BIRD_WHATSAPP_CHANNEL_ID",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MARKETING_SCHEDULER_ENABLED", "false")
    monkeypatch.setenv("SIGNALHOUSE_WEBHOOK_TOKEN", "test-webhook-token")

    def reject_network(*args, **kwargs):
        raise AssertionError("Live outbound requests are forbidden in service tests")

    async def reject_async_network(*args, **kwargs):
        raise AssertionError("Live outbound requests are forbidden in service tests")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", reject_network)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", reject_async_network)
    monkeypatch.setattr(smtplib, "SMTP", reject_network)
