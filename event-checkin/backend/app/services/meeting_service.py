"""Standalone meeting validation, signed response links, and invitation rendering."""
from datetime import datetime, timezone, timedelta
from html import escape
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Literal
import re
from urllib.parse import urlparse

import jwt
from pydantic import BaseModel, Field, EmailStr, field_validator, model_validator
from ..config import settings
from services.email_service import _build_ics_bytes


class AttendeeInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    channels: list[Literal["email", "sms", "whatsapp"]] = Field(default_factory=lambda: ["email"], min_length=1, max_length=3)
    sms_consent: bool = False
    whatsapp_consent: bool = False

    @field_validator("email", mode="before")
    @classmethod
    def empty_email(cls, value):
        return value or None

    @model_validator(mode="after")
    def contacts(self):
        if len(self.channels) != len(set(self.channels)):
            raise ValueError("Select each channel only once")
        if self.phone:
            self.phone = re.sub(r"[ ()-]", "", self.phone.strip())
            if not re.fullmatch(r"\+[1-9][0-9]{7,14}", self.phone):
                raise ValueError("Use an international phone number with + and country code")
        if "email" in self.channels and not self.email:
            raise ValueError("Email channel requires an email address")
        if any(c in self.channels for c in ("sms", "whatsapp")) and not self.phone:
            raise ValueError("SMS and WhatsApp require an international phone number")
        if "sms" in self.channels and not self.sms_consent:
            raise ValueError("Confirm SMS consent before selecting SMS")
        if "whatsapp" in self.channels and not self.whatsapp_consent:
            raise ValueError("Confirm WhatsApp consent before selecting WhatsApp")
        if self.email:
            self.email = str(self.email).lower()
        return self

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 for c in value):
            raise ValueError("Enter a name without control characters")
        return value


def utc_time(value: str, zone: str, fold: int | None):
    """Reject gaps and require explicit first/second occurrence for DST folds."""
    try:
        naive = datetime.fromisoformat(value)
        tz = ZoneInfo(zone)
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError("Use a valid local date/time and IANA timezone")
    if naive.tzinfo is not None:
        raise ValueError("Enter local time without an offset")
    candidates = []
    for f in (0, 1):
        dt = naive.replace(tzinfo=tz, fold=f)
        if dt.astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None) == naive:
            candidates.append(dt)
    if not candidates:
        raise ValueError("This local time does not exist because clocks move forward")
    if len({d.utcoffset() for d in candidates}) > 1 and fold is None:
        raise ValueError("This time occurs twice; choose first or second occurrence")
    return naive.replace(tzinfo=tz, fold=fold or 0).astimezone(timezone.utc)


class MeetingInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    agenda: str = Field(default="", max_length=10000)
    start: str
    end: str
    timezone: str = Field(max_length=100)
    start_fold: Literal[0, 1] | None = None
    end_fold: Literal[0, 1] | None = None
    location_type: Literal["online", "physical"] = "online"
    location: str = Field(default="", max_length=1000)
    video_url: str = Field(default="", max_length=2000)
    attendees: list[AttendeeInput] = Field(min_length=1, max_length=50)
    whatsapp_template_id: str | None = Field(default=None, max_length=36)
    invitation_style: Literal["aurora", "cobalt", "terracotta"] = "aurora"

    @field_validator("video_url", mode="before")
    @classmethod
    def normalize_meeting_url(cls, value):
        if not isinstance(value, str):
            return value
        value = value.strip()
        # Accept pasted host/path links without treating arbitrary schemes or
        # whitespace as a valid web address.
        if re.fullmatch(r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?::[0-9]{1,5})?(?:[/?#][^\s]*)?", value):
            return "https://" + value
        return value

    @model_validator(mode="after")
    def valid(self):
        self.title = self.title.strip()
        if not self.title or any(ord(c) < 32 for c in self.title):
            raise ValueError("Enter a meeting title without control characters")
        start = utc_time(self.start, self.timezone, self.start_fold)
        end = utc_time(self.end, self.timezone, self.end_fold)
        if end <= start:
            raise ValueError("End must be after start")
        emails = [str(a.email).lower() for a in self.attendees if a.email]
        if len(emails) != len(set(emails)):
            raise ValueError("Each email address may appear only once")
        phones = [a.phone for a in self.attendees if a.phone]
        if len(phones) != len(set(phones)):
            raise ValueError("Each phone number may appear only once")
        if self.video_url:
            parsed = urlparse(self.video_url)
            if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or any(ord(c) < 32 for c in self.video_url):
                raise ValueError("Meeting link must be an http or https URL")
        if self.location_type == "online" and not self.video_url:
            raise ValueError("Paste the online meeting link")
        if self.location_type == "physical" and not self.location.strip():
            raise ValueError("Enter the meeting location")
        return self


def response_token(meeting, attendee, *, scope="meeting-response", phone=None):
    if len(settings.meetings_signing_key) < 32:
        raise ValueError("Meeting response signing is not configured")
    end = utc_time(meeting.published["end"], meeting.published["timezone"], meeting.published.get("end_fold"))
    return jwt.encode({"scope": scope, "mid": meeting.id, "aid": attendee.id,
                       "phone": phone or getattr(attendee, "phone", None),
                       "seq": meeting.sequence, "exp": end + timedelta(days=30)},
                      settings.meetings_signing_key, algorithm="HS256")


INVITATION_STYLES = {
    "aurora": ("#183e3a", "#bbf17a", "#eef8eb"),
    "cobalt": ("#202d68", "#c4c2ff", "#eff0ff"),
    "terracotta": ("#663728", "#ffda9a", "#fff3e8"),
}


def invitation(data, *, method="REQUEST", response_url=None, recipient_name=None):
    subject = ("Cancelled: " if method == "CANCEL" else "You're invited: ") + data["title"]
    ink, accent, soft = INVITATION_STYLES.get(data.get("invitation_style"), INVITATION_STYLES["aurora"])
    start, end = datetime.fromisoformat(data["start"]), datetime.fromisoformat(data["end"])
    day = start.strftime("%A, %d %B %Y")
    hours = start.strftime("%I:%M %p").lstrip("0") + " – " + end.strftime("%I:%M %p").lstrip("0")
    if start.date() != end.date():
        hours += " · ends " + end.strftime("%d %B")
    place = data["video_url"] if data["location_type"] == "online" else data["location"]
    greeting = "Hello " + escape(recipient_name) + "," if recipient_name else "A little time. A meaningful connection."
    agenda = escape(data.get("agenda", "")).replace("\n", "<br>")
    state = "MEETING CANCELLED" if method == "CANCEL" else "YOU’RE INVITED"
    action = ""
    if method != "CANCEL":
        style = f"display:inline-block;background:{ink};color:#ffffff;padding:15px 23px;border-radius:12px;font-weight:700;text-decoration:none"
        action = (f'<a href="{escape(response_url, quote=True)}" style="{style}">View invitation &amp; respond →</a>' if response_url
                  else f'<span style="{style}">View invitation &amp; respond →</span>')
    else:
        action = '<p style="font-weight:700;color:#9a312d">This meeting has been cancelled.</p>'
    body = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(subject)}</title></head>
<body style="margin:0;background:#f1f3ef;font-family:Arial,Helvetica,sans-serif;color:#19302e;line-height:1.6">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #dbe4df">
<tr><td style="background:{ink};padding:30px;color:#ffffff"><table role="presentation" width="100%"><tr><td style="color:#ffffff;font-size:23px;font-weight:800">festio<span style="color:{accent}">.</span></td><td align="right" style="color:{accent};font-size:11px;letter-spacing:2px">LET’S CONNECT</td></tr></table>
<p style="margin:30px 0 12px;color:{accent};font-size:11px;font-weight:700;letter-spacing:2px">{state}</p>
<h1 style="font-size:32px;line-height:1.2;margin:0 0 18px;color:#ffffff;overflow-wrap:anywhere">{escape(data["title"])}</h1><p style="margin:0;color:#ffffff">{greeting}</p></td></tr>
<tr><td style="padding:26px 30px;background:{soft}"><p style="font-size:11px;letter-spacing:2px;font-weight:700;margin:0;color:{ink}">SAVE THE DATE</p><p style="font-size:21px;font-weight:700;margin:7px 0;color:{ink}">{day}</p><p style="margin:0;color:{ink}">{hours}</p><p style="font-size:12px;margin:5px 0 0;color:{ink}">{escape(data["timezone"])}</p></td></tr>
<tr><td style="padding:28px 30px"><p style="font-size:11px;letter-spacing:2px;font-weight:700;color:{ink};margin:0 0 8px">{'JOIN ONLINE' if data["location_type"] == 'online' else 'MEET US HERE'}</p><p style="margin:0 0 24px;overflow-wrap:anywhere">{escape(place)}</p>
{('<p style="font-size:11px;letter-spacing:2px;font-weight:700;color:'+ink+';margin:0 0 8px">ON THE AGENDA</p><p style="margin:0 0 24px;overflow-wrap:anywhere">'+agenda+'</p>') if agenda else ''}
{action}<p style="font-size:12px;color:#596e68;margin:18px 0 0">{'Your personal invitation includes a calendar attachment and a link to accept, decline or reply maybe. Responses are recorded in Festio.' if method != 'CANCEL' else 'The attached calendar cancellation updates the original invitation.'}</p></td></tr>
<tr><td style="padding:20px 30px;border-top:1px solid #e3eae5;color:#596e68;font-size:11px">A meeting made simple. Powered by <strong>Festio</strong>.<br>You received this personal invitation from the meeting organizer. Google/Outlook replies are not synchronized.</td></tr>
</table></td></tr></table></body></html>'''
    return subject, body


def contact_key(data):
    return data.get("email") or data.get("phone")


def targets(data):
    return [(a, channel, a.get("email") if channel == "email" else a.get("phone"))
            for a in data.get("attendees", []) for channel in a.get("channels", ["email"])]


def phone_message(data, *, method="REQUEST"):
    action = "Cancelled" if method == "CANCEL" else "Meeting invitation / update"
    place = data["video_url"] if data["location_type"] == "online" else data["location"]
    return f'{action}: {data["title"]}. {data["start"]} - {data["end"]} ({data["timezone"]}). {place}'


def calendar_bytes(meeting, data, attendee, method, sequence, *, dtstamp=None):
    return _build_ics_bytes(event_name=data["title"], start=utc_time(data["start"], data["timezone"], data.get("start_fold")),
        end=utc_time(data["end"], data["timezone"], data.get("end_fold")),
        venue_text=data["video_url"] if data["location_type"] == "online" else data["location"],
        uid=f"meeting-{meeting.id}@festio.events", organizer_email=meeting.organizer_email,
        attendee_name=attendee.name, attendee_email=attendee.email, method=method, sequence=sequence,
        description=data["agenda"], dtstamp=dtstamp)
