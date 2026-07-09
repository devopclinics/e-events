"""Public demo requests from the marketing site."""
import html
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks

from ..config import settings
from ..schemas import DemoRequestCreate, DemoRequestOut
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


def _ics_escape(value: str) -> str:
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _ics_datetime(dt: datetime) -> str:
    return _as_utc(dt).strftime("%Y%m%dT%H%M%SZ")


def _calendar_invite(body: DemoRequestCreate) -> bytes:
    start = _as_utc(body.preferred_time, body.timezone)
    end = start + timedelta(minutes=30)
    uid = f"demo-{uuid.uuid4()}@festio.events"
    description = "\n".join([
        f"Name: {body.contact_name}",
        f"Email: {body.email}",
        f"Phone: {body.phone or '-'}",
        f"Organization: {body.organization or '-'}",
        f"Event: {body.event_name or '-'}",
        f"Expected guests: {body.guest_count or '-'}",
        "",
        body.message or "",
    ]).strip()
    ics = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Festio//Demo Request//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
        f"DTSTART:{_ics_datetime(start)}",
        f"DTEND:{_ics_datetime(end)}",
        "SUMMARY:Festio demo",
        "LOCATION:Video call",
        f"DESCRIPTION:{_ics_escape(description)}",
        "ORGANIZER;CN=Festio:mailto:events@festio.events",
        f"ATTENDEE;CN={_ics_escape(body.contact_name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{body.email}",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ])
    return ics.encode("utf-8")


def _display_time(body: DemoRequestCreate) -> str:
    local = _as_utc(body.preferred_time, body.timezone).astimezone(_timezone(body.timezone))
    return local.strftime("%A, %B %-d, %Y at %-I:%M %p %Z")


@router.post("/demo-requests", response_model=DemoRequestOut, status_code=201)
async def submit_demo_request(body: DemoRequestCreate, background_tasks: BackgroundTasks):
    when = _display_time(body)
    calendar = _calendar_invite(body)
    attachment = [("festio-demo.ics", calendar, "text/calendar")]

    confirmation = (
        f"<p>Hi {_clean(body.contact_name)},</p>"
        "<p>Thanks for booking a Festio demo. We received your request and will confirm the meeting link shortly.</p>"
        f"<p><strong>Preferred time:</strong> {_clean(when)}</p>"
        "<p>A calendar hold is attached so you can save the time.</p>"
        "<p>— The Festio team</p>"
    )
    background_tasks.add_task(
        send_simple_email,
        str(body.email),
        "Your Festio demo request",
        confirmation,
        None,
        attachment,
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

    return DemoRequestOut(message="Demo request received. Check your email for the calendar hold.")
