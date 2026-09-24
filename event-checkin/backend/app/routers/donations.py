"""Event-scoped Donation Tracker and public Giving Hub APIs.

Financial truth lives in the contribution ledger. Festio Live consumes only the
privacy-safe aggregate snapshot, so enabling this module cannot change existing
poll, quiz, survey, or display behavior.
"""
from __future__ import annotations

import csv
import io
import logging
import secrets

import qrcode
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_paid_event_admin, require_paid_event_member
from ..config import settings
from ..database import get_db
from ..entitlements import last_credit_ledger_id, reserve_message_credit
from ..models import DonationCampaign, DonationContribution, DonationStatusHistory, Event, User
from ..ratelimit import rate_limit
from ..schemas import (
    DonationAuditEntryOut, DonationBulkVerifyIn, DonationBulkVerifyResult,
    DonationCampaignOut, DonationCampaignUpdate, DonationContributionCreate,
    DonationContributionOut, DonationDiscrepancyIn, DonationOfflineCreate,
    DonationPaymentReportIn, DonationPublicCampaignOut, DonationPublicContributionOut, DonationTransitionIn,
)
from . import broadcast
from .events import unique_event_code
from services import messaging
from services.credit_ledger import send_with_credit_ledger
from services.email_service import send_simple_email

logger = logging.getLogger(__name__)

router = APIRouter()
public_router = APIRouter()

DEFAULT_CHANNELS = [
    {"type": "festio_pay", "enabled": True, "label": "Festio Pay"},
    {"type": "cash_app", "enabled": False, "label": "Cash App"},
    {"type": "zelle", "enabled": False, "label": "Zelle"},
    {"type": "paypal", "enabled": False, "label": "PayPal"},
    {"type": "bank_transfer", "enabled": False, "label": "Bank transfer"},
    {"type": "offline", "enabled": False, "label": "Cash / cheque"},
    {"type": "pledge", "enabled": True, "label": "Pledge now"},
]

PLEDGE_PAYMENT_CHANNELS = [
    {"type": "festio_pay", "label": "Festio Pay"},
    {"type": "cash_app", "label": "Cash App"},
    {"type": "zelle", "label": "Zelle"},
    {"type": "paypal", "label": "PayPal"},
    {"type": "bank_transfer", "label": "Bank transfer"},
    {"type": "offline", "label": "Cash / cheque"},
]


def _public_base() -> str:
    return settings.frontend_url.rstrip("/")


def _reference() -> str:
    return f"GIVE-{secrets.token_hex(3).upper()}"


