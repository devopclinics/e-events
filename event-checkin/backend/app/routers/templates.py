"""Customizable message templates — view/edit per-event overrides of the
platform's outbound messages, with preview, test-send, reset and audit.

Resolution is event-override → code default (see services/templates.py). Editing
is restricted to event admins (require_event_admin), so staff can't change copy.
"""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, MessageTemplate, MessageTemplateAudit, User
from ..schemas import MessageTemplateSave, TemplatePreviewRequest, TemplateTestSendRequest
from ..auth import require_event_admin
from services import templates as tpl
from services.email_service import send_simple_email
from services import messaging

router = APIRouter()


async def _override(event_id: str, key: str, db: AsyncSession) -> MessageTemplate | None:
    return await db.scalar(
        select(MessageTemplate).where(
            MessageTemplate.event_id == event_id,
            MessageTemplate.template_key == key,
        )
    )


def _effective(spec: dict, ov: MessageTemplate | None) -> dict:
    """Merge an override over the code default, per field. Null override fields
    fall back to the default for that field."""
    def pick(field):
        if ov is not None:
            v = getattr(ov, field)
            if v is not None and v != "":
                return v
        return spec.get(field)
    return {
        "subject": pick("subject"),
        "email_body": pick("email_body"),
        "sms_body": pick("sms_body"),
        "whatsapp_body": pick("whatsapp_body"),
        "mms_body": pick("mms_body"),
    }


def _meta(key: str, spec: dict, ov: MessageTemplate | None) -> dict:
    eff = _effective(spec, ov)
    return {
        "key": key,
        "label": spec["label"],
        "group": spec["group"],
        "channels": spec["channels"],
        "placeholders": spec["placeholders"],
        "required": spec["required"],
        "email_kind": spec["email_kind"],
        "note": spec.get("note"),
        "source": "event-customized" if ov is not None else "default",
        "default": {
            "subject": spec.get("subject"),
            "email_body": spec.get("email_body"),
            "sms_body": spec.get("sms_body"),
            "whatsapp_body": spec.get("whatsapp_body"),
            "mms_body": spec.get("mms_body"),
        },
        "override": None if ov is None else {
            "subject": ov.subject, "email_body": ov.email_body,
            "sms_body": ov.sms_body, "whatsapp_body": ov.whatsapp_body,
            "mms_body": ov.mms_body,
            "updated_at": ov.updated_at.isoformat() if ov.updated_at else None,
        },
        "effective": eff,
    }


# ── List / get ──────────────────────────────────────────────────────────────────

