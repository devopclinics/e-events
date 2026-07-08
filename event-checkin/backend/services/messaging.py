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
from app.timeutil import local_hhmm, to_event_local

logger = logging.getLogger(__name__)

_BIRD_BASE = "https://api.bird.com"
_SMS_FOOTER = "Reply HELP for help, STOP to opt out. Message and data rates may apply."


def _brand_sms(body: str) -> str:
    """Keep carrier-reviewed SMS bodies branded and compliance-copy aligned."""
    text = body.strip()
    if not text.startswith("Festio:"):
        text = f"Festio: {text}"
    upper = text.upper()
    has_required_footer = (
        "HELP" in upper
        and "STOP" in upper
        and ("MSG & DATA RATES MAY APPLY" in upper or "MESSAGE AND DATA RATES MAY APPLY" in upper)
    )
    if not has_required_footer:
        text = f"{text} {_SMS_FOOTER}"
    return text


# ── public API ────────────────────────────────────────────────────────────────

async def send_invite_sms(*, phone: str, first_name: str, event_name: str, ticket_url: str, event_date: datetime) -> None:
    if not _channel_ready("sms", phone):
        return
    _local = to_event_local(event_date)
    date_str = _local.strftime("%b %d, %Y") if _local else ""
    body = f"Hi {first_name}! You're invited to {event_name}" + (f" on {date_str}" if date_str else "") + f". Your ticket: {ticket_url}"
    await _send_sms(phone, _brand_sms(body))


async def send_admission_sms(*, phone: str, first_name: str, event_name: str, admitted_at, table_name: str | None, seat_number: str | None) -> None:
    if not _channel_ready("sms", phone):
        return
    parts = [f"Welcome {first_name}!", f"You're checked in to {event_name}."]
    if admitted_at:
        parts.append(f"Time: {local_hhmm(admitted_at)}.")
    if table_name:
        seat_bit = f" seat {seat_number}" if seat_number else ""
        parts.append(f"Table: {table_name}{seat_bit}.")
    await _send_sms(phone, _brand_sms(" ".join(parts)))


async def send_invite_whatsapp(*, phone: str, first_name: str, event_name: str, ticket_url: str, event_date: datetime) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    _local = to_event_local(event_date)
    date_str = _local.strftime("%A, %d %B %Y") if _local else ""
    await _send_whatsapp_template(
        phone=phone,
        kind="invite",
        params=[first_name, event_name, date_str, ticket_url],
        var_keys=["firstName", "eventName", "eventDate", "ticketUrl"],
    )


async def send_admission_whatsapp(*, phone: str, first_name: str, event_name: str, table_name: str | None, seat_number: str | None) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_template(
        phone=phone,
        kind="admission",
        params=[first_name, event_name, table_name or "—", seat_number or "—"],
        var_keys=["firstName", "eventName", "tableName", "seatNumber"],
    )


async def send_rsvp_invitation_whatsapp(*, phone: str, name: str, event_name: str, invite_url: str) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_template(
        phone=phone,
        kind="rsvp_invitation",
        params=[name, event_name, invite_url],
        var_keys=["guestName", "eventName", "rsvpLink"],
    )


async def send_rsvp_reminder_whatsapp(*, phone: str, first_name: str, event_name: str, invite_url: str) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_template(
        phone=phone,
        kind="rsvp_reminder",
        params=[first_name, event_name, invite_url],
        var_keys=["firstName", "eventName", "rsvpLink"],
    )


async def send_rsvp_confirmation_whatsapp(*, phone: str, first_name: str, event_name: str, event_date: datetime) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    _local = to_event_local(event_date)
    date_str = _local.strftime("%A, %d %B %Y") if _local else ""
    await _send_whatsapp_template(
        phone=phone,
        kind="rsvp_confirmation",
        params=[first_name, event_name, date_str],
        var_keys=["firstName", "eventName", "eventDate"],
    )


async def send_rsvp_decline_whatsapp(*, phone: str, first_name: str, event_name: str) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_template(
        phone=phone,
        kind="rsvp_decline",
        params=[first_name, event_name],
        var_keys=["firstName", "eventName"],
    )


async def send_approval_pending_whatsapp(*, phone: str, first_name: str, event_name: str) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_template(
        phone=phone,
        kind="approval_pending",
        params=[first_name, event_name],
        var_keys=["firstName", "eventName"],
    )


