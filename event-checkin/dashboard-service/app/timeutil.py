"""Trimmed copy of backend/app/timeutil.py — stored timestamps are naive UTC;
day boundaries must be resolved in the event's own IANA timezone."""
from datetime import datetime
from zoneinfo import ZoneInfo

DEFAULT_TZ = ZoneInfo("UTC")
_UTC = ZoneInfo("UTC")


def resolve_tz(tz) -> ZoneInfo:
    if isinstance(tz, ZoneInfo):
        return tz
    if not tz:
        return DEFAULT_TZ
    try:
        return ZoneInfo(str(tz))
    except Exception:
        return DEFAULT_TZ


def event_tz(event) -> ZoneInfo:
    return resolve_tz(getattr(event, "timezone", None))


def to_event_local(dt: datetime | None, tz=None) -> datetime | None:
    if dt is None:
        return None
    aware = dt if dt.tzinfo else dt.replace(tzinfo=_UTC)
    return aware.astimezone(resolve_tz(tz))


def to_utc_naive(dt: datetime) -> datetime:
    """Aware datetime -> naive UTC, matching how ScanEvent.scanned_at etc. are stored."""
    aware = dt if dt.tzinfo else dt.replace(tzinfo=_UTC)
    return aware.astimezone(_UTC).replace(tzinfo=None)
