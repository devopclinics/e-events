"""Resend email delivery webhooks.

Configure Resend to POST events to:

    https://festio.events/api/webhooks/resend
"""
import base64
import hashlib
import hmac
import json
import logging
import time
from binascii import Error as BinasciiError
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import (
    EmailDeliveryEvent,
    Guest,
    InboundEmail,
    InboundEmailAutomation,
    InboundEmailWebhookReceipt,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_SVIX_TOLERANCE_SECONDS = 5 * 60


def _inbound_token(recipients) -> str | None:
    for raw in recipients if isinstance(recipients, list) else [recipients]:
        address = str(raw or "").strip().lower()
        local = address.rsplit("@", 1)[0]
        if "+" in local:
            token = local.rsplit("+", 1)[1].strip()
            if token:
                return token
    return None


def _decode_svix_secret(secret: str) -> bytes:
    value = secret.strip()
    if value.startswith("whsec_"):
        value = value[len("whsec_") :]
    return base64.b64decode(value)


def _verify_svix_signature(payload: bytes, headers, secret: str) -> bool:
    svix_id = headers.get("svix-id")
    svix_timestamp = headers.get("svix-timestamp")
    svix_signature = headers.get("svix-signature")
    if not svix_id or not svix_timestamp or not svix_signature:
        return False

    try:
        timestamp = int(svix_timestamp)
    except ValueError:
        return False
    if abs(int(time.time()) - timestamp) > _SVIX_TOLERANCE_SECONDS:
        return False

    try:
        secret_bytes = _decode_svix_secret(secret)
    except (BinasciiError, ValueError):
        logger.exception("Invalid Resend webhook secret format")
        return False

    signed_payload = b".".join([svix_id.encode(), svix_timestamp.encode(), payload])
    expected = base64.b64encode(
        hmac.new(secret_bytes, signed_payload, hashlib.sha256).digest()
    ).decode()
    signatures = [
        item.split(",", 1)[1]
        for item in svix_signature.split()
        if item.startswith("v1,") and "," in item
    ]
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


def _event_status(event_type: str) -> str:
    value = (event_type or "").removeprefix("email.").replace(".", "_")
    if value in {"bounced", "complained", "failed", "delivery_delayed", "suppressed"}:
        return value
    if value in {"sent", "delivered", "opened", "clicked"}:
        return value
    return value or "unknown"


def _tags_to_dict(raw) -> dict[str, str]:
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items() if v is not None}
    if isinstance(raw, list):
        tags = {}
        for item in raw:
            if isinstance(item, dict):
                name = item.get("name") or item.get("key")
                value = item.get("value")
                if name and value is not None:
                    tags[str(name)] = str(value)
        return tags
    return {}


def _first_recipient(value) -> str | None:
    if isinstance(value, list):
        return str(value[0]).lower() if value else None
    if isinstance(value, str):
        return value.lower()
    return None


def _parse_datetime(value) -> datetime:
    if not value:
        return datetime.utcnow()
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except ValueError:
        return datetime.utcnow()


async def _resolve_guest(
    db: AsyncSession,
    *,
    event_id: str | None,
    guest_id: str | None,
    recipient: str | None,
) -> tuple[str | None, str | None]:
    if guest_id:
        guest = await db.get(Guest, guest_id)
        if guest and (not event_id or guest.event_id == event_id):
            return guest.event_id, guest.id
    if event_id and recipient:
        guest = await db.scalar(
            select(Guest)
            .where(Guest.event_id == event_id, Guest.email == recipient.lower())
            .order_by(Guest.invite_sent_at.desc().nullslast(), Guest.id.desc())
            .limit(1)
        )
        if guest:
            return guest.event_id, guest.id
    return event_id, None


@router.get("/resend")
async def resend_webhook_health() -> dict[str, bool | str]:
    return {"ok": True, "provider": "resend"}