def _database_datetime(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


async def _campaign_for_event(event_id: str, db: AsyncSession) -> DonationCampaign | None:
    return await db.scalar(select(DonationCampaign).where(DonationCampaign.event_id == event_id))


async def _campaign_for_token(token: str, db: AsyncSession, require_enabled: bool = True) -> DonationCampaign:
    # The public link is normally the event's short event_code (e.g. "iedpu26"); older
    # links minted before that existed still resolve via the long public_token.
    campaign = await db.scalar(
        select(DonationCampaign)
        .join(Event, Event.id == DonationCampaign.event_id)
        .where(func.lower(Event.event_code) == token.strip().lower())
    )
    if not campaign:
        campaign = await db.scalar(select(DonationCampaign).where(DonationCampaign.public_token == token))
    if not campaign or (require_enabled and not campaign.enabled):
        raise HTTPException(404, "Donation campaign not found")
    return campaign


async def _rows(campaign_id: str, db: AsyncSession) -> list[DonationContribution]:
    return list((await db.execute(
        select(DonationContribution)
        .where(DonationContribution.campaign_id == campaign_id)
        .order_by(DonationContribution.created_at.desc())
    )).scalars().all())


def _totals(rows: list[DonationContribution]) -> dict:
    confirmed = sum(max(0, row.amount_minor - (row.refunded_minor or 0)) for row in rows if row.status == "confirmed")
    pending = sum(row.amount_minor for row in rows if row.status == "pending_verification")
    pledged = sum(row.amount_minor for row in rows if row.status == "pledged")
    refunded = sum(row.refunded_minor or 0 for row in rows)
    channel_totals: dict[str, dict] = {}
    for row in rows:
        bucket = channel_totals.setdefault(row.channel, {"channel": row.channel, "confirmed_minor": 0, "pending_minor": 0, "pledged_minor": 0, "count": 0})
        bucket["count"] += 1
        if row.status == "confirmed":
            bucket["confirmed_minor"] += max(0, row.amount_minor - (row.refunded_minor or 0))
        elif row.status == "pending_verification":
            bucket["pending_minor"] += row.amount_minor
        elif row.status == "pledged":
            bucket["pledged_minor"] += row.amount_minor
    return {
        "confirmed_minor": confirmed,
        "pending_minor": pending,
        "pledged_minor": pledged,
        "refunded_minor": refunded,
        "donation_count": sum(1 for row in rows if row.status == "confirmed"),
        "pledge_count": sum(1 for row in rows if row.status == "pledged"),
        "needs_attention_count": sum(1 for row in rows if row.reported_amount_minor is not None and row.status in ("pending_verification", "pledged")),
        "total_potential_minor": confirmed + pending + pledged,
        "channel_totals": list(channel_totals.values()),
    }


def _public_recent(campaign: DonationCampaign, rows: list[DonationContribution]) -> list[dict]:
    recent = []
    for row in rows:
        if row.status not in ("confirmed", "pledged"):
            continue
        recent.append({
            "id": row.id,
            "kind": "pledge" if row.status == "pledged" else "donation",
            "name": "Anonymous donor" if row.anonymous_publicly or not campaign.show_donor_names else (row.donor_name or "A generous donor"),
            "amount_minor": None if row.hide_amount_publicly or not campaign.show_donor_amounts else row.amount_minor,
            "message": row.message,
            "created_at": row.created_at.isoformat(),
        })
        if len(recent) == 8:
            break
    return recent


async def _campaign_out(campaign: DonationCampaign, db: AsyncSession) -> DonationCampaignOut:
    event = await db.get(Event, campaign.event_id)
    if event is not None and not event.event_code:
        event.event_code = await unique_event_code(db)
        await db.commit(); await db.refresh(event)
    rows = await _rows(campaign.id, db)
    totals = _totals(rows)
    share_token = event.event_code if event and event.event_code else campaign.public_token
    return DonationCampaignOut(
        id=campaign.id, event_id=campaign.event_id, public_token=campaign.public_token,
        public_url=f"{_public_base()}/give/{share_token}", event_name=event.name if event else "Event",
        enabled=campaign.enabled, title=campaign.title, description=campaign.description,
        goal_minor=campaign.goal_minor, currency=campaign.currency,
        public_total_mode=campaign.public_total_mode, show_donor_names=campaign.show_donor_names,
        show_donor_amounts=campaign.show_donor_amounts, show_pledged_total=campaign.show_pledged_total,
        celebrate_milestones=campaign.celebrate_milestones,
        milestones_minor=campaign.milestones_minor or [], channels=campaign.channels or [],
        recent_public=_public_recent(campaign, rows), **totals,
    )


async def _publish(campaign: DonationCampaign, db: AsyncSession) -> None:
    snapshot = await _campaign_out(campaign, db)
    await broadcast(campaign.event_id, {"type": "donation.changed", "donation": snapshot.model_dump(mode="json")})


def _money(amount_minor: int, currency: str) -> str:
    return f"{amount_minor / 100:,.2f} {currency}"


async def _send_thank_you(event: Event | None, row: DonationContribution, background_tasks: BackgroundTasks, db: AsyncSession) -> None:
    """Best-effort thank-you on contact_consent -- never raises, never blocks
    the donor's response. Email self-meters its own credit; SMS must reserve
    one first (see services/credit_ledger.py, entitlements.reserve_message_credit)."""
    if not event:
        return
    name = row.donor_name or "there"
    event_name = event.name
    amount = _money(row.amount_minor, row.currency)
    if row.status == "pledged":
        subject = f"Thank you for your pledge to {event_name}"
        html = f"<p>Hi {name},</p><p>Thank you for pledging <strong>{amount}</strong> to support {event_name}. Your pledge is recorded and we'll follow up as your expected date approaches.</p>"
        sms = f"Thank you for pledging {amount} to {event_name}! We'll follow up as your date approaches."
    else:
        subject = f"Thank you for your gift to {event_name}"
        html = f"<p>Hi {name},</p><p>Thank you for your gift of <strong>{amount}</strong> to support {event_name}. We'll confirm once it's received.</p>"
        sms = f"Thank you for your gift of {amount} to {event_name}! We'll confirm once it's received."

    if row.donor_email:
        try:
            background_tasks.add_task(send_simple_email, row.donor_email, subject, html, event.id, None, None, "donation_thank_you")
        except Exception:
            logger.exception("Failed to queue donation thank-you email for contribution=%s", row.id)

    if row.donor_phone:
        try:
            if await reserve_message_credit(event, "sms", db=db, reason="donation_thank_you"):
                background_tasks.add_task(send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_custom_sms, phone=row.donor_phone, body=sms)
        except Exception:
            logger.exception("Failed to queue donation thank-you SMS for contribution=%s", row.id)


@router.get("/{event_id}/donation-campaign", response_model=DonationCampaignOut)
async def get_campaign(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_member)):
    campaign = await _campaign_for_event(event_id, db)
    if not campaign:
        event = await db.get(Event, event_id)
        campaign = DonationCampaign(
            event_id=event_id, enabled=False, title=f"Support {event.name}" if event else "Support this event",
            currency="USD", channels=DEFAULT_CHANNELS,
        )
        db.add(campaign); await db.commit(); await db.refresh(campaign)
    return await _campaign_out(campaign, db)


