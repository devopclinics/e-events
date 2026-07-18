"""Results dashboard payload behavior for well-attended live events."""
import datetime as dt

import pytest
from sqlalchemy import delete

from app.models import Event, Guest
from conftest import _Session


@pytest.mark.asyncio
async def test_admitted_guests_capped_but_arrival_timeline_covers_everyone(ctx):
    """Regression test: the dashboard used to serialize every admitted guest's
    full record (unbounded), even though the frontend only ever displays the
    newest 50 -- on a well-attended live event (500+ check-ins) this produced
    a multi-hundred-KB response and client-side "Failed to fetch" timeouts.
    The admitted_guests list must be capped, but the arrival-timeline chart
    (which needs every check-in, not just the newest 50) must stay accurate."""
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        await s.execute(delete(Guest).where(Guest.event_id == ev))
        base = dt.datetime(2026, 7, 18, 9, 0, 0)
        for i in range(60):
            s.add(Guest(
                event_id=ev, first_name=f"G{i}", last_name="Test",
                email=f"g{i}@example.com", admitted=True,
                # Spread across 3 distinct hours so the timeline has multiple buckets.
                admitted_at=base + dt.timedelta(hours=i % 3, minutes=i),
            ))
        await s.commit()

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get(f"/api/events/{ev}/dashboard")
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["admitted"] == 60
    assert len(body["admitted_guests"]) <= 50, "admitted_guests must be capped, not every admitted guest"

    timeline_total = sum(point["count"] for point in body["arrival_timeline"])
    assert timeline_total == 60, "arrival_timeline must cover every admitted guest, not just the capped list"
