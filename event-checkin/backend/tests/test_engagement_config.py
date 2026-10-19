"""Isolated engagement controls keep safe defaults and stable environment names."""
import pytest

from app.engagement_config import EngagementSettings, engagement_settings


DEFAULTS = {
    "marketing_outbox_enabled": False,
    "prospect_ingress_enabled": False,
    "sales_responses_enabled": False,
    "meta_whatsapp_app_secret": "",
    "meta_whatsapp_sales_phone_number_id": "",
    "meta_whatsapp_webhook_verify_token": "",
    "prospect_chatwoot_webhook_token": "",
    "prospect_chatwoot_account_id": "",
    "prospect_chatwoot_inbox_id": "",
    "prospect_email_recipients": "",
}


@pytest.fixture
def clean_engagement_environment(monkeypatch):
    for field in DEFAULTS:
        monkeypatch.delenv(field.upper(), raising=False)
        monkeypatch.delenv(field, raising=False)


def test_engagement_defaults_are_off_and_unconfigured(clean_engagement_environment):
    settings = EngagementSettings(_env_file=None)
    assert settings.model_dump() == DEFAULTS
    assert set(EngagementSettings.model_fields) == set(DEFAULTS)


def test_engagement_uses_existing_environment_names(clean_engagement_environment, monkeypatch):
    expected = {field: True if isinstance(default, bool) else f"test-{field}" for field, default in DEFAULTS.items()}
    for field, value in expected.items():
        monkeypatch.setenv(field.upper(), "true" if value is True else value)
    assert EngagementSettings(_env_file=None).model_dump() == expected
    monkeypatch.setenv("MARKETING_OUTBOX_ENABLED", "false")
    monkeypatch.setenv("PROSPECT_INGRESS_ENABLED", "false")
    settings = EngagementSettings(_env_file=None)
    assert settings.marketing_outbox_enabled is False
    assert settings.prospect_ingress_enabled is False


def test_engagement_dotenv_loading_ignores_unrelated_settings(clean_engagement_environment, monkeypatch, tmp_path):
    # Synthetic test-only values, never the deployment's dotenv or credentials.
    config_file = tmp_path / "engagement-test-settings.env"
    config_file.write_text(
        "MARKETING_OUTBOX_ENABLED=true\nPROSPECT_INGRESS_ENABLED=true\n"
        "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN=test-verification\n"
        "PROSPECT_EMAIL_RECIPIENTS=sales@example.com\n"
        "UNRELATED_APPLICATION_SETTING=ignored\n"
    )
    settings = EngagementSettings(_env_file=config_file)
    assert settings.marketing_outbox_enabled is True
    assert settings.prospect_ingress_enabled is True
    assert settings.meta_whatsapp_webhook_verify_token == "test-verification"
    assert settings.prospect_email_recipients == "sales@example.com"
    assert not hasattr(settings, "unrelated_application_setting")
    # Standard BaseSettings precedence: environment overrides dotenv.
    monkeypatch.setenv("MARKETING_OUTBOX_ENABLED", "false")
    assert EngagementSettings(_env_file=config_file).marketing_outbox_enabled is False


async def test_meta_verification_never_falls_back_to_legacy_default(ctx, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "meta_whatsapp_webhook_verify_token", "legacy-test-value")
    monkeypatch.setattr(engagement_settings, "meta_whatsapp_webhook_verify_token", "")
    response = await ctx.client.get("/api/webhooks/whatsapp/meta", params={
        "hub.mode": "subscribe", "hub.verify_token": "legacy-test-value", "hub.challenge": "123",
    })
    assert response.status_code == 403
