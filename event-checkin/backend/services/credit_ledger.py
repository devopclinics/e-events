import logging
from typing import Any, Awaitable, Callable

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.entitlements import refund_message_credit
from app.models import Event, MessageCreditLedger

logger = logging.getLogger(__name__)


async def send_with_credit_ledger(
    ledger_id: str | None,
    send_func: Callable[..., Awaitable[Any]],
    **kwargs,
) -> None:
    """Run a provider send and reconcile the matching credit-ledger row.

    Send adapters return a small dict when the provider gives us an id:
    {"provider": "twilio", "provider_message_id": "...", "status": "queued"}.
    If a provider reports immediate failure, refund the debit.
    """
    try:
        result = await send_func(**kwargs)
    except Exception:
        logger.exception("Provider send crashed; refunding ledger=%s", ledger_id)
        await refund_ledger_by_id(ledger_id, reason="provider_exception")
        return

    if not ledger_id or not isinstance(result, dict):
        return

    provider_message_id = result.get("provider_message_id") or result.get("id")
    provider = result.get("provider")
    status = (result.get("status") or "").lower()
    async with AsyncSessionLocal() as db:
        ledger = await db.get(MessageCreditLedger, ledger_id)
        if not ledger:
            return
        if provider:
            ledger.provider = provider
        if provider_message_id:
            ledger.provider_message_id = str(provider_message_id)
        if status in {"failed", "undelivered", "rejected", "error"}:
            event = await db.get(Event, ledger.event_id)
            if event:
                refund_message_credit(event, ledger, reason=f"provider_{status}")
        await db.commit()


async def refund_ledger_by_id(ledger_id: str | None, *, reason: str) -> bool:
    if not ledger_id:
        return False
    async with AsyncSessionLocal() as db:
        ledger = await db.get(MessageCreditLedger, ledger_id)
        if not ledger:
            return False
        event = await db.get(Event, ledger.event_id)
        if not event:
            return False
        refund_message_credit(event, ledger, reason=reason)
        await db.commit()
        return True


async def reconcile_provider_status(
    *,
    provider: str,
    provider_message_id: str | None,
    status: str | None,
    error_code: str | None = None,
) -> bool:
    if not provider_message_id:
        return False
    status_key = (status or "").lower()
    async with AsyncSessionLocal() as db:
        ledger = (await db.execute(
            select(MessageCreditLedger).where(
                MessageCreditLedger.provider == provider,
                MessageCreditLedger.provider_message_id == provider_message_id,
            )
        )).scalars().first()
        if not ledger:
            return False
        if error_code:
            ledger.reason = f"{ledger.reason or 'message'}:{error_code}"
        if status_key in {"failed", "undelivered", "rejected", "error"}:
            event = await db.get(Event, ledger.event_id)
            if event:
                refund_message_credit(event, ledger, reason=f"delivery_{status_key}")
        elif status_key in {"delivered", "sent"}:
            ledger.status = "posted"
        await db.commit()
        return True
