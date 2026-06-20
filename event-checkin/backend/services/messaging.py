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
    body = f"Hi {first_name}! You're invited to {event_name}" + (f" on {date_str}" if date_str else "") + f". Your ticket: {ticket_url}"
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
    )


async def send_admission_whatsapp(*, phone: str, first_name: str, event_name: str, table_name: str | None, seat_number: str | None) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_template(
        phone=phone,
        kind="admission",
        params=[first_name, event_name, table_name or "—", seat_number or "—"],
    )


async def send_broadcast_sms(*, phone: str, first_name: str, message: str) -> None:
    """Send a free-text host broadcast over SMS."""
    if not _channel_ready("sms", phone):
        return
    body = f"Hi {first_name}! {message}"
    await _send_sms(phone, body)


async def send_broadcast_whatsapp(*, phone: str, first_name: str, message: str) -> None:
    """Send a free-text host broadcast over WhatsApp.

    Falls back to plain SMS-style text since broadcast messages don't use a
    registered template — this only works in WhatsApp sandbox / Business API
    sessions where a 24-hour messaging window is already open."""
    if not _channel_ready("whatsapp", phone):
        return
    body = f"Hi {first_name}! {message}"
    await _send_sms_as_whatsapp(phone, body)


async def send_manual_invite_sms(*, phone: str, name: str, event_name: str, invite_url: str) -> None:
    """Send a personal invite link via SMS to someone who hasn't RSVP'd yet."""
    if not _channel_ready("sms", phone):
        return
    body = f"Hi {name}! You're invited to {event_name}. RSVP here: {invite_url}"
    await _send_sms(phone, body)


async def send_manual_invite_whatsapp(*, phone: str, name: str, event_name: str, invite_url: str) -> None:
    """Send a personal invite link via WhatsApp to someone who hasn't RSVP'd yet."""
    if not _channel_ready("whatsapp", phone):
        return
    body = f"Hi {name}! You're invited to {event_name}. RSVP here: {invite_url}"
    await _send_sms_as_whatsapp(phone, body)


async def send_custom_sms(*, phone: str, body: str) -> None:
    """Send a fully-rendered SMS body (used by the customizable-template engine)."""
    if not _channel_ready("sms", phone):
        return
    await _send_sms(phone, body)


async def send_custom_whatsapp(*, phone: str, body: str) -> None:
    """Send a fully-rendered WhatsApp body as plain text (template engine).

    Like broadcasts this uses the free-text path, so it only delivers inside an
    open WhatsApp session / sandbox (no registered template)."""
    if not _channel_ready("whatsapp", phone):
        return
    await _send_sms_as_whatsapp(phone, body)


# ── internal: routing ─────────────────────────────────────────────────────────

def _channel_ready(channel: str, phone: str | None) -> bool:
    """Return False (silently) when there's no point trying — no provider,
    no phone, or no creds for the chosen provider."""
    if not phone or not str(phone).strip():
        return False
    provider = (settings.messaging_provider or "").lower()
    if provider == "bird":
        if not settings.bird_access_key or not settings.bird_workspace_id:
            logger.warning("Bird configured but missing access_key/workspace_id — skipping %s", channel)
            return False
        if channel == "sms" and not settings.bird_sms_channel_id:
            return False
        if channel == "whatsapp" and not settings.bird_whatsapp_channel_id:
            return False
        return True
    if provider == "twilio":
        if not settings.twilio_account_sid or not settings.twilio_auth_token:
            logger.warning("Twilio configured but missing sid/token — skipping %s", channel)
            return False
        if channel == "sms" and not settings.twilio_from_number:
            return False
        if channel == "whatsapp" and not settings.twilio_whatsapp_from:
            return False
        return True
    return False  # provider unset → silent no-op


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


async def _send_whatsapp_template(*, phone: str, kind: str, params: list[str]) -> None:
    """kind: 'invite' | 'admission' — picks template name (Bird) or SID (Twilio)."""
    provider = (settings.messaging_provider or "").lower()
    if provider == "bird":
        template = (
            settings.bird_whatsapp_invite_template if kind == "invite"
            else settings.bird_whatsapp_admission_template
        )
        if not template:
            logger.warning("Bird WhatsApp %s template not set — skipping", kind)
            return
        await _bird_post(settings.bird_whatsapp_channel_id, {
            "receiver": _bird_recipient(phone),
            "template": {
                "projectId": template,
                "variables": [{"key": str(i + 1), "value": v} for i, v in enumerate(params)],
            },
        })
    elif provider == "twilio":
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


async def _send_sms_as_whatsapp(phone: str, body: str) -> None:
    """Send a plain-text message via the WhatsApp channel (used for broadcasts
    where no template is registered)."""
    provider = (settings.messaging_provider or "").lower()
    if provider == "bird":
        await _bird_post(settings.bird_whatsapp_channel_id, {
            "receiver": _bird_recipient(phone),
            "body": {"type": "text", "text": {"text": body}},
        })
    elif provider == "twilio":
        to_addr = phone if phone.startswith("whatsapp:") else f"whatsapp:{phone}"
        await asyncio.to_thread(_twilio_send_sync, settings.twilio_whatsapp_from, to_addr, body=body)
