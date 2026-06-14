"""Inbound messaging webhooks.

Twilio POSTs a delivery-status callback here for every outbound SMS/WhatsApp
message as it moves through its lifecycle (queued → sent → delivered, or failed/
undelivered). Configure this endpoint as the **Status Callback URL** on the
Twilio Messaging Service (or phone number) sending the traffic:

    https://events.vsgs.io/api/messaging/twilio/status

The handler is intentionally forgiving: it always returns 204 so Twilio doesn't
retry/queue on transient app errors, and signature validation is enforced only
when an auth token is configured.
"""
import logging

from fastapi import APIRouter, Request, Response

from app.config import settings

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

    # 204: acknowledge without a body so Twilio marks the callback delivered.
    return Response(status_code=204)