async def send_approval_accepted_whatsapp(*, phone: str, first_name: str, event_name: str, ticket_url: str) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_template(
        phone=phone,
        kind="approval_accepted",
        params=[first_name, event_name, ticket_url],
        var_keys=["firstName", "eventName", "ticketLink"],
    )


async def send_approval_rejected_whatsapp(*, phone: str, first_name: str, event_name: str) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_template(
        phone=phone,
        kind="approval_rejected",
        params=[first_name, event_name],
        var_keys=["firstName", "eventName"],
    )


async def send_logistics_whatsapp(*, phone: str, first_name: str, event_name: str) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_template(
        phone=phone,
        kind="logistics",
        params=[first_name, event_name],
        var_keys=["firstName", "eventName"],
    )


async def send_registry_whatsapp(*, phone: str, event_name: str, registry_url: str) -> None:
    if not _channel_ready("whatsapp", phone):
        return
    await _send_whatsapp_template(
        phone=phone,
        kind="registry",
        params=[event_name, registry_url],
        var_keys=["eventName", "registryLink"],
    )


async def send_broadcast_sms(*, phone: str, first_name: str, message: str) -> None:
    """Send a free-text host broadcast over SMS."""
    if not _channel_ready("sms", phone):
        return
    body = f"Hi {first_name}! {message}"
    await _send_sms(phone, _brand_sms(body))


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
    await _send_sms(phone, _brand_sms(body))


async def send_manual_invite_whatsapp(*, phone: str, name: str, event_name: str, invite_url: str) -> None:
    """Send a personal invite link via WhatsApp to someone who hasn't RSVP'd yet."""
    if not _channel_ready("whatsapp", phone):
        return
    await send_rsvp_invitation_whatsapp(
        phone=phone, name=name, event_name=event_name, invite_url=invite_url,
    )


async def send_custom_sms(*, phone: str, body: str) -> None:
    """Send a fully-rendered SMS body (used by the customizable-template engine)."""
    if not _channel_ready("sms", phone):
        return
    await _send_sms(phone, _brand_sms(body))


# ── MMS (image ticket card) ─────────────────────────────────────────────────────

def mms_ready() -> bool:
    """Whether an MMS-capable provider is configured. Used to gate the channel."""
    provider = (settings.messaging_provider or "").lower()
    if settings.clicksend_username and settings.clicksend_api_key:
        return True
    if provider == "twilio" and settings.twilio_account_sid and settings.twilio_from_number:
        return True
    if provider == "bird" and settings.bird_access_key and settings.bird_mms_channel_id:
        return True
    return False


async def send_mms(*, phone: str, body: str, media_url: str) -> None:
    """Send an MMS (text body + image at media_url) via the configured provider.
    ClickSend is preferred when configured (prod), else the active provider's MMS
    path. Never raises — logs and returns on failure."""
    if not phone or not str(phone).strip() or not media_url:
        return
    # ClickSend takes precedence when credentials exist (prod's MMS provider).
    if settings.clicksend_username and settings.clicksend_api_key:
        await _clicksend_mms(phone, body, media_url)
        return
    provider = (settings.messaging_provider or "").lower()
    if provider == "twilio":
        await _twilio_mms(phone, body, media_url)
    elif provider == "bird":
        await _bird_mms(phone, body, media_url)
    else:
        logger.info("MMS requested but no MMS-capable provider configured — skipping")


async def _clicksend_mms(phone: str, body: str, media_url: str) -> None:
    import base64
    auth = base64.b64encode(f"{settings.clicksend_username}:{settings.clicksend_api_key}".encode()).decode()
    payload = {
        "media_file": media_url,  # collection-level; ClickSend fetches it directly
        "messages": [{
            "source": "python",
            "from": settings.clicksend_from or None,
            "to": phone,
            "body": body or " ",            # must be non-empty or MISSING_REQUIRED_FIELDS
            "subject": (body[:20] or "Ticket"),
        }],
    }
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post("https://rest.clicksend.com/v3/mms/send",
                             headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
                             json=payload)
            if r.status_code >= 400:
                logger.warning("ClickSend MMS → HTTP %s: %s", r.status_code, r.text[:300])
    except Exception:
        logger.exception("ClickSend MMS request failed")


def _twilio_mms_sync(to_addr: str, body: str, media_url: str) -> None:
    try:
        from twilio.rest import Client
        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        client.messages.create(from_=settings.twilio_from_number, to=to_addr, body=body or "", media_url=[media_url])
    except Exception:
        logger.exception("Twilio MMS send failed (to=%s)", to_addr)


