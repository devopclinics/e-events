"""Provider-agnostic SMS + WhatsApp dispatcher.

`MESSAGING_PROVIDER` env switch picks the backend:
  - 'bird'   → MessageBird/Bird Conversations API
  - 'twilio' → Twilio REST API
  - ''       → no-op (logs and returns)

Each function is async and never raises — failures are logged so a misconfigured
provider can't take down the invite/admission background tasks. The fan-out
in routers iterates enabled channels per event and dispatches in parallel.
"""
import asyncio
import io
import logging
from datetime import datetime

import httpx

from app.config import settings
from app.timeutil import local_hhmm

logger = logging.getLogger(__name__)

_BIRD_BASE = "https://api.bird.com"


# ── public API ────────────────────────────────────────────────────────────────

async def send_invite_sms(*, phone: str, first_name: str, event_name: str, ticket_url: str, event_date: datetime) -> None:
    if not _channel_ready("sms", phone):
        return
    date_str = event_date.strftime("%a %d %b") if event_date else ""
    body = f"Hi {first_name}! QR Code For {event_name}" + (f" on {date_str}" if date_str else "") + f". Your ticket: {ticket_url}"
    await _send_sms(phone, body)


async def send_admission_sms(*, phone: str, first_name: str, event_name: str, admitted_at, table_name: str | None, seat_number: str | None) -> None:
    if not _channel_ready("sms", phone):
        return
    parts = [f"Welcome {first_name}!", "You're checked in."]
    if admitted_at:
        parts.append(f"Time: {local_hhmm(admitted_at)}.")
    if table_name:
        seat_bit = f" seat {seat_number}" if seat_number else ""
        parts.append(f"Table: {table_name}{seat_bit}.")
    await _send_sms(phone, " ".join(parts))


async def send_invite_whatsapp(*, phone: str, first_name: str, event_name: str, ticket_url: str, event_date: datetime) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    date_str = event_date.strftime("%A, %d %B %Y") if event_date else ""
    await _send_whatsapp_template(
        phone=phone,
        kind="invite",
        params=[first_name, event_name, date_str, ticket_url],
        named_params={"firstName": first_name, "eventName": event_name, "eventDate": date_str, "ticketUrl": ticket_url},
    )


async def send_admission_whatsapp(*, phone: str, first_name: str, event_name: str, table_name: str | None, seat_number: str | None) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_template(
        phone=phone,
        kind="admission",
        params=[first_name, event_name, table_name or "—", seat_number or "—"],
        named_params={"firstName": first_name, "eventName": event_name, "tableName": table_name or "—", "seatNumber": seat_number or "—"},
    )


async def send_invite_mms(
    *,
    phone: str,
    body: str,
    media_url: str,
    subject: str = "",
    # optional ticket card fields — if provided, generate a styled card instead of raw QR
    event_name: str = "",
    couples_name: str = "",
    event_date: datetime | None = None,
    venue_name: str = "",
    venue_address: str = "",
    guest_first_name: str = "",
    guest_last_name: str = "",
    admitted: bool = False,
    table_name: str = "",
    seat_number: str = "",
) -> None:
    """Send MMS (image + text) via ClickSend. US/CA/AU only."""
    if not _channel_ready("mms", phone):
        return
    if event_name and guest_first_name:
        try:
            # Derive card URL from the QR media_url — swap /qr.png for /card.jpg
            # Our server generates the card on-demand; ClickSend fetches it directly.
            # This skips the ~4s ClickSend upload step entirely.
            card_url = media_url.replace("/qr.png", "/card.jpg")
            if admitted:
                card_url += "?admitted=true"
            await _clicksend_mms_send(
                phone=phone, body=body or subject or "Your ticket is attached.",
                subject=subject, direct_url=card_url,
            )
            return
        except Exception:
            logger.exception("MMS send failed — falling back to raw QR")
    await _clicksend_mms_send(phone=phone, body=body, media_url=media_url, subject=subject)


async def send_template_sms(*, phone: str, body: str) -> None:
    """Send SMS using custom template body (already rendered with {{placeholders}})."""
    if not _channel_ready("sms", phone):
        return
    await _send_sms(phone, body)


