import base64
import html as _html
import logging
import re
from datetime import datetime, timedelta, timezone
from email.utils import getaddresses
from email.mime.application import MIMEApplication
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from urllib.parse import quote_plus, urlencode, urljoin

import aiosmtplib
import httpx

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import EmailDeliveryEvent
from app.timeutil import local_hhmm, to_event_local
from services.qr_service import generate_qr_bytes

logger = logging.getLogger(__name__)


def _tag_value(value: str | None) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "-", str(value or "").strip())
    return cleaned[:256]


def _set_delivery_context(
    msg: MIMEMultipart,
    *,
    event_id: str | None = None,
    guest_id: str | None = None,
    message_kind: str | None = None,
) -> None:
    if event_id:
        msg["X-Festio-Event-Id"] = event_id
    if guest_id:
        msg["X-Festio-Guest-Id"] = guest_id
    if message_kind:
        msg["X-Festio-Message-Kind"] = message_kind


async def _design_email_theme(event_id: str | None) -> dict | None:
    """Fetch the published Design Studio email theme. Failure must not block mail."""
    if not event_id:
        return None
    base = (settings.design_service_url or "").rstrip("/")
    if not base:
        return None
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            r = await c.get(
                f"{base}/api/v1/design/events/{event_id}/theme",
                headers={"X-Internal-Token": getattr(settings, "design_internal_token", "")},
            )
        if r.status_code != 200:
            return None
        data = r.json()
        return None if data.get("is_default") else data
    except Exception:
        logger.info("Design email theme unavailable for event %s", event_id, exc_info=True)
        return None


def _theme_colors(theme: dict | None) -> dict:
    return {
        "background": (theme or {}).get("background_color") or "#f4f7fb",
        "surface": "#ffffff",
        "header": (theme or {}).get("background_color") or "#0f172a",
        "primary": (theme or {}).get("primary_color") or "#ffffff",
        "accent": (theme or {}).get("accent_color") or "#2dd4bf",
        "button_text": "#05111f",
    }


def _theme_cover_url(theme: dict | None) -> str:
    return (theme or {}).get("flyer_image_url") or (theme or {}).get("cover_image_url") or ""


def _apply_design_theme_to_html(html_body: str, theme: dict | None) -> str:
    if not theme or not html_body:
        return html_body
    c = _theme_colors(theme)
    replacements = {
        "#f4f7fb": c["background"],
        "#081524": c["header"],
        "#0d1b2f": c["header"],
        "#2dd4bf": c["accent"],
        "#76fff0": c["accent"],
        "#0f766e": c["accent"],
        "#ecfeff": f'{c["accent"]}18',
        "#99f6e4": f'{c["accent"]}55',
        "#115e59": c["header"],
    }
    out = html_body
    for old, new in replacements.items():
        out = out.replace(old, new)
    return out


def _resend_payload(msg: MIMEMultipart) -> dict:
    """Convert a built MIME message into a Resend API payload, preserving the
    HTML body and any inline/attached images (incl. the cid:qrcode QR)."""
    payload = {
        "from": msg["From"],
        "to": [a.strip() for a in (msg["To"] or "").split(",") if a.strip()],
        "subject": msg["Subject"] or "",
    }
    headers = {
        key: value
        for key, value in {
            "X-Festio-Event-Id": msg["X-Festio-Event-Id"],
            "X-Festio-Guest-Id": msg["X-Festio-Guest-Id"],
            "X-Festio-Message-Kind": msg["X-Festio-Message-Kind"],
        }.items()
        if value
    }
    if headers:
        payload["headers"] = headers
        tag_names = {
            "X-Festio-Event-Id": "event_id",
            "X-Festio-Guest-Id": "guest_id",
            "X-Festio-Message-Kind": "message_kind",
        }
        payload["tags"] = [
            {"name": tag_names[key], "value": _tag_value(value)}
            for key, value in headers.items()
            if _tag_value(value)
        ]
    attachments = []
    for part in msg.walk():
        if part.get_content_type() == "text/html" and "html" not in payload:
            payload["html"] = part.get_payload(decode=True).decode("utf-8", "replace")
        elif part.get_content_maintype() == "image":
            raw = part.get_payload(decode=True)
            if not raw:
                continue
            att = {
                "filename": part.get_filename() or "image.png",
                "content": base64.b64encode(raw).decode(),
            }
            cid = part.get("Content-ID")
            if cid:
                att["content_id"] = cid.strip("<>")  # renders cid: refs inline
            attachments.append(att)
        elif part.get_content_disposition() == "attachment":
            raw = part.get_payload(decode=True)
            if not raw:
                continue
            attachments.append({
                "filename": part.get_filename() or "attachment",
                "content": base64.b64encode(raw).decode(),
            })
    if attachments:
        payload["attachments"] = attachments
    return payload


async def _send_via_resend(msg: MIMEMultipart):
    headers = {"Authorization": f"Bearer {settings.resend_api_key}"}
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post("https://api.resend.com/emails", json=_resend_payload(msg), headers=headers)
    r.raise_for_status()
    try:
        data = r.json()
    except Exception:
        data = {}
    logger.info(
        "Resend accepted email: id=%s to=%s subject=%s kind=%s",
        data.get("id"),
        msg["To"],
        msg["Subject"],
        msg["X-Festio-Message-Kind"],
    )
    return data


