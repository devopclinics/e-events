from datetime import datetime
import pytest
from sqlalchemy import select
from fastapi import BackgroundTasks
from conftest import _Session
from app.models import Event, Guest
from app.routers.scanner import perform_admission

@pytest.mark.asyncio
async def test_public_pass_keeps_event_timezone_and_duplicate_admission_is_labeled(ctx):
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a'])
        event.timezone='Africa/Lagos';event.event_date=datetime(2027,2,15,9)
        guest=(await db.execute(select(Guest).where(Guest.event_id==event.id))).scalars().first()
        guest.rsvp_status='confirmed';guest.admitted=True;guest.admitted_at=datetime(2027,2,15,9,5)
        await db.commit();token=guest.qr_token
        result=await perform_admission(guest,event,BackgroundTasks(),db)
        assert result.status=='already_admitted'
        assert '10:05 AM WAT' in result.message
        assert '15 Feb 2027' in result.message
    response=await ctx.client.get(f'/api/scan/{token}/ticket')
    assert response.status_code==200
    assert response.json()['event']['timezone']=='Africa/Lagos'
    assert response.json()['event']['event_date'].startswith('2027-02-15T09:00')