@router.put("/{event_id}/donation-campaign", response_model=DonationCampaignOut)
async def save_campaign(event_id: str, body: DonationCampaignUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    campaign = await _campaign_for_event(event_id, db)
    if not campaign:
        campaign = DonationCampaign(event_id=event_id)
        db.add(campaign)
    values = body.model_dump()
    values["currency"] = values["currency"].upper()
    values["milestones_minor"] = sorted(set(value for value in values["milestones_minor"] if value > 0))
    values["channels"] = [channel.model_dump() for channel in body.channels]
    for key, value in values.items():
        setattr(campaign, key, value)
    await db.commit(); await db.refresh(campaign)
    await _publish(campaign, db)
    return await _campaign_out(campaign, db)


@router.get("/{event_id}/donations", response_model=list[DonationContributionOut])
async def list_contributions(event_id: str, status: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_member)):
    campaign = await _campaign_for_event(event_id, db)
    if not campaign:
        return []
    rows = await _rows(campaign.id, db)
    return [row for row in rows if not status or row.status == status]


async def _add_history(db: AsyncSession, row: DonationContribution, old: str | None, new: str, actor_id: str | None, note: str | None = None) -> None:
    db.add(DonationStatusHistory(contribution_id=row.id, from_status=old, to_status=new, actor_id=actor_id, note=note))


@router.post("/{event_id}/donations/offline", response_model=DonationContributionOut, status_code=201)
async def add_offline(event_id: str, body: DonationOfflineCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_paid_event_admin)):
    campaign = await _campaign_for_event(event_id, db)
    if not campaign or not campaign.enabled:
        raise HTTPException(409, "Enable the Donation Tracker first")
    row = DonationContribution(
        campaign_id=campaign.id, event_id=event_id, channel=body.channel,
        amount_minor=body.amount_minor, currency=campaign.currency, status=body.status,
        donor_name=body.donor_name, donor_email=str(body.donor_email) if body.donor_email else None,
        donor_phone=body.donor_phone, source=body.source, anonymous_publicly=body.anonymous_publicly,
        hide_amount_publicly=body.hide_amount_publicly, message=body.message,
        expected_payment_channel=body.expected_payment_channel,
        expected_payment_date=_database_datetime(body.expected_payment_date),
        provider_reference=body.provider_reference, reference=_reference(),
        verified_by=user.id if body.status == "confirmed" else None,
        verified_at=datetime.utcnow() if body.status == "confirmed" else None,
    )
    history_note = f"Added by organizer{f' — {body.source}' if body.source else ''}"
    db.add(row); await db.flush(); await _add_history(db, row, None, row.status, user.id, history_note)
    await db.commit(); await db.refresh(row); await _publish(campaign, db)
    return row


