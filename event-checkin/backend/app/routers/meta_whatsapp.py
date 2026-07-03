"""Meta WhatsApp Cloud API webhooks."""
import logging

from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/whatsapp/meta")
async def verify_meta_whatsapp_webhook(
    hub_mode: str = Query("", alias="hub.mode"),
    hub_verify_token: str = Query("", alias="hub.verify_token"),
    hub_challenge: str = Query("", alias="hub.challenge"),
) -> Response:
    """Respond to Meta's webhook verification challenge."""
    if hub_mode == "subscribe" and hub_verify_token == settings.meta_whatsapp_webhook_verify_token:
        return Response(content=hub_challenge, media_type="text/plain")
    raise HTTPException(status_code=403, detail="Invalid webhook verification token")


@router.post("/whatsapp/meta")
async def receive_meta_whatsapp_webhook(request: Request) -> dict[str, bool]:
    """Acknowledge incoming Meta WhatsApp webhook events.

    The app can process message/status events here later. For setup, Meta only
    requires a fast 200 response so webhook delivery is acknowledged.
    """
    payload = await request.json()
    logger.info("Meta WhatsApp webhook received: object=%s", payload.get("object"))
    return {"ok": True}
