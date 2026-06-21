"""Helpers that wire the customizable-template overrides into the existing send
sites. Resolution is event-override → code default; when no override exists for a
channel these return None and the caller keeps its original (default) behavior, so
unedited templates send exactly as before.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import MessageTemplate
from services import templates as tpl


async def load_overrides(event_id: str, db: AsyncSession) -> dict[str, MessageTemplate]:
    rows = (await db.execute(
        select(MessageTemplate).where(MessageTemplate.event_id == event_id)
    )).scalars().all()
    return {r.template_key: r for r in rows}


def _body(ov: MessageTemplate | None, channel: str) -> str | None:
    if ov is None:
        return None
    body = {"email": ov.email_body, "sms": ov.sms_body,
            "whatsapp": ov.whatsapp_body, "mms": ov.mms_body}.get(channel)
    return body or None


def channel_text(overrides: dict, key: str, channel: str, context: dict) -> str | None:
    """Rendered override body for a channel, or None to use the default sender."""
    body = _body(overrides.get(key), channel)
    if body is None:
        return None
    return tpl.render(body, context)


def channel_text_or_default(overrides: dict, key: str, channel: str, context: dict) -> str | None:
    """Rendered override body, falling back to the registry default for that
    channel (used by channels like MMS that have no legacy hard-coded sender).
    Returns None only when neither an override nor a default body exists."""
    text = channel_text(overrides, key, channel, context)
    if text is not None:
        return text
    spec = tpl.TEMPLATE_DEFS.get(key) or {}
    body = spec.get(f"{channel}_body")
    return tpl.render(body, context) if body else None


def email_override(overrides: dict, key: str, context: dict) -> tuple[str | None, str | None]:
    """(subject, body) rendered from an override, each None when not customized."""
    ov = overrides.get(key)
    if ov is None:
        return None, None
    subject = tpl.render(ov.subject, context) if ov.subject else None
    body = tpl.render(ov.email_body, context) if ov.email_body else None
    return subject, body


def email_or_default(overrides: dict, key: str, context: dict) -> tuple[str | None, str | None]:
    """(subject, body) rendered from override → registry default. Used by simple
    notification templates that have no legacy hard-coded email builder."""
    spec = tpl.TEMPLATE_DEFS.get(key) or {}
    ov = overrides.get(key)
    subject_t = (ov.subject if ov and ov.subject else None) or spec.get("subject")
    body_t = (ov.email_body if ov and ov.email_body else None) or spec.get("email_body")
    subject = tpl.render(subject_t, context) if subject_t else None
    body = tpl.render(body_t, context) if body_t else None
    return subject, body