async def send_template_whatsapp(*, phone: str, body: str) -> None:
    """Send WhatsApp using custom template body (already rendered with {{placeholders}})."""
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_text(phone, body)


# ── internal: routing ─────────────────────────────────────────────────────────

def _channel_ready(channel: str, phone: str | None) -> bool:
    """Return False (silently) when there's no point trying — no provider,
    no phone, or no creds for the chosen provider."""
    if not phone or not str(phone).strip():
        return False

    # WhatsApp uses its own provider setting (whatsapp_provider) so it can
    # run alongside ClickSend for SMS/MMS.
    if channel == "whatsapp":
        wa_provider = (settings.whatsapp_provider or "").lower()
        if wa_provider == "meta":
            if not settings.meta_whatsapp_token or not settings.meta_phone_number_id:
                logger.warning("Meta WhatsApp configured but missing token/phone_number_id")
                return False
            return True
        if wa_provider == "bird":
            if not settings.bird_access_key or not settings.bird_workspace_id or not settings.bird_whatsapp_channel_id:
                return False
            return True
        if wa_provider == "twilio":
            if not settings.twilio_account_sid or not settings.twilio_auth_token or not settings.twilio_whatsapp_from:
                return False
            return True
        return False  # no whatsapp provider set

    provider = (settings.messaging_provider or "").lower()
    if provider == "bird":
        if not settings.bird_access_key or not settings.bird_workspace_id:
            logger.warning("Bird configured but missing access_key/workspace_id — skipping %s", channel)
            return False
        if channel == "sms" and not settings.bird_sms_channel_id:
            return False
        return True
    if provider == "twilio":
        if not settings.twilio_account_sid or not settings.twilio_auth_token:
            logger.warning("Twilio configured but missing sid/token — skipping %s", channel)
            return False
        if channel == "sms" and not settings.twilio_from_number:
            return False
        return True
    if provider == "sns":
        if not settings.aws_access_key_id or not settings.aws_secret_access_key:
            logger.warning("SNS configured but missing AWS credentials — skipping %s", channel)
            return False
        return True
    if provider == "clicksend":
        if not settings.clicksend_username or not settings.clicksend_api_key.strip():
            logger.warning("ClickSend configured but missing username/api_key — skipping %s", channel)
            return False
        return True
    return False  # provider unset → silent no-op


# ── internal: AWS SNS ─────────────────────────────────────────────────────────