async def _twilio_mms(phone: str, body: str, media_url: str) -> None:
    await asyncio.to_thread(_twilio_mms_sync, phone, body, media_url)


async def _bird_mms(phone: str, body: str, media_url: str) -> None:
    # Bird image message. Channel/account must be MMS-capable — verify in prod.
    await _bird_post(settings.bird_mms_channel_id, {
        "receiver": _bird_recipient(phone),
        "body": {"type": "image", "image": {"images": [{"mediaUrl": media_url}], "text": body or ""}},
    })


async def send_custom_whatsapp(*, phone: str, body: str) -> None:
    """Send a fully-rendered WhatsApp body as plain text (template engine).

    Like broadcasts this uses the free-text path, so it only delivers inside an
    open WhatsApp session / sandbox (no registered template)."""
    if not _channel_ready("whatsapp", phone):
        return
    await _send_sms_as_whatsapp(phone, body)


# ── internal: routing ─────────────────────────────────────────────────────────

def _wa_provider() -> str:
    """WhatsApp provider — its own setting, falling back to messaging_provider.
    (Bug fix: WhatsApp used to read messaging_provider, so a clicksend SMS setup
    silently dropped WhatsApp even when Bird was configured for it.)"""
    return (settings.whatsapp_provider or settings.messaging_provider or "").lower()


def _channel_ready(channel: str, phone: str | None) -> bool:
    """Return False (silently) when there's no point trying — no provider,
    no phone, or no creds for the chosen provider."""
    if not phone or not str(phone).strip():
        return False
    provider = _wa_provider() if channel == "whatsapp" else (settings.messaging_provider or "").lower()
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


def _bird_whatsapp_template_for(kind: str) -> str:
    return {
        "invite": settings.bird_whatsapp_invite_template,
        "rsvp_invitation": settings.bird_whatsapp_rsvp_invitation_template,
        "rsvp_reminder": settings.bird_whatsapp_rsvp_reminder_template,
        "rsvp_confirmation": settings.bird_whatsapp_rsvp_confirmation_template,
        "rsvp_decline": settings.bird_whatsapp_rsvp_decline_template,
        "approval_pending": settings.bird_whatsapp_approval_pending_template,
        "approval_accepted": settings.bird_whatsapp_approval_accepted_template,
        "approval_rejected": settings.bird_whatsapp_approval_rejected_template,
        "admission": settings.bird_whatsapp_admission_template,
        "logistics": settings.bird_whatsapp_logistics_template,
        "registry": settings.bird_whatsapp_registry_template,
    }.get(kind, "")


async def _send_whatsapp_template(*, phone: str, kind: str, params: list[str],
                                  var_keys: list[str] | None = None) -> None:
    """Pick a provider template for a WhatsApp lifecycle message.

    `var_keys` names Bird template variables (e.g. firstName/eventName/…); falls
    back to positional 1,2,3 when not given."""
    provider = _wa_provider()
    if provider == "bird":
        template = _bird_whatsapp_template_for(kind)
        if not template:
            logger.warning("Bird WhatsApp %s template not set — skipping", kind)
            return
        keys = var_keys or [str(i + 1) for i in range(len(params))]
        # Bird wants the template *name*, a locale, and parameters as an array of
        # {type,key,value} objects. A flat {key:value} "variables" object 422s
        # with "provided template information is invalid".
        parameters = [{"type": "string", "key": k, "value": v} for k, v in zip(keys, params)]
        await _bird_post(settings.bird_whatsapp_channel_id, {
            "receiver": _bird_recipient(phone),
            "template": {
                "name": template,
                "locale": "en",
                "parameters": parameters,
            },
        })
    elif provider == "twilio":
        sid = (
            settings.twilio_whatsapp_invite_template_sid if kind == "invite"
            else settings.twilio_whatsapp_admission_template_sid if kind == "admission"
            else ""
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
    provider = _wa_provider()
    if provider == "bird":
        await _bird_post(settings.bird_whatsapp_channel_id, {
            "receiver": _bird_recipient(phone),
            "body": {"type": "text", "text": {"text": body}},
        })
    elif provider == "twilio":
        to_addr = phone if phone.startswith("whatsapp:") else f"whatsapp:{phone}"
        await asyncio.to_thread(_twilio_send_sync, settings.twilio_whatsapp_from, to_addr, body=body)
