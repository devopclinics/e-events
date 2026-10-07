"""Email-only recovery. Never return guest matches or bearer links to callers."""
import hashlib
import logging
import time
import uuid
from html import escape
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from sqlalchemy import func, select

from .. import ratelimit
from ..config import settings
from ..models import Event, Guest
from ..schemas import GuestHubRecoveryRequest
from services.email_service import send_simple_email

logger = logging.getLogger(__name__)
RECOVERY_MESSAGE = "If a registration matches, we’ll email its personal GuestHub link to the address saved on it. Check your inbox and spam folder."


async def allow_recovery(request: Request, event_id: str, email: str) -> bool:
    """Shared replica limits. Names cannot bypass the recipient cooldown."""
    ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "unknown")
    now = int(time.time())
    ip_hash = hashlib.sha256(ip.encode()).hexdigest()
    if not await ratelimit._hit(f"rl:hub-recovery-ip:{ip_hash}:{now // 900}", 20, 900, fail_closed=True):
        raise HTTPException(429, "Too many requests. Please wait a few minutes before trying again.")
    recipient = hashlib.sha256(f"{event_id}:{email.strip().lower()}".encode()).hexdigest()
    for window, limit in ((60, 1), (3600, 5)):
        if not await ratelimit._hit(f"rl:hub-recovery-email:{recipient}:{now // window}", limit, window, fail_closed=True):
            return False
    return True


async def send_recovery_email(event_id: str, data: GuestHubRecoveryRequest) -> None:
    # A separate session keeps guest lookup and mail delivery out of the public
    # response and avoids handing request-scoped DB resources to a background task.
    from ..database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            event = await db.get(Event, event_id)
            if not event or event.status == "ended":
                return
            query = select(Guest).where(
                Guest.event_id == event_id,
                func.lower(func.trim(Guest.email)) == str(data.email).lower(),
            )
            if data.first_name:
                query = query.where(func.lower(func.trim(Guest.first_name)) == data.first_name.lower())
            if data.last_name:
                query = query.where(func.lower(func.trim(Guest.last_name)) == data.last_name.lower())
            guests = (await db.execute(query.order_by(Guest.id).limit(51))).scalars().all()
            if not guests:
                return
            # Use a configured origin, never the untrusted request Host or a
            # caller-supplied redirect. Links retain existing GuestHub permissions.
            base = urlsplit((settings.public_base_url or event.checkin_base_url or "").strip())
            if base.scheme not in ("http", "https") or not base.netloc or base.username or base.password:
                logger.error("GuestHub recovery has no valid public origin for event %s", event_id)
                return
            origin = f"{base.scheme}://{base.netloc}"
            if len(guests) > 50:
                body = "<p>Please request your GuestHub link again with your first and last name to identify your registration.</p>"
            else:
                links = []
                for guest in guests:
                    if not guest.invite_token:
                        guest.invite_token = str(uuid.uuid4())
                    url = escape(f"{origin}/r/{guest.invite_token}", quote=True)
                    name = escape(f"{guest.first_name} {guest.last_name}".strip())
                    links.append(f'<li><a href="{url}">Open GuestHub for {name}</a></li>')
                await db.commit()
                body = "<p>Use your personal link below to open your registration and available event services.</p><ul>" + "".join(links) + "</ul>"
            recipient = guests[0].email.strip()
            event_name = " ".join(event.name.splitlines())
        # Operational access recovery is not a broadcast: no guest_id credit
        # charge, and no dependency on invitation notification toggles. The email
        # service still applies recipient safeguards and records delivery results.
        await send_simple_email(
            to_email=recipient,
            subject=f"Your GuestHub link — {event_name}",
            html_body=f"<h2>{escape(event_name)}</h2>{body}<p>Keep this personal link private. If you did not request it, you can ignore this email.</p>",
            event_id=event_id,
            message_kind="guesthub_recovery",
        )
    except Exception:
        # Do not log bearer tokens, email addresses, or submitted names.
        logger.error("GuestHub recovery could not complete for event %s", event_id)
