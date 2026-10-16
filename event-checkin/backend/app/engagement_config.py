"""Opt-in engagement configuration, separate from legacy application settings.

Keep rollout controls and new ingress configuration isolated so this module
contains no legacy database/account defaults. Existing environment names and
dotenv loading remain compatible with deployment configuration.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class EngagementSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    marketing_outbox_enabled: bool = False
    prospect_ingress_enabled: bool = False
    meta_whatsapp_app_secret: str = ""
    meta_whatsapp_sales_phone_number_id: str = ""
    meta_whatsapp_webhook_verify_token: str = ""
    prospect_chatwoot_webhook_token: str = ""
    prospect_chatwoot_account_id: str = ""
    prospect_chatwoot_inbox_id: str = ""
    prospect_email_recipients: str = ""


engagement_settings = EngagementSettings()
