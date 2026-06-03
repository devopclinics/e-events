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

    # Messaging provider switch: 'bird' | 'twilio' | '' (off)
    messaging_provider: str = ""

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    twilio_whatsapp_from: str = ""                    # e.g. "whatsapp:+14155238886" (sandbox) or your prod sender
    twilio_whatsapp_invite_template_sid: str = ""     # Content SID for invite template (prod only)
    twilio_whatsapp_admission_template_sid: str = ""  # Content SID for admission template (prod only)

    bird_access_key: str = ""
    bird_workspace_id: str = ""
    bird_sms_channel_id: str = ""
    bird_whatsapp_channel_id: str = ""
    bird_whatsapp_invite_template: str = ""           # Bird template name or project ID for invite
    bird_whatsapp_admission_template: str = ""        # Bird template name or project ID for admission

    class Config:
        env_file = ".env"


settings = Settings()