def _delivery_context(msg: MIMEMultipart) -> dict:
    return {
        "event_id": msg["X-Festio-Event-Id"] or None,
        "guest_id": msg["X-Festio-Guest-Id"] or None,
        "message_kind": msg["X-Festio-Message-Kind"] or None,
        "recipient": msg["To"] or None,
        "subject": msg["Subject"] or None,
    }


async def _record_email_delivery(
    msg: MIMEMultipart,
    *,
    provider: str,
    status: str,
    event_type: str,
    provider_email_id: str | None = None,
    error_message: str | None = None,
    payload: dict | None = None,
) -> None:
    try:
        ctx = _delivery_context(msg)
        async with AsyncSessionLocal() as db:
            db.add(EmailDeliveryEvent(
                provider=provider,
                provider_email_id=provider_email_id,
                event_id=ctx["event_id"],
                guest_id=ctx["guest_id"],
                recipient=ctx["recipient"],
                subject=ctx["subject"],
                message_kind=ctx["message_kind"],
                event_type=event_type,
                status=status,
                error_message=error_message[:2000] if error_message else None,
                payload=payload,
                occurred_at=datetime.utcnow(),
            ))
            await db.commit()
    except Exception:
        logger.exception("Failed to record email delivery status for %s", msg["To"])


def _first_html_text(msg: MIMEMultipart) -> tuple[str | None, str | None]:
    html = text = None
    for part in msg.walk():
        ctype = part.get_content_type()
        if part.is_multipart():
            continue
        raw = part.get_payload(decode=True)
        if not raw:
            continue
        decoded = raw.decode(part.get_content_charset() or "utf-8", "replace")
        if ctype == "text/html" and html is None:
            html = decoded
        elif ctype == "text/plain" and text is None:
            text = decoded
    return html, text


def _parse_email_header(value: str) -> tuple[str, str]:
    parsed = getaddresses([value or ""])
    if not parsed:
        return "", ""
    name, email = parsed[0]
    return name or "", email or ""


def _bird_payload(msg: MIMEMultipart) -> dict:
    """Convert MIME to Bird's Email API transmission payload.

    Festio renders templates before delivery, so substitutions stay disabled.
    Inline images use the Content-ID as their Bird name so cid:qrcode continues
    to work for QR-ticket emails.
    """
    from_name, from_email = _parse_email_header(msg["From"])
    recipients = []
    for name, email in getaddresses([msg["To"] or ""]):
        if email:
            recipients.append({"address": {"email": email, "name": name or email}})

    html, text = _first_html_text(msg)
    content = {
        "from": {"email": from_email, "name": from_name or from_email},
        "subject": msg["Subject"] or "",
    }
    if html:
        content["html"] = html
    if text:
        content["text"] = text

    attachments = []
    inline_images = []
    for part in msg.walk():
        if part.is_multipart() or part.get_content_maintype() == "text":
            continue
        raw = part.get_payload(decode=True)
        if not raw:
            continue
        encoded = base64.b64encode(raw).decode()
        filename = part.get_filename() or "attachment"
        if part.get_content_maintype() == "image":
            cid = (part.get("Content-ID") or "").strip("<>")
            inline_images.append({
                "name": cid or filename,
                "type": part.get_content_type(),
                "data": encoded,
            })
        elif part.get_content_disposition() == "attachment":
            attachments.append({
                "name": filename,
                "type": part.get_content_type(),
                "data": encoded,
            })
    if attachments:
        content["attachments"] = attachments
    if inline_images:
        content["inline_images"] = inline_images

    return {
        "options": {
            "transactional": True,
            "open_tracking": False,
            "click_tracking": False,
            "perform_substitutions": False,
        },
        "recipients": recipients,
        "content": content,
    }


