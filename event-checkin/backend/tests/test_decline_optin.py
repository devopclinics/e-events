"""Decline/rejection notices are opt-in: silent unless notify_rsvp_responses is on."""
import pytest
from sqlalchemy import delete

from app.models import Event, Guest
from app.routers import guests as guests_mod
from conftest import _Session


async def _event(event_id, *, notify_responses):
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.notify_email = True
        ev.notify_rsvp_responses = notify_responses
        await s.execute(delete(Guest).where(Guest.event_id == event_id))
        await s.commit()


def _capture_email(monkeypatch):
    calls = []
    async def fake(to, subject, html, *args, **kwargs):
        calls.append((to, subject))
    monkeypatch.setattr(guests_mod, "send_simple_email", fake)
    return calls


@pytest.mark.asyncio
async def test_reject_silent_when_off(ctx, monkeypatch):
    await _event(ctx.ids["event_a"], notify_responses=False)   # default
    calls = _capture_email(monkeypatch)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    g = (await ctx.client.post(f"/api/events/{ev}/guests",
         json={"first_name": "Dee", "last_name": "Klein", "email": "dee@x.com"})).json()

    r = await ctx.client.post(f"/api/events/{ev}/guests/{g['id']}/reject")
    assert r.status_code == 200
    assert calls == []                                          # nothing sent


@pytest.mark.asyncio
async def test_reject_notifies_when_on(ctx, monkeypatch):
    await _event(ctx.ids["event_a"], notify_responses=True)
    calls = _capture_email(monkeypatch)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    g = (await ctx.client.post(f"/api/events/{ev}/guests",
         json={"first_name": "Dee", "last_name": "Klein", "email": "dee@x.com"})).json()

    r = await ctx.client.post(f"/api/events/{ev}/guests/{g['id']}/reject")
    assert r.status_code == 200
    assert len(calls) == 1 and calls[0][0] == "dee@x.com"      # rejection notice sent
