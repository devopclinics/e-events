"""Acceptance scenarios from docs/MULTI-DAY-DASHBOARD-IMPLEMENTATION-PLAN.md:
a guest attending multiple days is first-time on their first day and
returning thereafter; a denied scan never counts; exits reduce on-site
without erasing daily attendance.
"""
from datetime import datetime

from app.models import Event


async def _set_multi_day(ctx):
    async with ctx.session_factory() as s:
        ev = await s.get(Event, ctx.event_id)
        ev.event_date = datetime(2020, 1, 2, 12, 0)
        ev.event_end_date = datetime(2020, 1, 3, 12, 0)
        await s.commit()


async def test_first_time_then_returning_across_days(ctx):
    await _set_multi_day(ctx)
    async with ctx.session_factory() as s:
        guest = await ctx.add_guest(s, first_name="Ada")
        await ctx.add_scan(s, guest.id, "in", datetime(2020, 1, 2, 9, 0))
        await ctx.add_scan(s, guest.id, "in", datetime(2020, 1, 3, 9, 0))
        await s.commit()

    day1 = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/attendance?day=2020-01-02"
    )).json()
    assert day1["checked_in"] == 1
    assert day1["first_time"] == 1
    assert day1["returning"] == 0

    day2 = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/attendance?day=2020-01-03"
    )).json()
    assert day2["checked_in"] == 1
    assert day2["first_time"] == 0
    assert day2["returning"] == 1


async def test_denied_scan_excluded_from_attendance(ctx):
    await _set_multi_day(ctx)
    async with ctx.session_factory() as s:
        guest = await ctx.add_guest(s)
        await ctx.add_scan(s, guest.id, "in", datetime(2020, 1, 2, 9, 0), denied=True)
        await s.commit()

    resp = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/attendance?day=2020-01-02"
    )).json()
    assert resp["checked_in"] == 0
    assert resp["first_time"] == 0


async def test_exit_reduces_onsite_not_daily_attendance(ctx):
    await _set_multi_day(ctx)
    async with ctx.session_factory() as s:
        guest = await ctx.add_guest(s)
        await ctx.add_scan(s, guest.id, "in", datetime(2020, 1, 2, 9, 0))
        await ctx.add_scan(s, guest.id, "out", datetime(2020, 1, 2, 18, 0))
        await s.commit()

    resp = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/attendance?day=2020-01-02"
    )).json()
    assert resp["checked_in"] == 1        # still counted as attended that day
    assert resp["checked_out"] == 1
    assert resp["on_site"] == 0           # but not currently on-site


async def test_day_outside_event_range_is_400(ctx):
    await _set_multi_day(ctx)
    resp = await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/attendance?day=2099-01-01"
    )
    assert resp.status_code == 400


async def test_no_auth_is_401(ctx):
    from app.main import app
    from app.database import get_db
    from app.auth import current_user as current_user_dep

    # Temporarily drop the auth override to prove the endpoint really requires it.
    saved = app.dependency_overrides.pop(current_user_dep)
    try:
        resp = await ctx.client.get(f"/api/results/events/{ctx.event_id}/command-center")
        assert resp.status_code in (401, 422)  # 422 if bearer header itself absent at the FastAPI layer
    finally:
        app.dependency_overrides[current_user_dep] = saved