@router.post("/resend")
async def receive_resend_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    payload = await request.body()

    if settings.resend_webhook_secret and not _verify_svix_signature(
        payload,
        request.headers,
        settings.resend_webhook_secret,
    ):
        raise HTTPException(status_code=400, detail="Invalid Resend webhook signature")

    try:
        event = json.loads(payload.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = event.get("type") or event.get("event") or "unknown"
    data = event.get("data") or {}
    tags = _tags_to_dict(data.get("tags") or event.get("tags"))
    recipient = _first_recipient(data.get("to") or data.get("recipient"))
    event_id, guest_id = await _resolve_guest(
        db,
        event_id=tags.get("event_id") or tags.get("event-id"),
        guest_id=tags.get("guest_id") or tags.get("guest-id"),
        recipient=recipient,
    )
    provider_event_id = event.get("id")
    if provider_event_id:
        existing = await db.scalar(
            select(EmailDeliveryEvent.id)
            .where(EmailDeliveryEvent.provider_event_id == str(provider_event_id))
            .limit(1)
        )
        if existing:
            return {"ok": True}

    delivery = EmailDeliveryEvent(
        provider="resend",
        provider_event_id=str(provider_event_id) if provider_event_id else None,
        provider_email_id=data.get("email_id") or data.get("id"),
        event_id=event_id,
        guest_id=guest_id,
        recipient=recipient,
        subject=data.get("subject"),
        message_kind=tags.get("message_kind") or tags.get("message-kind"),
        event_type=event_type,
        status=_event_status(event_type),
        error_message=data.get("error") or data.get("reason"),
        tags=tags or None,
        payload=event,
        occurred_at=_parse_datetime(event.get("created_at") or data.get("created_at")),
    )
    db.add(delivery)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return {"ok": True}

    logger.info(
        "Resend webhook received: type=%s email_id=%s to=%s guest_id=%s",
        event_type,
        data.get("email_id") or data.get("id"),
        data.get("to"),
        guest_id,
    )
    from ..services.marketing_client import ingest_marketing_delivery
    await ingest_marketing_delivery(recipient, event_type, data.get("email_id") or data.get("id"))
    return {"ok": True}


@router.post("/resend/inbound")
async def receive_resend_inbound_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    """Persist a verified ``email.received`` notification and return quickly.

    Content retrieval, parsing, matching, and Experience completion are owned
    by the durable inbound-email worker, never this request path.
    """
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > settings.inbound_email_max_webhook_bytes:
                raise HTTPException(status_code=413, detail="Webhook payload too large")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Content-Length")
    payload = await request.body()
    if len(payload) > settings.inbound_email_max_webhook_bytes:
        raise HTTPException(status_code=413, detail="Webhook payload too large")

    secret = settings.resend_inbound_webhook_secret or settings.resend_webhook_secret
    if not secret:
        logger.error("Resend inbound webhook rejected: signing secret is not configured")
        raise HTTPException(status_code=503, detail="Inbound email is not configured")
    if not _verify_svix_signature(payload, request.headers, secret):
        raise HTTPException(status_code=400, detail="Invalid Resend webhook signature")

    try:
        event = json.loads(payload.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    if event.get("type") != "email.received":
        return {"ok": True}

    data = event.get("data") or {}
    resend_email_id = str(data.get("email_id") or "").strip()
    svix_id = str(request.headers.get("svix-id") or "").strip()
    if not resend_email_id or not svix_id:
        raise HTTPException(status_code=400, detail="Missing inbound email identifier")

    prior_receipt = await db.scalar(
        select(InboundEmailWebhookReceipt).where(InboundEmailWebhookReceipt.svix_id == svix_id)
    )
    if prior_receipt:
        return {"ok": True}

    existing = await db.scalar(
        select(InboundEmail).where(InboundEmail.resend_email_id == resend_email_id)
    )
    if existing:
        db.add(InboundEmailWebhookReceipt(
            svix_id=svix_id,
            resend_email_id=resend_email_id,
            inbound_email_id=existing.id,
            is_duplicate=True,
        ))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
        logger.info("inbound_email.duplicate email_id=%s", resend_email_id)
        return {"ok": True}

    token = _inbound_token(data.get("to") or [])
    automation = None
    if token:
        automation = await db.scalar(
            select(InboundEmailAutomation).where(InboundEmailAutomation.inbound_token == token)
        )
    inbound = InboundEmail(
        org_id=automation.org_id if automation else None,
        event_id=automation.event_id if automation else None,
        automation_id=automation.id if automation else None,
        resend_email_id=resend_email_id,
        message_id=(str(data.get("message_id"))[:500] if data.get("message_id") else None),
        from_address=(str(data.get("from"))[:320].lower() if data.get("from") else None),
        to_addresses=[str(value).lower() for value in (data.get("to") or [])][:20],
        cc_addresses=[str(value).lower() for value in (data.get("cc") or [])][:20],
        subject=(str(data.get("subject"))[:1000] if data.get("subject") else None),
        attachment_metadata=(data.get("attachments") or [])[:50],
        processing_status="received" if automation else "invalid",
        failure_code=None if automation else "unknown_inbound_token",
        failure_reason=None if automation else "The recipient does not resolve to an automation.",
        processed_at=None if automation else datetime.utcnow(),
        received_at=_parse_datetime(data.get("created_at") or event.get("created_at")),
    )
    db.add(inbound)
    await db.flush()
    db.add(InboundEmailWebhookReceipt(
        svix_id=svix_id,
        resend_email_id=resend_email_id,
        inbound_email_id=inbound.id,
    ))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return {"ok": True}
    logger.info(
        "inbound_email.received inbound_email_id=%s automation_id=%s",
        inbound.id,
        automation.id if automation else None,
    )
    return {"ok": True}