def _sns_send_sync(phone: str, body: str) -> None:
    try:
        import boto3
        client = boto3.client(
            "sns",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        attrs: dict = {
            "AWS.SNS.SMS.SMSType": {"DataType": "String", "StringValue": "Transactional"},
        }
        if settings.aws_sns_sender_id:
            attrs["AWS.SNS.SMS.SenderID"] = {"DataType": "String", "StringValue": settings.aws_sns_sender_id}
        client.publish(PhoneNumber=phone, Message=body, MessageAttributes=attrs)
    except Exception:
        logger.exception("AWS SNS send failed (to=%s)", phone)


# ── internal: Bird ────────────────────────────────────────────────────────────

async def _bird_post(channel_id: str, payload: dict) -> None:
    url = f"{_BIRD_BASE}/workspaces/{settings.bird_workspace_id}/channels/{channel_id}/messages"
    headers = {
        "Authorization": f"AccessKey {settings.bird_access_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, headers=headers, json=payload)
            if r.status_code >= 400:
                logger.warning("Bird %s → HTTP %s: %s", channel_id, r.status_code, r.text[:300])
    except Exception:
        logger.exception("Bird request failed")


def _bird_recipient(phone: str) -> dict:
    return {"contacts": [{"identifierValue": phone, "identifierKey": "phonenumber"}]}


# ── internal: Twilio (sync SDK, wrapped) ──────────────────────────────────────

def _twilio_send_sync(from_addr: str, to_addr: str, **kwargs) -> None:
    try:
        from twilio.rest import Client
        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        client.messages.create(from_=from_addr, to=to_addr, **kwargs)
    except Exception:
        logger.exception("Twilio send failed (to=%s)", to_addr)


# ── internal: ClickSend ───────────────────────────────────────────────────────

async def _clicksend_send(phone: str, body: str) -> None:
    url = "https://rest.clicksend.com/v3/sms/send"
    msg: dict = {"source": "sdk", "to": phone, "body": body}
    if settings.clicksend_from.strip():
        msg["from"] = settings.clicksend_from.strip()
    payload = {"messages": [msg]}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                url,
                json=payload,
                auth=(settings.clicksend_username, settings.clicksend_api_key.strip()),
            )
            data = r.json()
            if r.status_code >= 400:
                logger.warning("ClickSend → HTTP %s: %s", r.status_code, r.text[:300])
            else:
                msg = data.get("data", {}).get("messages", [{}])[0]
                status = msg.get("status", "unknown")
                if status != "SUCCESS":
                    logger.warning("ClickSend message status=%s to=%s", status, phone)
    except Exception:
        logger.exception("ClickSend request failed (to=%s)", phone)


# ── internal: ClickSend MMS ───────────────────────────────────────────────────

async def _clicksend_upload_media(image_url: str, client: httpx.AsyncClient) -> str:
    """Download image from url and upload to ClickSend (converts PNG→JPG).
    Returns the hosted URL suitable for MMS media_file."""
    img_resp = await client.get(image_url, timeout=10)
    img_resp.raise_for_status()
    upload_resp = await client.post(
        "https://rest.clicksend.com/v3/uploads?convert=mms",
        files={"file": ("image.png", img_resp.content, "image/png")},
        auth=(settings.clicksend_username, settings.clicksend_api_key.strip()),
    )
    upload_resp.raise_for_status()
    hosted_url = upload_resp.json()["data"]["_url"]
    return hosted_url


async def _clicksend_mms_send(
    phone: str, body: str, subject: str = "",
    media_url: str = "", card_bytes: bytes = b"", direct_url: str = "",
) -> None:
    auth = (settings.clicksend_username, settings.clicksend_api_key.strip())
    msg: dict = {
        "source": "sdk",
        "to": phone,
        "body": body,
        "subject": subject or "Your Event Ticket",
    }
    if settings.clicksend_from.strip():
        msg["from"] = settings.clicksend_from.strip()
    else:
        logger.warning("CLICKSEND_FROM not set — MMS may be rejected by ClickSend")
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            if direct_url:
                # Our server hosts the card — pass URL directly, no upload needed.
                hosted_url = direct_url
            elif card_bytes:
                up = await c.post(
                    "https://rest.clicksend.com/v3/uploads?convert=mms",
                    files={"file": ("ticket.jpg", card_bytes, "image/jpeg")},
                    auth=auth,
                )
                up.raise_for_status()
                hosted_url = up.json()["data"]["_url"]
            else:
                hosted_url = await _clicksend_upload_media(media_url, c)
            payload = {"media_file": hosted_url, "messages": [msg]}
            r = await c.post("https://rest.clicksend.com/v3/mms/send", json=payload, auth=auth)
            if r.status_code >= 400:
                logger.warning("ClickSend MMS → HTTP %s: %s", r.status_code, r.text[:500])
            else:
                msg_data = r.json().get("data", {}).get("messages", [{}])[0]
                status = msg_data.get("status", "unknown")
                if status != "SUCCESS":
                    logger.warning("ClickSend MMS status=%s detail=%s to=%s", status, msg_data, phone)
                else:
                    logger.info("ClickSend MMS sent OK to=%s", phone)
    except Exception:
        logger.exception("ClickSend MMS request failed (to=%s)", phone)


# ── internal: dispatchers ─────────────────────────────────────────────────────

async def _send_sms(phone: str, body: str) -> None:
    provider = (settings.messaging_provider or "").lower()
    if provider == "bird":
        await _bird_post(settings.bird_sms_channel_id, {
            "receiver": _bird_recipient(phone),
            "body": {"type": "text", "text": {"text": body}},
        })
    elif provider == "twilio":
        await asyncio.to_thread(_twilio_send_sync, settings.twilio_from_number, phone, body=body)
    elif provider == "clicksend":
        await _clicksend_send(phone, body)
    elif provider == "sns":
        await asyncio.to_thread(_sns_send_sync, phone, body)


async def _meta_wa_post(payload: dict) -> None:
    """Send a WhatsApp message via Meta Cloud API."""
    url = f"https://graph.facebook.com/v19.0/{settings.meta_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {settings.meta_whatsapp_token}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, headers=headers, json=payload)
            if r.status_code >= 400:
                logger.warning("Meta WhatsApp → HTTP %s: %s", r.status_code, r.text[:400])
            else:
                logger.info("Meta WhatsApp sent OK to=%s", payload.get("to"))
    except Exception:
        logger.exception("Meta WhatsApp request failed")


def _e164(phone: str) -> str:
    """Strip spaces/dashes/parens — Meta requires E.164 format with no spaces."""
    import re
    digits = re.sub(r"[^\d+]", "", phone)
    return digits if digits.startswith("+") else f"+{digits}"


async def _send_whatsapp_template(*, phone: str, kind: str, params: list[str], named_params: dict | None = None) -> None:
    """kind: 'invite' | 'admission' — picks template name per provider."""
    wa_provider = (settings.whatsapp_provider or "").lower()
    if wa_provider == "meta":
        template_name = (
            settings.meta_wa_invite_template if kind == "invite"
            else settings.meta_wa_admission_template
        )
        if not template_name:
            logger.warning("Meta WhatsApp %s template name not set — skipping", kind)
            return
        components = [
            {
                "type": "body",
                "parameters": [{"type": "text", "text": p} for p in params],
            }
        ] if params else []
        await _meta_wa_post({
            "messaging_product": "whatsapp",
            "to": _e164(phone),
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": settings.meta_wa_language},
                "components": components,
            },
        })
        return

    if wa_provider == "bird":
        template = (
            settings.bird_whatsapp_invite_template if kind == "invite"
            else settings.bird_whatsapp_admission_template
        )
        version = (
            settings.bird_whatsapp_invite_version if kind == "invite"
            else settings.bird_whatsapp_admission_version
        )
        if not template:
            logger.warning("Bird WhatsApp %s template not set — skipping", kind)
            return
        # Bird expects variables as a flat {key: value} object, not an array.
        variables = (
            named_params
            if named_params
            else {str(i + 1): v for i, v in enumerate(params)}
        )
        template_payload = {
            "projectId": template,
            "locale": "en",
            "variables": variables,
        }
        if version:
            template_payload["version"] = version
        await _bird_post(settings.bird_whatsapp_channel_id, {
            "receiver": _bird_recipient(phone),
            "template": template_payload,
        })
    elif wa_provider == "twilio":
        sid = (
            settings.twilio_whatsapp_invite_template_sid if kind == "invite"
            else settings.twilio_whatsapp_admission_template_sid
        )
        to_addr = phone if phone.startswith("whatsapp:") else f"whatsapp:{phone}"
        # Sandbox accepts plain body; production requires content_sid + variables.
        if sid:
            import json
            await asyncio.to_thread(
                _twilio_send_sync,
                settings.twilio_whatsapp_from, to_addr,
                content_sid=sid,
                content_variables=json.dumps({str(i + 1): v for i, v in enumerate(params)}),
            )
        else:
            body = " | ".join(params)  # sandbox fallback for testing
            await asyncio.to_thread(_twilio_send_sync, settings.twilio_whatsapp_from, to_addr, body=body)


async def _send_whatsapp_text(phone: str, body: str) -> None:
    """Send WhatsApp using plain text body (for custom templates)."""
    wa_provider = (settings.whatsapp_provider or "").lower()
    if wa_provider == "meta":
        await _meta_wa_post({
            "messaging_product": "whatsapp",
            "to": _e164(phone),
            "type": "text",
            "text": {"body": body, "preview_url": False},
        })
        return

    provider = (settings.messaging_provider or "").lower()
    if provider == "bird":
        await _bird_post(settings.bird_whatsapp_channel_id, {
            "receiver": _bird_recipient(phone),
            "body": {"type": "text", "text": {"text": body}},
        })
    elif provider == "twilio":
        to_addr = phone if phone.startswith("whatsapp:") else f"whatsapp:{phone}"
        await asyncio.to_thread(_twilio_send_sync, settings.twilio_whatsapp_from, to_addr, body=body)

