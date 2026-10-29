import asyncio
import contextlib
import csv
import io
import json
import logging
import secrets
import hashlib
import httpx
from datetime import datetime, timedelta
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only
from .auth import Identity, current_identity, require_admin, require_service_enabled
from .config import settings
from .database import SessionLocal, get_db
from .models import AuditEvent, CancellationRequest, EventConfig, FeePolicy, JournalLine, LedgerEntry, OperationsSubscription, Order, OrderItem, PaymentEvent, PaymentRefund, PrivacyRequest, PromoCode, PayoutAccount, TicketProduct, TicketTransfer, WaitlistEntry, uid
from .providers import provider, verify_paystack, verify_stripe
from .schemas import SetupConfirmIn, BulkResendIn, CancellationDecisionIn, CancellationIn, ComplimentaryOrderIn, EventConfigIn, FeePolicyIn, OperationsSubscriptionIn, OrderIn, PaystackAccountIn, PrivacyDecisionIn, PrivacyRequestIn, ProductIn, PromoIn, ProviderBootstrapIn, RefundIn, SalesReportIn, StripeAccountIn, TransferIn, WaitlistIn, WaitlistOfferIn

from .safety import order_view, payment_kind, csv_safe, checkout_limits, peer_address, client_network, clean_buckets, lock_buyer
from .readiness import checklist, provider_fingerprint
from .provider_errors import stripe_onboarding_error
from .stripe_connect import managed_account, create_managed_account, managed_account_link, refresh_managed_account

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="Festio Ticketing Service", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","),
                   allow_credentials=False, allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    settings.assert_safe_environment()
    app.state.operations_task = asyncio.create_task(operations_loop())


@app.on_event("shutdown")
async def shutdown():
    task = getattr(app.state, "operations_task", None)
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


@app.get("/health")
def health():
    test_mode = settings.environment.lower() != "production"
    return {"status": "ok", "service": "ticketing-service", "enabled": settings.service_enabled,
            "environment": settings.environment, "test_mode": test_mode}


@app.get("/api/ticketing/status")
def public_status():
    return {"enabled": settings.service_enabled, "environment": settings.environment,
            "test_mode": settings.environment.lower() != "production"}


def product_out(p):
    value = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    if isinstance(p,EventConfig):
        value['setup_checks']={key:item for key,item in (p.setup_checks or {}).items() if key not in {'webhook_fingerprint','payout_fingerprint'}}
    return value


def provider_ready(name: str) -> bool:
    prefix = "sk_live_" if settings.environment.lower() == "production" else "sk_test_"
    return name == "fake" or (name == "stripe" and settings.stripe_secret_key.startswith(prefix)) or \
        (name == "paystack" and settings.paystack_secret_key.startswith(prefix))


def secure_token_matches(expected: str | None, supplied: str | None) -> bool:
    return bool(expected and supplied) and secrets.compare_digest(expected, supplied)


async def provider_readiness(name: str) -> dict:
    """Validate configured test credentials and remote provider state without returning secrets."""
    result = {"provider": name, "credentials_configured": provider_ready(name),
              "account_verified": False, "webhook_configured": False, "action_required": []}
    if not result["credentials_configured"]:
        result["action_required"].append(
            f"Add the {name.title()} {'live' if settings.environment.lower() == 'production' else 'test'} secret key")
        return result
    webhook_url = f"{settings.public_base_url}/api/ticketing/webhooks/{name}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if name == "stripe":
                headers = {"Authorization": f"Bearer {settings.stripe_secret_key}"}
                account = await client.get("https://api.stripe.com/v1/account", headers=headers)
                result["account_verified"] = account.status_code == 200
                hooks = await client.get("https://api.stripe.com/v1/webhook_endpoints", headers=headers,
                                         params={"limit": 100})
                if hooks.status_code == 200:
                    result["webhook_configured"] = any(
                        row.get("url") == webhook_url and row.get("status") == "enabled"
                        for row in hooks.json().get("data", []))
            else:
                headers = {"Authorization": f"Bearer {settings.paystack_secret_key}"}
                account = await client.get("https://api.paystack.co/transaction/totals", headers=headers)
                result["account_verified"] = account.status_code == 200 and account.json().get("status") is True
                # Paystack does not expose integration webhook settings through its public API.
                result["webhook_configured"] = False
                result["webhook_status"] = "dashboard_confirmation_required"
    except httpx.HTTPError:
        result["action_required"].append("Provider API could not be reached; retry the readiness check")
        return result
    if not result["account_verified"]:
        result["action_required"].append("The configured provider key was rejected")
    if not result["webhook_configured"]:
        result["action_required"].append(
            "Set the Paystack dashboard webhook URL, then confirm it here" if name == "paystack"
            else "Register the Stripe webhook endpoint")
    return result


async def ensure_stripe_webhook() -> dict:
    """Idempotently create the Stripe webhook endpoint for this environment.

    Stripe only returns the signing secret at creation. The caller must place it in
    the secret store and restart the service; it is never persisted in this DB.
    """
    state = await provider_readiness("stripe")
    if not state["credentials_configured"] or not state["account_verified"]:
        raise HTTPException(503, "Stripe credentials are not valid for this environment")
    if state["webhook_configured"]:
        return {**state, "created": False, "signing_secret": None}
    url = f"{settings.public_base_url}/api/ticketing/webhooks/stripe"
    data = [("url", url), ("description", f"Festio {settings.environment} ticket payments")]
    for event in ("checkout.session.completed", "charge.dispute.created", "charge.refunded",
                  "refund.created", "refund.updated", "refund.failed"):
        data.append(("enabled_events[]", event))
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post("https://api.stripe.com/v1/webhook_endpoints", data=data,
                                     auth=(settings.stripe_secret_key, ""))
    if response.status_code >= 400:
        raise HTTPException(502, "Stripe webhook registration failed")
    payload = response.json()
    return {**state, "webhook_configured": True, "created": True,
            "endpoint_id": payload.get("id"), "signing_secret": payload.get("secret"),
            "next_action": "Store signing_secret as STRIPE_WEBHOOK_SECRET and restart ticketing-service"}


def safe_refund_retry(status: str, attempts: int) -> bool:
    return status == "failed" and attempts < 3


def safe_payment_event_replay(provider_name: str, event_type: str, processed: bool, attempts: int) -> bool:
    return (not processed and attempts < 5 and
            (provider_name, event_type) in {
                ("stripe", "checkout.session.completed"), ("stripe", "checkout.session.async_payment_succeeded"), ("paystack", "charge.success")})


def payout_out(row: PayoutAccount):
    return {"id": row.id, "provider": row.provider, "business_name": row.business_name,
            "account_name": row.account_name, "account_last4": row.account_last4,
            "currency": row.currency, "status": row.status, "charges_enabled": row.charges_enabled,
            "payouts_enabled": row.payouts_enabled, "created_at": row.created_at,
            "risk_management": "stripe" if managed_account(row) else "legacy",
            "charge_type": "direct" if managed_account(row) else "legacy"}


def add_journal(db: AsyncSession, order: Order, *, kind: str, amount: int,
                reference: str | None = None, refund_id: str | None = None) -> str:
    """Post a balanced immutable journal transaction for a payment or refund."""
    transaction_id = uid()
    fee = order.platform_fee * amount // order.total if order.total else 0
    tax = order.tax_amount * amount // order.total if order.total else 0
    organizer = amount - fee - tax
    liabilities = (("platform_revenue", fee), ("tax_payable", tax),
                   ("organizer_payable", max(0, organizer)))
    organizer_receivable = max(0, -organizer)
    metadata = {"kind": kind, **({"refund_id": refund_id} if refund_id else {})}
    if kind == "payment":
        db.add(JournalLine(id=uid(), transaction_id=transaction_id, order_id=order.id,
            event_id=order.event_id, account="provider_clearing", debit=amount, credit=0,
            currency=order.currency, reference=reference, metadata_json=metadata))
        if organizer_receivable:
            db.add(JournalLine(id=uid(), transaction_id=transaction_id, order_id=order.id,
                event_id=order.event_id, account="organizer_receivable", debit=organizer_receivable,
                credit=0, currency=order.currency, reference=reference, metadata_json=metadata))
        for account, value in liabilities:
            if value:
                db.add(JournalLine(id=uid(), transaction_id=transaction_id, order_id=order.id,
                    event_id=order.event_id, account=account, debit=0, credit=value,
                    currency=order.currency, reference=reference, metadata_json=metadata))
    else:
        db.add(JournalLine(id=uid(), transaction_id=transaction_id, order_id=order.id,
            event_id=order.event_id, account="provider_clearing", debit=0, credit=amount,
            currency=order.currency, reference=reference, metadata_json=metadata))
        if organizer_receivable:
            db.add(JournalLine(id=uid(), transaction_id=transaction_id, order_id=order.id,
                event_id=order.event_id, account="organizer_receivable", debit=0,
                credit=organizer_receivable, currency=order.currency, reference=reference,
                metadata_json=metadata))
        for account, value in liabilities:
            if value:
                db.add(JournalLine(id=uid(), transaction_id=transaction_id, order_id=order.id,
                    event_id=order.event_id, account=account, debit=value, credit=0,
                    currency=order.currency, reference=reference, metadata_json=metadata))
    return transaction_id


