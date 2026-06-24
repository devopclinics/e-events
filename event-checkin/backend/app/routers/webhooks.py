"""Meta WhatsApp webhook — handles verification and incoming message events."""
import logging
from fastapi import APIRouter, Request, Response, HTTPException, Query

from ..config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/whatsapp")
async def whatsapp_verify(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
):
    """Meta calls this GET endpoint to verify the webhook URL."""
    if hub_mode == "subscribe" and hub_verify_token == settings.meta_wa_verify_token:
        logger.info("Meta WhatsApp webhook verified")
        return Response(content=hub_challenge, media_type="text/plain")
    logger.warning("Meta WhatsApp webhook verification failed — token mismatch")
    raise HTTPException(403, "Verification failed")


@router.post("/whatsapp")
async def whatsapp_events(request: Request):
    """Meta posts message and status events here."""
    try:
        body = await request.json()
        for entry in body.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                # Inbound messages (guests replying)
                for msg in value.get("messages", []):
                    phone  = msg.get("from")
                    m_type = msg.get("type")
                    text   = msg.get("text", {}).get("body", "") if m_type == "text" else f"[{m_type}]"
                    logger.info("WhatsApp inbound from=%s text=%r", phone, text)
                # Delivery / read status updates
                for status in value.get("statuses", []):
                    logger.info(
                        "WhatsApp status id=%s to=%s status=%s",
                        status.get("id"), status.get("recipient_id"), status.get("status"),
                    )
    except Exception:
        logger.exception("Error processing WhatsApp webhook event")
    # Always return 200 so Meta doesn't retry
    return Response(status_code=200)
