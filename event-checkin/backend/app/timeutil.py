"""Time formatting helpers. Stored timestamps are naive UTC (datetime.utcnow());
display strings should show the event's local wall-clock time.

Each event carries an IANA `timezone` (required at creation). Pass the event (or
its tz) into these helpers so emails/SMS/OG render in the event's zone, not the
server's or the viewer's. Legacy events with no timezone fall back to UTC until
they are backfilled."""
from datetime import datetime
from zoneinfo import ZoneInfo

# Fallback for events created before per-event timezones existed. Such events
# should be backfilled; UTC is the honest "unknown zone" default meanwhile.
DEFAULT_TZ = ZoneInfo("UTC")
# Back-compat alias for callers that imported the old module-level constant.
EVENT_TZ = DEFAULT_TZ
_UTC = ZoneInfo("UTC")


def resolve_tz(tz) -> ZoneInfo:
    """Coerce a ZoneInfo, an IANA name, or None into a ZoneInfo (UTC on
    unknown/blank), so callers can pass event.timezone directly."""
    if isinstance(tz, ZoneInfo):
        return tz
    if not tz:
        return DEFAULT_TZ
    try:
        return ZoneInfo(str(tz))
    except Exception:
        return DEFAULT_TZ


def event_tz(event) -> ZoneInfo:
    """The ZoneInfo for an Event (or anything with a `.timezone` attribute)."""
    return resolve_tz(getattr(event, "timezone", None))


def to_event_local(dt: datetime | None, tz=None) -> datetime | None:
    """Convert a UTC-stored datetime (naive-UTC or aware) to an aware datetime in
    the event's zone. `tz` may be a ZoneInfo, an IANA name, or None (→ UTC).
    Returns None on None. Use this before strftime-ing any stored timestamp for
    display so emails/SMS show event-local wall-clock time, not UTC."""
    if dt is None:
        return None
    aware = dt if dt.tzinfo else dt.replace(tzinfo=_UTC)
    return aware.astimezone(resolve_tz(tz))


def local_hhmm(dt: datetime | None, tz=None) -> str:
    """Format a UTC-stored datetime as HH:MM in the event's zone. '' on None."""
    local = to_event_local(dt, tz)
    return local.strftime("%H:%M") if local else ""