async def _transition(event_id: str, contribution_id: str, target: str, body: DonationTransitionIn, db: AsyncSession, user: User) -> DonationContribution:
    campaign = await _campaign_for_event(event_id, db)
    row = await db.get(DonationContribution, contribution_id)
    if not campaign or not row or row.campaign_id != campaign.id:
        raise HTTPException(404, "Contribution not found")
    allowed = {
        "confirmed": {"pending_verification", "pledged", "initiated"},
        "cancelled": {"pending_verification", "pledged", "initiated"},
        "failed": {"pending_verification", "initiated"},
    }
    if row.status not in allowed[target]:
        raise HTTPException(409, f"Cannot change {row.status} to {target}")
    old = row.status; row.status = target
    if body.provider_reference:
        row.provider_reference = body.provider_reference
    note = body.note
    if target == "confirmed":
        row.verified_by = user.id; row.verified_at = datetime.utcnow()
        if body.reported_amount_minor:
            reconciled = f"Reconciled from {_money(row.amount_minor, row.currency)} to {_money(body.reported_amount_minor, row.currency)} (reported amount)"
            note = f"{note} — {reconciled}" if note else reconciled
            row.amount_minor = body.reported_amount_minor
            row.reported_amount_minor = None
    await _add_history(db, row, old, target, user.id, note)
    await db.commit(); await db.refresh(row); await _publish(campaign, db)
    return row


@router.post("/{event_id}/donations/{contribution_id}/verify", response_model=DonationContributionOut)
async def verify_contribution(event_id: str, contribution_id: str, body: DonationTransitionIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_paid_event_admin)):
    return await _transition(event_id, contribution_id, "confirmed", body, db, user)


@router.post("/{event_id}/donations/{contribution_id}/reject", response_model=DonationContributionOut)
async def reject_contribution(event_id: str, contribution_id: str, body: DonationTransitionIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_paid_event_admin)):
    return await _transition(event_id, contribution_id, "failed", body, db, user)


@router.post("/{event_id}/donations/{contribution_id}/cancel", response_model=DonationContributionOut)
async def cancel_contribution(event_id: str, contribution_id: str, body: DonationTransitionIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_paid_event_admin)):
    return await _transition(event_id, contribution_id, "cancelled", body, db, user)


@router.post("/{event_id}/donations/{contribution_id}/discrepancy", response_model=DonationContributionOut)
async def report_discrepancy(event_id: str, contribution_id: str, body: DonationDiscrepancyIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_paid_event_admin)):
    """Flags what actually arrived differs from what was submitted, without
    changing status -- surfaces as "needs attention" until verify (optionally
    passing reported_amount_minor back) reconciles or cancel/reject closes it."""
    campaign = await _campaign_for_event(event_id, db)
    row = await db.get(DonationContribution, contribution_id)
    if not campaign or not row or row.campaign_id != campaign.id:
        raise HTTPException(404, "Contribution not found")
    if row.status not in ("pending_verification", "pledged"):
        raise HTTPException(409, f"Cannot flag a discrepancy on a {row.status} contribution")
    row.reported_amount_minor = body.reported_amount_minor
    note = f"Reported amount differs: expected {_money(row.amount_minor, row.currency)}, actually {_money(body.reported_amount_minor, row.currency)}"
    if body.note:
        note = f"{note} — {body.note}"
    await _add_history(db, row, row.status, row.status, user.id, note)
    await db.commit(); await db.refresh(row); await _publish(campaign, db)
    return row


@router.post("/{event_id}/donations/bulk-verify", response_model=DonationBulkVerifyResult)
async def bulk_verify_contributions(event_id: str, body: DonationBulkVerifyIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_paid_event_admin)):
    result = DonationBulkVerifyResult()
    transition_body = DonationTransitionIn(note=body.note)
    for contribution_id in body.contribution_ids:
        try:
            await _transition(event_id, contribution_id, "confirmed", transition_body, db, user)
            result.confirmed.append(contribution_id)
        except HTTPException as exc:
            result.failed.append({"id": contribution_id, "error": exc.detail})
    return result