def allocate_ticket_values(total: int, weights: list[int]) -> list[int]:
    """Deterministically allocate every minor currency unit across tickets."""
    if not weights:
        return []
    denominator = sum(max(0, value) for value in weights)
    allocations = ([total * max(0, value) // denominator for value in weights]
                   if denominator else [total // len(weights) for _ in weights])
    for index in range(total - sum(allocations)):
        allocations[index % len(allocations)] += 1
    return allocations


def inventory_available(*, capacity: int, sold: int, held: int, reserved: int,
                        own_reservation: int, requested: int, minimum: int, maximum: int) -> bool:
    return minimum <= requested <= maximum and \
        sold + held + reserved - own_reservation + requested <= capacity


async def effective_fee(db: AsyncSession, org_id: str, event_id: str) -> dict:
    rows = (await db.execute(select(FeePolicy).where(
        ((FeePolicy.scope_type == "global") & (FeePolicy.scope_id == "*")) |
        ((FeePolicy.scope_type == "organization") & (FeePolicy.scope_id == org_id)) |
        ((FeePolicy.scope_type == "event") & (FeePolicy.scope_id == event_id))
    ))).scalars().all()
    by_scope = {row.scope_type: row for row in rows}
    chosen = by_scope.get("event") or by_scope.get("organization") or by_scope.get("global")
    return {"fee_bps": chosen.fee_bps if chosen else settings.platform_fee_bps,
            "fees_paid_by": chosen.fees_paid_by if chosen else "buyer",
            "source": chosen.scope_type if chosen else "platform_default"}


async def expire_abandoned_orders(db: AsyncSession, event_id: str | None = None) -> int:
    query = select(Order).where(Order.status == "pending", Order.hold_expires_at < datetime.utcnow())
    if event_id: query = query.where(Order.event_id == event_id)
    rows = (await db.execute(query.with_for_update())).scalars().all()
    for order in rows:
        order.status = "expired"
        if order.waitlist_entry_id:
            waitlist = await db.get(WaitlistEntry, order.waitlist_entry_id)
            if waitlist and waitlist.status == "claimed":
                waitlist.status, waitlist.offer_token = "waiting", None
                waitlist.offer_expires_at = None
    if rows: await db.commit()
    return len(rows)


async def deliver_waitlist_message(row: WaitlistEntry, product_row: TicketProduct, *, reminder: bool = False) -> bool:
    offer_url = f"{settings.public_base_url}/tickets/e/{row.event_id}?offer={row.offer_token}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{settings.core_backend_url}/api/internal/ticketing/waitlist-offer/{row.event_id}",
                headers={"X-Internal-Token": settings.internal_service_token},
                json={"email": row.email, "name": row.name, "ticket_name": product_row.name,
                      "offer_url": offer_url, "expires_at": row.offer_expires_at.isoformat(),
                      "reminder": reminder})
            response.raise_for_status()
        return True
    except httpx.HTTPError:
        logging.exception("Waitlist %s email failed for %s", "reminder" if reminder else "offer", row.id)
        return False


async def maintain_waitlist(db: AsyncSession) -> dict:
    """Expire stale offers, remind active buyers, then offer free inventory FIFO."""
    now = datetime.utcnow()
    expired = (await db.execute(select(WaitlistEntry).where(
        WaitlistEntry.status == "offered", WaitlistEntry.offer_expires_at <= now).with_for_update())).scalars().all()
    for row in expired:
        row.status, row.offer_token, row.offer_expires_at = "expired", None, None
        db.add(AuditEvent(id=uid(), event_id=row.event_id, actor="system", action="waitlist.offer.expired",
                          subject_id=row.id, details={"attempt": row.offer_attempts}))

    reminder_cutoff = now + timedelta(minutes=settings.waitlist_reminder_minutes)
    reminders = (await db.execute(select(WaitlistEntry).where(
        WaitlistEntry.status == "offered", WaitlistEntry.reminder_sent_at.is_(None),
        WaitlistEntry.offer_expires_at > now, WaitlistEntry.offer_expires_at <= reminder_cutoff))).scalars().all()

    products = (await db.execute(select(TicketProduct).where(TicketProduct.active.is_(True)))).scalars().all()
    offered = []
    for product_row in products:
        reserved = int(await db.scalar(select(func.coalesce(func.sum(WaitlistEntry.quantity), 0)).where(
            WaitlistEntry.product_id == product_row.id, WaitlistEntry.status == "offered",
            WaitlistEntry.offer_expires_at > now)) or 0)
        available = product_row.capacity - product_row.sold - reserved
        if available <= 0:
            continue
        candidates = (await db.execute(select(WaitlistEntry).where(
            WaitlistEntry.product_id == product_row.id,
            WaitlistEntry.status.in_(("waiting", "expired")),
            WaitlistEntry.offer_attempts < 3).order_by(WaitlistEntry.created_at).with_for_update())).scalars().all()
        for row in candidates:
            if row.quantity > available:
                continue
            row.status, row.offer_token = "offered", uid().replace("-", "")
            row.offered_at, row.reminder_sent_at = now, None
            row.offer_expires_at = now + timedelta(minutes=settings.waitlist_offer_minutes)
            row.offer_attempts += 1
            db.add(AuditEvent(id=uid(), event_id=row.event_id, actor="system", action="waitlist.offer.created",
                              subject_id=row.id, details={"quantity": row.quantity,
                              "attempt": row.offer_attempts, "expires_at": row.offer_expires_at.isoformat()}))
            offered.append((row, product_row)); available -= row.quantity
            if available <= 0:
                break
    await db.commit()
    delivered = 0
    for row, product_row in offered:
        delivered += int(await deliver_waitlist_message(row, product_row))
    for row in reminders:
        product_row = await db.get(TicketProduct, row.product_id)
        if product_row and await deliver_waitlist_message(row, product_row, reminder=True):
            row.reminder_sent_at = now
            delivered += 1
    if reminders:
        await db.commit()
    return {"expired": len(expired), "offered": len(offered), "messages_delivered": delivered}


async def deliver_scheduled_operations_report(db: AsyncSession, sub: OperationsSubscription) -> None:
    orders = (await db.execute(select(Order).where(Order.event_id == sub.event_id)
                               .order_by(Order.created_at.desc()))).scalars().all()
    refunds = (await db.execute(select(PaymentRefund).where(
        PaymentRefund.event_id == sub.event_id))).scalars().all()
    order_refs = {ref for order in orders for ref in (order.provider_reference, order.payment_reference) if ref}
    failed_rows = (await db.execute(select(PaymentEvent).where(
        PaymentEvent.processed.is_(False), PaymentEvent.last_error.is_not(None)))).scalars().all()
    failed_events = 0
    for event_row in failed_rows:
        payload = event_row.payload or {}
        obj = payload.get("data", {}).get("object", {})
        data = payload.get("data", {})
        references = {obj.get("id"), obj.get("payment_intent"), data.get("reference")}
        if order_refs & references:
            failed_events += 1
    active = [o for o in orders if o.status in ("paid", "fulfilled", "partially_refunded")]
    gross = sum(o.total for o in orders if o.status in (
        "paid", "fulfilled", "partially_refunded", "refunded", "refund_processing", "disputed"))
    refund_total = sum(r.amount for r in refunds if r.status == "completed")
    alerts = {
        "failed_refunds": sum(1 for r in refunds if r.status in ("failed", "retry_unknown")),
        "processing_refunds": sum(1 for r in refunds if r.status == "processing"),
        "disputed_orders": sum(1 for o in orders if o.status == "disputed"),
        "failed_provider_events": failed_events,
        "unconfirmed_ticket_email":sum(1 for order in orders if order.status=='fulfilled' and order.delivery_queued_at and order.delivery_queued_at<datetime.utcnow()-timedelta(minutes=15) and order.email_delivery_status not in {'sent','delivered','not_requested'}),
    }
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["order_id", "created_at", "buyer_email", "provider", "status", "currency", "total"])
    for order in orders:
        writer.writerow([csv_safe(v) for v in [order.id, order.created_at.isoformat(), order.buyer_email,
                         order.provider, order.status, order.currency, order.total]])
    currency = orders[0].currency if orders else ""
    alert_html = ""
    if sub.include_alerts:
        alert_html = ("<h3>Items requiring attention</h3><ul>" + "".join(
            f"<li>{key.replace('_', ' ').title()}: <strong>{value}</strong></li>"
            for key, value in alerts.items()) + "</ul>")
    html_body = (f"<p>Your scheduled Festio ticket operations report is attached.</p>"
                 f"<p><strong>{len(active)}</strong> active paid orders · "
                 f"Gross {currency} {gross / 100:,.2f} · Refunds {currency} {refund_total / 100:,.2f}</p>"
                 f"{alert_html}")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(f"{settings.core_backend_url}/api/internal/ticketing/sales-report/{sub.event_id}",
            headers={"X-Internal-Token": settings.internal_service_token},
            json={"recipient": sub.recipient, "subject": "Scheduled Festio ticket operations report",
                  "html_body": html_body, "csv_content": output.getvalue(),
                  "filename": f"ticket-operations-{sub.event_id[:8]}.csv"})
        response.raise_for_status()
    sub.last_sent_at, sub.last_error = datetime.utcnow(), None
    db.add(AuditEvent(id=uid(), event_id=sub.event_id, actor="system",
                      action="sales_report.scheduled", details={"recipient": sub.recipient, **alerts}))


async def process_scheduled_reports(db: AsyncSession) -> int:
    now = datetime.utcnow()
    rows = (await db.execute(select(OperationsSubscription).where(
        OperationsSubscription.enabled.is_(True), OperationsSubscription.next_run_at <= now)
        .order_by(OperationsSubscription.next_run_at).limit(20).with_for_update(skip_locked=True))).scalars().all()
    processed = 0
    for sub in rows:
        # Advance first so concurrent workers cannot deliver the same schedule.
        sub.next_run_at = now + timedelta(days=7 if sub.frequency == "weekly" else 1)
        await db.commit()
        try:
            await deliver_scheduled_operations_report(db, sub)
            processed += 1
        except Exception as exc:
            sub.last_error = str(exc)[:1000]
            logging.exception("Scheduled ticket report failed for %s", sub.event_id)
        await db.commit()
    return processed


async def operations_loop():
    while True:
        try:
            async with SessionLocal() as db:
                await clean_buckets(db)
                await expire_abandoned_orders(db)
                await maintain_waitlist(db)
                await process_scheduled_reports(db)
        except Exception:
            logging.exception("Ticketing operations maintenance failed")
        await asyncio.sleep(max(15, settings.operations_interval_seconds))


@app.get("/api/ticketing/public/events/{event_id}/tickets", dependencies=[Depends(require_service_enabled)])
async def public_tickets(event_id: str, db: AsyncSession = Depends(get_db)):
    cfg = await db.get(EventConfig, event_id)
    preview_mode = bool(cfg and not cfg.enabled and (cfg.delivery_settings or {}).get("public_checkout_preview"))
    if not cfg or (not cfg.enabled and not preview_mode):
        raise HTTPException(404, "Ticketing is not available for this event")
    if not preview_mode:
        await expire_abandoned_orders(db, event_id)
    now = datetime.utcnow()
    rows = (await db.execute(select(TicketProduct).where(
        TicketProduct.event_id == event_id, TicketProduct.active.is_(True),
        (TicketProduct.sale_starts_at.is_(None) | (TicketProduct.sale_starts_at <= now)),
        (TicketProduct.sale_ends_at.is_(None) | (TicketProduct.sale_ends_at >= now)),
    ).order_by(TicketProduct.sort_order, TicketProduct.name))).scalars().all()
    fee_policy = await effective_fee(db, cfg.org_id, event_id)
    return {"enabled": True, "preview_mode": preview_mode, "currency": cfg.currency,
            "require_attendee_names": bool((cfg.delivery_settings or {}).get("require_attendee_names")),
            "show_availability": not bool((cfg.delivery_settings or {}).get("hide_availability")),
            "fee": {"bps": fee_policy["fee_bps"], "paid_by": cfg.fees_paid_by},
            "test_mode": settings.environment.lower() != "production",
            "tax": {"enabled": cfg.tax_enabled, "bps": cfg.tax_bps, "paid_by": cfg.tax_paid_by},
            "checkout_fields": cfg.checkout_fields or [],
            "tickets": [{**product_out(p), "available": max(0, p.capacity - p.sold)} for p in rows]}


@app.post("/api/ticketing/public/events/{event_id}/waitlist", dependencies=[Depends(require_service_enabled)])
async def join_waitlist(event_id: str, body: WaitlistIn, db: AsyncSession = Depends(get_db)):
    cfg, product_row = await db.get(EventConfig, event_id), await db.get(TicketProduct, body.product_id)
    if not cfg or not cfg.enabled or not product_row or product_row.event_id != event_id or not product_row.active:
        raise HTTPException(404, "Ticket is unavailable")
    row = WaitlistEntry(id=uid(), event_id=event_id, product_id=product_row.id,
                        name=body.name.strip(), email=str(body.email).lower(), quantity=body.quantity)
    db.add(row)
    try: await db.commit()
    except IntegrityError:
        await db.rollback()
        row = await db.scalar(select(WaitlistEntry).where(
            WaitlistEntry.product_id == product_row.id, WaitlistEntry.email == str(body.email).lower()))
    return {"id": row.id, "status": row.status, "ticket_name": product_row.name}


@app.get("/api/ticketing/public/waitlist/offers/{token}", dependencies=[Depends(require_service_enabled)])
async def waitlist_offer(token: str, db: AsyncSession = Depends(get_db)):
    row = await db.scalar(select(WaitlistEntry).where(
        WaitlistEntry.offer_token == token, WaitlistEntry.status == "offered",
        WaitlistEntry.offer_expires_at > datetime.utcnow()))
    if not row: raise HTTPException(404, "Waitlist offer is unavailable")
    product_row = await db.get(TicketProduct, row.product_id)
    return {"event_id": row.event_id, "product_id": row.product_id, "ticket_name": product_row.name,
            "quantity": row.quantity, "name": row.name, "email": row.email,
            "expires_at": row.offer_expires_at}


@app.get("/api/ticketing/public/events", dependencies=[Depends(require_service_enabled)])
async def public_events(db: AsyncSession = Depends(get_db)):
    # Checkout may remain available by direct link while marketplace discovery is off.
    configs = (await db.execute(select(EventConfig).where(
        EventConfig.enabled.is_(True), EventConfig.public_listing.is_(True)))).scalars().all()
    if not configs:
        return {"events": []}
    ids = [row.event_id for row in configs]
    products = (await db.execute(select(TicketProduct).where(
        TicketProduct.event_id.in_(ids), TicketProduct.active.is_(True)))).scalars().all()
    by_event = {}
    for item in products:
        if item.capacity > item.sold:
            by_event.setdefault(item.event_id, []).append(item)
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(f"{settings.core_backend_url}/api/internal/ticketing/events",
            headers={"X-Internal-Token": settings.internal_service_token}, json={"event_ids": ids})
    response.raise_for_status()
    metadata = {row["id"]: row for row in response.json().get("events", [])}
    rows = []
    for cfg in configs:
        event_products = by_event.get(cfg.event_id, [])
        event = metadata.get(cfg.event_id)
        if event and event_products:
            starts = event.get("event_date")
            ends = event.get("event_end_date") or starts
            if ends and datetime.fromisoformat(ends.replace("Z", "+00:00")).replace(tzinfo=None) < datetime.utcnow():
                continue
            state = "current" if starts and datetime.fromisoformat(starts.replace("Z", "+00:00")).replace(tzinfo=None) <= datetime.utcnow() else "upcoming"
            rows.append({**event, "currency": cfg.currency,
                         "from_price": min(p.price for p in event_products),
                         "ticket_types": len(event_products),
                         "sales_url": f"{settings.public_base_url}/tickets/e/{cfg.event_id}",
                         "invite_url": f"{settings.public_base_url}/invite/{cfg.event_id}",
                         "timing": state})
    return {"events": rows}


@app.get("/api/ticketing/public/events/{event_id}", dependencies=[Depends(require_service_enabled)])
async def public_event_detail(event_id: str, db: AsyncSession = Depends(get_db)):
    cfg = await db.get(EventConfig, event_id)
    if not cfg or not cfg.enabled:
        raise HTTPException(404, "Ticket sales are unavailable for this event")
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(f"{settings.core_backend_url}/api/internal/ticketing/events",
            headers={"X-Internal-Token": settings.internal_service_token}, json={"event_ids": [event_id]})
    response.raise_for_status()
    event = next((row for row in response.json().get("events", []) if row["id"] == event_id), None)
    if not event:
        raise HTTPException(404, "Event not available")
    return {**event, "currency": cfg.currency, "enabled": True,
            "sales_url": f"{settings.public_base_url}/tickets/e/{event_id}"}


@app.get("/api/ticketing/events/{event_id}/config")
async def get_config(event_id: str, ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    cfg = await db.get(EventConfig, event_id)
    fee = await effective_fee(db, ident.org_id, event_id)
    config = product_out(cfg) if cfg else None
    if config:
        config.update({"fee_bps": fee["fee_bps"]})
    return {"service_enabled": settings.service_enabled, "config": config,
            "test_mode": settings.environment.lower() != "production",
            "default_currency": ident.currency, "go_live": await checklist(db,cfg,ident.currency),
            "providers": {"stripe": provider_ready("stripe"), "paystack": provider_ready("paystack")},
            "fee_policy": {**fee, "fees_paid_by": cfg.fees_paid_by if cfg else fee["fees_paid_by"],
                           "can_manage": ident.is_platform_superadmin}}


@app.get('/api/ticketing/events/{event_id}/request-protection')
async def request_protection(event_id: str,request: Request,ident: Identity=Depends(current_identity)):
    require_admin(ident)
    if ident.event_id!=event_id:raise HTTPException(403,'Wrong event scope')
    # Organizers see only their own resolved address; platform superadmins may
    # inspect hop addresses. No credentials, buyer data or database writes.
    details=client_network(request)
    if ident.is_platform_superadmin:
        details.update(peer=request.client.host if request.client else None,forwarded_hops=request.headers.get('x-forwarded-for','').split(','))
    return {**details,'per_ip_per_minute':settings.checkout_ip_per_minute,
            'per_email_per_hour':settings.checkout_email_per_hour,'pending_per_email':settings.checkout_pending_per_email}


@app.get('/api/ticketing/events/{event_id}/go-live')
async def go_live(event_id: str,ident: Identity=Depends(current_identity),db: AsyncSession=Depends(get_db)):
    require_admin(ident)
    if ident.event_id!=event_id:raise HTTPException(403,'Wrong event scope')
    return await checklist(db,await db.get(EventConfig,event_id),ident.currency)


@app.post('/api/ticketing/events/{event_id}/setup-confirmation')
async def confirm_setup(event_id: str,body: SetupConfirmIn,ident: Identity=Depends(current_identity),db: AsyncSession=Depends(get_db)):
    require_admin(ident)
    if ident.event_id!=event_id:raise HTTPException(403,'Wrong event scope')
    cfg=await db.get(EventConfig,event_id,with_for_update=True)
    if not cfg or cfg.currency!=body.currency:raise HTTPException(409,'Save and review the selected ticket currency first')
    checks=dict(cfg.setup_checks or {})
    if body.confirm_currency:checks.update(currency=cfg.currency,currency_confirmed=True)
    if body.confirm_payout:
        account=await db.scalar(select(PayoutAccount).where(PayoutAccount.org_id==ident.org_id,PayoutAccount.provider==cfg.provider,PayoutAccount.provider_account_id==cfg.provider_account_id))
        if managed_account(account):
            await refresh_managed_account(account)
        valid=bool(account and account.currency==cfg.currency and account.charges_enabled and account.payouts_enabled and ((account.provider=='paystack' and account.account_name and account.status in {'created','verified'}) or account.status=='verified'))
        if not valid:raise HTTPException(409,'Connect and select the active organizer payout account first')
        checks.update(payout_confirmed_account_id=cfg.provider_account_id,payout_fingerprint=provider_fingerprint(cfg.provider))
    if body.confirm_webhook_dashboard:
        if not provider_ready(cfg.provider):raise HTTPException(409,'Configure provider credentials before confirming its dashboard webhook')
        account = await db.scalar(select(PayoutAccount).where(PayoutAccount.org_id == ident.org_id,
            PayoutAccount.provider == cfg.provider, PayoutAccount.provider_account_id == cfg.provider_account_id)) if cfg.provider_account_id else None
        scope = "connected" if managed_account(account) else "platform"
        if scope == "connected" and not settings.stripe_connect_webhook_secret:
            raise HTTPException(409, "Configure the connected-account webhook before confirming it")
        checks.update(webhook_confirmed=True,webhook_provider=cfg.provider,webhook_fingerprint=provider_fingerprint(cfg.provider),webhook_scope=scope)
    if body.confirm_alert_destination:
        sub=await db.scalar(select(OperationsSubscription).where(OperationsSubscription.event_id==event_id,OperationsSubscription.enabled.is_(True),OperationsSubscription.include_alerts.is_(True)))
        if not sub or not sub.recipient:raise HTTPException(409,'Enable a scheduled operations report with an alert destination first')
        checks['alert_confirmed']=True
    checks.update(confirmed_at=datetime.utcnow().isoformat(),confirmed_by=ident.subject)
    cfg.setup_checks=checks
    db.add(AuditEvent(id=uid(),event_id=event_id,actor=ident.subject,action='setup.confirmed',details={'currency':cfg.currency,'provider':cfg.provider,'currency_confirmed':body.confirm_currency,'payout_confirmed':body.confirm_payout,'webhook_dashboard_confirmed':body.confirm_webhook_dashboard,'alert_destination_confirmed':body.confirm_alert_destination}))
    await db.commit()
    return await checklist(db,cfg,ident.currency)


@app.get("/api/ticketing/events/{event_id}/provider-readiness")
async def get_provider_readiness(event_id: str, ident: Identity = Depends(current_identity)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    stripe, paystack = await asyncio.gather(provider_readiness("stripe"), provider_readiness("paystack"))
    return {"environment": settings.environment, "public_base_url": settings.public_base_url,
            "providers": {"stripe": stripe, "paystack": paystack},
            "automated": ["credential validation", "Stripe webhook registration", "signed webhook processing",
                          "refund and settlement reconciliation"],
            "human_approval": ["provider KYC and bank approval", "secret-store write",
                               "Paystack dashboard webhook setting", "legal tax sign-off"]}


@app.post("/api/ticketing/events/{event_id}/provider-bootstrap")
async def bootstrap_provider(event_id: str, body: ProviderBootstrapIn,
                             ident: Identity = Depends(current_identity)):
    if not ident.is_platform_superadmin:
        raise HTTPException(403, "Only a platform superadmin can bootstrap payment providers")
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    if body.provider == "stripe" and body.register_webhook:
        return await ensure_stripe_webhook()
    return await provider_readiness(body.provider)


@app.put("/api/ticketing/events/{event_id}/config")
async def put_config(event_id: str, body: EventConfigIn, ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    if (body.provider == "stripe" and body.currency != "USD") or (body.provider == "paystack" and body.currency != "NGN"):
        raise HTTPException(400, "Stripe ticketing currently requires USD; Paystack ticketing requires NGN")
    if body.enabled and not provider_ready(body.provider):
        raise HTTPException(503, f"{body.provider.title()} credentials are not configured")
    cfg = await db.get(EventConfig, event_id) or EventConfig(event_id=event_id, org_id=ident.org_id)
    was_enabled=bool(getattr(cfg,"enabled",False))
    if cfg.currency != body.currency:
        existing = await db.scalar(select(func.count(TicketProduct.id)).where(TicketProduct.event_id == event_id))
        if existing:
            raise HTTPException(409, "Currency cannot change after tickets have been created")
    for key, value in body.model_dump().items():
        if key in ("checkout_fields", "delivery_settings") and value is None:
            continue
        setattr(cfg, key, value)
    if body.enabled and not was_enabled and settings.environment=='production':
        paid_products=await db.scalar(select(func.count(TicketProduct.id)).where(TicketProduct.event_id==event_id,TicketProduct.price>0,TicketProduct.active.is_(True)))
        if paid_products and not (await checklist(db,cfg,ident.currency))['ready']:
            raise HTTPException(409,'Complete the paid-sales checklist before enabling this event')
    fee = await effective_fee(db, ident.org_id, event_id)
    cfg.fee_bps = fee["fee_bps"]
    db.add(cfg)
    await db.commit()
    await db.refresh(cfg)
    return product_out(cfg)


@app.put("/api/ticketing/events/{event_id}/fee-policy")
async def set_fee_policy(event_id: str, body: FeePolicyIn, ident: Identity = Depends(current_identity),
                         db: AsyncSession = Depends(get_db)):
    if not ident.is_platform_superadmin:
        raise HTTPException(403, "Only a platform superadmin can change Festio fees")
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    scope_id = {"global": "*", "organization": ident.org_id, "event": event_id}[body.scope]
    row = await db.scalar(select(FeePolicy).where(FeePolicy.scope_type == body.scope,
                                                  FeePolicy.scope_id == scope_id))
    if not row:
        row = FeePolicy(id=uid(), scope_type=body.scope, scope_id=scope_id, updated_by=ident.subject,
                        fee_bps=body.fee_bps, fees_paid_by=body.fees_paid_by)
    else:
        row.fee_bps, row.fees_paid_by, row.updated_by = body.fee_bps, body.fees_paid_by, ident.subject
    db.add(row); await db.commit()
    return await effective_fee(db, ident.org_id, event_id)


@app.delete("/api/ticketing/events/{event_id}/fee-policy/{scope}")
async def delete_fee_policy(event_id: str, scope: str, ident: Identity = Depends(current_identity),
                            db: AsyncSession = Depends(get_db)):
    if not ident.is_platform_superadmin:
        raise HTTPException(403, "Only a platform superadmin can change Festio fees")
    if ident.event_id != event_id or scope not in ("global", "organization", "event"):
        raise HTTPException(400, "Invalid fee policy scope")
    scope_id = {"global": "*", "organization": ident.org_id, "event": event_id}[scope]
    row = await db.scalar(select(FeePolicy).where(FeePolicy.scope_type == scope, FeePolicy.scope_id == scope_id))
    if row:
        await db.delete(row); await db.commit()
    return await effective_fee(db, ident.org_id, event_id)


@app.get("/api/ticketing/events/{event_id}/payout-accounts")
async def list_payout_accounts(event_id: str, ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    rows = (await db.execute(select(PayoutAccount).where(PayoutAccount.org_id == ident.org_id)
                             .order_by(PayoutAccount.created_at.desc()))).scalars().all()
    stripe_rows = [row for row in rows if row.provider == "stripe"]
    if stripe_rows and provider_ready("stripe"):
        async with httpx.AsyncClient(timeout=20) as client:
            for row in stripe_rows:
                if managed_account(row):
                    await refresh_managed_account(row)
                    continue
                response = await client.get(f"https://api.stripe.com/v1/accounts/{row.provider_account_id}",
                                            auth=(settings.stripe_secret_key, ""))
                if response.status_code < 400:
                    data = response.json()
                    row.charges_enabled = bool(data.get("charges_enabled"))
                    row.payouts_enabled = bool(data.get("payouts_enabled"))
                    row.status = "verified" if row.charges_enabled and row.payouts_enabled else "onboarding"
        await db.commit()
    cfg = await db.get(EventConfig, event_id)
    return [{**payout_out(row), "selected": bool(cfg and cfg.provider == row.provider and
                                                  cfg.provider_account_id == row.provider_account_id)} for row in rows]


async def stripe_account_link(account_id: str) -> str:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post("https://api.stripe.com/v1/account_links",
                                     auth=(settings.stripe_secret_key, ""), data={
            "account": account_id, "type": "account_onboarding",
            "refresh_url": f"{settings.public_base_url}/ticketing-redesign?stripe=refresh",
            "return_url": f"{settings.public_base_url}/ticketing-redesign?stripe=complete",
        })
    if response.status_code >= 400:
        raise stripe_onboarding_error(response, "start payout onboarding", (account_id, settings.stripe_secret_key))
    return response.json()["url"]


@app.get("/api/ticketing/events/{event_id}/paystack/banks")
async def paystack_banks(event_id: str, ident: Identity = Depends(current_identity)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    if not provider_ready("paystack"):
        raise HTTPException(503, "Paystack test mode is not configured")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get("https://api.paystack.co/bank", params={"currency": "NGN", "perPage": 200},
                                    headers={"Authorization": f"Bearer {settings.paystack_secret_key}"})
    if response.status_code >= 400 or not response.json().get("status"):
        raise HTTPException(502, "Paystack bank list is unavailable")
    return [{"name": item["name"], "code": item["code"]} for item in response.json()["data"]]


@app.post("/api/ticketing/events/{event_id}/payout-accounts/paystack", status_code=201)
async def create_paystack_account(event_id: str, body: PaystackAccountIn,
                                  ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    if not provider_ready("paystack"):
        raise HTTPException(503, "Paystack test mode is not configured")
    headers = {"Authorization": f"Bearer {settings.paystack_secret_key}"}
    async with httpx.AsyncClient(timeout=20) as client:
        resolved = await client.get("https://api.paystack.co/bank/resolve",
                                    params={"account_number": body.account_number, "bank_code": body.settlement_bank},
                                    headers=headers)
        if resolved.status_code >= 400 or not resolved.json().get("status"):
            raise HTTPException(400, "Paystack could not verify that bank account")
        account_name = resolved.json()["data"]["account_name"]
        fee = await effective_fee(db, ident.org_id, event_id)
        payload = {"business_name": body.business_name, "settlement_bank": body.settlement_bank,
                   "account_number": body.account_number, "percentage_charge": fee["fee_bps"] / 100,
                   "primary_contact_name": body.contact_name, "primary_contact_email": str(body.contact_email or ""),
                   "primary_contact_phone": body.contact_phone,
                   "metadata": json.dumps({"festio_org_id": ident.org_id, "created_by": ident.subject})}
        payload = {key: value for key, value in payload.items() if value not in (None, "")}
        created = await client.post("https://api.paystack.co/subaccount", json=payload, headers=headers)
    if created.status_code >= 400 or not created.json().get("status"):
        raise HTTPException(502, "Paystack could not create the organizer subaccount")
    data = created.json()["data"]
    row = PayoutAccount(id=uid(), org_id=ident.org_id, provider="paystack",
                        provider_account_id=data["subaccount_code"], business_name=body.business_name,
                        account_name=account_name, account_last4=body.account_number[-4:], currency="NGN",
                        status="verified" if data.get("is_verified") else "created",
                        charges_enabled=bool(data.get("active", True)), payouts_enabled=bool(data.get("active", True)),
                        details={"settlement_bank": data.get("settlement_bank"), "domain": data.get("domain")})
    db.add(row); await db.commit(); await db.refresh(row)
    return payout_out(row)


@app.post("/api/ticketing/events/{event_id}/payout-accounts/stripe", status_code=201)
async def create_stripe_account(event_id: str, body: StripeAccountIn,
                                ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    if not provider_ready("stripe"):
        raise HTTPException(503, "Stripe credentials are not configured")
    account = await create_managed_account(ident.org_id, body.business_name, str(body.email), body.country)
    row = await db.scalar(select(PayoutAccount).where(PayoutAccount.org_id == ident.org_id,
        PayoutAccount.provider == "stripe", PayoutAccount.provider_account_id == account["id"]))
    if not row:
        row = PayoutAccount(id=uid(), org_id=ident.org_id, provider="stripe",
            provider_account_id=account["id"], business_name=body.business_name,
            account_name=body.business_name, currency="USD", status="onboarding",
            charges_enabled=False, payouts_enabled=False,
            details={"country": body.country, "api_version": "v2", "charge_type": "direct", "losses_collector": "stripe"})
        db.add(row)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            row = await db.scalar(select(PayoutAccount).where(PayoutAccount.org_id == ident.org_id,
                PayoutAccount.provider == "stripe", PayoutAccount.provider_account_id == account["id"]))
            if not row:
                raise
        await db.refresh(row)
    # Keep the account even if link creation fails, so onboarding can be resumed.
    onboarding_url = await managed_account_link(row.provider_account_id)
    return {**payout_out(row), "onboarding_url": onboarding_url}


@app.post("/api/ticketing/events/{event_id}/payout-accounts/{account_id}/onboarding-link")
async def resume_stripe_onboarding(event_id: str, account_id: str, ident: Identity = Depends(current_identity),
                                   db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    account = await db.get(PayoutAccount, account_id)
    if not account or account.org_id != ident.org_id or account.provider != "stripe":
        raise HTTPException(404, "Stripe payout account not found")
    if not provider_ready("stripe"):
        raise HTTPException(503, "Stripe credentials are not configured")
    return {"onboarding_url": await (managed_account_link(account.provider_account_id) if managed_account(account) else stripe_account_link(account.provider_account_id))}


@app.post("/api/ticketing/events/{event_id}/payout-accounts/{account_id}/select")
async def select_payout_account(event_id: str, account_id: str, ident: Identity = Depends(current_identity),
                                db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    account = await db.get(PayoutAccount, account_id)
    if not account or account.org_id != ident.org_id:
        raise HTTPException(404, "Payout account not found")
    cfg = await db.get(EventConfig, event_id) or EventConfig(event_id=event_id, org_id=ident.org_id)
    if cfg.currency != account.currency:
        existing = await db.scalar(select(func.count(TicketProduct.id)).where(TicketProduct.event_id == event_id))
        if existing:
            raise HTTPException(409, "This account's currency does not match existing tickets")
    cfg.provider, cfg.provider_account_id, cfg.currency = account.provider, account.provider_account_id, account.currency
    db.add(cfg); await db.commit(); await db.refresh(cfg)
    return {"config": product_out(cfg), "account": payout_out(account)}


@app.get("/api/ticketing/events/{event_id}/products")
async def list_products(event_id: str, ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    rows = (await db.execute(select(TicketProduct).where(TicketProduct.event_id == event_id)
                             .order_by(TicketProduct.sort_order))).scalars().all()
    return [product_out(row) for row in rows]


@app.post("/api/ticketing/events/{event_id}/products", status_code=201)
async def create_product(event_id: str, body: ProductIn, ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    cfg = await db.get(EventConfig, event_id)
    if not cfg or body.currency != cfg.currency:
        raise HTTPException(400, "Product currency must match event ticketing currency")
    if settings.environment=='production' and not ((getattr(cfg,'setup_checks',None) or {}).get('currency_confirmed') and (cfg.setup_checks or {}).get('currency')==cfg.currency):
        raise HTTPException(409,'Confirm the ticket settlement currency in Payments before creating products')
    row = TicketProduct(id=uid(), event_id=event_id, **body.model_dump())
    db.add(row); await db.commit(); await db.refresh(row)
    return product_out(row)


@app.put("/api/ticketing/events/{event_id}/products/{product_id}")
async def update_product(event_id: str, product_id: str, body: ProductIn,
                         ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    row = await db.get(TicketProduct, product_id)
    if ident.event_id != event_id or not row or row.event_id != event_id:
        raise HTTPException(404, "Ticket not found")
    if body.capacity < row.sold:
        raise HTTPException(409, "Capacity cannot be lower than tickets already sold")
    for key, value in body.model_dump().items(): setattr(row, key, value)
    await db.commit(); await db.refresh(row)
    return product_out(row)


@app.delete("/api/ticketing/events/{event_id}/products/{product_id}", status_code=204)
async def delete_product(event_id: str, product_id: str, ident: Identity = Depends(current_identity),
                         db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    row = await db.get(TicketProduct, product_id)
    if ident.event_id != event_id or not row or row.event_id != event_id:
        raise HTTPException(404, "Ticket not found")
    if row.sold:
        row.active = False
    else:
        await db.delete(row)
    await db.commit()


@app.get("/api/ticketing/events/{event_id}/promos")
async def list_promos(event_id: str, ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    return [product_out(r) for r in (await db.execute(select(PromoCode).where(
        PromoCode.event_id == event_id).order_by(PromoCode.code))).scalars().all()]


@app.post("/api/ticketing/events/{event_id}/promos", status_code=201)
async def create_promo(event_id: str, body: PromoIn, ident: Identity = Depends(current_identity),
                       db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id: raise HTTPException(403, "Wrong event scope")
    row = PromoCode(id=uid(), event_id=event_id, **body.model_dump())
    row.code = row.code.upper()
    db.add(row)
    try: await db.commit()
    except IntegrityError:
        await db.rollback(); raise HTTPException(409, "Promo code already exists")
    await db.refresh(row); return product_out(row)


@app.post("/api/ticketing/public/events/{event_id}/orders", status_code=201, dependencies=[Depends(require_service_enabled)])
async def create_order(event_id: str, body: OrderIn, db: AsyncSession = Depends(get_db), request: Request = None):
    cfg = await db.get(EventConfig, event_id)
    if not cfg or not cfg.enabled:
        raise HTTPException(404, "Ticketing is not available for this event")
    if request is not None:
        await checkout_limits(db,event_id,str(body.buyer_email),peer_address(request))
    await expire_abandoned_orders(db, event_id)
    await lock_buyer(db,event_id,str(body.buyer_email))
    held_count=await db.scalar(select(func.count(Order.id)).where(Order.event_id==event_id,
        func.lower(Order.buyer_email)==str(body.buyer_email).lower(),Order.status.in_(['pending','payment_processing'])))
    if int(held_count or 0)>=settings.checkout_pending_per_email:
        raise HTTPException(429,'Finish or wait for an existing pending order before starting another.',headers={'Retry-After':'60'})
    configured_fields = {field["id"]: field for field in (cfg.checkout_fields or [])}
    if set(body.custom_answers) - set(configured_fields):
        raise HTTPException(400, "Checkout contains unknown custom fields")
    for field_id, field in configured_fields.items():
        value = body.custom_answers.get(field_id)
        if field.get("required") and (value is None or value is False or not str(value).strip()):
            raise HTTPException(400, f"{field['label']} is required")
        if field.get("type") == "select" and value and value not in field.get("options", []):
            raise HTTPException(400, f"{field['label']} has an invalid selection")
    ids = [line.product_id for line in body.lines]
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "A ticket product may appear only once")
    products = {p.id: p for p in (await db.execute(
        select(TicketProduct).where(TicketProduct.id.in_(ids), TicketProduct.event_id == event_id)
        .order_by(TicketProduct.id).with_for_update())).scalars().all()}
    offer = None
    if body.waitlist_token:
        offer = await db.scalar(select(WaitlistEntry).where(
            WaitlistEntry.event_id == event_id, WaitlistEntry.offer_token == body.waitlist_token,
            WaitlistEntry.status == "offered", WaitlistEntry.offer_expires_at > datetime.utcnow()).with_for_update())
        if not offer: raise HTTPException(409, "This waitlist offer has expired or was already used")
    subtotal = 0
    for line in body.lines:
        p = products.get(line.product_id)
        if not p or not p.active or p.currency != cfg.currency:
            raise HTTPException(400, "A selected ticket is unavailable")
        if p.product_type == "ticket" and (cfg.delivery_settings or {}).get("require_attendee_names"):
            if any(not attendee.first_name.strip() for attendee in line.attendees):
                raise HTTPException(400, "Enter a first name for every attendee")
        # external products are informational-only (see ProductIn docstring) --
        # never sold through Festio checkout, regardless of what the frontend
        # does or doesn't render. This is the actual enforcement point; the
        # public page's own link-out-instead-of-add-to-cart behavior is UX,
        # not the safety boundary.
        if p.product_type == "external":
            raise HTTPException(400, f"{p.name} is not sold through Festio — use the registration link instead.")
        if line.custom_amount is not None:
            if p.product_type != "donation" or not p.allow_custom_amount:
                raise HTTPException(400, f"{p.name} does not accept a custom amount")
            if line.custom_amount < p.price:
                raise HTTPException(400, f"{p.name} requires a minimum pledge of {p.price} {p.currency}")
            if line.quantity != 1:
                raise HTTPException(400, f"{p.name} accepts only one pledge per order line")
        held = await db.scalar(select(func.coalesce(func.sum(OrderItem.quantity), 0)).join(Order).where(
            OrderItem.product_id == p.id, Order.status == "pending", Order.hold_expires_at > datetime.utcnow()))
        reserved = await db.scalar(select(func.coalesce(func.sum(WaitlistEntry.quantity), 0)).where(
            WaitlistEntry.product_id == p.id, WaitlistEntry.status == "offered",
            WaitlistEntry.offer_expires_at > datetime.utcnow()))
        own_reservation = offer.quantity if offer and offer.product_id == p.id else 0
        if offer and (line.product_id != offer.product_id or line.quantity > offer.quantity):
            raise HTTPException(409, "Order does not match the waitlist offer")
        if not inventory_available(capacity=p.capacity, sold=p.sold, held=int(held or 0),
                                   reserved=int(reserved or 0), own_reservation=own_reservation,
                                   requested=line.quantity, minimum=p.min_per_order,
                                   maximum=p.max_per_order):
            raise HTTPException(409, f"Not enough {p.name} tickets are available")
        subtotal += (line.custom_amount if line.custom_amount is not None else p.price) * line.quantity
    discount = 0
    promo = None
    if body.promo_code:
        promo = await db.scalar(select(PromoCode).where(PromoCode.event_id == event_id,
            PromoCode.code == body.promo_code.strip().upper(), PromoCode.active.is_(True)).with_for_update())
        reserved=await db.scalar(select(func.count(Order.id)).where(Order.event_id==event_id,
            Order.promo_code==promo.code,Order.status.in_(['pending','payment_processing']))) if promo else 0
        if not promo or (promo.max_uses is not None and promo.uses + int(reserved or 0) >= promo.max_uses):
            raise HTTPException(400, "Promo code is invalid or exhausted")
        discount = min(subtotal, subtotal * promo.amount // 100 if promo.kind == "percent" else promo.amount)
    fee_policy = await effective_fee(db, cfg.org_id, event_id)
    fee = max(0, (subtotal - discount) * fee_policy["fee_bps"] // 10000)
    tax = max(0, (subtotal - discount) * cfg.tax_bps // 10000) if cfg.tax_enabled else 0
    total = subtotal - discount + (fee if cfg.fees_paid_by == "buyer" else 0) + \
        (tax if cfg.tax_paid_by == "buyer" else 0)
    if total>0 and settings.environment=='production' and not (await checklist(db,cfg))['ready']:
        raise HTTPException(409,'Paid ticket sales are not ready yet. Please contact the organizer.')
    payout = await db.scalar(select(PayoutAccount).where(PayoutAccount.org_id == cfg.org_id,
        PayoutAccount.provider == "stripe", PayoutAccount.provider_account_id == cfg.provider_account_id)) if cfg.provider == "stripe" and cfg.provider_account_id else None
    direct_account = cfg.provider_account_id if managed_account(payout) else None
    if direct_account and total > 0:
        await refresh_managed_account(payout)
        if not payout.charges_enabled or not payout.payouts_enabled:
            raise HTTPException(409, "Stripe has not enabled payments and payouts for this organizer")
    if direct_account and total > 0 and not settings.stripe_connect_webhook_secret:
        raise HTTPException(409, "Connected-account payment confirmations must be configured before checkout")
    order = Order(id=uid(), event_id=event_id, org_id=cfg.org_id, buyer_name=body.buyer_name,
        buyer_email=str(body.buyer_email), buyer_phone=body.buyer_phone, currency=cfg.currency,
        subtotal=subtotal, discount=discount, platform_fee=fee, tax_amount=tax, total=total, provider=cfg.provider,
        stripe_account_id=direct_account,
        promo_code=promo.code if promo else None, waitlist_entry_id=offer.id if offer else None,
        custom_answers=body.custom_answers,
        hold_expires_at=datetime.utcnow() + timedelta(minutes=settings.inventory_hold_minutes))
    db.add(order)
    total_tickets = sum(line.quantity for line in body.lines)
    holder_index = 0
    for line in body.lines:
        p = products[line.product_id]
        attendee_data = []
        for attendee in line.attendees:
            holder_index += 1
            data = attendee.model_dump(mode="json")
            if not data["first_name"].strip():
                if total_tickets == 1:
                    parts = body.buyer_name.strip().split(maxsplit=1)
                    data["first_name"] = parts[0]
                    data["last_name"] = parts[1] if len(parts) > 1 else ""
                else:
                    data["first_name"], data["last_name"] = "Ticket Holder", str(holder_index)
            attendee_data.append(data)
        db.add(OrderItem(id=uid(), order_id=order.id, product_id=p.id, product_name=p.name,
                         unit_price=line.custom_amount if line.custom_amount is not None else p.price,
                         quantity=line.quantity, attendee_data=attendee_data))
    await db.flush()
    if offer:
        offer.status = "claimed"
    # Nothing to charge -- a genuinely free ticket product, or a promo code
    # that discounted a paid one down to zero. Stripe/Paystack both reject a
    # $0 payment-mode Checkout Session, so there's no provider to hand this
    # to; complete the order directly instead of erroring out at checkout.
    if order.total == 0:
        order.is_test = cfg.provider == "fake" or settings.environment.lower() != "production"
        order.status, order.paid_at = "paid", datetime.utcnow()
        for line in body.lines:
            products[line.product_id].sold += line.quantity
        if promo:
            promo.uses += 1
        order.checkout_url = f"{settings.public_base_url}/tickets/orders/{order.id}?token={order.access_token}&checkout=success"
        await db.commit()
        await fulfill(db, order)
    else:
        reference, url = await provider(cfg.provider).create_checkout(order_id=order.id,
            access_token=order.access_token, email=order.buyer_email, amount=order.total, currency=order.currency,
            account_id=cfg.provider_account_id, fee=order.platform_fee,
            **({"direct": True} if direct_account else {}))
        order.provider_reference, order.checkout_url = reference, url
        await db.commit()
    return {"order_id": order.id, "status": order.status, "checkout_url": order.checkout_url,
            "expires_at": order.hold_expires_at,
            "test_mode": settings.environment.lower() != "production"}


@app.get("/api/ticketing/public/orders/{order_id}", dependencies=[Depends(require_service_enabled)])
async def public_order(order_id: str, token: str, db: AsyncSession = Depends(get_db)):
    order = await db.get(Order, order_id)
    if not order or not secure_token_matches(order.access_token, token):
        raise HTTPException(404, "Order not found")
    visible_status = "expired" if order.status == "pending" and order.hold_expires_at < datetime.utcnow() else order.status
    passes = []
    if order.fulfillment_result:
        for item in order.fulfillment_result.get("passes", []):
            qr_token = item.get("qr_token")
            if qr_token:
                passes.append({"guest_id": item.get("guest_id"), "name": item.get("name"), "ticket_id": qr_token.split("-")[0].upper(),
                               "pass_url": f"{settings.public_base_url}/scan/{qr_token}",
                               "invitation_url": item.get("invitation_url"),
                               "qr_url": f"{settings.public_base_url}/api/scan/{qr_token}/qr.png",
                               "card_url": f"{settings.public_base_url}/api/scan/{qr_token}/card.jpg"})
    cancellation = await db.scalar(select(CancellationRequest).where(CancellationRequest.order_id == order.id))
    return {"id": order.id, "status": visible_status, "currency": order.currency,
            "subtotal": order.subtotal, "discount": order.discount, "platform_fee": order.platform_fee,
            "tax_amount": order.tax_amount, "total": order.total, "buyer_email": order.buyer_email,
            "paid_at": order.paid_at, "fulfilled_at": order.fulfilled_at,
            "delivery_status": order.delivery_status, "passes": passes,
            "cancellation": product_out(cancellation) if cancellation else None}


@app.post("/api/ticketing/public/orders/{order_id}/transfers", dependencies=[Depends(require_service_enabled)])
async def create_transfer(order_id: str, token: str, body: TransferIn, db: AsyncSession = Depends(get_db)):
    order = await db.get(Order, order_id)
    if not order or not secure_token_matches(order.access_token, token) or order.status != "fulfilled":
        raise HTTPException(404, "Transferable order not found")
    valid_guest_ids = {item.get("guest_id") for item in (order.fulfillment_result or {}).get("passes", [])}
    if body.guest_id not in valid_guest_ids:
        raise HTTPException(404, "Ticket not found in this order")
    existing = await db.scalar(select(TicketTransfer).where(
        TicketTransfer.guest_id == body.guest_id, TicketTransfer.status == "pending"))
    if existing:
        await db.delete(existing); await db.flush()
    row = TicketTransfer(id=uid(), order_id=order.id, event_id=order.event_id, guest_id=body.guest_id,
                         recipient_name=body.recipient_name.strip(), recipient_email=str(body.recipient_email).lower())
    db.add(row); await db.commit(); await db.refresh(row)
    return {"id": row.id, "status": row.status,
            "acceptance_url": f"{settings.public_base_url}/tickets/transfers/{row.token}"}


@app.get("/api/ticketing/public/transfers/{token}", dependencies=[Depends(require_service_enabled)])
async def transfer_details(token: str, db: AsyncSession = Depends(get_db)):
    row = await db.scalar(select(TicketTransfer).where(TicketTransfer.token == token))
    if not row: raise HTTPException(404, "Transfer not found")
    return {"status": row.status, "recipient_name": row.recipient_name,
            "recipient_email": row.recipient_email, "event_id": row.event_id}


@app.post("/api/ticketing/public/transfers/{token}/accept", dependencies=[Depends(require_service_enabled)])
async def accept_transfer(token: str, db: AsyncSession = Depends(get_db)):
    row = await db.scalar(select(TicketTransfer).where(TicketTransfer.token == token).with_for_update())
    if not row or row.status != "pending": raise HTTPException(409, "Transfer is no longer available")
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(f"{settings.core_backend_url}/api/internal/ticketing/transfer/{row.event_id}",
                headers={"X-Internal-Token": settings.internal_service_token},
                json={"order_id": row.order_id, "guest_id": row.guest_id,
                      "recipient_name": row.recipient_name, "recipient_email": row.recipient_email})
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.json().get("detail", "Transfer could not be completed")
        raise HTTPException(exc.response.status_code, detail) from exc
    row.status, row.accepted_at = "accepted", datetime.utcnow()
    order = await db.get(Order, row.order_id)
    updated_result = dict(order.fulfillment_result or {})
    updated_result["passes"] = [{**item, **({"qr_token": response.json()["qr_token"],
        "name": response.json()["name"], "invitation_url": response.json().get("invitation_url")} if item.get("guest_id") == row.guest_id else {})}
        for item in updated_result.get("passes", [])]
    order.fulfillment_result = updated_result
    db.add(AuditEvent(id=uid(), event_id=row.event_id, actor=row.recipient_email,
                      action="ticket.transfer.accepted", subject_id=row.guest_id,
                      details={"order_id": row.order_id, "transfer_id": row.id}))
    await db.commit()
    return {"status": "accepted", **response.json()}


@app.post("/api/ticketing/public/orders/{order_id}/cancellations", dependencies=[Depends(require_service_enabled)])
async def request_cancellation(order_id: str, token: str, body: CancellationIn,
                               db: AsyncSession = Depends(get_db)):
    order = await db.get(Order, order_id)
    if not order or not secure_token_matches(order.access_token, token):
        raise HTTPException(404, "Order not found")
    if order.status not in ("paid", "fulfilled", "partially_refunded"):
        raise HTTPException(409, "This order is not eligible for cancellation")
    existing = await db.scalar(select(CancellationRequest).where(CancellationRequest.order_id == order.id))
    if existing:
        return product_out(existing)
    row = CancellationRequest(id=uid(), order_id=order.id, event_id=order.event_id,
                              reason=body.reason.strip(), status="pending")
    db.add(row); await db.commit(); await db.refresh(row)
    return product_out(row)


@app.post("/api/ticketing/public/orders/{order_id}/privacy-requests", dependencies=[Depends(require_service_enabled)])
async def request_order_privacy(order_id: str, token: str, body: PrivacyRequestIn,
                                db: AsyncSession = Depends(get_db)):
    order = await db.get(Order, order_id)
    if not order or not secure_token_matches(order.access_token, token): raise HTTPException(404, "Order not found")
    row = await db.scalar(select(PrivacyRequest).where(
        PrivacyRequest.order_id == order.id, PrivacyRequest.kind == body.kind))
    if not row:
        row = PrivacyRequest(id=uid(), order_id=order.id, event_id=order.event_id,
                             kind=body.kind, reason=body.reason,
                             status="completed" if body.kind == "export" else "pending")
        if body.kind == "export": row.decided_at, row.decided_by = datetime.utcnow(), "automatic_export"
        db.add(row); await db.commit(); await db.refresh(row)
    result = product_out(row)
    if body.kind == "export":
        items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
        result["data"] = {"order": {key: value for key, value in product_out(order).items()
                                      if key not in ("access_token", "checkout_url")},
                          "items": [product_out(item) for item in items]}
    return result


@app.get("/api/ticketing/public/test-checkout/{reference}", response_class=HTMLResponse,
         dependencies=[Depends(require_service_enabled)])
async def fake_checkout(reference: str, token: str, db: AsyncSession = Depends(get_db)):
    """Staging simulator used only by the fake provider in automated tests."""
    order = await db.scalar(select(Order).where(Order.provider_reference == reference))
    if not order or order.provider != "fake":
        raise HTTPException(404, "Test checkout not found")
    await record_success(db, "fake", f"evt_{reference}", "checkout.completed", {"test": True},
                         reference, reference, order.total, order.currency)
    return RedirectResponse(f"{settings.public_base_url}/tickets/orders/{order.id}?token={token}&checkout=success", status_code=303)


async def fulfill(db: AsyncSession, order: Order) -> bool:
    items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
    products = {p.id: p for p in (await db.execute(select(TicketProduct).where(
        TicketProduct.id.in_([item.product_id for item in items])))).scalars().all()}
    attendees = []
    allocations=allocate_ticket_values(max(0,order.subtotal-order.discount),[item.unit_price*item.quantity for item in items])
    ticket_amount=sum(value for item,value in zip(items,allocations) if products[item.product_id].product_type!="donation")
    for item in items:
        p = products[item.product_id]
        for attendee in item.attendee_data:
            attendees.append({**attendee, "access_ticket_type_id": p.access_ticket_type_id,
                              "product_name": item.product_name, "is_donation": p.product_type == "donation"})
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(f"{settings.core_backend_url}/api/internal/ticketing/fulfill",
                headers={"X-Internal-Token": settings.internal_service_token},
                json={"order_id": order.id, "event_id": order.event_id,
                      "is_test": order.is_test, "amount": order.total, "currency": order.currency,
                      "ticket_amount":ticket_amount,
                      "buyer_email": order.buyer_email, "attendees": attendees,
                      "delivery_settings": (await db.get(EventConfig, order.event_id)).delivery_settings or {}})
        response.raise_for_status()
    except (httpx.HTTPError, ValueError):
        logging.exception("Ticket fulfillment failed for order %s", order.id)
        return False
    order.status, order.fulfilled_at = "fulfilled", datetime.utcnow()
    order.fulfillment_result = response.json()
    order.delivery_attempts += 1
    if response.json().get("delivery_queued"):
        order.delivery_status, order.delivery_queued_at = "queued", datetime.utcnow()
    elif response.json().get("delivery_blocked"):
        order.delivery_status = "blocked_by_staging_safety"
    await db.commit()
    return True


async def apply_payment_success(db: AsyncSession, payment_event: PaymentEvent, reference: str,
                                payment_reference: str | None, amount: int, currency: str,
                                *, required_event_id: str | None = None):
    order = await db.scalar(select(Order).where(Order.provider_reference == reference).with_for_update())
    if required_event_id and (not order or order.event_id != required_event_id):
        payment_event.last_error = "Provider event does not belong to the requested Festio event"
        await db.commit()
        return None
    if not order or order.status not in ("pending", "payment_processing"):
        payment_event.processed = True
        payment_event.processed_at = datetime.utcnow()
        payment_event.last_error = None
        await db.commit(); return order
    if payment_event.provider == "stripe":
        proof = payment_event.payload or {}
        if (proof.get("account") or None) != order.stripe_account_id:
            payment_event.last_error = "Stripe payment account does not match this order"
            await db.commit()
            return None
        obj = proof.get("data", {}).get("object", {})
        if order.stripe_account_id and (obj.get("payment_status") != "paid" or proof.get("livemode") is not (settings.environment.lower() == "production")):
            payment_event.last_error = "Direct payment is not paid in the expected environment"
            await db.commit()
            return None
    if amount != order.total or currency.upper() != order.currency.upper():
        logging.error("Rejected mismatched payment for order %s", order.id)
        payment_event.last_error = "Payment amount or currency did not match the order"
        await db.commit(); return None
    order.status, order.paid_at, order.payment_reference = "paid", datetime.utcnow(), payment_reference
    proof = payment_event.payload or {}
    live = proof.get("livemode") if payment_event.provider == "stripe" else (proof.get("data") or {}).get("domain")
    order.is_test = (not live) if type(live) is bool else (live != "live") if isinstance(live, str) and live in {"live", "test"} else True
    db.add(LedgerEntry(id=uid(), order_id=order.id, kind="payment", amount=order.total,
                       currency=order.currency, provider_reference=reference))
    add_journal(db, order, kind="payment", amount=order.total, reference=reference)
    items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
    for item in items:
        product_row = await db.get(TicketProduct, item.product_id, with_for_update=True)
        product_row.sold += item.quantity
    if order.promo_code:
        promo = await db.scalar(select(PromoCode).where(
            PromoCode.event_id == order.event_id, PromoCode.code == order.promo_code).with_for_update())
        if promo: promo.uses += 1
    payment_event.processed = True
    payment_event.processed_at = datetime.utcnow()
    payment_event.last_error = None
    await db.commit()
    await fulfill(db, order)
    return order


async def record_success(db: AsyncSession, provider_name: str, event_id: str, event_type: str,
                         payload: dict, reference: str, payment_reference: str | None,
                         amount: int, currency: str):
    payment_event = PaymentEvent(id=uid(), provider=provider_name, provider_event_id=event_id,
                                 event_type=event_type, payload=payload, processing_attempts=1)
    db.add(payment_event)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback(); return
    await apply_payment_success(db, payment_event, reference, payment_reference, amount, currency)


async def suspend_for_payment_risk(db: AsyncSession, provider_name: str, provider_event_id: str,
                                   event_type: str, payload: dict, reference: str | None):
    if not reference:
        return
    payment_event = PaymentEvent(id=uid(), provider=provider_name, provider_event_id=provider_event_id,
                                 event_type=event_type, payload=payload, processing_attempts=1)
    db.add(payment_event)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback(); return
    order = await db.scalar(select(Order).where(
        (Order.payment_reference == reference) | (Order.provider_reference == reference)).with_for_update())
    if order and provider_name == "stripe" and (payload.get("account") or None) != order.stripe_account_id:
        payment_event.last_error = "Stripe risk event account does not match this order"
        await db.commit()
        return
    if not order or order.status in ("refunded", "disputed", "payment_reversed"):
        payment_event.processed = True
        payment_event.processed_at = datetime.utcnow()
        await db.commit(); return
    order.pre_dispute_status, order.status, order.delivery_status = order.status, "disputed", "suspended"
    db.add(LedgerEntry(id=uid(), order_id=order.id, kind="payment_risk_hold", amount=0,
                       currency=order.currency, provider_reference=reference,
                       metadata_json={"event_type": event_type}))
    payment_event.processed = True
    payment_event.processed_at = datetime.utcnow()
    await db.commit()
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{settings.core_backend_url}/api/internal/ticketing/void/{order.event_id}/{order.id}",
                headers={"X-Internal-Token": settings.internal_service_token})
            response.raise_for_status()
    except httpx.HTTPError:
        logging.exception("Ticket suspension failed for disputed order %s", order.id)


async def update_refund_from_webhook(db: AsyncSession, provider_name: str, refund_id: str | None,
                                     payment_reference: str | None, succeeded: bool, failure_reason: str | None = None, stripe_account_id: str | None = None):
    row = await db.scalar(select(PaymentRefund).where(
        PaymentRefund.provider == provider_name,
        PaymentRefund.provider_refund_id == refund_id).with_for_update()) if refund_id else None
    if not row and payment_reference:
        order = await db.scalar(select(Order).where(
            (Order.payment_reference == payment_reference) | (Order.provider_reference == payment_reference)))
        if order:
            row = await db.scalar(select(PaymentRefund).where(
                PaymentRefund.order_id == order.id, PaymentRefund.status == "processing")
                .order_by(PaymentRefund.created_at).with_for_update())
    if not row or row.status != "processing": return
    order = await db.get(Order, row.order_id)
    if provider_name == "stripe" and (stripe_account_id or None) != order.stripe_account_id:
        return
    if succeeded:
        await complete_refund(db, row, order)
    else:
        row.status, row.failure_reason = "failed", failure_reason or "Provider reported refund failure"
        order.status = order.pre_dispute_status or "fulfilled"
        order.delivery_status = "queued"
    await db.commit()


async def direct_refund_event(db, account_id, obj):
    """Reconcile refunds initiated in Stripe as well as Festio; scope every lookup."""
    reference = obj.get("payment_intent")
    if not isinstance(reference, str) or not obj.get("id"):
        return
    order = await db.scalar(select(Order).where(Order.provider == "stripe",
        Order.stripe_account_id == account_id, Order.payment_reference == reference).with_for_update())
    if not order:
        return
    amount = obj.get("amount")
    if type(amount) is not int or amount <= 0 or str(obj.get("currency", "")).upper() != order.currency:
        return
    row = await db.scalar(select(PaymentRefund).where(PaymentRefund.provider == "stripe",
        PaymentRefund.provider_refund_id == obj["id"]).with_for_update())
    if row and (row.order_id != order.id or row.amount != amount or row.status == "completed"):
        return
    was_internal_pending = bool(row and row.status in ("processing", "retry_unknown") and row.requested_by != "stripe_webhook")
    if not row:
        row = PaymentRefund(id=uid(), order_id=order.id, event_id=order.event_id,
            provider="stripe", provider_refund_id=obj["id"], amount=amount,
            reason="Refund initiated in Stripe", requested_by="stripe_webhook", status="processing")
        db.add(row)
    if obj.get("status") == "succeeded":
        refunded = abs(int(await db.scalar(select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
            LedgerEntry.order_id == order.id, LedgerEntry.kind == "refund")) or 0))
        if refunded + amount > order.total:
            row.status, row.failure_reason = "review_required", "Provider refunds exceed the recorded order total"
        else:
            await complete_refund(db, row, order)
    elif obj.get("status") in ("failed", "canceled"):
        row.status, row.failure_reason = "failed", obj.get("failure_reason") or "Stripe reported refund failure"
        if was_internal_pending and order.status == "refund_processing":
            remaining = await db.scalar(select(func.count(PaymentRefund.id)).where(PaymentRefund.order_id == order.id,
                PaymentRefund.id != row.id, PaymentRefund.status.in_(("processing", "retry_unknown"))))
            if not remaining:
                prior = await db.scalar(select(func.count(LedgerEntry.id)).where(LedgerEntry.order_id == order.id,
                    LedgerEntry.kind == "refund"))
                order.status = "partially_refunded" if prior else "fulfilled" if order.fulfilled_at else "paid"
                order.delivery_status = "queued"
    await db.commit()


@app.post("/api/ticketing/webhooks/stripe")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    raw = await request.body(); event = verify_stripe(raw, request.headers.get("stripe-signature", ""))
    return await process_stripe_event(event, db)


@app.post("/api/ticketing/webhooks/stripe-connect")
async def stripe_connect_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    if not settings.stripe_connect_webhook_secret:
        raise HTTPException(503, "Connected-account webhook signing is not configured")
    event = verify_stripe(await request.body(), request.headers.get("stripe-signature", ""), secret=settings.stripe_connect_webhook_secret)
    if not event.get("account"):
        raise HTTPException(400, "A connected-account event is required")
    return await process_stripe_event(event, db)


async def process_stripe_event(event: dict, db: AsyncSession):
    if event.get("account") and event.get("livemode") is not (settings.environment.lower() == "production"):
        return {"received": True, "ignored": "environment"}
    if event.get("type") == "account.updated" and event.get("account"):
        row = await db.scalar(select(PayoutAccount).where(PayoutAccount.provider == "stripe",
            PayoutAccount.provider_account_id == event["account"]))
        if managed_account(row):
            await refresh_managed_account(row)
            await db.commit()
        return {"received": True}
    if event.get("type") in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        obj = event["data"]["object"]
        await record_success(db, "stripe", event["id"], event["type"], event, obj["id"],
                             obj.get("payment_intent"), int(obj.get("amount_total") or 0),
                             obj.get("currency") or "")
    elif event.get("type") in ("charge.dispute.created", "charge.dispute.funds_withdrawn"):
        obj = event.get("data", {}).get("object", {})
        charge = obj.get("charge")
        # Stripe dispute payloads include the charge; expanded charge may expose its PaymentIntent.
        reference = charge.get("payment_intent") if isinstance(charge, dict) else charge
        if isinstance(charge, str):
            async with httpx.AsyncClient(timeout=20) as client:
                charge_response = await client.get(f"https://api.stripe.com/v1/charges/{charge}",
                                                   auth=(settings.stripe_secret_key, ""),
                                                   headers={"Stripe-Account": event["account"]} if event.get("account") else {})
            if charge_response.status_code < 400:
                reference = charge_response.json().get("payment_intent") or reference
        await suspend_for_payment_risk(db, "stripe", event.get("id", uid()), event.get("type", "dispute"),
                                       event, reference)
    elif event.get("type") in ("refund.updated", "refund.created", "refund.failed"):
        obj = event.get("data", {}).get("object", {})
        if event.get("account"):
            await direct_refund_event(db, event["account"], obj)
        elif obj.get("status") in ("succeeded", "failed", "canceled"):
            await update_refund_from_webhook(db, "stripe", obj.get("id"), obj.get("payment_intent"),
                                             obj.get("status") == "succeeded", obj.get("failure_reason"), event.get("account"))
    return {"received": True}


@app.post("/api/ticketing/webhooks/paystack")
async def paystack_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    raw = await request.body()
    if not verify_paystack(raw, request.headers.get("x-paystack-signature", "")):
        raise HTTPException(400, "Invalid Paystack signature")
    event = await request.json(); data = event.get("data", {})
    if event.get("event") == "charge.success":
        await record_success(db, "paystack", str(data.get("id")), event["event"], event,
                             data.get("reference"), data.get("reference"), int(data.get("amount") or 0),
                             data.get("currency") or "")
    elif event.get("event") in ("charge.dispute.create", "charge.dispute.remind"):
        transaction = data.get("transaction") or {}
        await suspend_for_payment_risk(db, "paystack", str(data.get("id") or uid()), event["event"], event,
                                       transaction.get("reference") or data.get("reference"))
    elif event.get("event") in ("refund.processed", "refund.failed"):
        transaction = data.get("transaction") or {}
        await update_refund_from_webhook(db, "paystack", str(data.get("id")) if data.get("id") else None,
                                         transaction.get("reference") or data.get("transaction_reference"),
                                         event.get("event") == "refund.processed", data.get("reason"))
    return {"received": True}


def filtered_orders(event_id,q='',status='',from_date='',to_date=''):
    query=select(Order).where(Order.event_id==event_id)
    if q:query=query.where(or_(func.lower(Order.buyer_name).contains(q.lower(),autoescape=True),func.lower(Order.buyer_email).contains(q.lower(),autoescape=True),Order.id.contains(q,autoescape=True)))
    if status:
        if status not in {'pending','paid','fulfilled','expired','refunded','partially_refunded','refund_processing','disputed','payment_processing','cancelled'}:raise HTTPException(422,'Unknown order status')
        query=query.where(Order.status==status)
    try:
        if from_date:query=query.where(Order.created_at>=datetime.fromisoformat(from_date+'T00:00:00'))
        if to_date:query=query.where(Order.created_at<datetime.fromisoformat(to_date+'T00:00:00')+timedelta(days=1))
        if from_date and to_date and from_date>to_date:raise ValueError()
    except ValueError:raise HTTPException(422,'Choose a valid UTC date range')
    return query


async def sync_email_delivery(db,event_id,orders):
    eligible=[order for order in orders if order.status=='fulfilled'][:50]
    if not eligible:return
    cfg=await db.get(EventConfig,event_id)
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            response=await client.post(settings.core_backend_url+'/api/internal/ticketing/delivery-status',headers={'X-Internal-Token':settings.internal_service_token},json={'event_id':event_id,'orders':[{'id':o.id,'buyer_email':o.buyer_email,'email_enabled':bool((cfg.delivery_settings or {}).get('email_enabled',True)),'queued_after':o.delivery_queued_at.isoformat() if o.delivery_queued_at else None} for o in eligible]})
        response.raise_for_status();states=response.json().get('orders',{})
    except (httpx.HTTPError,ValueError):return
    for order in sorted(eligible,key=lambda row:row.id):
        state=states.get(order.id)
        if not state or state.get('status') not in {'unknown','queued','sent','delivered','failed','bounced','complained','blocked','not_requested'}:continue
        latest=await db.scalar(select(Order).where(Order.id==order.id).with_for_update().execution_options(populate_existing=True))
        if latest.status!='fulfilled':continue
        latest.email_delivery_status=state['status']
        if state['status']=='delivered' and state.get('delivered_at'):
            latest.email_delivered_at=datetime.fromisoformat(state['delivered_at']).replace(tzinfo=None)
    await db.commit()


@app.get("/api/ticketing/events/{event_id}/sales")
async def sales(event_id: str, ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
                q: str = '', status: str = '', from_date: str = '', to_date: str = '', limit: int = 50, offset: int = 0):
    require_admin(ident)
    if ident.event_id != event_id: raise HTTPException(403, "Wrong event scope")
    await expire_abandoned_orders(db, event_id)
    if limit<1 or limit>100 or offset<0 or len(q)>200:raise HTTPException(422,'Invalid report page or search')
    base=filtered_orders(event_id,q,status,from_date,to_date)
    # Totals read financial metadata, never checkout credentials or QR payloads.
    metrics=[Order.id,Order.total,Order.status,Order.platform_fee,Order.tax_amount,Order.provider,Order.created_at,
        Order.delivery_queued_at,Order.email_delivery_status,Order.currency]
    rows=(await db.execute(base.options(load_only(*metrics)))).scalars().all()
    page_columns=[getattr(Order,key) for key in ('id','event_id','buyer_name','buyer_email','currency','subtotal','discount','platform_fee','tax_amount','total','status','provider','created_at','paid_at','fulfilled_at','delivery_status','delivery_attempts','delivery_queued_at','email_delivery_status','email_delivered_at')]
    page_rows=(await db.execute(base.options(load_only(*page_columns)).order_by(Order.created_at.desc(),Order.id).offset(offset).limit(limit))).scalars().all()
    await sync_email_delivery(db,event_id,page_rows)

    order_ids = [o.id for o in rows]
    quantities=(await db.execute(select(OrderItem.order_id,func.sum(OrderItem.quantity)).join(TicketProduct,TicketProduct.id==OrderItem.product_id).where(OrderItem.order_id.in_(order_ids),TicketProduct.product_type=='ticket').group_by(OrderItem.order_id))).all() if order_ids else []
    returned=(await db.execute(select(LedgerEntry.order_id,func.sum(func.abs(LedgerEntry.amount))).where(LedgerEntry.order_id.in_(order_ids),LedgerEntry.kind=='refund').group_by(LedgerEntry.order_id))).all() if order_ids else []
    quantity_by_order,refunds_by_order=dict(quantities),dict(returned)
    paid_statuses = ("paid", "fulfilled", "partially_refunded", "refunded", "refund_processing", "disputed")
    gross = sum(o.total for o in rows if o.status in paid_statuses)
    refunds = sum(refunds_by_order.values())
    commission = sum(round(o.platform_fee * max(0, o.total - refunds_by_order.get(o.id, 0)) / o.total)
                     for o in rows if o.status in paid_statuses and o.total)
    tax = sum(round(o.tax_amount * max(0, o.total - refunds_by_order.get(o.id, 0)) / o.total)
              for o in rows if o.status in paid_statuses and o.total)
    active_statuses = ("paid", "fulfilled", "partially_refunded")
    requests = (await db.execute(select(CancellationRequest).where(
        CancellationRequest.event_id == event_id))).scalars().all()
    waitlist = (await db.execute(select(WaitlistEntry).where(
        WaitlistEntry.event_id == event_id).order_by(WaitlistEntry.created_at))).scalars().all()
    refund_rows = (await db.execute(select(PaymentRefund).where(
        PaymentRefund.event_id == event_id).order_by(PaymentRefund.created_at.desc()))).scalars().all()
    request_by_order = {row.order_id: product_out(row) for row in requests}
    order_output = []
    for o in page_rows:
        refunded = refunds_by_order.get(o.id, 0)
        fee = round(o.platform_fee * max(0, o.total - refunded) / o.total) if o.total else 0
        order_tax = round(o.tax_amount * max(0, o.total - refunded) / o.total) if o.total else 0
        order_output.append({**order_view(o), "cancellation": request_by_order.get(o.id),
                             "ticket_count": quantity_by_order.get(o.id, 0), "refunded_amount": refunded,
                             "net_collected": max(0, o.total - refunded), "effective_platform_fee": fee,
                             "effective_tax": order_tax,
                             "organizer_proceeds": max(0, o.total - refunded - fee - order_tax)})
    tax_config=await db.get(EventConfig,event_id)
    day_start=datetime.utcnow().replace(hour=0,minute=0,second=0,microsecond=0)-timedelta(days=6)
    daily=[{'day':(day_start+timedelta(days=i)).date().isoformat(),'revenue':0,'orders':0} for i in range(7)]
    for order in rows:
        index=(order.created_at.date()-day_start.date()).days
        if 0<=index<7 and order.status in paid_statuses:
            daily[index]['orders']+=1;daily[index]['revenue']+=max(0,order.total-refunds_by_order.get(order.id,0))
    return {"orders": order_output, "pagination":{'total':len(rows),'offset':offset,'limit':limit},'daily_sales':daily,
            "waitlist": [{key:value for key,value in product_out(row).items() if key!='offer_token'} for row in waitlist],
            "refunds": [product_out(row) for row in refund_rows], "summary": {
        "orders_total":len(rows),"tickets_issued":sum(quantity_by_order.get(o.id,0) for o in rows if o.status in active_statuses),
        "paid_tickets":sum(quantity_by_order.get(o.id,0) for o in rows if o.status in active_statuses and payment_kind(o)=='paid'),
        "free_tickets":sum(quantity_by_order.get(o.id,0) for o in rows if o.status in active_statuses and payment_kind(o)=='free'),
        "paid_orders":sum(1 for o in rows if o.status in active_statuses and payment_kind(o)=='paid'),
        "free_orders":sum(1 for o in rows if o.status in active_statuses and payment_kind(o)=='free'),
        "delivery_attention":sum(1 for o in rows if o.status=='fulfilled' and ((o.email_delivery_status or 'unknown') in {'failed','bounced','complained','blocked'} or (o.delivery_queued_at and o.delivery_queued_at<datetime.utcnow()-timedelta(minutes=15) and o.email_delivery_status not in {'sent','delivered','not_requested'}))),
        "gross": gross, "refunds": refunds, "net_collected": max(0, gross - refunds),
        "platform_fees": commission, "organizer_proceeds": max(0, gross - refunds - commission - tax),
        "tax_collected": tax, "tax_status": "enabled" if tax_config and tax_config.tax_enabled else "not_configured",
        "processor_fees": None, "processor_fee_status": "provider_reporting_unavailable",
        "sold_orders": sum(1 for o in rows if o.status in active_statuses and o.provider != "manual"),
        "complimentary_orders": sum(1 for o in rows if o.status in active_statuses and o.provider == "manual"),
        "refunded_orders": sum(1 for o in rows if o.status == "refunded"),
        "disputed_orders": sum(1 for o in rows if o.status == "disputed"),
        "pending_orders": sum(1 for o in rows if o.status in ("pending", "payment_processing")),
        "tickets_sold": sum(quantity_by_order.get(o.id, 0) for o in rows if o.status in active_statuses and o.provider != "manual"),
        "complimentary_tickets": sum(quantity_by_order.get(o.id, 0) for o in rows if o.status in active_statuses and o.provider == "manual"),
        "pending_cancellations": sum(1 for r in requests if r.status == "pending"),
        "processing_refunds": sum(1 for row in refund_rows if row.status == "processing"),
        "failed_refunds": sum(1 for row in refund_rows if row.status == "failed"),
        "waitlist_count": sum(1 for row in waitlist if row.status == "waiting"),
        "generated_at": datetime.utcnow()}}


@app.post("/api/ticketing/events/{event_id}/complimentary-orders")
async def complimentary_order(event_id: str, body: ComplimentaryOrderIn,
                              ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    product_row = await db.get(TicketProduct, body.product_id, with_for_update=True)
    cfg = await db.get(EventConfig, event_id)
    if not cfg or not product_row or product_row.event_id != event_id or not product_row.active:
        raise HTTPException(404, "Ticket not found")
    if product_row.product_type == "external":
        raise HTTPException(400, f"{product_row.name} is an external-registration listing and can't be issued as a complimentary Festio order.")
    if product_row.sold + body.quantity > product_row.capacity:
        raise HTTPException(409, "Not enough ticket inventory")
    order = Order(id=uid(), event_id=event_id, org_id=ident.org_id, buyer_name=body.buyer_name,
                  buyer_email=str(body.buyer_email), currency=cfg.currency,
                  subtotal=product_row.price * body.quantity, discount=product_row.price * body.quantity,
                  platform_fee=0, tax_amount=0, total=0, provider="manual", status="paid",
                  paid_at=datetime.utcnow(), hold_expires_at=datetime.utcnow())
    parts = body.buyer_name.strip().split(maxsplit=1)
    attendees = [entry.model_dump(mode="json") for entry in body.attendees] if body.attendees else [
        {"first_name": parts[0], "last_name": parts[1] if len(parts) > 1 else "",
         "email": str(body.buyer_email), "phone": None} for _ in range(body.quantity)]
    db.add(order); db.add(OrderItem(id=uid(), order_id=order.id, product_id=product_row.id,
        product_name=product_row.name, unit_price=0, quantity=body.quantity, attendee_data=attendees))
    product_row.sold += body.quantity
    db.add(AuditEvent(id=uid(), event_id=event_id, actor=ident.subject, action="complimentary_order.created",
                      subject_id=order.id, details={"quantity": body.quantity, "reason": body.reason}))
    await db.commit()
    if not await fulfill(db, order):
        raise HTTPException(503, "Complimentary passes were saved but fulfillment must be retried")
    return {"id": order.id, "status": order.status, "passes": order.fulfillment_result.get("passes", [])}


@app.post("/api/ticketing/events/{event_id}/waitlist/{entry_id}/offer")
async def offer_waitlist_ticket(event_id: str, entry_id: str, body: WaitlistOfferIn,
                                ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    row = await db.get(WaitlistEntry, entry_id, with_for_update=True)
    if ident.event_id != event_id or not row or row.event_id != event_id or row.status not in ("waiting", "offered"):
        raise HTTPException(404, "Waiting customer not found")
    product_row = await db.get(TicketProduct, row.product_id, with_for_update=True)
    active_offers = int(await db.scalar(select(func.coalesce(func.sum(WaitlistEntry.quantity), 0)).where(
        WaitlistEntry.product_id == row.product_id, WaitlistEntry.status == "offered",
        WaitlistEntry.id != row.id, WaitlistEntry.offer_expires_at > datetime.utcnow())) or 0)
    if product_row.sold + active_offers + row.quantity > product_row.capacity:
        raise HTTPException(409, "Inventory is not available for this offer")
    row.status, row.offer_token = "offered", uid().replace("-", "")
    row.offered_at, row.reminder_sent_at = datetime.utcnow(), None
    row.offer_expires_at = datetime.utcnow() + timedelta(minutes=body.minutes)
    row.offer_attempts += 1
    db.add(AuditEvent(id=uid(), event_id=event_id, actor=ident.subject, action="waitlist.offer.created",
        subject_id=row.id, details={"quantity": row.quantity, "expires_at": row.offer_expires_at.isoformat()}))
    await db.commit()
    offer_url = f"{settings.public_base_url}/tickets/e/{event_id}?offer={row.offer_token}"
    delivery_queued = await deliver_waitlist_message(row, product_row)
    return {"status": row.status, "expires_at": row.offer_expires_at,
            "offer_url": offer_url, "delivery_queued": delivery_queued}


@app.get("/api/ticketing/events/{event_id}/audit")
async def audit_log(event_id: str, ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id: raise HTTPException(403, "Wrong event scope")
    rows = (await db.execute(select(AuditEvent).where(AuditEvent.event_id == event_id)
                             .order_by(AuditEvent.created_at.desc()).limit(500))).scalars().all()
    return [product_out(row) for row in rows]


@app.get("/api/ticketing/events/{event_id}/privacy-requests")
async def privacy_requests(event_id: str, ident: Identity = Depends(current_identity),
                           db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id: raise HTTPException(403, "Wrong event scope")
    rows = (await db.execute(select(PrivacyRequest).where(PrivacyRequest.event_id == event_id)
                             .order_by(PrivacyRequest.requested_at.desc()))).scalars().all()
    return [product_out(row) for row in rows]


@app.post("/api/ticketing/events/{event_id}/privacy-requests/{request_id}/decision")
async def decide_privacy_request(event_id: str, request_id: str, body: PrivacyDecisionIn,
                                 ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    row = await db.get(PrivacyRequest, request_id, with_for_update=True)
    if ident.event_id != event_id or not row or row.event_id != event_id or row.status != "pending":
        raise HTTPException(404, "Pending privacy request not found")
    if body.action == "approve" and row.kind == "delete" and not ident.is_platform_superadmin:
        raise HTTPException(403, "A platform superadmin must approve irreversible anonymization")
    order = await db.get(Order, row.order_id)
    if body.action == "approve" and row.kind == "delete":
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{settings.core_backend_url}/api/internal/ticketing/anonymize/{event_id}/{order.id}",
                headers={"X-Internal-Token": settings.internal_service_token})
        response.raise_for_status()
        order.buyer_name, order.buyer_email, order.buyer_phone = "Deleted customer", f"deleted+{order.id}@privacy.invalid", None
        order.checkout_url, order.access_token = None, uid().replace("-", "")
        cleaned = dict(order.fulfillment_result or {})
        cleaned["passes"] = [{"guest_id": item.get("guest_id"), "name": "Deleted attendee"}
                             for item in cleaned.get("passes", [])]
        order.fulfillment_result = cleaned
        row.status = "completed"
    else:
        row.status = "rejected" if body.action == "reject" else "completed"
    row.decided_at, row.decided_by, row.decision_note = datetime.utcnow(), ident.subject, body.note
    db.add(AuditEvent(id=uid(), event_id=event_id, actor=ident.subject, action=f"privacy.{row.kind}.{row.status}",
        subject_id=order.id, details={"request_id": row.id}))
    await db.commit(); return product_out(row)


@app.post("/api/ticketing/events/{event_id}/operations/run")
async def run_operations(event_id: str, ident: Identity = Depends(current_identity),
                         db: AsyncSession = Depends(get_db)):
    """Safe, idempotent maintenance trigger for an organizer operations console."""
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    expired_orders = await expire_abandoned_orders(db, event_id)
    waitlist = await maintain_waitlist(db)
    return {"expired_orders": expired_orders, "waitlist": waitlist, "ran_at": datetime.utcnow()}


@app.get("/api/ticketing/events/{event_id}/operations/subscription")
async def get_operations_subscription(event_id: str, ident: Identity = Depends(current_identity),
                                      db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    row = await db.get(OperationsSubscription, event_id)
    return product_out(row) if row else None


@app.put("/api/ticketing/events/{event_id}/operations/subscription")
async def put_operations_subscription(event_id: str, body: OperationsSubscriptionIn,
                                      ident: Identity = Depends(current_identity),
                                      db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    row = await db.get(OperationsSubscription, event_id, with_for_update=True)
    interval = timedelta(days=7 if body.frequency == "weekly" else 1)
    if not row:
        row = OperationsSubscription(event_id=event_id, recipient=str(body.recipient),
            frequency=body.frequency, enabled=body.enabled, include_alerts=body.include_alerts,
            next_run_at=datetime.utcnow() + interval)
        db.add(row)
    else:
        frequency_changed = row.frequency != body.frequency
        row.recipient, row.frequency = str(body.recipient), body.frequency
        row.enabled, row.include_alerts = body.enabled, body.include_alerts
        if frequency_changed or row.next_run_at < datetime.utcnow():
            row.next_run_at = datetime.utcnow() + interval
    db.add(AuditEvent(id=uid(), event_id=event_id, actor=ident.subject,
                      action="operations_subscription.updated",
                      details={"recipient": str(body.recipient), "frequency": body.frequency,
                               "enabled": body.enabled, "include_alerts": body.include_alerts}))
    await db.commit(); await db.refresh(row)
    return product_out(row)


@app.get("/api/ticketing/events/{event_id}/payment-events")
async def payment_event_log(event_id: str, status: str | None = None,
                            ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Provider webhook operations view. Payloads are redacted to avoid exposing buyer data."""
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    references = select(Order.provider_reference).where(Order.event_id == event_id).union(
        select(Order.payment_reference).where(Order.event_id == event_id))
    query = select(PaymentEvent).where(
        (PaymentEvent.payload["data"]["object"]["id"].as_string().in_(references)) |
        (PaymentEvent.payload["data"]["reference"].as_string().in_(references))
    ).order_by(PaymentEvent.created_at.desc()).limit(500)
    if status == "processed":
        query = query.where(PaymentEvent.processed.is_(True))
    elif status == "failed":
        query = query.where(PaymentEvent.processed.is_(False), PaymentEvent.last_error.is_not(None))
    rows = (await db.execute(query)).scalars().all()
    return [{"id": row.id, "provider": row.provider, "provider_event_id": row.provider_event_id,
             "event_type": row.event_type, "processed": row.processed,
             "processing_attempts": row.processing_attempts, "last_error": row.last_error,
             "processed_at": row.processed_at, "created_at": row.created_at} for row in rows]


@app.post("/api/ticketing/events/{event_id}/payment-events/{payment_event_id}/replay")
async def replay_payment_event(event_id: str, payment_event_id: str,
                               ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Replay only a stored, failed payment-success event; never a completed event."""
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    row = await db.get(PaymentEvent, payment_event_id, with_for_update=True)
    if not row or row.processed:
        raise HTTPException(409, "Only an unprocessed provider event can be replayed")
    if not safe_payment_event_replay(row.provider, row.event_type, row.processed, row.processing_attempts):
        raise HTTPException(409, "Provider event type or replay limit is not safe")
    payload = row.payload or {}
    if row.provider == "stripe" and row.event_type in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        obj = payload.get("data", {}).get("object", {})
        reference, payment_reference = obj.get("id"), obj.get("payment_intent")
        amount, currency = int(obj.get("amount_total") or 0), obj.get("currency") or ""
    elif row.provider == "paystack" and row.event_type == "charge.success":
        obj = payload.get("data", {})
        reference = payment_reference = obj.get("reference")
        amount, currency = int(obj.get("amount") or 0), obj.get("currency") or ""
    else:
        raise HTTPException(409, "This provider event type is not safely replayable")
    if not reference:
        raise HTTPException(409, "Stored provider event has no payment reference")
    row.processing_attempts += 1
    row.last_error = None
    order = await apply_payment_success(db, row, reference, payment_reference, amount, currency,
                                        required_event_id=event_id)
    db.add(AuditEvent(id=uid(), event_id=event_id, actor=ident.subject,
                      action="payment_event.replayed", subject_id=row.id,
                      details={"attempt": row.processing_attempts, "processed": row.processed}))
    await db.commit()
    return {"id": row.id, "processed": row.processed, "attempts": row.processing_attempts,
            "last_error": row.last_error, "order_id": order.id if order else None}


@app.post("/api/ticketing/events/{event_id}/sales-report/email")
async def email_sales_report(event_id: str, body: SalesReportIn,
                             ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    orders = (await db.execute(select(Order).where(Order.event_id == event_id)
                               .order_by(Order.created_at))).scalars().all()
    order_ids = [row.id for row in orders]
    items = (await db.execute(select(OrderItem).where(OrderItem.order_id.in_(order_ids)))).scalars().all() if order_ids else []
    ledger = (await db.execute(select(LedgerEntry).where(LedgerEntry.order_id.in_(order_ids)))).scalars().all() if order_ids else []
    quantities, refunded = {}, {}
    for item in items:
        quantities[item.order_id] = quantities.get(item.order_id, 0) + item.quantity
    for entry in ledger:
        if entry.kind == "refund":
            refunded[entry.order_id] = refunded.get(entry.order_id, 0) + abs(entry.amount)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["order_id", "created_at", "buyer_name", "buyer_email", "provider", "status",
                     "currency", "tickets", "gross", "refunded", "festio_fee", "tax", "organizer_proceeds"])
    totals = {"gross": 0, "refunds": 0, "fees": 0, "tax": 0, "tickets": 0, "proceeds": 0}
    reportable = ("paid", "fulfilled", "partially_refunded", "refunded", "refund_processing", "disputed")
    for order in orders:
        returned = refunded.get(order.id, 0)
        fee = round(order.platform_fee * max(0, order.total - returned) / order.total) if order.total else 0
        tax = round(order.tax_amount * max(0, order.total - returned) / order.total) if order.total else 0
        gross = order.total if order.status in reportable else 0
        proceeds = max(0, gross - returned - fee - tax)
        count = quantities.get(order.id, 0)
        writer.writerow([csv_safe(v) for v in [order.id, order.created_at.isoformat(), order.buyer_name, order.buyer_email,
                         order.provider, order.status, order.currency, count, gross, returned, fee, tax, proceeds]])
        totals["gross"] += gross; totals["refunds"] += returned; totals["fees"] += fee
        totals["tax"] += tax
        totals["tickets"] += count if order.status in reportable else 0
        totals["proceeds"] += proceeds
    currency = orders[0].currency if orders else ""
    summary_html = (f"<p>Your requested Festio ticket sales report is attached.</p>"
                    f"<table><tr><td>Tickets</td><td><strong>{totals['tickets']}</strong></td></tr>"
                    f"<tr><td>Gross</td><td>{currency} {totals['gross'] / 100:,.2f}</td></tr>"
                    f"<tr><td>Refunds</td><td>{currency} {totals['refunds'] / 100:,.2f}</td></tr>"
                    f"<tr><td>Festio commission</td><td>{currency} {totals['fees'] / 100:,.2f}</td></tr>"
                    f"<tr><td>Tax</td><td>{currency} {totals['tax'] / 100:,.2f}</td></tr>"
                    f"<tr><td>Organizer proceeds</td><td><strong>{currency} {totals['proceeds'] / 100:,.2f}</strong></td></tr></table>")
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(f"{settings.core_backend_url}/api/internal/ticketing/sales-report/{event_id}",
                headers={"X-Internal-Token": settings.internal_service_token},
                json={"recipient": str(body.recipient), "subject": "Festio ticket sales report",
                      "html_body": summary_html, "csv_content": output.getvalue(),
                      "filename": f"ticket-sales-{event_id[:8]}.csv"})
            response.raise_for_status()
    except httpx.HTTPError:
        logging.exception("Ticket sales report delivery failed for event %s", event_id)
        raise HTTPException(502, "Sales report email could not be queued")
    db.add(AuditEvent(id=uid(), event_id=event_id, actor=ident.subject,
                      action="sales_report.emailed", details={"recipient": str(body.recipient), **totals}))
    await db.commit()
    return {"queued": True, "recipient": str(body.recipient), "summary": totals}


@app.get("/api/ticketing/events/{event_id}/reconciliation")
async def reconciliation(event_id: str, ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id: raise HTTPException(403, "Wrong event scope")
    cfg = await db.get(EventConfig, event_id)
    if not cfg or not cfg.provider_account_id:
        return {"provider": cfg.provider if cfg else None, "status": "payout_account_not_connected", "settlements": []}
    if cfg.provider == "paystack" and provider_ready("paystack"):
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get("https://api.paystack.co/settlement",
                params={"subaccount": cfg.provider_account_id, "perPage": 50},
                headers={"Authorization": f"Bearer {settings.paystack_secret_key}"})
        if response.status_code >= 400: raise HTTPException(502, "Paystack settlement reporting is unavailable")
        data = response.json().get("data", [])
        return {"provider": "paystack", "status": "available", "settlements": [{
            "id": str(row.get("id")), "status": row.get("status"), "currency": row.get("currency"),
            "gross": row.get("total_processed", 0), "processor_fees": row.get("total_fees", 0),
            "net": row.get("effective_amount", 0), "settled_at": row.get("settled_at") or row.get("paidAt")
        } for row in data]}
    if cfg.provider == "stripe" and provider_ready("stripe"):
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get("https://api.stripe.com/v1/balance_transactions",
                params={"limit": 100}, auth=(settings.stripe_secret_key, ""),
                headers={"Stripe-Account": cfg.provider_account_id})
        if response.status_code >= 400: raise HTTPException(502, "Stripe reconciliation is unavailable")
        rows = response.json().get("data", [])
        return {"provider": "stripe", "status": "available", "settlements": [{
            "id": row.get("id"), "status": row.get("status"), "currency": str(row.get("currency", "")).upper(),
            "gross": row.get("amount", 0), "processor_fees": row.get("fee", 0), "net": row.get("net", 0),
            "settled_at": datetime.utcfromtimestamp(row["available_on"]).isoformat() if row.get("available_on") else None
        } for row in rows]}
    return {"provider": cfg.provider, "status": "provider_credentials_unavailable", "settlements": []}


@app.get("/api/ticketing/events/{event_id}/journal")
async def accounting_journal(event_id: str, ident: Identity = Depends(current_identity),
                             db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id: raise HTTPException(403, "Wrong event scope")
    rows = (await db.execute(select(JournalLine).where(JournalLine.event_id == event_id)
                             .order_by(JournalLine.created_at, JournalLine.id))).scalars().all()
    transactions = {}
    balances = {}
    for row in rows:
        item = product_out(row)
        transactions.setdefault(row.transaction_id, []).append(item)
        balances[row.account] = balances.get(row.account, 0) + row.debit - row.credit
    output = []
    for transaction_id, lines in transactions.items():
        debit = sum(line["debit"] for line in lines)
        credit = sum(line["credit"] for line in lines)
        output.append({"transaction_id": transaction_id, "balanced": debit == credit,
                       "debit": debit, "credit": credit, "lines": lines})
    return {"transactions": output, "account_balances": balances,
            "balanced": all(row["balanced"] for row in output), "generated_at": datetime.utcnow()}


async def complete_refund(db: AsyncSession, refund_row: PaymentRefund, order: Order):
    if refund_row.status == "completed": return
    refund_row.status, refund_row.completed_at = "completed", datetime.utcnow()
    prior = await db.scalar(select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
        LedgerEntry.order_id == order.id, LedgerEntry.kind == "refund"))
    total_refunded = abs(int(prior or 0)) + refund_row.amount
    order.status = "refunded" if total_refunded >= order.total else "partially_refunded"
    order.delivery_status = "cancelled" if order.status == "refunded" else "queued"
    db.add(LedgerEntry(id=uid(), order_id=order.id, kind="refund", amount=-refund_row.amount,
        currency=order.currency, provider_reference=refund_row.provider_refund_id,
        metadata_json={"reason": refund_row.reason, "refund_id": refund_row.id}))
    add_journal(db, order, kind="refund", amount=refund_row.amount,
                reference=refund_row.provider_refund_id, refund_id=refund_row.id)
    if refund_row.item_quantities:
        for product_id, quantity in refund_row.item_quantities.items():
            product_row = await db.get(TicketProduct, product_id, with_for_update=True)
            if product_row:
                product_row.sold = max(0, product_row.sold - int(quantity))
    elif order.status == "refunded":
        prior_ticket_refunds = (await db.execute(select(PaymentRefund).where(
            PaymentRefund.order_id == order.id, PaymentRefund.id != refund_row.id,
            PaymentRefund.status == "completed"))).scalars().all()
        released = {}
        for prior_refund in prior_ticket_refunds:
            for product_id, quantity in (prior_refund.item_quantities or {}).items():
                released[product_id] = released.get(product_id, 0) + int(quantity)
        items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
        for item in items:
            product_row = await db.get(TicketProduct, item.product_id, with_for_update=True)
            remaining = max(0, item.quantity - released.get(item.product_id, 0))
            product_row.sold = max(0, product_row.sold - remaining)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            voided = await client.post(
                f"{settings.core_backend_url}/api/internal/ticketing/void/{order.event_id}/{order.id}",
                headers={"X-Internal-Token": settings.internal_service_token},
                json={"guest_ids": refund_row.guest_ids or []})
            voided.raise_for_status()
    except httpx.HTTPError:
        logging.exception("Ticket void failed while completing refund %s", refund_row.id)


async def ticket_refund_selection(db: AsyncSession, order: Order, guest_ids: list[str]):
    """Return stable pro-rata value and inventory quantities for selected fulfilled passes."""
    passes = (order.fulfillment_result or {}).get("passes", [])
    pass_ids = [row.get("guest_id") for row in passes]
    selected = set(guest_ids)
    if not selected or not selected.issubset(set(pass_ids)):
        raise HTTPException(400, "One or more selected tickets are not part of this order")
    prior = (await db.execute(select(PaymentRefund).where(
        PaymentRefund.order_id == order.id, PaymentRefund.status.in_(("processing", "completed"))))).scalars().all()
    unavailable = {guest_id for row in prior for guest_id in (row.guest_ids or [])}
    if selected & unavailable:
        raise HTTPException(409, "A selected ticket already has a refund in progress or completed")
    items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id)
                              .order_by(OrderItem.id))).scalars().all()
    weighted = []
    item_quantities = {}
    cursor = 0
    for item in items:
        for _ in range(item.quantity):
            if cursor >= len(pass_ids):
                raise HTTPException(409, "Ticket fulfillment data is incomplete")
            weighted.append((pass_ids[cursor], item.product_id, item.unit_price))
            cursor += 1
    allocations = allocate_ticket_values(order.total, [row[2] for row in weighted])
    amount = 0
    for (guest_id, product_id, _), value in zip(weighted, allocations):
        if guest_id in selected:
            amount += value
            item_quantities[product_id] = item_quantities.get(product_id, 0) + 1
    if amount <= 0:
        raise HTTPException(409, "Selected tickets have no refundable payment value")
    return amount, item_quantities


async def refund_order(db: AsyncSession, order: Order, body: RefundIn, requested_by: str = "system",
                       request_key: str | None = None):
    if request_key:
        existing = await db.scalar(select(PaymentRefund).where(PaymentRefund.request_key == request_key))
        if existing:
            if existing.order_id != order.id:
                raise HTTPException(409, "Idempotency key was already used for another order")
            return {"status": order.status, "refund_status": existing.status,
                    "refund_id": existing.id, "amount": existing.amount, "idempotent_replay": True}
    if order.total<=0:
        raise HTTPException(409,"Free and complimentary orders have no payment to refund")
    item_quantities = {}
    if body.guest_ids:
        amount, item_quantities = await ticket_refund_selection(db, order, body.guest_ids)
    else:
        amount = body.amount or order.total
    already_refunded = abs(int(await db.scalar(select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
        LedgerEntry.order_id == order.id, LedgerEntry.kind == "refund")) or 0))
    pending = int(await db.scalar(select(func.coalesce(func.sum(PaymentRefund.amount), 0)).where(
        PaymentRefund.order_id == order.id, PaymentRefund.status == "processing")) or 0)
    if amount + already_refunded + pending > order.total or order.provider == "manual":
        raise HTTPException(400, "Refund exceeds order total")
    result = await provider(order.provider).refund(reference=order.payment_reference or order.provider_reference, amount=amount,
        **({"account_id": order.stripe_account_id} if order.provider == "stripe" and order.stripe_account_id else {}))
    raw_status = str(result.get("status") or "processing").lower()
    completed = raw_status in ("succeeded", "success", "processed", "completed")
    refund_row = PaymentRefund(id=uid(), order_id=order.id, event_id=order.event_id, provider=order.provider,
        provider_refund_id=str(result.get("id") or result.get("reference") or uid()), amount=amount,
        reason=body.reason, status="processing", requested_by=requested_by,
        request_key=request_key, guest_ids=body.guest_ids, item_quantities=item_quantities)
    db.add(refund_row)
    order.status, order.delivery_status = "refund_processing", "suspended"
    if completed: await complete_refund(db, refund_row, order)
    db.add(AuditEvent(id=uid(), event_id=order.event_id, actor=requested_by, action="refund.requested",
        subject_id=order.id, details={"refund_id": refund_row.id, "amount": amount, "provider_status": raw_status}))
    await db.commit()
    return {"status": order.status, "refund_status": refund_row.status, "refund_id": refund_row.id,
            "amount": amount, "provider": result}


@app.post("/api/ticketing/events/{event_id}/orders/{order_id}/refunds")
async def refund(event_id: str, order_id: str, body: RefundIn,
                 idempotency_key: str | None = Header(default=None, alias="X-Idempotency-Key", max_length=120),
                 ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id: raise HTTPException(403, "Wrong event scope")
    order = await db.get(Order, order_id, with_for_update=True)
    if not order or order.event_id != event_id:
        raise HTTPException(404, "Refundable order not found")
    if idempotency_key:
        existing = await db.scalar(select(PaymentRefund).where(PaymentRefund.request_key == idempotency_key))
        if existing:
            if existing.order_id != order.id: raise HTTPException(409, "Idempotency key was already used for another order")
            return {"status": order.status, "refund_status": existing.status, "refund_id": existing.id,
                    "amount": existing.amount, "idempotent_replay": True}
    if order.status not in ("paid", "fulfilled", "partially_refunded"):
        raise HTTPException(404, "Refundable order not found")
    return await refund_order(db, order, body, ident.subject, idempotency_key)


@app.post("/api/ticketing/events/{event_id}/refunds/{refund_id}/retry")
async def retry_refund(event_id: str, refund_id: str, ident: Identity = Depends(current_identity),
                       db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    if ident.event_id != event_id:
        raise HTTPException(403, "Wrong event scope")
    row = await db.get(PaymentRefund, refund_id, with_for_update=True)
    if not row or row.event_id != event_id or not safe_refund_retry(row.status, row.retry_attempts):
        raise HTTPException(409, "Only a provider-confirmed failed refund can be retried")
    order = await db.get(Order, row.order_id, with_for_update=True)
    if not order or order.status in ("refunded", "refund_processing"):
        raise HTTPException(409, "Order is not eligible for this refund retry")
    row.retry_attempts += 1
    row.last_attempt_at = datetime.utcnow()
    row.status, row.failure_reason = "processing", None
    order.status, order.delivery_status = "refund_processing", "suspended"
    # Stable across attempts: Stripe will return the first result instead of creating
    # another refund when our response was lost after the provider accepted it.
    idempotency_key = f"festio-refund-{row.id}-retry"
    db.add(AuditEvent(id=uid(), event_id=event_id, actor=ident.subject,
                      action="refund.retry.requested", subject_id=row.id,
                      details={"attempt": row.retry_attempts, "amount": row.amount}))
    await db.commit()
    try:
        result = await provider(order.provider).refund(
            reference=order.payment_reference or order.provider_reference,
            amount=row.amount, idempotency_key=idempotency_key,
            **({"account_id": order.stripe_account_id} if order.provider == "stripe" and order.stripe_account_id else {}))
    except HTTPException as exc:
        # Network/provider ambiguity is not a confirmed failure. Keep passes suspended
        # until a webhook or an operator reconciliation resolves the provider outcome.
        row.status, row.failure_reason = "retry_unknown", str(exc.detail)
        await db.commit()
        raise
    raw_status = str(result.get("status") or "processing").lower()
    row.provider_refund_id = str(result.get("id") or result.get("reference") or row.provider_refund_id)
    if raw_status in ("succeeded", "success", "processed", "completed"):
        await complete_refund(db, row, order)
    elif raw_status in ("failed", "canceled", "cancelled"):
        row.status, row.failure_reason = "failed", str(result.get("reason") or "Provider rejected retry")
        order.status, order.delivery_status = order.pre_dispute_status or "fulfilled", "queued"
    await db.commit()
    return {"refund_id": row.id, "status": row.status, "order_status": order.status,
            "attempt": row.retry_attempts, "provider_refund_id": row.provider_refund_id}


@app.post("/api/ticketing/events/{event_id}/cancellations/{request_id}/decision")
async def decide_cancellation(event_id: str, request_id: str, body: CancellationDecisionIn,
                              ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    row = await db.get(CancellationRequest, request_id, with_for_update=True)
    if ident.event_id != event_id or not row or row.event_id != event_id or row.status != "pending":
        raise HTTPException(404, "Pending cancellation request not found")
    order = await db.get(Order, row.order_id, with_for_update=True)
    if body.action == "approve":
        if order.total == 0:
            if order.status not in ("paid", "fulfilled"):
                raise HTTPException(409, "Order is not eligible for cancellation")
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    f"{settings.core_backend_url}/api/internal/ticketing/void/{event_id}/{order.id}",
                    headers={"X-Internal-Token": settings.internal_service_token}, json={"guest_ids": []})
                response.raise_for_status()
            items = (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
            for item in items:
                product = await db.get(TicketProduct, item.product_id, with_for_update=True)
                if product:
                    product.sold = max(0, product.sold - item.quantity)
            order.status, order.delivery_status = "cancelled", "cancelled"
            db.add(AuditEvent(id=uid(), event_id=event_id, actor=ident.subject,
                action="order.cancelled", subject_id=order.id, details={"payment_kind": payment_kind(order)}))
        else:
            await refund_order(db, order, RefundIn(reason="approved_customer_cancellation"), ident.subject,
                               request_key="cancellation-" + row.id)
        row.status = "approved"
    else:
        row.status = "rejected"
    row.decided_at, row.decided_by, row.decision_note = datetime.utcnow(), ident.subject, body.note
    db.add(row); await db.commit(); await db.refresh(row)
    return product_out(row)


@app.post("/api/ticketing/events/{event_id}/orders/{order_id}/fulfill")
async def retry_fulfillment(event_id: str, order_id: str, ident: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    order = await db.get(Order, order_id)
    if not order or order.event_id != event_id or order.status not in ("paid", "fulfilled"):
        raise HTTPException(404, "Paid order not found")
    if order.status == "fulfilled":
        return {"status": order.status, "result": order.fulfillment_result}
    if not await fulfill(db, order):
        raise HTTPException(503, "Festio fulfillment is temporarily unavailable; retry is safe")
    return {"status": order.status, "result": order.fulfillment_result}


@app.post("/api/ticketing/events/{event_id}/orders/{order_id}/resend")
async def resend_order_delivery(event_id: str, order_id: str, ident: Identity = Depends(current_identity),
                                db: AsyncSession = Depends(get_db)):
    require_admin(ident)
    order = await db.get(Order, order_id)
    if ident.event_id != event_id or not order or order.event_id != event_id or order.status != "fulfilled":
        raise HTTPException(404, "Fulfilled order not found")
    if order.delivery_queued_at and order.delivery_queued_at>datetime.utcnow()-timedelta(minutes=5):
        raise HTTPException(429,"Wait five minutes before resending this order again")
    cfg = await db.get(EventConfig, event_id)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{settings.core_backend_url}/api/internal/ticketing/delivery/{event_id}/{order_id}",
                headers={"X-Internal-Token": settings.internal_service_token},
                json={"buyer_email": order.buyer_email, "delivery_settings": cfg.delivery_settings or {}})
        response.raise_for_status()
    except httpx.HTTPError as exc:
        order.delivery_status = "failed"; order.delivery_attempts += 1; await db.commit()
        raise HTTPException(503, "Ticket delivery could not be queued") from exc
    order.delivery_status, order.delivery_queued_at = "queued", datetime.utcnow()
    order.delivery_attempts += 1; await db.commit()
    return {"status": order.delivery_status, "attempts": order.delivery_attempts}

@app.get('/api/ticketing/events/{event_id}/sales-export')
async def export_sales(event_id: str,kind: str='orders',q: str='',status: str='',from_date: str='',to_date: str='',ident: Identity=Depends(current_identity),db: AsyncSession=Depends(get_db)):
    require_admin(ident)
    if ident.event_id!=event_id:raise HTTPException(403,'Wrong event scope')
    if kind not in {'orders','attendees','refunds','provider'}:raise HTTPException(422,'Unknown export type')
    stream=io.StringIO(newline='');writer=csv.writer(stream)
    def write(values):writer.writerow([csv_safe(value) for value in values])
    if kind=='provider':
        report=await reconciliation(event_id,ident,db)
        if report['status']!='available':raise HTTPException(409,'Connect the organizer payout account and check provider reporting first')
        write(['provider','entry_id','status','currency','gross_minor','processor_fees_minor','net_minor','provider_reported_date'])
        for row in report['settlements']:write([report['provider'],row['id'],row['status'],row['currency'],row['gross'],row['processor_fees'],row['net'],row.get('settled_at') or row.get('available_at') or ''])
    else:
        orders=(await db.scalars(filtered_orders(event_id,q,status,from_date,to_date).order_by(Order.created_at,Order.id).limit(5001))).all()
        if len(orders)>5000:raise HTTPException(413,'Narrow the date/search filter to export at most 5000 orders')
        ids=[o.id for o in orders];by_id={o.id:o for o in orders}
        if kind=='attendees':
            write(['order_id','order_created_utc','status','payment_kind','ticket_product','attendee_name','attendee_email','currency','ticket_face_value_minor'])
            items=(await db.scalars(select(OrderItem).join(TicketProduct,TicketProduct.id==OrderItem.product_id).where(OrderItem.order_id.in_(ids),TicketProduct.product_type=='ticket').order_by(OrderItem.order_id,OrderItem.id))).all() if ids else []
            count=0
            for item in items:
                order=by_id[item.order_id]
                for attendee in item.attendee_data:
                    count+=1
                    if count>20000:raise HTTPException(413,'Narrow the export to at most 20000 attendee rows')
                    write([order.id,order.created_at.isoformat(),order.status,payment_kind(order),item.product_name,' '.join(filter(None,[attendee.get('first_name'),attendee.get('last_name')])),attendee.get('email') or order.buyer_email,order.currency,item.unit_price])
        elif kind=='refunds':
            write(['order_id','refund_id','requested_utc','completed_utc','status','currency','amount_minor','reason','provider'])
            rows=(await db.scalars(select(PaymentRefund).where(PaymentRefund.order_id.in_(ids)).order_by(PaymentRefund.created_at))).all() if ids else []
            for row in rows:write([row.order_id,row.id,row.created_at.isoformat(),row.completed_at.isoformat() if row.completed_at else '',row.status,by_id[row.order_id].currency,row.amount,row.reason,row.provider])
        else:
            write(['order_id','created_utc','buyer_name','buyer_email','provider','payment_kind','status','currency','gross_minor','refund_minor','festio_fee_minor','tax_minor','expected_organizer_proceeds_minor','organizer_account_last4'])
            returned=dict((await db.execute(select(LedgerEntry.order_id,func.sum(func.abs(LedgerEntry.amount))).where(LedgerEntry.order_id.in_(ids),LedgerEntry.kind=='refund').group_by(LedgerEntry.order_id))).all()) if ids else {}
            cfg=await db.get(EventConfig,event_id)
            account=await db.scalar(select(PayoutAccount).where(PayoutAccount.org_id==ident.org_id,PayoutAccount.provider==cfg.provider,PayoutAccount.provider_account_id==cfg.provider_account_id)) if cfg and cfg.provider_account_id else None
            for order in orders:
                refund=returned.get(order.id,0);net=max(0,order.total-refund)
                fee=round(order.platform_fee*net/order.total) if order.total else 0
                tax=round(order.tax_amount*net/order.total) if order.total else 0
                gross=order.total if order.status in {'paid','fulfilled','partially_refunded','refunded','refund_processing','disputed'} else 0
                write([order.id,order.created_at.isoformat(),order.buyer_name,order.buyer_email,order.provider,payment_kind(order),order.status,order.currency,gross,refund,fee,tax,max(0,gross-refund-fee-tax),account.account_last4 if account else ''])
    return {'filename':'ticket-'+kind+'.csv','content':stream.getvalue()}


@app.post('/api/ticketing/events/{event_id}/orders/bulk-resend')
async def bulk_resend(event_id: str,body: BulkResendIn,ident: Identity=Depends(current_identity),db: AsyncSession=Depends(get_db)):
    require_admin(ident)
    if ident.event_id!=event_id:raise HTTPException(403,'Wrong event scope')
    queued=[];skipped=[]
    for order_id in dict.fromkeys(body.order_ids):
        try:
            await resend_order_delivery(event_id,order_id,ident,db);queued.append(order_id)
        except HTTPException as exc:
            await db.rollback();skipped.append({'id':order_id,'status':exc.status_code,'detail':exc.detail})
    return {'queued':queued,'skipped':skipped}
