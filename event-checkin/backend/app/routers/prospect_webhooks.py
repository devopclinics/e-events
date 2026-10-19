"""Dedicated sales-inbox webhooks, isolated from event guest communications."""
import hmac
from datetime import datetime,timezone
from email.utils import parseaddr

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.engagement_config import engagement_settings
from app.database import get_db
from app.routers.resend_webhooks import _verify_svix_signature
from app.services.marketing_client import enqueue_marketing_payload
from app.services.prospect_ingress import bounded_body, email_address, event_key, incoming_event, object_payload, phone_number, sales_intent, authenticated_message_time

router = APIRouter()


def require_enabled():
    if not engagement_settings.prospect_ingress_enabled:
        raise HTTPException(status_code=503, detail="Prospect ingress is not enabled")


@router.post("/prospects/chatwoot")
async def prospect_chatwoot_webhook(
    request: Request, token: str = Query(""), db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    require_enabled()
    configured = engagement_settings.prospect_chatwoot_webhook_token
    if not configured or not engagement_settings.prospect_chatwoot_account_id or not engagement_settings.prospect_chatwoot_inbox_id:
        raise HTTPException(status_code=503, detail="Prospect chat ingress is not configured")
    if not hmac.compare_digest(token, configured):
        raise HTTPException(status_code=403, detail="Invalid webhook token")
    payload = object_payload(await bounded_body(request))
    account, inbox = payload.get("account") or {}, payload.get("inbox") or {}
    if not isinstance(account, dict) or not isinstance(inbox, dict):
        raise HTTPException(status_code=400, detail="Invalid account or inbox")
    if str(account.get("id", "")) != engagement_settings.prospect_chatwoot_account_id or str(inbox.get("id", "")) != engagement_settings.prospect_chatwoot_inbox_id:
        raise HTTPException(status_code=403, detail="Unexpected sales inbox")
    if payload.get("event") != "message_created" or payload.get("message_type") not in ("incoming", 0) or payload.get("private") is not False:
        return {"ok": True}
    sender = payload.get("sender") or {}
    if not isinstance(sender, dict) or sender.get("type", "contact") != "contact":
        return {"ok": True}
    provider_id = payload.get("id")
    email, phone = email_address(sender.get("email")), phone_number(sender.get("phone_number"))
    contact_id = sender.get("id")
    if provider_id is None or contact_id is None:
        return {"ok": True}
    identity = {"email": email} if email else ({"phone": phone} if phone else {})
    await enqueue_marketing_payload(db, {
        "channel": "chat", "event": incoming_event(payload.get("content")), **identity,
        # Public pre-chat details are claimed, not verified account identity.
        # Store a separate contact/handoff, never change another lead by email.
        "identity_verified": False,
        "source_contact_id": f"chatwoot:{engagement_settings.prospect_chatwoot_account_id}:{engagement_settings.prospect_chatwoot_inbox_id}:{contact_id}",
    }, endpoint="conversations", event_id=event_key("chatwoot", f"{engagement_settings.prospect_chatwoot_account_id}:{provider_id}"))
    conversation=payload.get("conversation")
    thread_id=str(conversation.get("id") or "") if isinstance(conversation,dict) else ""
    received=authenticated_message_time(payload.get("created_at"))
    intent=sales_intent(payload.get("content"))
    can_respond=received is not None and thread_id.isdigit()
    if engagement_settings.sales_responses_enabled and (can_respond or intent in {"opt_out","handoff"}):
        await enqueue_marketing_payload(db, {
            "channel": "chat", "contact_id": f"chatwoot:{engagement_settings.prospect_chatwoot_account_id}:{engagement_settings.prospect_chatwoot_inbox_id}:{contact_id}",
            "thread_id": thread_id,
            "transport_account_id": engagement_settings.prospect_chatwoot_account_id,
            "destination": engagement_settings.prospect_chatwoot_inbox_id,
            "received_at": received or datetime.now(timezone.utc).isoformat(), "intent": intent, "window_verified":can_respond,
            "authenticated": True, "direction": "inbound",
        }, endpoint="sales-responses", event_id=event_key("chat-sales", f"{engagement_settings.prospect_chatwoot_account_id}:{provider_id}"))
    await db.commit()
    return {"ok": True}


@router.post("/prospects/resend")
async def prospect_resend_webhook(
    request: Request, db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    require_enabled()
    # Deliberately not the guest inbound route or its receiving addresses.
    secret = settings.resend_inbound_webhook_secret
    destinations = {email_address(value) for value in engagement_settings.prospect_email_recipients.split(",")}
    destinations.discard(None)
    if not secret or not destinations:
        raise HTTPException(status_code=503, detail="Prospect email ingress is not configured")
    raw = await bounded_body(request)
    if not _verify_svix_signature(raw, request.headers, secret):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")
    payload = object_payload(raw)
    if payload.get("type") != "email.received":
        return {"ok": True}
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid email metadata")
    recipients = data.get("to") or []
    recipients = recipients if isinstance(recipients, list) else [recipients]
    allowed_recipients = []
    for value in recipients:
        address = email_address(value)
        if not address:
            continue
        # Email matching is case-insensitive, but the opaque reply signature
        # contains case-sensitive base64. Preserve the original local part.
        local, domain = parseaddr(value)[1].strip().rsplit("@", 1)
        domain = domain.lower()
        base = f"{local.split('+', 1)[0].lower()}@{domain}"
        if address in destinations or (local.startswith("reply+") and base in destinations):
            allowed_recipients.append(f"{local}@{domain}")
    if not allowed_recipients:
        return {"ok": True}
    sender = email_address(data.get("from"))
    provider_id = data.get("email_id")
    if not sender or not isinstance(provider_id, str) or not provider_id:
        raise HTTPException(status_code=400, detail="Missing inbound email identity")
    # Resend notifications contain metadata, not body content. Every reply
    # pauses automation for human review; an exact opt-out subject also
    # revokes email consent. No email body fetch or LLM call occurs here.
    await enqueue_marketing_payload(db, {
        "channel": "email", "event": incoming_event(data.get("subject")), "email": sender,
        "identity_verified": False, "source_contact_id": event_key("resend-contact", sender),
        # The Marketing service verifies this HMAC and intended sender before
        # matching a lead. A signed Resend callback alone does not verify From.
        "reply_token": next((address.split("@", 1)[0][len("reply+"):] for address in allowed_recipients if address.startswith("reply+")), None),
    }, endpoint="conversations", event_id=event_key("resend-inbound", provider_id))
    await db.commit()
    return {"ok": True}