@router.get("/{event_id}/templates")
async def list_templates(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    overrides = {
        o.template_key: o for o in (await db.execute(
            select(MessageTemplate).where(MessageTemplate.event_id == event_id)
        )).scalars().all()
    }
    return [_meta(k, spec, overrides.get(k)) for k, spec in tpl.TEMPLATE_DEFS.items()]


@router.get("/{event_id}/templates/audit")
async def template_audit(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    rows = (await db.execute(
        select(MessageTemplateAudit).where(MessageTemplateAudit.event_id == event_id)
        .order_by(MessageTemplateAudit.changed_at.desc()).limit(200)
    )).scalars().all()
    return [{
        "template_key": r.template_key, "action": r.action,
        "changed_by_email": r.changed_by_email,
        "changed_at": r.changed_at.isoformat() if r.changed_at else None,
    } for r in rows]


@router.get("/{event_id}/templates/{key}")
async def get_template(event_id: str, key: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    spec = tpl.TEMPLATE_DEFS.get(key)
    if not spec:
        raise HTTPException(404, "Unknown template")
    return _meta(key, spec, await _override(event_id, key, db))


# ── Save / reset ─────────────────────────────────────────────────────────────────

def _validate(key: str, spec: dict, data: MessageTemplateSave) -> None:
    """Reject saves that drop a required placeholder from a non-empty body, or
    that target a channel the template doesn't use."""
    by_channel = {"email": data.email_body, "sms": data.sms_body,
                  "whatsapp": data.whatsapp_body, "mms": data.mms_body}
    for channel, body in by_channel.items():
        if body and channel not in spec["channels"]:
            raise HTTPException(400, f"This template does not use the {channel} channel")
        missing = tpl.missing_required(key, body, channel=channel)
        if missing:
            raise HTTPException(
                400,
                f"{channel} body is missing required placeholder(s): "
                + ", ".join("{{" + m + "}}" for m in missing),
            )


@router.put("/{event_id}/templates/{key}")
async def save_template(event_id: str, key: str, data: MessageTemplateSave,
                        db: AsyncSession = Depends(get_db), user: User = Depends(require_event_admin)):
    spec = tpl.TEMPLATE_DEFS.get(key)
    if not spec:
        raise HTTPException(404, "Unknown template")
    _validate(key, spec, data)

    email_body = tpl.sanitize_html(data.email_body) if data.email_body else data.email_body
    ov = await _override(event_id, key, db)
    if ov is None:
        ov = MessageTemplate(event_id=event_id, template_key=key)
        db.add(ov)
    ov.subject = data.subject
    ov.email_body = email_body
    ov.sms_body = data.sms_body
    ov.whatsapp_body = data.whatsapp_body
    ov.mms_body = data.mms_body
    ov.updated_at = datetime.utcnow()
    ov.updated_by = user.id

    db.add(MessageTemplateAudit(
        event_id=event_id, template_key=key, action="save",
        snapshot=json.dumps({
            "subject": ov.subject, "email_body": ov.email_body,
            "sms_body": ov.sms_body, "whatsapp_body": ov.whatsapp_body,
            "mms_body": ov.mms_body,
        }),
        changed_by=user.id, changed_by_email=user.email,
    ))
    await db.commit()
    return _meta(key, spec, await _override(event_id, key, db))


@router.delete("/{event_id}/templates/{key}")
async def reset_template(event_id: str, key: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_event_admin)):
    spec = tpl.TEMPLATE_DEFS.get(key)
    if not spec:
        raise HTTPException(404, "Unknown template")
    ov = await _override(event_id, key, db)
    if ov is not None:
        await db.delete(ov)
        db.add(MessageTemplateAudit(
            event_id=event_id, template_key=key, action="reset",
            snapshot=None, changed_by=user.id, changed_by_email=user.email,
        ))
        await db.commit()
    return _meta(key, spec, None)


# ── Preview / test-send ──────────────────────────────────────────────────────────

def _render_draft(event, key: str, spec: dict, data: MessageTemplateSave, ov: MessageTemplate | None) -> dict:
    """Render the draft (falling back to override then default per field) with
    sample data. Returns rendered subject + per-channel bodies."""
    eff = _effective(spec, ov)
    ctx = tpl.sample_context(event)
    subject = data.subject if data.subject is not None else eff["subject"]
    email_body = data.email_body if data.email_body is not None else eff["email_body"]
    sms_body = data.sms_body if data.sms_body is not None else eff["sms_body"]
    wa_body = data.whatsapp_body if data.whatsapp_body is not None else eff["whatsapp_body"]
    mms_body = data.mms_body if data.mms_body is not None else eff["mms_body"]
    return {
        "subject": tpl.render(subject, ctx),
        "email_body": tpl.render(email_body, ctx),
        "sms_body": tpl.render(sms_body, ctx),
        "whatsapp_body": tpl.render(wa_body, ctx),
        "mms_body": tpl.render(mms_body, ctx),
    }


@router.post("/{event_id}/templates/{key}/preview")
async def preview_template(event_id: str, key: str, data: TemplatePreviewRequest,
                           db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    spec = tpl.TEMPLATE_DEFS.get(key)
    if not spec:
        raise HTTPException(404, "Unknown template")
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return _render_draft(event, key, spec, data, await _override(event_id, key, db))


@router.post("/{event_id}/templates/{key}/test-send")
async def test_send_template(event_id: str, key: str, data: TemplateTestSendRequest,
                             db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    spec = tpl.TEMPLATE_DEFS.get(key)
    if not spec:
        raise HTTPException(404, "Unknown template")
    if data.channel not in spec["channels"]:
        raise HTTPException(400, f"This template does not use the {data.channel} channel")
    if not (data.to or "").strip():
        raise HTTPException(400, "A destination address/number is required")
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    if data.channel == "mms":
        # The MMS card needs a specific guest's QR, so it can't be test-sent in
        # isolation. The body is verifiable via Preview; real MMS fires at check-in.
        raise HTTPException(400, "MMS can't be test-sent here — use Preview; it sends with the ticket card at check-in.")

    rendered = _render_draft(event, key, spec, data, await _override(event_id, key, db))
    if data.channel == "email":
        await send_simple_email(data.to, rendered["subject"] or f"Test — {spec['label']}", rendered["email_body"])
    elif data.channel == "sms":
        await messaging.send_custom_sms(phone=data.to, body=rendered["sms_body"])
    elif data.channel == "whatsapp":
        await messaging.send_custom_whatsapp(phone=data.to, body=rendered["whatsapp_body"])
    return {"ok": True, "channel": data.channel, "to": data.to}
