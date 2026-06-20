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
    body = {"email": ov.email_body, "sms": ov.sms_body, "whatsapp": ov.whatsapp_body}.get(channel)
    return body or None


def channel_text(overrides: dict, key: str, channel: str, context: dict) -> str | None:
    """Rendered override body for a channel, or None to use the default sender."""
    body = _body(overrides.get(key), channel)
    if body is None:
        return None
    return tpl.render(body, context)


def email_override(overrides: dict, key: str, context: dict) -> tuple[str | None, str | None]:
    """(subject, body) rendered from an override, each None when not customized."""
    ov = overrides.get(key)
    if ov is None:
        return None, None
    subject = tpl.render(ov.subject, context) if ov.subject else None
    body = tpl.render(ov.email_body, context) if ov.email_body else None
    return subject, body
