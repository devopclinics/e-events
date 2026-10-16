"""Authenticated Meta webhook ingress; never sends an automatic reply."""
import hashlib
import hmac

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.engagement_config import engagement_settings
from app.database import get_db
from app.services.marketing_client import enqueue_marketing_payload
from app.services.prospect_ingress import bounded_body, event_key, incoming_event, object_payload, phone_number

router = APIRouter()


@router.get("/whatsapp/meta")
async def verify_meta_whatsapp_webhook(
    hub_mode: str = Query("", alias="hub.mode"),
    hub_verify_token: str = Query("", alias="hub.verify_token"),
    hub_challenge: str = Query("", alias="hub.challenge"),
) -> Response:
    configured = engagement_settings.meta_whatsapp_webhook_verify_token
    if configured and hub_mode == "subscribe" and hmac.compare_digest(hub_verify_token, configured):
        return Response(content=hub_challenge, media_type="text/plain")
    raise HTTPException(status_code=403, detail="Invalid webhook verification token")


@router.post("/whatsapp/meta")
async def receive_meta_whatsapp_webhook(
    request: Request, db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    if not engagement_settings.prospect_ingress_enabled or not engagement_settings.meta_whatsapp_app_secret:
        raise HTTPException(status_code=503, detail="Prospect WhatsApp ingress is not enabled")
    if not engagement_settings.meta_whatsapp_sales_phone_number_id:
        raise HTTPException(status_code=503, detail="Prospect WhatsApp destination is not configured")
    raw = await bounded_body(request)
    expected = "sha256=" + hmac.new(engagement_settings.meta_whatsapp_app_secret.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(request.headers.get("x-hub-signature-256", ""), expected):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")
    payload = object_payload(raw)
    if payload.get("object") != "whatsapp_business_account":
        return {"ok": True}
    entries = payload.get("entry", [])
    if not isinstance(entries, list):
        raise HTTPException(status_code=400, detail="Invalid webhook entries")
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        changes = entry.get("changes", [])
        for change in changes if isinstance(changes, list) else []:
            if not isinstance(change, dict) or change.get("field") != "messages":
                continue
            value = change.get("value")
            if not isinstance(value, dict):
                continue
            metadata = value.get("metadata") or {}
            if not isinstance(metadata, dict) or str(metadata.get("phone_number_id", "")) != engagement_settings.meta_whatsapp_sales_phone_number_id:
                continue  # Never attach guest/event-channel traffic to the sales CRM.
            messages = value.get("messages", [])
            for message in messages if isinstance(messages, list) else []:
                if not isinstance(message, dict):
                    continue
                provider_id = message.get("id")
                phone = phone_number(message.get("from"))
                if not isinstance(provider_id, str) or not provider_id or not phone:
                    continue
                content = message.get("text") or {}
                text = content.get("body") if isinstance(content, dict) else None
                # Delivery notifications and our own sends have no inbound
                # messages. Any received attachment also pauses follow-ups.
                await enqueue_marketing_payload(db, {
                    "channel": "whatsapp", "event": incoming_event(text), "phone": phone,
                    "identity_verified": True, "source_contact_id": f"meta:{phone}",
                }, endpoint="conversations", event_id=event_key("meta", provider_id))
    await db.commit()  # 200 only after durable capture; provider retries failures.
    return {"ok": True}
