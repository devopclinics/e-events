import base64
import html as _html
import logging
from datetime import datetime
from email.utils import getaddresses
from email.mime.application import MIMEApplication
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib
import httpx

from app.config import settings
from app.timeutil import local_hhmm
from services.qr_service import generate_qr_bytes

logger = logging.getLogger(__name__)


def _resend_payload(msg: MIMEMultipart) -> dict:
    """Convert a built MIME message into a Resend API payload, preserving the
    HTML body and any inline/attached images (incl. the cid:qrcode QR)."""
    payload = {
        "from": msg["From"],
        "to": [a.strip() for a in (msg["To"] or "").split(",") if a.strip()],
        "subject": msg["Subject"] or "",
    }
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

    EventQR renders templates before delivery, so substitutions stay disabled.
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


async def _send(msg: MIMEMultipart):
    if not (msg["To"] or "").strip():
        logger.info("Skipping email — recipient has no email address (likely a VVIP walk-in)")
        return
    # Prefer the Resend HTTP API when configured; otherwise fall back to SMTP.
    if settings.resend_api_key:
        try:
            await _send_via_resend(msg)
        except Exception:
            logger.exception("Resend send failed for %s", msg["To"])
        return
    if settings.bird_email_api_base and settings.bird_workspace_id and settings.bird_access_key:
        try:
            await _send_via_bird(msg)
        except Exception:
            logger.exception("Bird email send failed for %s", msg["To"])
        return
    if not settings.smtp_host:
        logger.warning("Email not configured — skipping email to %s", msg["To"])
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
    except Exception:
        logger.exception("Failed to send email to %s", msg["To"])


async def send_simple_email(to_email: str, subject: str, html_body: str):
    """Lightweight HTML email — used for trial-request notifications."""
    if not to_email:
        return
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.email_from
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))
    await _send(msg)


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


async def send_invite_email(
    guest_data: dict,
    event_name: str,
    couples_name: str,
    checkin_base_url: str,
    event_date: datetime,
    seating_enabled: bool = False,
    menu_enabled: bool = False,
    override_subject: str | None = None,
    override_body: str | None = None,
):
    """Render the ticket-QR invite from the message template (event override or
    the code default in TEMPLATE_DEFS) — all wording lives in the template. The
    QR image, pairing and menu buttons are injected via the {{qr_code}},
    {{pairing_cta}} and {{menu_cta}} placeholders."""
    from services import templates as tpl

    msg = MIMEMultipart("related")
    qr_bytes = generate_qr_bytes(guest_data["qr_token"], checkin_base_url)
    ticket_url = f"{checkin_base_url.rstrip('/')}/scan/{guest_data['qr_token']}"
    date_str = event_date.strftime("%A, %d %B %Y") if event_date else ""

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
        "organizer_name": _html.escape(couples_name or ""),
        "ticket_link": ticket_url,
        "qr_code": '<img src="cid:qrcode" alt="Your QR Code" style="width:220px;height:220px;" />',
        "pairing_cta": _invite_pairing_cta(ticket_url) if seating_enabled else "",
        "menu_cta": _invite_menu_cta(ticket_url) if menu_enabled else "",
    }

    subject = tpl.render(subject_tmpl, ctx) or f"Your Invitation — {event_name}"
    inner = tpl.render(body_tmpl, ctx)
    body = (
        '<html><body style="font-family: Arial, sans-serif; max-width: 600px; '
        f'margin: 0 auto; padding: 20px;">{inner}</body></html>'
    )

    msg["Subject"] = subject
    msg["From"] = settings.email_from
    msg["To"] = guest_data["email"]
    msg.attach(MIMEText(body, "html"))
    img_part = MIMEImage(qr_bytes)
    img_part.add_header("Content-ID", "<qrcode>")
    img_part.add_header("Content-Disposition", "inline", filename="invite-qr.png")
    msg.attach(img_part)

    await _send(msg)


