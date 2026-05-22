import html as _html
import logging
from datetime import datetime
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from app.config import settings
from services.qr_service import generate_qr_bytes

logger = logging.getLogger(__name__)


async def _send(msg: MIMEMultipart):
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
):
    msg = MIMEMultipart("related")
    msg["Subject"] = f"Your Invitation — {event_name}"
    msg["From"] = settings.email_from
    msg["To"] = guest_data["email"]

    qr_bytes = generate_qr_bytes(guest_data["qr_token"], checkin_base_url)
    date_str = event_date.strftime("%A, %d %B %Y")

    first = _html.escape(guest_data["first_name"])
    last  = _html.escape(guest_data["last_name"])
    e_name    = _html.escape(event_name)
    e_couple  = _html.escape(couples_name)

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

    admitted_time = guest_data["admitted_at"].strftime("%H:%M") if guest_data.get("admitted_at") else ""
    first = _html.escape(guest_data["first_name"])

    body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #22c55e; color: white; padding: 30px; border-radius: 12px; text-align: center;">
        <h1>Welcome, {first}!</h1>
        <p style="font-size: 18px;">You have been successfully admitted.</p>
        {"<p>Check-in time: <strong>" + admitted_time + "</strong></p>" if admitted_time else ""}
      </div>
      <p style="margin-top: 20px; color: #666;">Enjoy the event!</p>
    </body>
    </html>
    """

    msg.attach(MIMEText(body, "html"))
    await _send(msg)

