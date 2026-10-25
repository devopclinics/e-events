"""Standalone meeting validation, signed response links, and invitation rendering."""
from datetime import datetime, timezone, timedelta
from html import escape
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Literal
from urllib.parse import urlparse

import jwt
from pydantic import BaseModel, Field, EmailStr, field_validator, model_validator
from ..config import settings
from services.email_service import _build_ics_bytes


class AttendeeInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr

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

    @model_validator(mode="after")
    def valid(self):
        self.title = self.title.strip()
        if not self.title or any(ord(c) < 32 for c in self.title):
            raise ValueError("Enter a meeting title without control characters")
        start = utc_time(self.start, self.timezone, self.start_fold)
        end = utc_time(self.end, self.timezone, self.end_fold)
        if end <= start:
            raise ValueError("End must be after start")
        emails = [str(a.email).lower() for a in self.attendees]
        if len(emails) != len(set(emails)):
            raise ValueError("Each email address may appear only once")
        for attendee in self.attendees:
            attendee.email = str(attendee.email).lower()
        if self.video_url:
            parsed = urlparse(self.video_url)
            if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or any(ord(c) < 32 for c in self.video_url):
                raise ValueError("Meeting link must be an http or https URL")
        if self.location_type == "online" and not self.video_url:
            raise ValueError("Paste the online meeting link")
        if self.location_type == "physical" and not self.location.strip():
            raise ValueError("Enter the meeting location")
        return self


def response_token(meeting, attendee):
    if len(settings.meetings_signing_key) < 32:
        raise ValueError("Meeting response signing is not configured")
    end = utc_time(meeting.published["end"], meeting.published["timezone"], meeting.published.get("end_fold"))
    return jwt.encode({"scope": "meeting-response", "mid": meeting.id, "aid": attendee.id,
                       "seq": meeting.sequence, "exp": end + timedelta(days=30)},
                      settings.meetings_signing_key, algorithm="HS256")


def invitation(data, *, method="REQUEST"):
    subject = ("Cancelled: " if method == "CANCEL" else "You're invited: ") + data["title"]
    place = data["video_url"] if data["location_type"] == "online" else data["location"]
    body = f'<h2>{escape(data["title"])}</h2><p>{escape(data["agenda"])}</p><p>{escape(data["start"])} – {escape(data["end"])}<br>{escape(data["timezone"])}</p><p>{escape(place)}</p>'
    body += "<p>This meeting has been cancelled.</p>" if method == "CANCEL" else "<p>Please respond using your personal Festio link. Responses are recorded in Festio; Google/Outlook replies are not synchronized.</p>"
    return subject, body


def calendar_bytes(meeting, data, attendee, method, sequence):
    return _build_ics_bytes(event_name=data["title"], start=utc_time(data["start"], data["timezone"], data.get("start_fold")),
        end=utc_time(data["end"], data["timezone"], data.get("end_fold")),
        venue_text=data["video_url"] if data["location_type"] == "online" else data["location"],
        uid=f"meeting-{meeting.id}@festio.events", organizer_email=meeting.organizer_email,
        attendee_name=attendee.name, attendee_email=attendee.email, method=method, sequence=sequence,
        description=data["agenda"])
