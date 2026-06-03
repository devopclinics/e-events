"""Time formatting helpers. Stored timestamps are naive UTC (datetime.utcnow());
display strings should show local event time."""
from datetime import datetime
from zoneinfo import ZoneInfo

# TODO: per-event timezone. For now use the event location's local zone.
EVENT_TZ = ZoneInfo("America/Chicago")
_UTC = ZoneInfo("UTC")


def local_hhmm(dt: datetime | None) -> str:
    """Format a UTC-stored datetime as HH:MM in EVENT_TZ. Returns '' on None."""
    if dt is None:
        return ""
    aware = dt if dt.tzinfo else dt.replace(tzinfo=_UTC)
    return aware.astimezone(EVENT_TZ).strftime("%H:%M")
