"""Check-in queues real-world-action gamification credit for FestioMe, via
the same outbox pattern as guest sync/announcements — see
app/services/festiome_outbox.py::queue_points_award and its call site in
routers/scanner.py::perform_admission."""
import pytest
from sqlalchemy import select

from conftest import _Session
from app.models import Event, FestioMeOutbox, Guest


async def _confirmed_guest(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        ev.status = "active"
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        guest.rsvp_status = "confirmed"
        await s.commit()
        return guest.id, guest.qr_token


@pytest.mark.asyncio
async def test_checkin_queues_exactly_one_points_award(ctx):
    ctx.login(ctx.ids["user_a"])
    guest_id, token = await _confirmed_guest(ctx)

    scan = await ctx.client.post(f"/api/scan/{token}")
    assert scan.status_code == 200
    assert scan.json()["status"] == "admitted"

    async with _Session() as s:
        rows = (await s.execute(select(FestioMeOutbox).where(
            FestioMeOutbox.command == "points.award"))).scalars().all()
    assert len(rows) == 1
    assert rows[0].payload["guest_ref"] == guest_id
    assert rows[0].payload["reason"] == "event_checked_in"
    assert rows[0].payload["points"] == 15


@pytest.mark.asyncio
async def test_rescan_does_not_double_queue_points(ctx):
    ctx.login(ctx.ids["user_a"])
    guest_id, token = await _confirmed_guest(ctx)

    first = await ctx.client.post(f"/api/scan/{token}")
    assert first.json()["status"] == "admitted"
    second = await ctx.client.post(f"/api/scan/{token}")
    assert second.json()["status"] == "already_admitted"

    async with _Session() as s:
        rows = (await s.execute(select(FestioMeOutbox).where(
            FestioMeOutbox.command == "points.award"))).scalars().all()
    assert len(rows) == 1
