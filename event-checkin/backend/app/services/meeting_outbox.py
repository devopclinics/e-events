"""Durable, per-recipient deliveries. Never automatically retry uncertain sends.

Resend is the initial supported transport because it accepts idempotency keys.
Provider acceptance is deliberately distinct from inbox delivery confirmation.
"""
import asyncio
from datetime import datetime, timedelta
from html import escape
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from sqlalchemy import select
import httpx

from ..database import AsyncSessionLocal
from ..config import settings
from ..models import Meeting, MeetingAttendee, MeetingDelivery, Organization
from .meeting_service import calendar_bytes, invitation, response_token
from services.email_service import _resend_payload, _festio_email_shell
from services.outbound_safety import recipient_allowed


async def transport(row, meeting, attendee):
    if not settings.meetings_sending_enabled:
        raise ValueError("Meetings sending is disabled")
    if not settings.resend_api_key:
        raise ValueError("Meetings requires the idempotent Resend transport")
    if not recipient_allowed("email", attendee.email):
        raise ValueError("Recipient blocked by configured outbound safety policy")
    subject, body = invitation(row.payload, method=row.method)
    if row.method == "REQUEST":
        token = response_token(meeting, attendee)
        url = settings.frontend_url.rstrip("/") + "/meeting-response/" + token
        body += f'<p><a href="{escape(url, quote=True)}">View invitation and respond</a></p>'
        body += '<p>' + ' · '.join(f'<a href="{escape(url, quote=True)}?choice={choice}">{label}</a>' for choice, label in
            [("accepted", "Accept"), ("maybe", "Maybe"), ("declined", "Decline")]) + '</p><p>Opening a link previews the invitation. Confirm your response on the page.</p>'
    msg = MIMEMultipart("mixed")
    msg["To"] = attendee.email
    msg["From"] = settings.email_from
    msg["Subject"] = subject
    msg["Message-ID"] = f"<meeting-{row.id}@festio.events>"
    msg.attach(MIMEText(_festio_email_shell(body, title=subject), "html", "utf-8"))
    part = MIMEText(calendar_bytes(meeting, row.payload, attendee, row.method, row.sequence).decode(), "calendar", "utf-8")
    part.set_param("method", row.method)
    part.add_header("Content-Disposition", "attachment", filename="meeting.ics")
    msg.attach(part)
    payload = _resend_payload(msg)
    payload["tags"] = [{"name": "meeting_delivery_id", "value": row.id}]
    async with httpx.AsyncClient(timeout=20) as client:
        result = await client.post("https://api.resend.com/emails", json=payload,
            headers={"Authorization": f"Bearer {settings.resend_api_key}", "Idempotency-Key": f"meeting-{row.id}"})
    result.raise_for_status()
    provider_id = result.json().get("id")
    if not provider_id:
        raise RuntimeError("Provider accepted without an identifier; reconcile outcome")
    return provider_id


async def deliver(delivery_id, sessions=None, sender=None):
    sessions = sessions or AsyncSessionLocal
    sender = sender or transport
    if not settings.meetings_sending_enabled:
        return
    # Persist a claim before external I/O. A crash leaves 'sending', never queued.
    async with sessions() as db:
        row = await db.get(MeetingDelivery, delivery_id)
        if not row:
            return
        m = await db.scalar(select(Meeting).where(Meeting.id == row.meeting_id).with_for_update())
        await db.refresh(row)
        if row.status != "queued":
            return
        if row.sequence != m.sequence or (m.status == "cancelled" and row.method == "REQUEST"):
            row.status = "superseded"
        else:
            row.status = "sending"
            row.attempts += 1
            row.attempted_at = datetime.utcnow()
        await db.commit()
    async with sessions() as db:
        m = await db.scalar(select(Meeting).where(Meeting.id == row.meeting_id).with_for_update())
        row = await db.get(MeetingDelivery, delivery_id)
        if row.status != "sending" or row.sequence != m.sequence:
            return
        attendee = await db.get(MeetingAttendee, row.attendee_id)
        org = await db.get(Organization, m.org_id)
        if not org or not org.is_active or (row.method == "REQUEST" and (not attendee.active or m.status != "scheduled")):
            row.status = "superseded"
        else:
            try:
                row.provider_id = await sender(row, m, attendee)
                row.status = "accepted"
                row.error = None
            except ValueError as exc:
                row.status, row.error = "failed", str(exc)
            except httpx.HTTPStatusError as exc:
                # 4xx rejection is safe to retry after correction. A 5xx may
                # have followed acceptance, so requires reconciliation.
                row.status = "failed" if 400 <= exc.response.status_code < 500 else "uncertain"
                row.error = f"Provider HTTP {exc.response.status_code}"
            except Exception:
                row.status, row.error = "uncertain", "Provider outcome unknown; reconcile before retry"
        await db.commit()


async def tick(sessions=None):
    sessions = sessions or AsyncSessionLocal
    if not settings.meetings_sending_enabled:
        return
    async with sessions() as db:
        abandoned = (await db.scalars(select(MeetingDelivery).where(MeetingDelivery.status == "sending",
            MeetingDelivery.attempted_at < datetime.utcnow() - timedelta(minutes=5)).with_for_update(skip_locked=True))).all()
        for row in abandoned:
            row.status, row.error = "uncertain", "Interrupted send; reconcile provider outcome before retry"
        ids = (await db.scalars(select(MeetingDelivery.id).where(MeetingDelivery.status == "queued").limit(20))).all()
        await db.commit()
    for delivery_id in ids:
        await deliver(delivery_id, sessions)


async def run():
    while True:
        try:
            await tick()
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Meeting outbox tick failed")
        await asyncio.sleep(10)
