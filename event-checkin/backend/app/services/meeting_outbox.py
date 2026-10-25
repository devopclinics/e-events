"""Durable, per-recipient deliveries. Never automatically retry uncertain sends.

Resend is the initial supported transport because it accepts idempotency keys.
Provider acceptance is deliberately distinct from inbox delivery confirmation.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from html import escape
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from sqlalchemy import select
import httpx
import json
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr, format_datetime
import aiosmtplib

from ..database import AsyncSessionLocal
from ..config import settings
from ..models import Meeting, MeetingAttendee, MeetingDelivery, Organization, Membership
from .meeting_service import calendar_bytes, invitation, response_token, phone_message, utc_time
from .meeting_followups import followup_guard, release_followups, authorized
from .meeting_channels import preflight, SetupRequired, Suppressed, DefiniteRejection
from services import messaging
from services.email_service import _resend_payload
from services.outbound_safety import recipient_allowed


def freeze_payload(row, meeting, attendee, template=None):
    if row.wire_payload:
        return
    token = response_token(meeting, attendee, scope="meeting-response" if row.method == "REQUEST" else "meeting-preferences",
        phone=row.recipient if row.channel != "email" else attendee.phone)
    url = settings.frontend_url.rstrip("/") + "/meeting-response/" + token
    if row.method == "CANCEL":
        url += "?preferences=1"
    if row.channel != "email":
        body = phone_message(row.payload, method=row.method)
        row.wire_payload = {"mode": row.channel, "body": body + ". Details / notification preferences: " + url,
            "template_ref": template.bird_project_id if template else None,
            "params": [attendee.name, row.payload["title"], body, url],
            "var_keys": ["firstName", "eventName", "message", "ticketLink"]}
        return
    subject, body = invitation(row.payload, method=row.method, recipient_name=attendee.name,
        response_url=url if row.method == "REQUEST" else None, purpose=row.purpose)
    msg = MIMEMultipart("mixed", boundary="meeting-" + row.id)
    msg["To"] = row.recipient or attendee.email
    msg["From"] = settings.email_from
    msg["Subject"] = subject
    msg["Message-ID"] = f"<meeting-{row.id}@festio.events>"
    msg["Date"] = format_datetime(row.created_at.replace(tzinfo=timezone.utc))
    msg.attach(MIMEText(body, "html", "utf-8"))
    recipient = type("Recipient", (), {"name": attendee.name, "email": row.recipient or attendee.email})()
    part = MIMEText(calendar_bytes(meeting, row.payload, recipient, row.method, row.sequence, dtstamp=row.created_at).decode(), "calendar", "utf-8")
    part.set_param("method", row.method)
    part.add_header("Content-Disposition", "attachment", filename="meeting.ics")
    msg.attach(part)
    payload = _resend_payload(msg)
    payload["tags"] = [{"name": "meeting_delivery_id", "value": row.id}]
    # Persist exact bytes, including DTSTAMP, boundary, sender and signed URL.
    row.wire_payload = {"mode": settings.meetings_email_transport,
        "mime": msg.as_bytes(policy=policy.SMTP).decode("utf-8"),
        "body_json": json.dumps(payload, separators=(",", ":"), ensure_ascii=False)}


async def transport(row, meeting, attendee):
    if not settings.meetings_sending_enabled:
        raise ValueError("Meetings sending is disabled")
    if not recipient_allowed(row.channel, row.recipient or attendee.email):
        raise Suppressed("Recipient blocked by configured outbound safety policy")
    freeze_payload(row, meeting, attendee)
    wire = row.wire_payload
    if row.channel in {"sms", "whatsapp"}:
        context = messaging._event_context.set(None)
        try:
            if row.channel == "sms":
                result = await messaging.send_custom_sms(phone=row.recipient, body=wire["body"])
            else:
                result = await messaging.send_custom_template_whatsapp(phone=row.recipient,
                    template_ref=wire["template_ref"], params=wire["params"], var_keys=wire["var_keys"])
        finally:
            messaging._event_context.reset(context)
        # Legacy adapters swallow timeouts and rejection details. Never label
        # their generic 'failed' as safe to retry after possible acceptance.
        if not isinstance(result, dict) or result.get("status") in {"failed", "rejected", "error", "undelivered"} or not result.get("provider_message_id"):
            raise RuntimeError("Messaging outcome unknown; reconcile before retry")
        return str(result["provider_message_id"])
    if wire["mode"] == "smtp":
        if not settings.smtp_host:
            raise SetupRequired("SMTP setup required for calendar scheduling MIME")
        message = BytesParser(policy=policy.SMTP).parsebytes(wire["mime"].encode("utf-8"))
        async with aiosmtplib.SMTP(hostname=settings.smtp_host, port=settings.smtp_port,
                use_tls=False, start_tls=settings.smtp_tls, timeout=20) as smtp:
            if settings.smtp_user:
                await smtp.login(settings.smtp_user, settings.smtp_password)
            # Raw MIME retains text/calendar; method=REQUEST/CANCEL end to end.
            await smtp.sendmail(parseaddr(message["From"])[1], [row.recipient], wire["mime"].encode("utf-8"))
        return "smtp:" + row.id
    if wire["mode"] != "resend_attachment" or not settings.resend_api_key:
        raise SetupRequired("Email transport setup required")
    async with httpx.AsyncClient(timeout=20) as client:
        result = await client.post("https://api.resend.com/emails", content=wire["body_json"].encode("utf-8"),
            headers={"Authorization": f"Bearer {settings.resend_api_key}", "Content-Type": "application/json", "Idempotency-Key": f"meeting-{row.id}"})
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
            attendee = await db.get(MeetingAttendee, row.attendee_id)
            org = await db.scalar(select(Organization).where(Organization.id == m.org_id).with_for_update())
            try:
                await followup_guard(db, m, attendee, row)
                template = await preflight(db, m, attendee, row.channel, row.recipient or attendee.email, row.payload, org)
                if row.channel == "whatsapp" and row.wire_payload and row.wire_payload.get("template_ref") != template.bird_project_id:
                    raise SetupRequired("Approved template changed; publish a reviewed new revision")
                freeze_payload(row, m, attendee, template)
                if row.channel != "email" and (row.charged_at is None or row.charge_refunded):
                    if int(org.message_credit_units or 0) < row.credit_units:
                        raise SetupRequired("Insufficient organization message credits")
                    org.message_credit_units -= row.credit_units
                    row.charged_at = datetime.utcnow()
                    row.charge_refunded = False
                row.status = "sending"
                row.attempts += 1
                row.attempted_at = datetime.utcnow()
            except Suppressed as exc:
                row.status, row.error = "blocked", str(exc)
            except SetupRequired as exc:
                row.status, row.error = "setup_required", str(exc)
        await db.commit()
    async with sessions() as db:
        m = await db.scalar(select(Meeting).where(Meeting.id == row.meeting_id).with_for_update())
        row = await db.get(MeetingDelivery, delivery_id)
        if row.status != "sending" or row.sequence != m.sequence:
            # This invocation committed the claim but has not called a provider.
            # A concurrent publish/cancel can supersede that claim between our
            # transactions. Release its reservation here, never by blindly
            # refunding historic uncertain sends from enqueue().
            if row.status == "superseded" and row.charged_at and not row.charge_refunded:
                org = await db.scalar(select(Organization).where(Organization.id == m.org_id).with_for_update())
                org.message_credit_units += row.credit_units
                row.charge_refunded = True
                await db.commit()
            return
        attendee = await db.get(MeetingAttendee, row.attendee_id)
        org = await db.get(Organization, m.org_id)
        if not org or not org.is_active or (row.method == "REQUEST" and (not attendee.active or m.status != "scheduled")):
            row.status = "superseded"
        else:
            try:
                await followup_guard(db, m, attendee, row)
                await preflight(db, m, attendee, row.channel, row.recipient or attendee.email, row.payload, org)
                row.provider_id = await sender(row, m, attendee)
                row.status = "accepted"
                row.error = None
            except Suppressed as exc:
                row.status, row.error = "blocked", str(exc)
            except SetupRequired as exc:
                row.status, row.error = "setup_required", str(exc)
            except DefiniteRejection as exc:
                row.status, row.error = "failed", str(exc)
            except httpx.HTTPStatusError as exc:
                # Only known rejection responses are safe to retry. Conflict,
                # timeout and server errors may follow acceptance.
                row.status = "failed" if exc.response.status_code in {400, 401, 403, 404, 405, 413, 415, 422, 429} else "uncertain"
                row.error = f"Provider HTTP {exc.response.status_code}"
            except Exception:
                row.status, row.error = "uncertain", "Provider outcome unknown; reconcile before retry"
        if row.status in {"failed", "setup_required", "blocked", "superseded"} and row.charged_at and not row.charge_refunded:
            org = await db.scalar(select(Organization).where(Organization.id == m.org_id).with_for_update())
            org.message_credit_units += row.credit_units
            row.charge_refunded = True
        await db.commit()


async def release_scheduled(sessions):
    from fastapi import HTTPException
    from ..routers.meetings import Version, validate_publish, enqueue, clear_schedule
    async with sessions() as db:
        ids = (await db.scalars(select(Meeting.id).where(Meeting.send_at <= datetime.utcnow()).limit(20))).all()
    for mid in ids:
        async with sessions() as db:
            m = await db.scalar(select(Meeting).where(Meeting.id == mid).with_for_update(skip_locked=True))
            if not m or not m.send_at or m.send_at > datetime.utcnow():
                continue
            instruction = m.send_schedule or {}
            try:
                org = await db.get(Organization, m.org_id)
                authorizer = instruction.get("authorized_by", m.organizer_id)
                member = await authorized(db, m, authorizer)
                if not org or not org.is_active or not member:
                    raise HTTPException(403, "Organizer access changed. Review invitation sending.")
                data = Version(revision=instruction["revision"], confirm_paid_channels=instruction.get("confirm_paid_channels", False),
                    quoted_credit_units=instruction.get("quoted_credit_units"))
                await validate_publish(m, data, db)
                if utc_time(m.draft["start"], m.draft["timezone"], m.draft.get("start_fold")) <= datetime.now(timezone.utc):
                    raise HTTPException(422, "The meeting has already started. Review invitation sending.")
                await enqueue(m, db, authorized_by=authorizer)
                clear_schedule(m, "queued")
            except HTTPException as exc:
                clear_schedule(m, "blocked", str(exc.detail))
            await db.commit()


async def tick(sessions=None):
    sessions = sessions or AsyncSessionLocal
    if not settings.meetings_sending_enabled:
        return
    await release_scheduled(sessions)
    await release_followups(sessions)
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
