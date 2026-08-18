"""Pure fire-time computation for the Reminders add-on -- no scheduler logic
here (see reminder_outbox.py for the tick loop, reminder_send.py for the
per-guest fan-out) so routers/events.py and routers/reminders.py can import
this without pulling in the outbox worker."""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Event, EventReminder
from ..timeutil import event_local_to_utc, to_event_local


def compute_fire_at(event: Event, *, offset_days: int, send_time_local: str):
    """UTC instant `offset_days` before event.event_date at send_time_local,
    in the event's own timezone."""
    local_date = (to_event_local(event.event_date, event.timezone) - timedelta(days=offset_days)).date()
    return event_local_to_utc(local_date, send_time_local, event.timezone)


async def recompute_fire_times(event: Event, db: AsyncSession) -> None:
    """Called from routers/events.py::update_event when event_date or
    timezone changes. Only touches reminders that haven't fired yet --
    already-sent reminders keep their historical fire_at_utc (audit trail)."""
    rows = (await db.scalars(select(EventReminder).where(
        EventReminder.event_id == event.id, EventReminder.fired_at.is_(None),
    ))).all()
    for reminder in rows:
        reminder.fire_at_utc = compute_fire_at(
            event, offset_days=reminder.offset_days, send_time_local=reminder.send_time_local
        )