@router.get("/{event_id}/donations/audit", response_model=list[DonationAuditEntryOut])
async def donation_audit_trail(event_id: str, limit: int = 30, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_member)):
    campaign = await _campaign_for_event(event_id, db)
    if not campaign:
        return []
    entries = (await db.execute(
        select(DonationStatusHistory, DonationContribution, User)
        .join(DonationContribution, DonationContribution.id == DonationStatusHistory.contribution_id)
        .outerjoin(User, User.id == DonationStatusHistory.actor_id)
        .where(DonationContribution.campaign_id == campaign.id)
        .order_by(DonationStatusHistory.created_at.desc())
        .limit(min(limit, 100))
    )).all()
    return [
        DonationAuditEntryOut(
            id=history.id, contribution_id=contribution.id, donor_name=contribution.donor_name,
            reference=contribution.reference, amount_minor=contribution.amount_minor, currency=contribution.currency,
            channel=contribution.channel, from_status=history.from_status, to_status=history.to_status,
            actor_name=(actor.name if actor else None), note=history.note, created_at=history.created_at,
        )
        for history, contribution, actor in entries
    ]


@router.get("/{event_id}/donations/export")
async def export_donations(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    campaign = await _campaign_for_event(event_id, db)
    rows = await _rows(campaign.id, db) if campaign else []
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Reference", "Donor", "Email", "Phone", "Amount", "Reported amount", "Currency", "Channel", "Status", "Submitted", "Verified at"])
    for row in rows:
        writer.writerow([
            row.reference, row.donor_name or "", row.donor_email or "", row.donor_phone or "",
            row.amount_minor / 100, (row.reported_amount_minor / 100) if row.reported_amount_minor else "",
            row.currency, row.channel, row.status,
            row.created_at.isoformat(timespec="minutes"), row.verified_at.isoformat(timespec="minutes") if row.verified_at else "",
        ])
    buffer.seek(0)
    filename = f"donations-{event_id}.csv"
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@public_router.get("/{token}/qr.png")
async def public_campaign_qr(token: str, db: AsyncSession = Depends(get_db)):
    await _campaign_for_token(token, db)
    image = qrcode.make(f"{_public_base()}/give/{token}")
    output = io.BytesIO(); image.save(output, format="PNG"); output.seek(0)
    return StreamingResponse(output, media_type="image/png", headers={"Cache-Control": "public, max-age=300"})


@public_router.get("/{token}", response_model=DonationPublicCampaignOut)
async def public_campaign(token: str, db: AsyncSession = Depends(get_db), _: None = Depends(rate_limit(limit=180, window=60, scope="donation_public_read", key="token"))):
    campaign = await _campaign_for_token(token, db)
    event = await db.get(Event, campaign.event_id)
    rows = await _rows(campaign.id, db); totals = _totals(rows)
    return DonationPublicCampaignOut(
        token=token, event_name=event.name if event else "Event", title=campaign.title,
        description=campaign.description,
        logo_url=event.logo_url if event else None,
        cover_image_url=event.invite_cover_image if event else None,
        goal_minor=campaign.goal_minor, currency=campaign.currency,
        confirmed_minor=totals["confirmed_minor"], pledged_minor=totals["pledged_minor"],
        pledge_count=totals["pledge_count"], show_pledged_total=campaign.show_pledged_total,
        channels=[channel for channel in (campaign.channels or []) if channel.get("enabled")],
        pledge_payment_channels=PLEDGE_PAYMENT_CHANNELS,
        recent_public=_public_recent(campaign, rows),
    )


def _public_contribution_out(row: DonationContribution, channel: dict) -> DonationPublicContributionOut:
    return DonationPublicContributionOut(
        id=row.id, access_token=row.access_token, reference=row.reference, status=row.status,
        channel=row.channel, amount_minor=row.amount_minor, currency=row.currency,
        expected_payment_date=row.expected_payment_date, payment_reported_at=row.payment_reported_at,
        instructions=channel.get("public_instructions"), checkout_url=channel.get("checkout_url"),
        recipient_email=channel.get("recipient_email"), recipient_phone=channel.get("recipient_phone"),
        bank_name=channel.get("bank_name"), account_number=channel.get("account_number"),
        routing_number=channel.get("routing_number"), account_type=channel.get("account_type"),
        account_holder_name=channel.get("account_holder_name"),
    )


@public_router.post("/{token}/contributions", response_model=DonationPublicContributionOut, status_code=201)
async def create_public_contribution(token: str, body: DonationContributionCreate, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), _: None = Depends(rate_limit(limit=20, window=60, scope="donation_public_submit", key="client_ip"))):
    campaign = await _campaign_for_token(token, db)
    channel = next((item for item in (campaign.channels or []) if item.get("type") == body.channel and item.get("enabled")), None)
    if not channel:
        raise HTTPException(422, "This contribution channel is not enabled")
    if body.channel == "offline":
        raise HTTPException(422, "Cash and cheque contributions are recorded by event staff")
    if body.channel == "pledge" and (not body.expected_payment_channel or not body.expected_payment_date):
        raise HTTPException(422, "Pledges require an expected payment channel and date")
    if body.channel == "festio_pay" and not channel.get("checkout_url"):
        raise HTTPException(409, "Festio Pay is not configured for this campaign")
    status = "pledged" if body.channel == "pledge" else ("initiated" if body.channel == "festio_pay" else "pending_verification")
    row = DonationContribution(
        campaign_id=campaign.id, event_id=campaign.event_id, channel=body.channel,
        amount_minor=body.amount_minor, currency=campaign.currency, status=status,
        donor_name=body.donor_name, donor_email=str(body.donor_email) if body.donor_email else None,
        donor_phone=body.donor_phone, contact_consent=body.contact_consent, anonymous_publicly=body.anonymous_publicly,
        hide_amount_publicly=body.hide_amount_publicly, message=body.message,
        expected_payment_channel=body.expected_payment_channel,
        expected_payment_date=_database_datetime(body.expected_payment_date),
        provider_reference=body.provider_reference, reference=_reference(),
    )
    db.add(row); await db.flush(); await _add_history(db, row, None, status, None, "Submitted through Giving Hub")
    await db.commit(); await db.refresh(row); await _publish(campaign, db)
    if body.contact_consent and (row.donor_email or row.donor_phone):
        event = await db.get(Event, campaign.event_id)
        await _send_thank_you(event, row, background_tasks, db)
    return _public_contribution_out(row, channel)


