from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://checkin:checkin@localhost/checkin"
    frontend_url: str = "http://localhost:5173"
    # Extra CORS origins (comma-separated) on top of frontend_url + the Capacitor
    # native WebView origins. Set to add e.g. a staging URL.
    cors_extra_origins: str = ""
    design_service_url: str = "http://design-service:8010"
    design_internal_token: str = ""

    # Firebase — paste the service account JSON as a single-line string
    firebase_credentials: str = ""

    # Comma-separated emails granted platform-superadmin (operator/support) on
    # sign-in. Cross-tenant access; keep this to your own operator accounts.
    superadmin_emails: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_tls: bool = True
    email_from: str = "Festio <events@festio.events>"
    # If set, email is sent via the Resend HTTP API instead of SMTP.
    resend_api_key: str = ""
    # If set, email is sent via Bird's Email API before falling back to SMTP.
    # Example: https://email.us-west-2.api.bird.com/api
    bird_email_api_base: str = ""
    bird_email_channel_id: str = ""

    # Messaging provider switch: 'bird' | 'twilio' | '' (off)
    messaging_provider: str = ""
    # Optional per-channel override for WhatsApp (e.g. SMS via ClickSend but
    # WhatsApp via Bird). Falls back to messaging_provider when empty.
    whatsapp_provider: str = ""

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
    bird_whatsapp_invite_template: str = ""           # Bird WhatsApp template NAME for invite (e.g. event_invite_utility)
    bird_whatsapp_rsvp_invitation_template: str = ""  # Bird WhatsApp template NAME for RSVP invite
    bird_whatsapp_rsvp_reminder_template: str = ""    # Bird WhatsApp template NAME for RSVP reminder
    bird_whatsapp_rsvp_confirmation_template: str = ""# Bird WhatsApp template NAME for RSVP confirmation
    bird_whatsapp_rsvp_decline_template: str = ""     # Bird WhatsApp template NAME for RSVP decline
    bird_whatsapp_approval_pending_template: str = "" # Bird WhatsApp template NAME for approval pending
    bird_whatsapp_approval_accepted_template: str = ""# Bird WhatsApp template NAME for approval accepted
    bird_whatsapp_approval_rejected_template: str = ""# Bird WhatsApp template NAME for approval rejected
    bird_whatsapp_admission_template: str = ""        # Bird WhatsApp template NAME for admission (e.g. event_admmision_utility)
    bird_whatsapp_logistics_template: str = ""        # Bird WhatsApp template NAME for logistics notification
    bird_whatsapp_registry_template: str = ""         # Bird WhatsApp template NAME for registry message
    bird_mms_channel_id: str = ""                     # Bird MMS channel (image-capable)

    meta_whatsapp_webhook_verify_token: str = "festio-whatsapp-webhook"

    # ClickSend (MMS-capable provider used in prod). Empty = disabled.
    clicksend_username: str = ""
    clicksend_api_key: str = ""
    clicksend_from: str = ""

    # ── Billing (Phase 3) — Event Pass checkout. Empty = provider disabled. ──
    # Public base used to build checkout return URLs (defaults to frontend_url).
    public_base_url: str = ""
    stripe_secret_key: str = ""        # sk_live_... / sk_test_...
    stripe_webhook_secret: str = ""    # whsec_...
    paystack_secret_key: str = ""      # sk_live_... / sk_test_...
    # Enable Stripe Tax on checkout (requires Stripe Tax activated in dashboard).
    stripe_tax_enabled: bool = False

    class Config:
        env_file = ".env"
        extra = "ignore"  # tolerate unknown keys in .env / environment


settings = Settings()
