"""Time formatting helpers. Stored timestamps are naive UTC (datetime.utcnow());
display strings should show local event time."""
from datetime import datetime
from zoneinfo import ZoneInfo

# TODO: per-event timezone. For now use the event location's local zone.
EVENT_TZ = ZoneInfo("America/Chicago")
_UTC = ZoneInfo("UTC")


def to_event_local(dt: datetime | None) -> datetime | None:
    """Convert a UTC-stored datetime (naive-UTC or aware) to an aware EVENT_TZ
    datetime. Returns None on None. Use this before strftime-ing any stored
    timestamp for display so emails/SMS show event-local wall-clock time, not UTC."""
    if dt is None:
        return None
    aware = dt if dt.tzinfo else dt.replace(tzinfo=_UTC)
    return aware.astimezone(EVENT_TZ)


def local_hhmm(dt: datetime | None) -> str:
    """Format a UTC-stored datetime as HH:MM in EVENT_TZ. Returns '' on None."""
    local = to_event_local(dt)
    return local.strftime("%H:%M") if local else ""