async def send_admission_email(guest_data: dict):
    msg = MIMEMultipart()
    msg["Subject"] = guest_data.get("subject_override") or "You're Admitted!"
    msg["From"] = settings.email_from
    msg["To"] = guest_data["email"]

    admitted_time = local_hhmm(guest_data.get("admitted_at"))
    first = _html.escape(guest_data["first_name"])
    table_name = guest_data.get("table_name")
    seat_number = guest_data.get("seat_number")
    menu_choices = guest_data.get("menu_choices") or []  # list[(category, item)]

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

    body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #22c55e; color: white; padding: 30px; border-radius: 12px; text-align: center;">
        {intro_html}
        {time_html}
        {seating_html}
      </div>
      {menu_html}
      {menu_cta_html}
      <p style="margin-top: 24px; color: #666;">Enjoy the event!</p>
    </body>
    </html>
    """

    msg.attach(MIMEText(body, "html"))
    await _send(msg)


async def send_manual_invite_email(
    *,
    name: str,
    email: str,
    invite_url: str,
    event_name: str,
    event_date: datetime,
    invite_message: str | None = None,
):
    """Send a personal invite link (no QR) to a recipient who hasn't RSVP'd yet."""
    msg = MIMEMultipart()
    msg["Subject"] = f"You're invited — {event_name}"
    msg["From"] = settings.email_from
    msg["To"] = email

    safe_name = _html.escape(name)
    safe_event = _html.escape(event_name)
    date_str = event_date.strftime("%A, %d %B %Y") if event_date else ""
    safe_msg = f"<p>{_html.escape(invite_message)}</p>" if invite_message else ""

    body = f"""
    <html>
    <body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h1 style="color:#1a1a2e;">You're Invited!</h1>
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
    </body>
    </html>
    """

    msg.attach(MIMEText(body, "html"))
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
):
    """Send a vendor the shipping/packing list for a shipment — a link to the
    read-only vendor page, plus an optional spreadsheet attachment."""
    msg = MIMEMultipart()
    msg["Subject"] = f"Shipping list — {shipment_name} ({event_name})"
    msg["From"] = settings.email_from
    msg["To"] = vendor_email

    safe_vendor = _html.escape(vendor_name) if vendor_name else "there"
    safe_event = _html.escape(event_name)
    safe_shipment = _html.escape(shipment_name)
    safe_notes = f'<p style="background:#f8fafc;border-left:3px solid #0f766e;padding:10px 14px;color:#334155;">{_html.escape(notes)}</p>' if notes else ""

    body = f"""
    <html>
    <body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h1 style="color:#1a1a2e;">Shipping list ready</h1>
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
    </body>
    </html>
    """

    msg.attach(MIMEText(body, "html"))
    if attachment:
        part = MIMEApplication(attachment, _subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        part.add_header("Content-Disposition", "attachment", filename=attachment_name)
        msg.attach(part)
    await _send(msg)


async def send_broadcast_email(*, email: str, first_name: str, message: str, event_name: str):
    """Send a free-text broadcast update (no QR/link) to a guest."""
    msg = MIMEMultipart()
    msg["Subject"] = f"Update — {event_name}"
    msg["From"] = settings.email_from
    msg["To"] = email

    safe_name = _html.escape(first_name or "there")
    safe_event = _html.escape(event_name)
    safe_msg = _html.escape(message).replace("\n", "<br>")

    body = f"""
    <html>
    <body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#1a1a2e;">{safe_event}</h2>
      <p>Hi <strong>{safe_name}</strong>,</p>
      <p style="font-size:15px;line-height:1.6;">{safe_msg}</p>
      <p style="color:#888;font-size:12px;margin-top:28px;">
        You're receiving this because you're on the guest list for {safe_event}.
      </p>
    </body>
    </html>
    """

    msg.attach(MIMEText(body, "html"))
    await _send(msg)
