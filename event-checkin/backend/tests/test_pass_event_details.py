import pytest
from sqlalchemy import select
from app.models import Event, Guest
from conftest import _Session


@pytest.mark.asyncio
async def test_ticket_exposes_event_timezone_and_venue_without_checking_guest_in(ctx):
    async with _Session() as db:
        event = await db.get(Event, ctx.ids['event_a'])
        event.timezone = 'Africa/Lagos'
        event.venue_name = 'The Event Center'
        event.venue_address = 'Agidingbi, Lagos'
        guest = await db.scalar(select(Guest).where(Guest.event_id == event.id))
        token = guest.qr_token
        await db.commit()
    response = await ctx.client.get(f'/api/scan/{token}/ticket')
    assert response.status_code == 200
    data = response.json()
    assert data['event']['timezone'] == 'Africa/Lagos'
    assert data['event']['venue_name'] == 'The Event Center'
    assert data['event']['venue_address'] == 'Agidingbi, Lagos'
    assert data['status'] == 'valid' and not data['guest']['admitted']
    invalid = await ctx.client.get('/api/scan/not-a-pass/ticket')
    assert invalid.json()['status'] == 'invalid'