async def _send_via_bird(msg: MIMEMultipart):
    base = settings.bird_email_api_base.rstrip("/")
    url = f"{base}/workspaces/{settings.bird_workspace_id}/reach/transmissions"
    headers = {
        "Authorization": f"AccessKey {settings.bird_access_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(url, json=_bird_payload(msg), headers=headers)
    r.raise_for_status()
    try:
        return r.json()
    except Exception:
        return {}


async def _send(msg: MIMEMultipart):
    if not (msg["To"] or "").strip():
        logger.info("Skipping email — recipient has no email address (likely a VVIP walk-in)")
        return
    # Prefer the Resend HTTP API when configured; otherwise fall back to SMTP.
    if settings.resend_api_key:
        try:
            data = await _send_via_resend(msg)
            await _record_email_delivery(
                msg,
                provider="resend",
                provider_email_id=(data or {}).get("id"),
                event_type="email.accepted",
                status="sent",
                payload={"source": "send_attempt"},
            )
        except Exception as exc:
            logger.exception("Resend send failed for %s", msg["To"])
            await _record_email_delivery(
                msg,
                provider="resend",
                event_type="email.failed",
                status="failed",
                error_message=str(exc),
                payload={"source": "send_attempt"},
            )
        return
    if settings.bird_email_api_base and settings.bird_workspace_id and settings.bird_access_key:
        try:
            data = await _send_via_bird(msg)
            provider_email_id = (data or {}).get("id") or (data or {}).get("messageId") or None
            await _record_email_delivery(
                msg,
                provider="bird",
                provider_email_id=str(provider_email_id) if provider_email_id else None,
                event_type="email.accepted",
                status="sent",
                payload={"source": "send_attempt"},
            )
        except Exception as exc:
            logger.exception("Bird email send failed for %s", msg["To"])
            await _record_email_delivery(
                msg,
                provider="bird",
                event_type="email.failed",
                status="failed",
                error_message=str(exc),
                payload={"source": "send_attempt"},
            )
        return
    if not settings.smtp_host:
        logger.warning("Email not configured — skipping email to %s", msg["To"])
        await _record_email_delivery(
            msg,
            provider="none",
            event_type="email.skipped",
            status="failed",
            error_message="Email provider is not configured",
            payload={"source": "send_attempt"},
        )
        return
    try:
        async with aiosmtplib.SMTP(
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            use_tls=False,
            start_tls=settings.smtp_tls,
        ) as smtp:
            if settings.smtp_user:
                await smtp.login(settings.smtp_user, settings.smtp_password)
            await smtp.send_message(msg)
        await _record_email_delivery(
            msg,
            provider="smtp",
            event_type="email.accepted",
            status="sent",
            payload={"source": "send_attempt"},
        )
    except Exception as exc:
        logger.exception("Failed to send email to %s", msg["To"])
        await _record_email_delivery(
            msg,
            provider="smtp",
            event_type="email.failed",
            status="failed",
            error_message=str(exc),
            payload={"source": "send_attempt"},
        )


def _plain_text_from_html(html_body: str) -> str:
    text = re.sub(r"(?i)<br\s*/?>", "\n", html_body or "")
    text = re.sub(r"(?i)</p\s*>", "\n\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return _html.unescape(text).strip()


def _festio_email_shell(inner: str, *, title: str | None = None,
                        preheader: str | None = None,
                        footer_reason: str | None = None,
                        theme: dict | None = None) -> str:
    """Shared email-client-safe shell for transactional non-ticket emails."""
    safe_title = _html.escape(title or "Festio")
    safe_preheader = _html.escape(preheader or safe_title)
    footer = _html.escape(footer_reason or "You are receiving this email because you are connected to this event.")
    c = _theme_colors(theme)
    cover = _theme_cover_url(theme)
    cover_block = (
        '<tr><td>'
        f'<img src="{_html.escape(cover, quote=True)}" alt="" width="600" '
        'style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;" />'
        '</td></tr>'
        if cover else ""
    )
    return (
        '<!doctype html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        '<style>@media only screen and (max-width: 620px) {'
        'table[width="600"]{width:100% !important;}'
        'h1{font-size:24px !important;line-height:30px !important;}'
        '}</style></head>'
        f'<body style="margin:0;padding:0;background:{c["background"]};font-family:Arial,Helvetica,sans-serif;">'
        f'<div style="display:none;font-size:1px;color:{c["background"]};line-height:1px;max-height:0;'
        f'max-width:0;opacity:0;overflow:hidden;">{safe_preheader}</div>'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        f'style="width:100%;background:{c["background"]};margin:0;padding:0;">'
        '<tr><td align="center" style="padding:28px 12px;">'
        '<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" '
        f'style="width:100%;max-width:600px;border-collapse:separate;background:{c["surface"]};'
        'border-radius:16px;border:1px solid #dbe7ef;overflow:hidden;">'
        f'<tr><td style="background:{c["header"]};padding:22px 28px;">'
        f'<div style="font-family:Arial,Helvetica,sans-serif;color:{c["accent"]};font-size:13px;'
        'line-height:18px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;">Festio</div>'
        f'<h1 style="font-family:Arial,Helvetica,sans-serif;color:{c["primary"]};font-size:28px;'
        f'line-height:34px;margin:8px 0 0 0;font-weight:800;">{safe_title}</h1>'
        '</td></tr>'
        f'{cover_block}'
        '<tr><td style="font-family:Arial,Helvetica,sans-serif;color:#172033;'
        'font-size:15px;line-height:24px;padding:28px;">'
        f'{inner}'
        '</td></tr>'
        '<tr><td align="center" style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 24px;">'
        '<p style="font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:12px;line-height:18px;margin:0 0 6px 0;">'
        'Powered by <strong style="color:#0f172a;">Festio</strong> · '
        '<a href="https://festio.events" style="color:#0f766e;text-decoration:underline;">festio.events</a> · '
        '<a href="mailto:events@festio.events" style="color:#0f766e;text-decoration:underline;">events@festio.events</a></p>'
        '<p style="font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:11px;line-height:17px;margin:0 0 5px 0;">'
        'Invites, RSVP, QR check-in, seating, guest messaging, Experience workflows and event insights.</p>'
        f'<p style="font-family:Arial,Helvetica,sans-serif;color:#94a3b8;font-size:11px;line-height:17px;margin:0;">{footer}</p>'
        '</td></tr>'
        '</table></td></tr></table></body></html>'
    )


async def send_simple_email(
    to_email: str,
    subject: str,
    html_body: str,
    event_id: str | None = None,
    attachments: list[tuple[str, bytes, str]] | None = None,
    guest_id: str | None = None,
    message_kind: str | None = "simple",
):
    """Shared Festio-branded HTML email for simple transactional templates."""
    if not to_email:
        return
    msg = MIMEMultipart("mixed" if attachments else "alternative")
    msg["Subject"] = subject
    msg["From"] = settings.email_from
    msg["To"] = to_email
    _set_delivery_context(msg, event_id=event_id, guest_id=guest_id, message_kind=message_kind)
    theme = await _design_email_theme(event_id)
    wrapped = _festio_email_shell(
        html_body,
        title=subject,
        preheader=_plain_text_from_html(html_body)[:140],
        theme=theme,
    )
    body_part = MIMEMultipart("alternative") if attachments else msg
    body_part.attach(MIMEText(_plain_text_from_html(html_body), "plain", "utf-8"))
    body_part.attach(MIMEText(wrapped, "html", "utf-8"))
    if attachments:
        msg.attach(body_part)
    for filename, content, content_type in attachments or []:
        maintype, _, subtype = (content_type or "application/octet-stream").partition("/")
        if maintype == "text":
            part = MIMEText(content.decode("utf-8", "replace"), subtype or "plain", "utf-8")
        elif maintype == "application":
            part = MIMEApplication(content, _subtype=subtype or "octet-stream")
        else:
            part = MIMEBase(maintype or "application", subtype or "octet-stream")
            part.set_payload(content)
            encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(part)
    await _send(msg)


def render_simple_email_preview(subject: str, html_body: str) -> str:
    return _festio_email_shell(
        html_body,
        title=subject,
        preheader=_plain_text_from_html(html_body)[:140],
    )


def _invite_pairing_cta(ticket_url: str) -> str:
    return (
        '<table style="width:100%;margin:24px 0;border:1px solid #fce7f3;'
        'border-radius:12px;border-collapse:separate;overflow:hidden;">'
        '<tr><td style="padding:14px 16px;">'
        '<div style="font-weight:700;color:#9d174d;font-size:14px;">'
        'Coming with your spouse or partner?</div>'
        '<div style="color:#6b7280;font-size:13px;margin-top:2px;">'
        'Pair up so we seat you together at check-in.</div>'
        f'<a href="{ticket_url}" style="display:inline-block;margin-top:10px;'
        'background:#ec4899;color:white;text-decoration:none;padding:8px 16px;'
        'border-radius:8px;font-size:13px;font-weight:700;">Pair with my partner →</a>'
        '</td></tr></table>'
    )


def _invite_hub_cta(hub_url: str) -> str:
    return (
        '<table style="width:100%;margin:24px 0;border:1px solid #cffafe;'
        'border-radius:12px;border-collapse:separate;overflow:hidden;">'
        '<tr><td style="padding:14px 16px;">'
        '<div style="font-weight:700;color:#155e75;font-size:14px;">'
        '💬 Your Guest Hub</div>'
        '<div style="color:#6b7280;font-size:13px;margin-top:2px;">'
        'Message the host, read announcements, and see your table — from any '
        'device. Bookmark this link to come back anytime.</div>'
        f'<a href="{hub_url}" style="display:inline-block;margin-top:10px;'
        'background:#0891b2;color:white;text-decoration:none;padding:8px 16px;'
        'border-radius:8px;font-size:13px;font-weight:700;">Open my Guest Hub →</a>'
        '</td></tr></table>'
    )


def _invite_menu_cta(ticket_url: str) -> str:
    return (
        '<table style="width:100%;margin:24px 0;border:1px solid #fde68a;'
        'border-radius:12px;border-collapse:separate;overflow:hidden;">'
        '<tr><td style="padding:14px 16px;">'
        '<div style="font-weight:700;color:#92400e;font-size:14px;">'
        '🍽️ Pick your meal in advance</div>'
        '<div style="color:#6b7280;font-size:13px;margin-top:2px;">'
        'Choose what you want to eat. You can change it any time before the event.</div>'
        f'<a href="{ticket_url}" style="display:inline-block;margin-top:10px;'
        'background:#f59e0b;color:white;text-decoration:none;padding:8px 16px;'
        'border-radius:8px;font-size:13px;font-weight:700;">Choose menu →</a>'
        '</td></tr></table>'
    )


def _fmt_event_date(dt: datetime | None) -> str:
    dt = to_event_local(dt)
    if not dt:
        return ""
    try:
        return dt.strftime("%A, %B %-d, %Y")
    except ValueError:
        return dt.strftime("%A, %B %d, %Y").replace(" 0", " ")


def _fmt_event_time(dt: datetime | None) -> str:
    dt = to_event_local(dt)
    if not dt:
        return ""
    try:
        return dt.strftime("%-I:%M %p")
    except ValueError:
        return dt.strftime("%I:%M %p").lstrip("0")


def _abs_url(base_url: str, value: str | None) -> str:
    if not value:
        return ""
    value = str(value).strip()
    if value.startswith(("http://", "https://", "cid:")):
        return value
    return urljoin(base_url.rstrip("/") + "/", value.lstrip("/"))


def _detail_row(label: str, value_html: str) -> str:
    return (
        '<tr>'
        '<td valign="top" width="110" style="font-family:Arial,Helvetica,sans-serif;'
        'color:#64748b;font-size:12px;line-height:18px;font-weight:800;'
        'text-transform:uppercase;letter-spacing:.8px;padding:10px 18px;'
        'border-top:1px solid #e2e8f0;">'
        f'{_html.escape(label)}</td>'
        '<td valign="top" style="font-family:Arial,Helvetica,sans-serif;color:#172033;'
        'font-size:15px;line-height:22px;font-weight:700;padding:10px 18px;'
        'border-top:1px solid #e2e8f0;">'
        f'{value_html}</td>'
        '</tr>'
    )


def _secondary_link(label: str, href: str) -> str:
    if not href:
        return ""
    return (
        f'<a href="{_html.escape(href, quote=True)}" '
        'style="font-family:Arial,Helvetica,sans-serif;color:#0f766e;'
        'text-decoration:underline;font-size:14px;font-weight:700;margin:0 8px;">'
        f'{_html.escape(label)}</a>'
    )


def _calendar_link(event_name: str, event_date: datetime | None, venue: str) -> str:
    if not event_date:
        return ""
    start = event_date if event_date.tzinfo else event_date.replace(tzinfo=timezone.utc)
    end = start + timedelta(hours=3)
    params = {
        "action": "TEMPLATE",
        "text": event_name or "Event",
        "dates": f"{start.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}/"
                 f"{end.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
    }
    if venue:
        params["location"] = venue
    return "https://calendar.google.com/calendar/render?" + urlencode(params)


def _ticket_plain_text(ctx: dict) -> str:
    parts = [
        f"You're invited to {ctx['event_name']}",
        "",
        f"Hi {ctx['guest_first_name'] or 'there'},",
        "",
        f"You are invited to {ctx['event_name']} on {ctx['event_date']}"
        + (f" at {ctx['event_time']}." if ctx["event_time"] else "."),
        "",
        "Please show your personal Festio Pass at the entrance for admission.",
        "",
        "Event details:",
        f"Date: {ctx['event_date']}",
    ]
    if ctx["event_time"]:
        parts.append(f"Time: {ctx['event_time']}")
    parts.append(f"Venue: {ctx['venue_text']}")
    if ctx["organizer_name"]:
        parts.append(f"Host: {ctx['organizer_name']}")
    parts.extend([
        "",
        "View your ticket:",
        ctx["ticket_link"],
    ])
    if ctx.get("calendar_link"):
        parts.extend(["", "Add to Calendar:", ctx["calendar_link"]])
    if ctx.get("directions_link"):
        parts.extend(["", "Get Directions:", ctx["directions_link"]])
    parts.extend([
        "",
        "This QR code is unique to you. Please do not share it.",
        "",
        "With love,",
        ctx["organizer_name"] or "Festio",
    ])
    return "\n".join(parts)


def _custom_email_shell(inner: str, title: str | None = None) -> str:
    """Keep older organizer-customized full-body templates readable."""
    return _festio_email_shell(inner, title=title or "Event update")


async def send_invite_email(
    guest_data: dict,
    event_name: str,
    couples_name: str,
    checkin_base_url: str,
    event_date: datetime,
    seating_enabled: bool = False,
    menu_enabled: bool = False,
    partner_pairing_enabled: bool = False,
    override_subject: str | None = None,
    override_body: str | None = None,
    venue_name: str | None = None,
    venue_address: str | None = None,
    admission_note: str | None = None,
    event_image: str | None = None,
    rsvp_link: str | None = None,
    support_email: str | None = None,
    hub_url: str | None = None,
):
    """Render the ticket-QR invite from the message template (event override or
    the code default in TEMPLATE_DEFS) — all wording lives in the template. The
    QR image, pairing and menu buttons are injected via the {{qr_code}},
    {{pairing_cta}} and {{menu_cta}} placeholders."""
    from services import templates as tpl

    msg = MIMEMultipart("related")
    qr_bytes = generate_qr_bytes(guest_data["qr_token"], checkin_base_url)
    theme = await _design_email_theme(guest_data.get("event_id"))
    ticket_url = f"{checkin_base_url.rstrip('/')}/scan/{guest_data['qr_token']}"
    date_str = _fmt_event_date(event_date)
    time_str = _fmt_event_time(event_date)
    venue_name = (venue_name or "").strip()
    venue_address = (venue_address or "").strip()
    venue_text = " - ".join([p for p in [venue_name, venue_address] if p]) or "Venue details coming soon."
    venue_html = _html.escape(venue_name or "Venue details coming soon.")
    if venue_address:
        venue_html += f'<br><span style="font-weight:400;color:#64748b;">{_html.escape(venue_address)}</span>'
    event_image_url = _abs_url(checkin_base_url, _theme_cover_url(theme) or event_image)
    calendar_url = _calendar_link(event_name, event_date, venue_text if venue_name or venue_address else "")
    directions_url = (
        "https://www.google.com/maps/search/?api=1&query=" + quote_plus(venue_text)
        if venue_name or venue_address else ""
    )

    spec = tpl.TEMPLATE_DEFS["ticket_qr"]
    subject_tmpl = override_subject or spec["subject"]
    body_tmpl = override_body or spec["email_body"]

    first = _html.escape(guest_data.get("first_name", "") or "")
    last = _html.escape(guest_data.get("last_name", "") or "")
    ctx = {
        # Text fields are HTML-escaped; the *_cta / qr_code fields are trusted HTML.
        "guest_first_name": first,
        "guest_last_name": last,
        "guest_full_name": f"{first} {last}".strip(),
        "event_name": _html.escape(event_name or ""),
        "event_date": _html.escape(date_str),
        "event_time": _html.escape(time_str),
        "organizer_name": _html.escape(couples_name or ""),
        "venue_name": _html.escape(venue_name),
        "venue_address": _html.escape(venue_address),
        "event_location": _html.escape(venue_address),
        "venue_text": _html.escape(venue_text),
        "ticket_link": ticket_url,
        "rsvp_link": rsvp_link or "",
        "event_image": event_image_url,
        "preview_text": "Your personal Festio Pass is ready. Show it at the entrance for admission.",
        "qr_code": (
            '<img src="cid:qrcode" alt="Your admission QR code" width="240" height="240" '
            'style="display:block;width:240px;height:240px;border:0;outline:none;text-decoration:none;" />'
        ),
        "event_image_block": (
            '<tr><td>'
            f'<img src="{_html.escape(event_image_url, quote=True)}" alt="{_html.escape(event_name or "Event")} image" '
            'width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;" />'
            '</td></tr>'
            if event_image_url else ""
        ),
        "event_time_row": _detail_row("Time", _html.escape(time_str)) if time_str else "",
        "venue_row": _detail_row("Venue", venue_html),
        "host_row": _detail_row("Host", _html.escape(couples_name)) if couples_name else "",
        "admission_instruction": _html.escape(
            (admission_note or "").strip() or "Please bring this email with you for admission."
        ),
        "calendar_link": calendar_url,
        "calendar_link_block": _secondary_link("Add to Calendar", calendar_url),
        "directions_link": directions_url,
        "directions_link_block": _secondary_link("Get Directions", directions_url),
        "pairing_cta": _invite_pairing_cta(ticket_url) if seating_enabled and partner_pairing_enabled else "",
        "menu_cta": _invite_menu_cta(ticket_url) if menu_enabled else "",
        "hub_cta": _invite_hub_cta(hub_url) if hub_url else "",
        "support_email": _html.escape(support_email or settings.email_from or ""),
    }

    subject = tpl.render(subject_tmpl, ctx) or f"You're invited to {event_name}"
    inner = tpl.render(body_tmpl, ctx)
    if override_body:
        inner = _custom_email_shell(inner, title=subject)
    text_body = _ticket_plain_text(ctx)
    body = (
        '<!doctype html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        '<style>@media only screen and (max-width: 620px) {'
        'table[width="600"]{width:100% !important;}'
        'h1{font-size:28px !important;line-height:34px !important;}'
        '}</style></head>'
        '<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;">'
        '<div style="display:none;font-size:1px;color:#f4f7fb;line-height:1px;max-height:0;'
        'max-width:0;opacity:0;overflow:hidden;">'
        f'{_html.escape(ctx["preview_text"])}'
        '</div>'
        f'{inner}'
        '</body></html>'
    )
    body = _apply_design_theme_to_html(body, theme)

    msg["Subject"] = subject
    msg["From"] = settings.email_from
    msg["To"] = guest_data["email"]
    _set_delivery_context(
        msg,
        event_id=guest_data.get("event_id"),
        guest_id=guest_data.get("guest_id"),
        message_kind=guest_data.get("message_kind") or "invitation",
    )
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(text_body, "plain", "utf-8"))
    alt.attach(MIMEText(body, "html", "utf-8"))
    msg.attach(alt)
    img_part = MIMEImage(qr_bytes)
    img_part.add_header("Content-ID", "<qrcode>")
    img_part.add_header("Content-Disposition", "inline", filename="invite-qr.png")
    msg.attach(img_part)

    await _send(msg)


async def send_admission_email(guest_data: dict):
    theme = await _design_email_theme(guest_data.get("event_id"))
    msg = MIMEMultipart()
    msg["Subject"] = guest_data.get("subject_override") or "You're Admitted!"
    msg["From"] = settings.email_from
    msg["To"] = guest_data["email"]
    _set_delivery_context(
        msg,
        event_id=guest_data.get("event_id"),
        guest_id=guest_data.get("guest_id"),
        message_kind=guest_data.get("message_kind") or "admission",
    )

    admitted_time = local_hhmm(guest_data.get("admitted_at"))
    first = _html.escape(guest_data["first_name"])
    table_name = guest_data.get("table_name")
    seat_number = guest_data.get("seat_number")
    menu_choices = guest_data.get("menu_choices") or []  # list[(category, item)]
    experience_steps = guest_data.get("experience_next_steps") or []
    hub_url = guest_data.get("hub_url")

    # ── Seating block ────────────────────────────────────────────────────────
    seating_html = ""
    if table_name or seat_number:
        chips = []
        if table_name:
            chips.append(
                f'<span style="display:inline-block;background:rgba(255,255,255,0.18);'
                f'padding:6px 14px;border-radius:999px;margin:4px 4px 0 0;font-size:14px;">'
                f'Table: <strong>{_html.escape(str(table_name))}</strong></span>'
            )
        if seat_number:
            chips.append(
                f'<span style="display:inline-block;background:rgba(255,255,255,0.18);'
                f'padding:6px 14px;border-radius:999px;margin:4px 4px 0 0;font-size:14px;">'
                f'Seat: <strong>{_html.escape(str(seat_number))}</strong></span>'
            )
        seating_html = (
            '<div style="margin-top:16px;text-align:center;">'
            + "".join(chips)
            + "</div>"
        )

    # ── Menu block — show current choices if any, plus CTA when menu enabled ─
    menu_html = ""
    if menu_choices:
        rows = "".join(
            f'<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;'
            f'font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">'
            f'{_html.escape(cat)}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;'
            f'color:#111;">{_html.escape(item)}</td></tr>'
            for cat, item in menu_choices
        )
        menu_html = (
            '<div style="margin-top:24px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">'
            '<div style="background:#f8fafc;padding:10px 16px;font-weight:700;color:#111;font-size:14px;">'
            'Your menu selection</div>'
            f'<table style="width:100%;border-collapse:collapse;">{rows}</table>'
            "</div>"
        )

    ticket_url = guest_data.get("ticket_url")
    menu_enabled = guest_data.get("menu_enabled", False)
    menu_cta_html = ""
    if ticket_url and menu_enabled:
        if menu_choices:
            cta_text = "Change my meal choice"
            cta_intro = "Want to swap your meal? Tap below."
        else:
            cta_text = "Pick my meal now"
            cta_intro = "You haven't picked your meal yet — tap below to choose."
        menu_cta_html = (
            '<div style="margin-top:24px;background:#fef3c7;border:1px solid #fcd34d;'
            'border-radius:12px;padding:16px;text-align:center;">'
            f'<div style="font-weight:700;color:#92400e;font-size:15px;">🍽️ {cta_intro}</div>'
            f'<a href="{ticket_url}" style="display:inline-block;margin-top:10px;'
            'background:#f59e0b;color:white;text-decoration:none;padding:10px 20px;'
            f'border-radius:8px;font-size:14px;font-weight:700;">{cta_text} →</a>'
            "</div>"
        )

    experience_html = ""
    if experience_steps:
        def session_line(session: dict | None) -> str:
            if not isinstance(session, dict):
                return ""
            parts = []
            for key in ("topic", "date"):
                if session.get(key):
                    parts.append(str(session[key]))
            times = " - ".join(str(session.get(k)) for k in ("start_time", "end_time") if session.get(k))
            if times:
                parts.append(times)
            if session.get("room"):
                parts.append(str(session["room"]))
            if session.get("speaker"):
                parts.append(f"Speaker: {session['speaker']}")
            return " · ".join(parts)

        def step_row(step: dict) -> str:
            step_type = str(step.get("type") or "")
            action_url = step.get("action_url")
            session = session_line(step.get("session"))
            helper = (
                "Guest action: sign from your Festio Pass."
                if step_type == "consent"
                else "Staff action: an official will scan and mark this complete."
                if step_type == "souvenir"
                else ""
            )
            description = str(step.get("guest_message") or step.get("description") or helper)
            action = (
                f'<br><a href="{_html.escape(str(action_url))}" style="display:inline-block;margin-top:8px;'
                'background:#0f766e;color:white;text-decoration:none;padding:8px 12px;'
                'border-radius:8px;font-size:12px;font-weight:800;">Open consent form</a>'
                if step_type == "consent" and action_url else ""
            )
            return (
                '<li style="margin:8px 0;color:#334155;font-size:14px;line-height:20px;">'
                f'<strong>{_html.escape(str(step.get("title") or "Next step"))}</strong>'
                + (
                    ' <span style="display:inline-block;background:#fef3c7;color:#92400e;'
                    'border-radius:999px;padding:2px 8px;font-size:11px;font-weight:800;'
                    'text-transform:uppercase;">Required</span>'
                    if step.get("required") else ""
                )
                + (
                    f'<br><span style="color:#64748b;font-size:13px;">{_html.escape(description)}</span>'
                    if description else ""
                )
                + (
                    f'<br><span style="display:inline-block;margin-top:4px;color:#0f766e;font-size:12px;font-weight:700;">{_html.escape(session)}</span>'
                    if session else ""
                )
                + action
                + '</li>'
            )

        rows = "".join(step_row(step) for step in experience_steps)
        hub_cta = (
            f'<p style="margin:14px 0 0 0;"><a href="{_html.escape(str(hub_url))}" '
            'style="display:inline-block;background:#0f172a;color:white;text-decoration:none;'
            'padding:10px 14px;border-radius:9px;font-size:13px;font-weight:800;">'
            'Open Guest Hub to track my activity</a></p>'
            if hub_url else ""
        )
        experience_html = (
            '<div style="margin-top:24px;border:1px solid #ccfbf1;background:#f0fdfa;'
            'border-radius:12px;padding:16px;">'
            '<div style="font-weight:800;color:#115e59;font-size:15px;">Next steps at the event</div>'
            '<p style="margin:4px 0 10px 0;color:#475569;font-size:13px;line-height:19px;">'
            'Complete guest actions from your Festio Pass. Staff will scan and complete station actions as you move through the event.</p>'
            f'<ol style="margin:0;padding-left:20px;">{rows}</ol>'
            f'{hub_cta}'
            '</div>'
        )

    time_html = (
        f'<p style="margin-top:8px;font-size:14px;opacity:0.9;">'
        f'Check-in time: <strong>{admitted_time}</strong></p>'
        if admitted_time else ""
    )

    intro_override = guest_data.get("intro_block_override")
    intro_html = intro_override or (
        f'<h1 style="margin:0 0 8px 0;">Welcome, {first}!</h1>'
        '<p style="font-size: 18px; margin:0;">You have been successfully admitted.</p>'
    )

    inner = f"""
      <div style="background: #22c55e; color: white; padding: 30px; border-radius: 12px; text-align: center;">
        {intro_html}
        {time_html}
        {seating_html}
      </div>
      {menu_html}
      {menu_cta_html}
      {experience_html}
      <p style="margin-top: 24px; color: #666;">Enjoy the event!</p>
    """
    body = _festio_email_shell(
        inner,
        title=msg["Subject"],
        preheader=f"Welcome, {guest_data['first_name']}! You have been checked in.",
        footer_reason="You are receiving this email because you were checked in for this event.",
        theme=theme,
    )

    msg.attach(MIMEText(_plain_text_from_html(inner), "plain", "utf-8"))
    msg.attach(MIMEText(body, "html", "utf-8"))
    await _send(msg)


async def send_manual_invite_email(
    *,
    name: str,
    email: str,
    invite_url: str,
    event_name: str,
    event_date: datetime,
    invite_message: str | None = None,
    event_id: str | None = None,
    guest_id: str | None = None,
):
    """Send a personal invite link (no QR) to a recipient who hasn't RSVP'd yet."""
    msg = MIMEMultipart()
    msg["Subject"] = f"You're invited — {event_name}"
    msg["From"] = settings.email_from
    msg["To"] = email
    _set_delivery_context(msg, event_id=event_id, guest_id=guest_id, message_kind="rsvp_invitation")

    theme = await _design_email_theme(event_id)
    safe_name = _html.escape(name)
    safe_event = _html.escape(event_name)
    _local_date = to_event_local(event_date)
    date_str = _local_date.strftime("%A, %d %B %Y") if _local_date else ""
    safe_msg = f"<p>{_html.escape(invite_message)}</p>" if invite_message else ""

    inner = f"""
      <p>Hi <strong>{safe_name}</strong>,</p>
      <p>You have been personally invited to <strong>{safe_event}</strong>{(' on <strong>' + date_str + '</strong>') if date_str else ''}.</p>
      {safe_msg}
      <div style="text-align:center;margin:32px 0;">
        <a href="{invite_url}" style="background:#0f766e;color:white;text-decoration:none;
           padding:14px 28px;border-radius:10px;font-size:16px;font-weight:700;display:inline-block;">
          RSVP Now →
        </a>
      </div>
      <p style="color:#666;font-size:13px;">Or copy this link: {invite_url}</p>
    """
    body = _festio_email_shell(
        inner,
        title="You're invited",
        preheader=f"RSVP for {event_name}",
        footer_reason=f"You are receiving this email because you were invited to {event_name}.",
        theme=theme,
    )

    msg.attach(MIMEText(_plain_text_from_html(inner), "plain", "utf-8"))
    msg.attach(MIMEText(body, "html", "utf-8"))
    await _send(msg)


async def send_vendor_shipping_email(
    *,
    vendor_email: str,
    vendor_name: str | None,
    event_name: str,
    shipment_name: str,
    vendor_url: str,
    item_count: int,
    notes: str | None = None,
    attachment: bytes | None = None,
    attachment_name: str = "shipping-list.xlsx",
    event_id: str | None = None,
):
    """Send a vendor the shipping/packing list for a shipment — a link to the
    read-only vendor page, plus an optional spreadsheet attachment."""
    msg = MIMEMultipart()
    msg["Subject"] = f"Shipping list — {shipment_name} ({event_name})"
    msg["From"] = settings.email_from
    msg["To"] = vendor_email

    theme = await _design_email_theme(event_id)
    safe_vendor = _html.escape(vendor_name) if vendor_name else "there"
    safe_event = _html.escape(event_name)
    safe_shipment = _html.escape(shipment_name)
    safe_notes = f'<p style="background:#f8fafc;border-left:3px solid #0f766e;padding:10px 14px;color:#334155;">{_html.escape(notes)}</p>' if notes else ""

    inner = f"""
      <p>Hi <strong>{safe_vendor}</strong>,</p>
      <p>Here is the shipping list for <strong>{safe_shipment}</strong> ({safe_event}) —
         <strong>{item_count}</strong> recipient(s).</p>
      {safe_notes}
      <div style="text-align:center;margin:32px 0;">
        <a href="{vendor_url}" style="background:#0f766e;color:white;text-decoration:none;
           padding:14px 28px;border-radius:10px;font-size:16px;font-weight:700;display:inline-block;">
          View shipping list →
        </a>
      </div>
      <p style="color:#666;font-size:13px;">Or copy this link: {vendor_url}</p>
      <p style="color:#666;font-size:13px;">The full list (names, addresses, sizes) is on that page, and also attached as a spreadsheet.</p>
    """
    body = _festio_email_shell(
        inner,
        title="Shipping list ready",
        preheader=f"{shipment_name} shipping list for {event_name}",
        footer_reason=f"You are receiving this email because you are a vendor for {event_name}.",
        theme=theme,
    )

    msg.attach(MIMEText(_plain_text_from_html(inner), "plain", "utf-8"))
    msg.attach(MIMEText(body, "html", "utf-8"))
    if attachment:
        part = MIMEApplication(attachment, _subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        part.add_header("Content-Disposition", "attachment", filename=attachment_name)
        msg.attach(part)
    await _send(msg)


async def send_broadcast_email(*, email: str, first_name: str, message: str, event_name: str, event_id: str | None = None):
    """Send a free-text broadcast update (no QR/link) to a guest."""
    msg = MIMEMultipart()
    msg["Subject"] = f"Update — {event_name}"
    msg["From"] = settings.email_from
    msg["To"] = email

    theme = await _design_email_theme(event_id)
    safe_name = _html.escape(first_name or "there")
    safe_event = _html.escape(event_name)
    safe_msg = _html.escape(message).replace("\n", "<br>")

    inner = f"""
      <p>Hi <strong>{safe_name}</strong>,</p>
      <p style="font-size:15px;line-height:1.6;">{safe_msg}</p>
      <p style="color:#888;font-size:12px;margin-top:28px;">
        You're receiving this because you're on the guest list for {safe_event}.
      </p>
    """
    body = _festio_email_shell(
        inner,
        title=f"Update — {event_name}",
        preheader=message[:140],
        footer_reason=f"You are receiving this email because you are on the guest list for {event_name}.",
        theme=theme,
    )

    msg.attach(MIMEText(_plain_text_from_html(inner), "plain", "utf-8"))
    msg.attach(MIMEText(body, "html", "utf-8"))
    await _send(msg)
