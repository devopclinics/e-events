"""Inbound messaging webhooks.

Twilio POSTs a delivery-status callback here for every outbound SMS/WhatsApp
message as it moves through its lifecycle (queued → sent → delivered, or failed/
undelivered). Configure this endpoint as the **Status Callback URL** on the
Twilio Messaging Service (or phone number) sending the traffic:

    https://festio.events/api/messaging/twilio/status

The handler is intentionally forgiving: it always returns 204 so Twilio doesn't
retry/queue on transient app errors, and signature validation is enforced only
when an auth token is configured.
"""
import logging

from fastapi import APIRouter, Request, Response

from app.config import settings
from services.credit_ledger import reconcile_provider_status

logger = logging.getLogger(__name__)

router = APIRouter()


def _request_url(request: Request) -> str:
    """Rebuild the externally-visible URL Twilio signed against.

    Behind Cloudflare + nginx the app sees http internally, so trust the
    forwarded proto/host headers set by the proxy (see proxy.conf)."""
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("host", request.url.netloc)
    return f"{proto}://{host}{request.url.path}"


@router.post("/twilio/status")
async def twilio_status_callback(request: Request) -> Response:
    form = await request.form()
    params = {k: v for k, v in form.items()}

    # Validate the X-Twilio-Signature when we have the auth token to do so.
    signature = request.headers.get("x-twilio-signature", "")
    if settings.twilio_auth_token and signature:
        try:
            from twilio.request_validator import RequestValidator

            validator = RequestValidator(settings.twilio_auth_token)
            if not validator.validate(_request_url(request), params, signature):
                logger.warning("Twilio status callback: invalid signature (sid=%s)", params.get("MessageSid"))
                return Response(status_code=403)
        except Exception:
            logger.exception("Twilio signature validation error")

    status = params.get("MessageStatus") or params.get("SmsStatus")
    error_code = params.get("ErrorCode")
    logger.info(
        "Twilio status: sid=%s to=%s status=%s%s",
        params.get("MessageSid"),
        params.get("To"),
        status,
        f" error={error_code}" if error_code else "",
    )
    try:
        await reconcile_provider_status(
            provider="twilio",
            provider_message_id=params.get("MessageSid"),
            status=status,
            error_code=error_code,
        )
    except Exception:
        logger.exception("Twilio status callback reconciliation failed")

    # 204: acknowledge without a body so Twilio marks the callback delivered.
    return Response(status_code=204)


async def _payload(request: Request) -> dict:
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    form = await request.form()
    return {k: v for k, v in form.items()}


def _signalhouse_extract_status_and_message_id(data: dict) -> tuple[str | None, str | None]:
    """Extract status + message id from Signal House callback payloads.

    Signal House callbacks can arrive in multiple shapes. We support:
    - flat: status/messageStatus + messageId/message_id/id
    - nested message object
    - insertedMessages[0].status + insertedMessages[0].statusHistory[-1]._id
    """
    message = data.get("message") if isinstance(data.get("message"), dict) else {}

    status = data.get("status") or data.get("messageStatus") or message.get("status")
    message_id = (
        data.get("messageId") or data.get("message_id") or data.get("id")
        or message.get("messageId") or message.get("message_id") or message.get("id")
    )

    inserted = data.get("insertedMessages")
    first = inserted[0] if isinstance(inserted, list) and inserted and isinstance(inserted[0], dict) else {}
    history = first.get("statusHistory")
    last = history[-1] if isinstance(history, list) and history and isinstance(history[-1], dict) else {}

    status = status or first.get("status") or last.get("status")
    message_id = (
        message_id
        or first.get("messageId") or first.get("message_id") or first.get("id") or first.get("_id")
        or last.get("messageId") or last.get("message_id") or last.get("id") or last.get("_id")
        or first.get("groupId") or first.get("subgroupId")
        or data.get("batchId") or data.get("batch_id")
    )

    return (str(status) if status else None, str(message_id) if message_id else None)


@router.post("/bird/status")
async def bird_status_callback(request: Request) -> Response:
    data = await _payload(request)
    message = data.get("message") if isinstance(data.get("message"), dict) else {}
    status = data.get("status") or message.get("status") or data.get("messageStatus")
    message_id = (
        data.get("id")
        or data.get("messageId")
        or data.get("message_id")
        or message.get("id")
        or message.get("messageId")
        or message.get("message_id")
    )
    error = data.get("errorCode") or data.get("error_code") or data.get("error")
    try:
        await reconcile_provider_status(
            provider="bird",
            provider_message_id=message_id,
            status=status,
            error_code=str(error) if error else None,
        )
    except Exception:
        logger.exception("Bird status callback reconciliation failed")
    return Response(status_code=204)


@router.post("/clicksend/status")
async def clicksend_status_callback(request: Request) -> Response:
    data = await _payload(request)
    status = data.get("status") or data.get("message_status") or data.get("status_text")
    message_id = data.get("message_id") or data.get("messageid") or data.get("id")
    error = data.get("error_code") or data.get("error") or data.get("status_code")
    try:
        await reconcile_provider_status(
            provider="clicksend",
            provider_message_id=message_id,
            status=status,
            error_code=str(error) if error else None,
        )
    except Exception:
        logger.exception("ClickSend status callback reconciliation failed")
    return Response(status_code=204)


@router.post("/signalhouse/status")
async def signalhouse_status_callback(request: Request) -> Response:
    """Reconcile Signal House SMS/MMS delivery callbacks."""
    data = await _payload(request)
    status, message_id = _signalhouse_extract_status_and_message_id(data)
    error = data.get("errorCode") or data.get("error_code") or data.get("error")
    try:
        await reconcile_provider_status(
            provider="signalhouse",
            provider_message_id=message_id,
            status=status,
            error_code=str(error) if error else None,
        )
    except Exception:
        logger.exception("Signal House status callback reconciliation failed")
    return Response(status_code=204)
