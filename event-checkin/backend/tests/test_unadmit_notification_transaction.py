"""Corrective notifications must not retain the wallet lock into dispatch."""
import pytest
from sqlalchemy import select
from conftest import _Session
from app.models import Guest, Organization
from app.routers import guests

@pytest.mark.asyncio
@pytest.mark.parametrize('notify', [True, False])
async def test_unadmit_commits_notification_reservations_before_background_dispatch(ctx, monkeypatch, notify):
    ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        guest = await db.scalar(select(Guest).where(Guest.event_id == ctx.ids['event_a']))
        guest.admitted = True
        org = await db.get(Organization, ctx.ids['org_a'])
        org.message_credit_units = 100
        await db.commit()
        guest_id = guest.id
    reservations = []
    deliveries = []
    monkeypatch.setattr(guests, 'channels_for_flow', lambda *a, **kw: ['email','sms','whatsapp'])
    async def reserve(event, channel, *, db, guest_id):
        org = await db.get(Organization, event.org_id)
        org.message_credit_units -= 5
        await db.flush()
        reservations.append(db)
        return True
    async def delivered(*args, **kwargs):
        # The request's transaction must release its wallet lock BEFORE a
        # notification opens a separate connection to meter/send the email.
        assert all(not db.in_transaction() for db in reservations)
        async with _Session() as db:
            org = await db.get(Organization, ctx.ids['org_a'])
            assert org.message_credit_units == 90
        deliveries.append(True)
    monkeypatch.setattr(guests, 'reserve_message_credit', reserve)
    monkeypatch.setattr(guests, 'send_simple_email', delivered)
    monkeypatch.setattr(guests, 'send_with_credit_ledger', delivered)
    # Both paid channels need a contact number to be considered.
    async with _Session() as db:
        g = await db.get(Guest, guest_id); g.phone = '+2348000000000'; await db.commit()
    response = await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/guests/{guest_id}/unadmit", json={'notify': notify})
    assert response.status_code == 200, response.text
    assert response.json()['admitted'] is False
    assert len(deliveries) == (3 if notify else 0)
    async with _Session() as db:
        assert (await db.get(Organization, ctx.ids['org_a'])).message_credit_units == (90 if notify else 100)
