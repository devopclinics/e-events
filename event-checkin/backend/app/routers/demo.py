"""Public demo requests from the marketing site."""
import html
import hashlib
import json
from typing import Annotated
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..schemas import DemoRequestCreate, DemoRequestOut
from ..database import get_db
from ..ratelimit import rate_limit
from ..models import DemoRequest
from ..services.marketing_client import enqueue_marketing_payload, lifecycle_event_id
from services.email_service import send_simple_email

router = APIRouter()

_DEFAULT_TZ = ZoneInfo("America/Chicago")


def _clean(value: object) -> str:
    return html.escape(str(value or "").strip())


def _recipient_emails() -> list[str]:
    raw = settings.demo_recipient_emails or "events@festio.events"
    emails = [part.strip() for part in raw.split(",") if part.strip()]
    return emails or ["events@festio.events"]


def _timezone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "America/Chicago")
    except Exception:
        return _DEFAULT_TZ


def _as_utc(dt: datetime, tz_name: str | None = None) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_timezone(tz_name))
    return dt.astimezone(timezone.utc)


def _display_time(body: DemoRequestCreate) -> str:
    local = _as_utc(body.preferred_time, body.timezone).astimezone(_timezone(body.timezone))
    # Unpadded %-d/%-I directives are unsupported on Windows.
    return (local.strftime("%A, %B ") + str(local.day) + local.strftime(", %Y at ")
            + str(local.hour % 12 or 12) + local.strftime(":%M %p %Z"))


def _response(request: DemoRequest) -> DemoRequestOut:
    return DemoRequestOut(
        request_id=request.id,
        message="Demo request received. Your preferred time is not yet confirmed; our team will contact you.",
    )


def _replay(request: DemoRequest, digest: str) -> DemoRequestOut:
    if request.payload_digest != digest:
        raise HTTPException(409, "This submission key was already used for a different demo request.")
    return _response(request)


@router.post(
    "/demo-requests", response_model=DemoRequestOut, status_code=201,
    dependencies=[Depends(rate_limit(limit=5, window=60, scope="demo_request", key="client_ip"))],
)
async def submit_demo_request(
    body: DemoRequestCreate, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db),
    idempotency_key: Annotated[str | None, Header(min_length=8, max_length=128)] = None,
):
    # The client retains a random key across retries of the same submission.
    # Store only its digest, and reject key reuse with a different payload.
    key = hashlib.sha256(idempotency_key.encode()).hexdigest() if idempotency_key else None
    digest = hashlib.sha256(json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
    if key:
        existing = await db.scalar(select(DemoRequest).where(DemoRequest.idempotency_key == key))
        if existing:
            return _replay(existing, digest)
    preferred_time = _as_utc(body.preferred_time, body.timezone)
    request = DemoRequest(
        **body.model_dump(exclude={"preferred_time", "timezone", "consent_email", "consent_sms", "consent_whatsapp"}),
        preferred_time=preferred_time.replace(tzinfo=None), timezone=body.timezone or "America/Chicago",
        status="requested", idempotency_key=key, payload_digest=digest,
    )
    db.add(request)
    try:
        await db.flush()
    except IntegrityError:
        # Concurrent requests with the same key cannot both queue emails.
        await db.rollback()
        existing = await db.scalar(select(DemoRequest).where(DemoRequest.idempotency_key == key)) if key else None
        if existing:
            return _replay(existing, digest)
        raise
    consent = {
        field: getattr(body, field) for field in ("consent_email", "consent_sms", "consent_whatsapp")
        if getattr(body, field) is not None
    }
    await enqueue_marketing_payload(db, {
        "email": str(body.email), "name": body.contact_name, "phone": body.phone,
        "organization": body.organization, "guest_count": body.guest_count,
        "lifecycle_event": "demo_requested", "source": "website_demo", "identity_verified": False,
        "demo_request_id": request.id, "preferred_time": preferred_time.isoformat(),
        "timezone": request.timezone, "event_name": body.event_name, "message": body.message,
        **consent,
    }, endpoint="demo-requests", event_id=lifecycle_event_id("demo_requested", request.id))
    # Anonymous contact details and checkbox claims are review evidence, never
    # authority to match or update an existing Marketing lead.
    # A success response means the request and unverified capture are durable.
    # Email is a transactional acknowledgement, never a booking confirmation.
    await db.commit()
    when = _display_time(body)

    confirmation = (
        f"<p>Hi {_clean(body.contact_name)},</p>"
        "<p>Thanks for requesting a Festio demo. We received your request. This is not a confirmed booking; our team will contact you to arrange a time.</p>"
        f"<p><strong>Preferred time:</strong> {_clean(when)}</p>"
        "<p>— The Festio team</p>"
    )
    background_tasks.add_task(
        send_simple_email,
        str(body.email),
        "Your Festio demo request",
        confirmation,
        None,
        None,
        None,
        "demo_request_confirmation",
    )

    details = (
        "<p>A new Festio demo request was submitted.</p>"
        "<ul>"
        f"<li><strong>Name:</strong> {_clean(body.contact_name)}</li>"
        f"<li><strong>Email:</strong> {_clean(body.email)}</li>"
        f"<li><strong>Phone:</strong> {_clean(body.phone) or '—'}</li>"
        f"<li><strong>Organization:</strong> {_clean(body.organization) or '—'}</li>"
        f"<li><strong>Event:</strong> {_clean(body.event_name) or '—'}</li>"
        f"<li><strong>Expected guests:</strong> {_clean(body.guest_count) or '—'}</li>"
        f"<li><strong>Preferred time:</strong> {_clean(when)}</li>"
        "</ul>"
        f"<p><strong>Message:</strong><br>{_clean(body.message) or '—'}</p>"
    )
    for recipient in _recipient_emails():
        background_tasks.add_task(
            send_simple_email,
            recipient,
            f"New Festio demo request — {body.contact_name}",
            details,
            None,
            None,
            None,
            "demo_request_operator",
        )

    return _response(request)
