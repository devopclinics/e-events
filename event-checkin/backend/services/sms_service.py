import logging

from app.config import settings

logger = logging.getLogger(__name__)


def send_admission_sms(guest_data: dict):
    if not settings.twilio_account_sid:
        logger.warning("Twilio not configured — skipping SMS to %s", guest_data.get("phone"))
        return
    try:
        from twilio.rest import Client

        admitted_time = guest_data["admitted_at"].strftime("%H:%M") if guest_data.get("admitted_at") else ""
        body = (
            f"Hi {guest_data['first_name']}! You have been admitted to the event."
            + (f" Check-in time: {admitted_time}." if admitted_time else "")
            + " Welcome!"
        )
        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        client.messages.create(
            body=body,
            from_=settings.twilio_from_number,
            to=guest_data["phone"],
        )
    except Exception:
        logger.exception("Failed to send SMS to %s", guest_data.get("phone"))
