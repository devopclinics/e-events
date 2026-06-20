"""Message Templates CRUD + preview + test-send endpoints.

Scope hierarchy: event-level override → platform default.
"""
import html
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import MessageTemplate, Event, User
from ..schemas import (
    MessageTemplateUpsert,
    MessageTemplateOut,
    TemplatePreviewRequest,
    TemplatePreviewOut,
    TemplateTestSendRequest,
)
from ..auth import require_admin, get_current_user
from services import template_service

router = APIRouter()

# ── helpers ───────────────────────────────────────────────────────────────────

_DANGEROUS_TAGS = re.compile(
    r"<\s*(script|iframe|object|embed|form|input|button|link|meta|base|style)[^>]*>",
    re.IGNORECASE,
)


def _sanitize_html(text: str | None) -> str | None:
    """Strip obviously dangerous HTML tags from email bodies."""
    if text is None:
        return None
    return _DANGEROUS_TAGS.sub("", text)


def _to_out(row: MessageTemplate, is_default: bool = False) -> MessageTemplateOut:
    defaults = template_service.DEFAULTS.get(row.template_key, {})
    return MessageTemplateOut(
        id=row.id,
        scope=row.scope,
        event_id=row.event_id,
        template_key=row.template_key,
        subject=row.subject if row.subject is not None else defaults.get("subject"),
        email_body=row.email_body if row.email_body is not None else defaults.get("email_body"),
        sms_body=row.sms_body if row.sms_body is not None else defaults.get("sms_body"),
        mms_body=row.mms_body if row.mms_body is not None else defaults.get("mms_body"),
        whatsapp_body=row.whatsapp_body if row.whatsapp_body is not None else defaults.get("whatsapp_body"),
        updated_at=row.updated_at,
        updated_by=row.updated_by,
        is_default=is_default,
    )


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/templates", response_model=list[MessageTemplateOut])
async def list_templates(
    event_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all templates. If event_id is given, merges platform defaults with
    event-level overrides and flags which source each template comes from."""
    platform_rows = (await db.execute(
        select(MessageTemplate).where(
            MessageTemplate.scope == "platform",
            MessageTemplate.event_id.is_(None),
        )
    )).scalars().all()

    platform_by_key = {r.template_key: r for r in platform_rows}

    event_rows: dict[str, MessageTemplate] = {}
    if event_id:
        rows = (await db.execute(
            select(MessageTemplate).where(
                MessageTemplate.scope == "event",
                MessageTemplate.event_id == event_id,
            )
        )).scalars().all()
        event_rows = {r.template_key: r for r in rows}

    results: list[MessageTemplateOut] = []
    all_keys = set(template_service.ALL_TEMPLATE_KEYS) | set(platform_by_key) | set(event_rows)
    for key in sorted(all_keys):
        if key in event_rows:
            results.append(_to_out(event_rows[key], is_default=False))
        elif key in platform_by_key:
            results.append(_to_out(platform_by_key[key], is_default=False))
        else:
            # Return a synthetic "default" placeholder so the UI can show it.
            defaults = template_service.DEFAULTS.get(key, {})
            from ..models import MessageTemplate as MT
            import uuid
            from datetime import datetime
            synthetic = MT(
                id=f"default-{key}",
                scope="platform",
                event_id=None,
                template_key=key,
                subject=defaults.get("subject"),
                email_body=defaults.get("email_body"),
                sms_body=defaults.get("sms_body"),
                mms_body=defaults.get("mms_body"),
                whatsapp_body=defaults.get("whatsapp_body"),
                updated_at=datetime.utcnow(),
                updated_by=None,
            )
            out = _to_out(synthetic, is_default=True)
            results.append(out)

    return results


# ── Get single ────────────────────────────────────────────────────────────────

@router.get("/templates/{template_key}", response_model=MessageTemplateOut)
async def get_template(
    template_key: str,
    event_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resolved = await template_service.resolve_template(template_key, event_id, db)
    defaults = template_service.DEFAULTS.get(template_key, {})
    # Try to load the actual DB row so we can return proper metadata.
    scope = "event" if event_id else "platform"
    row = (await db.execute(
        select(MessageTemplate).where(
            MessageTemplate.template_key == template_key,
            MessageTemplate.scope == scope,
            MessageTemplate.event_id == event_id if event_id else MessageTemplate.event_id.is_(None),
        )
    )).scalar_one_or_none()

    if row:
        return _to_out(row)

    # Return a synthetic read-only default.
    from ..models import MessageTemplate as MT
    from datetime import datetime
    synthetic = MT(
        id=f"default-{template_key}",
        scope="platform",
        event_id=None,
        template_key=template_key,
        subject=defaults.get("subject"),
        email_body=defaults.get("email_body"),
        sms_body=defaults.get("sms_body"),
        whatsapp_body=defaults.get("whatsapp_body"),
        updated_at=datetime.utcnow(),
        updated_by=None,
    )
    return _to_out(synthetic, is_default=True)


# ── Upsert ────────────────────────────────────────────────────────────────────

@router.put("/templates/{template_key}", response_model=MessageTemplateOut)
async def upsert_template(
    template_key: str,
    data: MessageTemplateUpsert,
    event_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create or update a template override. Pass event_id to create an
    event-level override; omit for a platform-level template."""
    if event_id and not await db.get(Event, event_id):
        raise HTTPException(404, "Event not found")

    scope = "event" if event_id else "platform"

    row = (await db.execute(
        select(MessageTemplate).where(
            MessageTemplate.template_key == template_key,
            MessageTemplate.scope == scope,
            MessageTemplate.event_id == event_id if event_id else MessageTemplate.event_id.is_(None),
        )
    )).scalar_one_or_none()

    if row is None:
        row = MessageTemplate(
            scope=scope,
            event_id=event_id,
            template_key=template_key,
        )
        db.add(row)

    if data.subject is not None:
        row.subject = data.subject
    if data.email_body is not None:
        row.email_body = _sanitize_html(data.email_body)
    if data.sms_body is not None:
        row.sms_body = data.sms_body
    if data.mms_body is not None:
        row.mms_body = data.mms_body
    if data.whatsapp_body is not None:
        row.whatsapp_body = data.whatsapp_body

    row.updated_by = current_user.email
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


# ── Reset to default ──────────────────────────────────────────────────────────

@router.delete("/templates/{template_key}", status_code=204)
async def reset_template(
    template_key: str,
    event_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Delete the custom override so the default is used again."""
    scope = "event" if event_id else "platform"
    row = (await db.execute(
        select(MessageTemplate).where(
            MessageTemplate.template_key == template_key,
            MessageTemplate.scope == scope,
            MessageTemplate.event_id == event_id if event_id else MessageTemplate.event_id.is_(None),
        )
    )).scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()


# ── Preview ───────────────────────────────────────────────────────────────────

@router.post("/templates/preview", response_model=TemplatePreviewOut)
async def preview_template(
    data: TemplatePreviewRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Render a template with sample (or provided) data."""
    resolved = await template_service.resolve_template(data.template_key, data.event_id, db)

    # Allow caller to override individual fields (useful for live preview while editing).
    fields = {
        "subject":       data.subject       if data.subject       is not None else resolved.get("subject"),
        "email_body":    data.email_body    if data.email_body    is not None else resolved.get("email_body"),
        "sms_body":      data.sms_body      if data.sms_body      is not None else resolved.get("sms_body"),
        "mms_body":      data.mms_body      if data.mms_body      is not None else resolved.get("mms_body"),
        "whatsapp_body": data.whatsapp_body if data.whatsapp_body is not None else resolved.get("whatsapp_body"),
    }

    event_name = "Sample Event"
    if data.event_id:
        ev = await db.get(Event, data.event_id)
        if ev:
            event_name = ev.name

    ctx = template_service._sample_context(event_name)
    if data.sample_data:
        ctx.update({k: str(v) for k, v in data.sample_data.items()})

    rendered = template_service.render_template(fields, ctx)
    return TemplatePreviewOut(**rendered)


# ── Test send ─────────────────────────────────────────────────────────────────

@router.post("/templates/test-send", response_model=dict)
async def test_send_template(
    data: TemplateTestSendRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Resolve + render a template and dispatch a real test message."""
    from services import messaging

    resolved = await template_service.resolve_template(data.template_key, data.event_id, db)

    event_name = "Test Event"
    if data.event_id:
        ev = await db.get(Event, data.event_id)
        if ev:
            event_name = ev.name

    ctx = template_service._sample_context(event_name)
    rendered = template_service.render_template(resolved, ctx)

    if data.channel == "email":
        from services.email_service import send_template_email, send_plain_email
        from app.models import Guest as _Guest
        subject = rendered.get("subject") or f"Test: {data.template_key}"
        body = rendered.get("email_body") or "(no email body)"

        # Try to grab a real guest's QR token for the embedded QR image.
        qr_token = None
        checkin_base_url = None
        if data.event_id and ev:
            sample_guest = (await db.execute(
                select(_Guest).where(
                    _Guest.event_id == data.event_id,
                    _Guest.qr_generated_at.isnot(None),
                ).limit(1)
            )).scalar_one_or_none()
            if sample_guest:
                qr_token = sample_guest.qr_token
                checkin_base_url = ev.checkin_base_url

        if qr_token and checkin_base_url:
            await send_template_email(data.recipient, subject, body, qr_token, checkin_base_url)
        else:
            await send_plain_email(data.recipient, subject, body)
        return {"sent": True, "channel": "email", "recipient": data.recipient}

    elif data.channel == "sms":
        await messaging.send_invite_sms(
            phone=data.recipient,
            first_name=ctx["guest_first_name"],
            event_name=event_name,
            ticket_url=ctx["ticket_link"],
            event_date=None,
            body_override=rendered.get("sms_body"),
        )
        return {"sent": True, "channel": "sms", "recipient": data.recipient}

    elif data.channel == "mms":
        mms_body = rendered.get("mms_body") or rendered.get("sms_body") or f"Test MMS for {event_name}"
        qr_url = ctx["ticket_link"].replace("/scan/", "/api/scan/") + "/qr.png"
        mms_kwargs: dict = {}
        if data.event_id and ev:
            from app.models import Guest as _Guest
            sample_guest = (await db.execute(
                select(_Guest).where(
                    _Guest.event_id == data.event_id,
                    _Guest.qr_generated_at.isnot(None),
                ).limit(1)
            )).scalar_one_or_none()
            if sample_guest:
                qr_url = f"{ev.checkin_base_url.rstrip('/')}/api/scan/{sample_guest.qr_token}/qr.png"
                mms_kwargs = dict(
                    event_name=ev.name,
                    couples_name=ev.couples_name or "",
                    event_date=ev.event_date,
                    venue_name=ev.venue_name or "",
                    venue_address=ev.venue_address or "",
                    guest_first_name=sample_guest.first_name,
                    guest_last_name=sample_guest.last_name or "",
                )
        await messaging.send_invite_mms(
            phone=data.recipient,
            body=mms_body,
            media_url=qr_url,
            subject=event_name,
            **mms_kwargs,
        )
        return {"sent": True, "channel": "mms", "recipient": data.recipient}

    elif data.channel == "whatsapp":
        await messaging.send_invite_whatsapp(
            phone=data.recipient,
            first_name=ctx["guest_first_name"],
            event_name=event_name,
            ticket_url=ctx["ticket_link"],
            event_date=None,
            body_override=rendered.get("whatsapp_body"),
        )
        return {"sent": True, "channel": "whatsapp", "recipient": data.recipient}

    raise HTTPException(400, "Unknown channel")