@public_router.get("/{token}/contributions/{access_token}", response_model=DonationPublicContributionOut)
async def public_contribution_status(token: str, access_token: str, db: AsyncSession = Depends(get_db), _: None = Depends(rate_limit(limit=60, window=60, scope="donation_public_status", key="client_ip"))):
    campaign = await _campaign_for_token(token, db)
    row = await db.scalar(select(DonationContribution).where(
        DonationContribution.campaign_id == campaign.id,
        DonationContribution.access_token == access_token,
    ))
    if not row:
        raise HTTPException(404, "Contribution not found")
    channel = next((item for item in (campaign.channels or []) if item.get("type") == row.channel), {})
    return _public_contribution_out(row, channel)


@public_router.post("/{token}/contributions/{access_token}/report", response_model=DonationPublicContributionOut)
async def report_public_contribution(token: str, access_token: str, body: DonationPaymentReportIn, db: AsyncSession = Depends(get_db), _: None = Depends(rate_limit(limit=20, window=60, scope="donation_public_report", key="client_ip"))):
    """Donor self-report: "I've completed my payment," optionally converting
    a pledge into an actual payment attempt on THIS SAME row (never creates a
    duplicate contribution). Never moves status to confirmed -- only staff
    verifying in Finance does that."""
    campaign = await _campaign_for_token(token, db)
    row = await db.scalar(select(DonationContribution).where(
        DonationContribution.campaign_id == campaign.id,
        DonationContribution.access_token == access_token,
    ))
    if not row:
        raise HTTPException(404, "Contribution not found")
    if row.status not in ("pending_verification", "initiated", "pledged"):
        raise HTTPException(409, f"Cannot report payment on a {row.status} contribution")
    old_status = row.status
    if body.channel and body.channel != row.channel:
        target = next((item for item in (campaign.channels or []) if item.get("type") == body.channel and item.get("enabled")), None)
        if not target:
            raise HTTPException(422, "That payment method is not enabled for this campaign")
        note = f"Pledge converted to a {target.get('label') or body.channel} payment attempt"
        row.channel = body.channel
        if row.status == "pledged":
            row.status = "pending_verification"
    else:
        target = next((item for item in (campaign.channels or []) if item.get("type") == row.channel), {})
        note = "Donor reported payment completed"
    if body.provider_reference:
        row.provider_reference = body.provider_reference
    if body.evidence_note:
        note = f"{note} — {body.evidence_note}"
    row.payment_reported_at = datetime.utcnow()
    await _add_history(db, row, old_status, row.status, None, note)
    await db.commit(); await db.refresh(row); await _publish(campaign, db)
    return _public_contribution_out(row, target)
