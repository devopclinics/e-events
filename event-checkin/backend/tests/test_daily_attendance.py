"""Daily attendance is opt-in and must never mutate ordinary event admission."""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import AttendanceRecord, Event, Guest
from conftest import _Session


async def _prepare(ctx, *, enabled=True, admitted=True, in_dates=True):
    event_id = ctx.ids["event_a"]
    async with _Session() as session:
        event = await session.get(Event, event_id)
        guest = await session.scalar(select(Guest).where(Guest.event_id == event_id))
        now = datetime.utcnow()
        event.status = "active"
        event.timezone = "UTC"
        event.daily_checkin_enabled = enabled
        event.event_date = now - timedelta(hours=1) if in_dates else now - timedelta(days=3)
        event.event_end_date = now + timedelta(hours=1) if in_dates else now - timedelta(days=2)
        guest.admitted = admitted
        await session.commit()
        return guest.qr_token, guest.id


@pytest.mark.asyncio
async def test_organizer_can_explicitly_toggle_daily_attendance(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]
    enabled = await ctx.client.patch(f"/api/events/{event_id}/features", json={"daily_checkin_enabled": True})
    assert enabled.status_code == 200
    assert enabled.json()["daily_checkin_enabled"] is True
    disabled = await ctx.client.patch(f"/api/events/{event_id}/features", json={"daily_checkin_enabled": False})
    assert disabled.status_code == 200
    assert disabled.json()["daily_checkin_enabled"] is False


@pytest.mark.asyncio
async def test_daily_attendance_is_gated_and_requires_existing_admission(ctx):
    ctx.login(ctx.ids["user_a"])
    token, _ = await _prepare(ctx, enabled=False, admitted=True)
    disabled = await ctx.client.post(f"/api/scan/{token}/daily-attendance")
    assert disabled.status_code == 200
    assert disabled.json()["status"] == "daily_attendance_disabled"

    token, _ = await _prepare(ctx, enabled=True, admitted=False)
    not_admitted = await ctx.client.post(f"/api/scan/{token}/daily-attendance")
    assert not_admitted.status_code == 200
    assert not_admitted.json()["status"] == "event_checkin_required"


@pytest.mark.asyncio
async def test_daily_attendance_records_once_without_changing_admission(ctx):
    ctx.login(ctx.ids["user_a"])
    token, guest_id = await _prepare(ctx)

    first = await ctx.client.post(f"/api/scan/{token}/daily-attendance")
    assert first.status_code == 200
    assert first.json()["status"] == "daily_recorded"
    assert first.json()["attendance_date"] == datetime.utcnow().date().isoformat()

    repeated = await ctx.client.post(f"/api/scan/{token}/daily-attendance")
    assert repeated.status_code == 200
    assert repeated.json()["status"] == "already_recorded"

    async with _Session() as session:
        event = await session.get(Event, ctx.ids["event_a"])
        guest = await session.get(Guest, guest_id)
        records = (await session.execute(select(AttendanceRecord).where(
            AttendanceRecord.event_id == event.id,
            AttendanceRecord.guest_id == guest_id,
            AttendanceRecord.scope == "daily",
        ))).scalars().all()
        assert guest.admitted is True
        assert len(records) == 1


@pytest.mark.asyncio
async def test_daily_attendance_rejects_scans_outside_event_dates(ctx):
    ctx.login(ctx.ids["user_a"])
    token, _ = await _prepare(ctx, in_dates=False)
    result = await ctx.client.post(f"/api/scan/{token}/daily-attendance")
    assert result.status_code == 200
    assert result.json()["status"] == "outside_event_dates"
