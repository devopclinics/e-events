from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://checkin:checkin@localhost/checkin"
    frontend_url: str = "http://localhost:5173"

    # Firebase — paste the service account JSON as a single-line string
    firebase_credentials: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_tls: bool = True
    email_from: str = "noreply@event.com"

    # SMS/MMS provider: 'bird' | 'twilio' | 'sns' | 'clicksend' | '' (off)
    messaging_provider: str = ""
    # WhatsApp provider (separate from SMS): 'meta' | 'bird' | 'twilio' | '' (off)
    whatsapp_provider: str = ""

    clicksend_username: str = ""
    clicksend_api_key: str = ""
    clicksend_from: str = ""  # optional sender name or number (alphanumeric in NG, number in US)

    # AWS SNS (SMS only — no WhatsApp)
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    aws_sns_sender_id: str = ""   # Optional alphanumeric sender ID (e.g. "EventQR")

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    twilio_whatsapp_from: str = ""                    # e.g. "whatsapp:+14155238886" (sandbox) or your prod sender
    twilio_whatsapp_invite_template_sid: str = ""     # Content SID for invite template (prod only)
    twilio_whatsapp_admission_template_sid: str = ""  # Content SID for admission template (prod only)

    # Meta WhatsApp Cloud API
    meta_whatsapp_token: str = ""          # Permanent or temporary access token
    meta_phone_number_id: str = ""         # Phone Number ID from Meta dashboard
    meta_waba_id: str = ""                 # WhatsApp Business Account ID
    meta_wa_invite_template: str = ""      # Approved template name for invites
    meta_wa_admission_template: str = ""   # Approved template name for admission
    meta_wa_language: str = "en_US"        # Template language code
    meta_wa_verify_token: str = ""         # Webhook verify token (you set this, Meta sends it back)

    bird_access_key: str = ""
    bird_workspace_id: str = ""
    bird_sms_channel_id: str = ""
    bird_whatsapp_channel_id: str = ""
    bird_whatsapp_invite_template: str = ""     # Bird template project ID for invite
    bird_whatsapp_invite_version: str = ""      # Bird template published version ID for invite
    bird_whatsapp_admission_template: str = ""  # Bird template project ID for admission
    bird_whatsapp_admission_version: str = ""   # Bird template published version ID for admission

    class Config:
        env_file = ".env"


settings = Settings()
