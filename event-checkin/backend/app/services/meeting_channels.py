"""Standalone channel preflight. No provider requests or credit mutation here."""
from sqlalchemy import select, or_
from ..config import settings
from ..models import MeetingSuppression, Guest, Event, WhatsAppTemplateSubmission
from ..organization_entitlements import pass_is_active, channel_credit_units
from ..entitlements import channel_weight
from services import messaging
from services.outbound_safety import recipient_allowed, normalize_phone

TEMPLATE_VARS = {"firstName", "eventName", "message", "ticketLink"}


class SetupRequired(ValueError):
    pass


class Suppressed(ValueError):
    pass


class DefiniteRejection(ValueError):
    """Only for an adapter that proves the provider did not accept a message."""


def cost(channel, org_id):
    return channel_credit_units(channel, channel_weight(channel, org_id=org_id)) if channel != "email" else 0


async def approved_templates(db, org_id):
    rows = (await db.scalars(select(WhatsAppTemplateSubmission).where(
        WhatsAppTemplateSubmission.status == "approved",
        or_(WhatsAppTemplateSubmission.org_id == org_id, WhatsAppTemplateSubmission.is_shared.is_(True))))).all()
    return [r for r in rows if r.bird_project_id and set(r.variables or []) == TEMPLATE_VARS]


async def preflight(db, meeting, attendee, channel, recipient, data, org):
    if len(settings.meetings_signing_key) < 32:
        raise SetupRequired("Meeting response signing is not configured")
    if not recipient_allowed(channel, recipient):
        raise Suppressed("Recipient blocked by existing outbound safety policy")
    if channel == "email":
        if settings.meetings_email_transport == "smtp" and not settings.smtp_host:
            raise SetupRequired("SMTP setup required for calendar scheduling MIME")
        if settings.meetings_email_transport == "resend_attachment" and not settings.resend_api_key:
            raise SetupRequired("Resend setup required (manual calendar import only)")
        if settings.meetings_email_transport not in {"smtp", "resend_attachment"}:
            raise SetupRequired("Select a supported Meetings email transport")
        return None
    if not settings.meetings_paid_sending_enabled:
        raise SetupRequired("SMS/WhatsApp Meetings sending is disabled")
    if not settings.organization_entitlements_v2:
        raise SetupRequired("The existing organization message wallet is not enabled")
    if not pass_is_active(org):
        raise SetupRequired("An active organization pass is required for paid channels")
    consent = attendee.sms_consent if channel == "sms" else attendee.whatsapp_consent
    if not consent:
        raise Suppressed("Attendee has not consented to this channel")
    suppression = await db.scalar(select(MeetingSuppression.id).where(
        MeetingSuppression.org_id == org.id, MeetingSuppression.phone == recipient, MeetingSuppression.channel == channel))
    if suppression:
        raise Suppressed("Attendee opted out of this channel")
    # Existing event consent withdrawals must not be bypassed by a new meeting.
    legacy = (await db.execute(select(Guest.phone, Guest.sms_consent, Guest.whatsapp_consent).join(Event,
        Event.id == Guest.event_id).where(Event.org_id == org.id,
        (Guest.sms_consent.is_(False) if channel == "sms" else Guest.whatsapp_consent.is_(False))))).all()
    if any(normalize_phone(row.phone) == recipient for row in legacy):
        raise Suppressed("Existing Festio notification opt-out applies to this phone")
    if not messaging._channel_ready(channel, recipient):
        raise SetupRequired("Existing messaging provider/channel setup is unavailable")
    if channel == "whatsapp":
        if messaging._wa_provider() != "bird":
            raise SetupRequired("An approved Bird template path is required; free-text fallback is disabled")
        templates = await approved_templates(db, org.id)
        template = next((r for r in templates if r.id == data.get("whatsapp_template_id")), None)
        if not template:
            raise SetupRequired("Select an existing approved, eligible WhatsApp template")
        return template
    return None
