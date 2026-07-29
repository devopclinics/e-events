import logging

from app.config import settings

logger = logging.getLogger(__name__)


def send_admission_sms(guest_data: dict):
    phone = guest_data.get("phone") or ""

    # Route Nigerian numbers through xwireless regardless of Twilio config.
    if phone and (phone.lstrip("+").startswith("234")) and settings.xwireless_api_key and settings.xwireless_client_id:
        _send_via_xwireless(guest_data, phone)
        return

    if not settings.twilio_account_sid:
        logger.warning("Twilio not configured — skipping SMS to %s", phone)
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
            to=phone,
        )
    except Exception:
        logger.exception("Failed to send SMS to %s", phone)


def _send_via_xwireless(guest_data: dict, phone: str):
    """Synchronous wrapper for xwireless admission SMS (for legacy callers)."""
    import httpx

    admitted_time = guest_data["admitted_at"].strftime("%H:%M") if guest_data.get("admitted_at") else ""
    body = (
        f"Festio: Hi {guest_data['first_name']}! You have been admitted to the event."
        + (f" Check-in time: {admitted_time}." if admitted_time else "")
        + " Welcome!"
    )
    mobile = phone.lstrip("+")
    try:
        resp = httpx.post(
            f"{settings.xwireless_base_url.rstrip('/')}/api/v2/SendSMS",
            json={
                "apiKey": settings.xwireless_api_key,
                "clientId": settings.xwireless_client_id,
                "senderId": settings.xwireless_sender_id or "FESTIO",
                "mobileNumbers": mobile,
                "message": body,
                "is_Unicode": False,
                "is_Flash": False,
                "dataCoding": 0,
            },
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("errorCode", -1) != 0:
            logger.warning("xwireless admission SMS error %s: %s (to=%s)", data.get("errorCode"), data.get("errorDescription"), phone)
    except Exception:
        logger.exception("xwireless admission SMS failed (to=%s)", phone)
