"""xwireless.net SMS delivery-report (DLR) webhook.

Configure xwireless portal → SMS MT → WebHooks with:

    Endpoint Base URI : https://festio.events/api/webhooks/xwireless
    Method            : POST
    Handler           : DLR

Parameters to map (Key → Value):
    msgid    → ##MessageId##
    status   → ##Status##
    mobile   → ##Who##

xwireless POSTs (or GETs) these when a message is delivered / failed.
The handler updates EventMessageDeliveryLog.status and
MessageCreditLedger.status so the dashboard delivery count stays accurate.
"""
import logging

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import EventMessageDeliveryLog, MessageCreditLedger

logger = logging.getLogger(__name__)

router = APIRouter()

# xwireless DLR status strings → normalised internal status
_STATUS_MAP: dict[str, str] = {
    "delivered": "delivered",
    "delivery successful": "delivered",
    "delivrd": "delivered",
    "success": "delivered",
    "failed": "failed",
    "undelivered": "failed",
    "delivery failed": "failed",
    "expired": "failed",
    "rejected": "failed",
    "absent subscriber": "failed",
}


def _normalise(raw: str | None) -> str:
    if not raw:
        return "unknown"
    return _STATUS_MAP.get(raw.strip().lower(), raw.strip().lower())


async def _update_by_provider_id(
    db: AsyncSession,
    provider_message_id: str,
    status: str,
) -> int:
    """Update all delivery-log and ledger rows for a given provider_message_id.
    Returns the number of rows updated."""
    updated = 0

    rows = (
        await db.execute(
            select(EventMessageDeliveryLog).where(
                EventMessageDeliveryLog.provider_message_id == provider_message_id
            )
        )
    ).scalars().all()
    for row in rows:
        row.status = status
        updated += 1

    ledger_rows = (
        await db.execute(
            select(MessageCreditLedger).where(
                MessageCreditLedger.provider_message_id == provider_message_id,
                MessageCreditLedger.provider == "xwireless",
            )
        )
    ).scalars().all()
    for row in ledger_rows:
        # A successful provider submission is recorded as a posted spend. The
        # DLR is what promotes it to delivered or failed.
        if row.status not in ("delivered", "failed", "refunded"):
            row.status = status if status == "delivered" else "failed"
            updated += 1

    await db.commit()
    return updated


@router.post("/xwireless")
@router.get("/xwireless")
async def xwireless_dlr(
    request: Request,
    db: AsyncSession = Depends(get_db),
    # Accept params from both query string (GET) and form body (POST form-encoded)
    msgid: str | None = Query(default=None, alias="msgid"),
    status: str | None = Query(default=None, alias="status"),
    mobile: str | None = Query(default=None, alias="mobile"),
):
    """Receive xwireless DLR (delivery report) callbacks."""
    # Also parse form-encoded POST body if present
    body: dict = {}
    content_type = request.headers.get("content-type", "")
    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        body = dict(await request.form())
    elif "application/json" in content_type:
        try:
            body = await request.json()
        except Exception:
            body = {}

    msg_id = msgid or body.get("msgid") or body.get("MessageId") or body.get("message_id")
    raw_status = status or body.get("status") or body.get("Status") or body.get("DeliveryStatus")
    mobile_no = mobile or body.get("mobile") or body.get("Who") or body.get("MobileNumber")

    logger.info(
        "xwireless DLR: msgid=%s status=%s mobile=%s",
        msg_id, raw_status, mobile_no,
    )

    if not msg_id:
        # Nothing to look up — acknowledge anyway so xwireless stops retrying
        logger.warning("xwireless DLR received with no msgid (mobile=%s status=%s)", mobile_no, raw_status)
        return Response(content="OK", media_type="text/plain")

    normalised = _normalise(raw_status)
    updated = await _update_by_provider_id(db, msg_id, normalised)
    logger.info("xwireless DLR updated %d row(s) for msgid=%s → %s", updated, msg_id, normalised)

    return Response(content="OK", media_type="text/plain")
