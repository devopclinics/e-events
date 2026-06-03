import html as _html
import logging
from datetime import datetime
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from app.config import settings
from app.timeutil import local_hhmm
from services.qr_service import generate_qr_bytes

logger = logging.getLogger(__name__)


async def _send(msg: MIMEMultipart):
    if not (msg["To"] or "").strip():
        logger.info("Skipping email — recipient has no email address (likely a VVIP walk-in)")
        return
    if not settings.smtp_host:
        logger.warning("SMTP not configured — skipping email to %s", msg["To"])
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


async def send_invite_email(
    guest_data: dict,
    event_name: str,
    couples_name: str,
    checkin_base_url: str,
    event_date: datetime,
    seating_enabled: bool = False,
    menu_enabled: bool = False,
):
    msg = MIMEMultipart("related")
    msg["Subject"] = f"Your Invitation — {event_name}"
    msg["From"] = settings.email_from
    msg["To"] = guest_data["email"]

    qr_bytes = generate_qr_bytes(guest_data["qr_token"], checkin_base_url)
    date_str = event_date.strftime("%A, %d %B %Y")
    ticket_url = f"{checkin_base_url.rstrip('/')}/scan/{guest_data['qr_token']}"

    first = _html.escape(guest_data["first_name"])
    last  = _html.escape(guest_data["last_name"])
    e_name    = _html.escape(event_name)
    e_couple  = _html.escape(couples_name)

    # ── Pre-event actions block (pairing + menu) ─────────────────────────────
    cta_rows: list[str] = []
    if seating_enabled:
        cta_rows.append(
            '<tr><td style="padding:14px 16px;border-bottom:1px solid #fce7f3;">'
            '<div style="font-weight:700;color:#9d174d;font-size:14px;">'
            'Coming with your spouse or partner?</div>'
            '<div style="color:#6b7280;font-size:13px;margin-top:2px;">'
            'Pair up so we seat you together at check-in.</div>'
            f'<a href="{ticket_url}" style="display:inline-block;margin-top:10px;'
            'background:#ec4899;color:white;text-decoration:none;padding:8px 16px;'
            'border-radius:8px;font-size:13px;font-weight:700;">Pair with my partner →</a>'
            '</td></tr>'
        )
    if menu_enabled:
        cta_rows.append(
            '<tr><td style="padding:14px 16px;">'
            '<div style="font-weight:700;color:#92400e;font-size:14px;">'
            '🍽️ Pick your meal in advance</div>'
            '<div style="color:#6b7280;font-size:13px;margin-top:2px;">'
            'Choose what you want to eat. You can change it any time before the event.</div>'
            f'<a href="{ticket_url}" style="display:inline-block;margin-top:10px;'
            'background:#f59e0b;color:white;text-decoration:none;padding:8px 16px;'
            'border-radius:8px;font-size:13px;font-weight:700;">Choose menu →</a>'
            '</td></tr>'
        )
    cta_html = (
        f'<table style="width:100%;margin:24px 0;border:1px solid #e5e7eb;'
        f'border-radius:12px;border-collapse:separate;overflow:hidden;">{"".join(cta_rows)}</table>'
        if cta_rows else ""
    )

    body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #1a1a2e;">You're Invited!</h1>
      <p>Dear <strong>{first} {last}</strong>,</p>
      <p>We are delighted to invite you to <strong>{e_name}</strong> on <strong>{date_str}</strong>.</p>
      <p>Please present the QR code below at the entrance on the day of the event:</p>
      <div style="text-align: center; margin: 30px 0;">
        <img src="cid:qrcode" alt="Your QR Code" style="width: 220px; height: 220px;" />
      </div>
      <p style="text-align:center;margin:0 0 24px 0;">
        <a href="{ticket_url}" style="color:#0f766e;font-size:14px;font-weight:600;text-decoration:none;">
          View your ticket online →
        </a>
      </p>
      {cta_html}
      <p style="color: #666; font-size: 14px;">This QR code is unique to you — please do not share it.</p>
      <p>With love,<br/><strong>{e_couple}</strong></p>
    </body>
    </html>
    """

    msg.attach(MIMEText(body, "html"))
    img_part = MIMEImage(qr_bytes)
    img_part.add_header("Content-ID", "<qrcode>")
    img_part.add_header("Content-Disposition", "inline", filename="invite-qr.png")
    msg.attach(img_part)

    await _send(msg)


async def send_admission_email(guest_data: dict):
    msg = MIMEMultipart()
    msg["Subject"] = "You're Admitted!"
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

    body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #22c55e; color: white; padding: 30px; border-radius: 12px; text-align: center;">
        <h1 style="margin:0 0 8px 0;">Welcome, {first}!</h1>
        <p style="font-size: 18px; margin:0;">You have been successfully admitted.</p>
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

