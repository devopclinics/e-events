"""Per-channel message delivery reporting.

Shared by routers/dashboard.py and routers/billing.py so both report the
same numbers -- billing.py previously only counted action="spend" rows and
missed nearly every send made through the org-wallet path (action="reserve"),
undercounting real volume by roughly 100x on some events. See
services/credit_ledger.py for why a single logical send can appear under
either action depending on which credit system was active when it was sent.

Email is deliberately NOT covered by channel_delivery_report(): its ledger
rows never get a real delivery outcome written back to them (see
services/email_service.py's _charge_email_credit, which charges credit
before the send attempt and never reconciles the ledger row afterward) --
its real delivery status lives in EmailDeliveryEvent instead. Use
email_delivery_report() for that.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import EmailDeliveryEvent, MessageCreditLedger

FAILED_STATUSES = {
    "failed", "undelivered", "error", "rejected", "refunded",
    "sending_failed", "delivery_failed", "skipped", "deleted",
    "invalid_recipient", "country_not_enabled", "insufficient_credit",
}
# Terminal-success synonyms that don't literally contain "deliver" -- e.g.
# Twilio/Signal House record "success"/"sent" as their best-known final
# state when no separate delivery-receipt webhook ever fires for this
# account. Without recognizing these, a real successful send was invisible
# in reporting: neither "delivered" nor "failed".
DELIVERED_SYNONYMS = {"success", "sent"}

CHANNELS = ("sms", "mms", "whatsapp")


async def channel_delivery_report(db: AsyncSession, event_id: str, channels: tuple[str, ...] = CHANNELS) -> dict:
    """Returns {channel: {"sent": int, "delivered": int, "failed": int, "credits_spent": int}}.

    Counts each distinct message once, deduped by provider_message_id (or
    the ledger row id when a provider id was never recorded) -- a refund
    mutates or accompanies the same logical send, not a second message.
    """
    rows = (await db.execute(
        select(
            MessageCreditLedger.id, MessageCreditLedger.channel, MessageCreditLedger.action,
            MessageCreditLedger.status, MessageCreditLedger.credits, MessageCreditLedger.provider_message_id,
        ).where(MessageCreditLedger.event_id == event_id, MessageCreditLedger.channel.in_(channels))
    )).all()

    ids = {c: {"sent": set(), "delivered": set(), "failed": set()} for c in channels}
    credits_spent = {c: 0 for c in channels}
    for row_id, channel, action, status, credits, provider_message_id in rows:
        bucket = ids.get(channel)
        if bucket is None:
            continue
        key = provider_message_id or f"ledger:{row_id}"
        if action in ("spend", "reserve"):
            bucket["sent"].add(key)
            st = (status or "").lower()
            if "deliver" in st or st in DELIVERED_SYNONYMS:
                bucket["delivered"].add(key)
            elif st in FAILED_STATUSES:
                bucket["failed"].add(key)
            credits_spent[channel] += abs(credits or 0)
        elif action == "refund":
            bucket["failed"].add(key)

    out = {}
    for c in channels:
        sent, failed = ids[c]["sent"], ids[c]["failed"]
        delivered = ids[c]["delivered"] - failed
        out[c] = {"sent": len(sent), "delivered": len(delivered), "failed": len(failed), "credits_spent": credits_spent[c]}
    return out


async def email_delivery_report(db: AsyncSession, event_id: str) -> dict:
    """Email's real outcome lives in EmailDeliveryEvent (webhook-driven),
    not the credit ledger. Counts distinct recipients per terminal status,
    since one email typically produces multiple lifecycle events
    (accepted -> sent -> delivered)."""
    rows = (await db.execute(
        select(EmailDeliveryEvent.recipient, EmailDeliveryEvent.status)
        .where(EmailDeliveryEvent.event_id == event_id)
    )).all()
    by_recipient: dict[str, set[str]] = {}
    for recipient, status in rows:
        by_recipient.setdefault(recipient or "", set()).add((status or "").lower())

    delivered = failed = blocked = sent_only = 0
    for statuses in by_recipient.values():
        if "delivered" in statuses:
            delivered += 1
        elif "bounced" in statuses or "suppressed" in statuses:
            failed += 1
        elif "blocked_no_credits" in statuses:
            blocked += 1
        else:
            sent_only += 1
    total = len(by_recipient)
    return {
        "recipients": total, "delivered": delivered, "failed": failed,
        "blocked_no_credits": blocked, "sent_unconfirmed": sent_only,
    }
