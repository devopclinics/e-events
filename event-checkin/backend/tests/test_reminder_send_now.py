from datetime import datetime,timedelta
import pytest
from sqlalchemy import select
from conftest import _Session
from app.models import Event,EventReminder,Guest,EventReminderSend

async def prep(ctx):
    ctx.login(ctx.ids['superadmin'])
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.reminders_enabled=True;event.notify_email=True;event.is_paid=True
        guest=await db.scalar(select(Guest).where(Guest.event_id==event.id));guest.rsvp_status='confirmed'
        db.add(Guest(event_id=event.id,first_name='QA',last_name='Guest',email='qa@example.com',is_test=True,rsvp_status='confirmed'))
        row=EventReminder(event_id=event.id,label='Draft',fire_at_utc=datetime.utcnow()+timedelta(days=1),enabled=False,channels=['email'],subject='Hello',email_body='Hello {{first_name}}',audience_rsvp_statuses=['confirmed'])
        db.add(row);await db.commit();return event.id,row.id,guest.id

@pytest.mark.asyncio
async def test_summary_then_queue_once_and_lock_edits(ctx):
    eid,rid,gid=await prep(ctx);base=f'/api/events/{eid}/reminders/{rid}'
    summary=await ctx.client.get(base+'/send-summary');assert summary.status_code==200,summary.text
    data=summary.json();assert data['audience']==1 and data['channels']=={'email':1} and data['excluded_test_guests']==1
    async with _Session() as db:
        assert not (await db.get(EventReminder,rid)).enabled
        assert not (await db.scalars(select(EventReminderSend))).all()
    response=await ctx.client.post(base+'/send-now',json={'confirmation_token':data['confirmation_token']});assert response.status_code==202,response.text
    assert (await ctx.client.post(base+'/send-now',json={'confirmation_token':data['confirmation_token']})).status_code==409
    assert (await ctx.client.put(base,json={'subject':'Changed'})).status_code==409
    assert (await ctx.client.delete(base)).status_code==409
    progress=await ctx.client.get(base+'/send-progress');assert progress.status_code==200 and progress.json()['processed']==0

@pytest.mark.asyncio
async def test_changed_audience_requires_new_confirmation(ctx):
    eid,rid,gid=await prep(ctx);base=f'/api/events/{eid}/reminders/{rid}'
    token=(await ctx.client.get(base+'/send-summary')).json()['confirmation_token']
    async with _Session() as db:
        g=await db.get(Guest,gid);g.email='changed@example.com';await db.commit()
    response=await ctx.client.post(base+'/send-now',json={'confirmation_token':token});assert response.status_code==409,response.text
    async with _Session() as db:assert not (await db.get(EventReminder,rid)).enabled

@pytest.mark.asyncio
async def test_cross_event_access_denied(ctx):
    eid,rid,_=await prep(ctx);ctx.login(ctx.ids['user_b'])
    base=f'/api/events/{eid}/reminders/{rid}'
    assert (await ctx.client.get(base+'/send-summary')).status_code==404
    assert (await ctx.client.post(base+'/send-now',json={'confirmation_token':'anything'})).status_code==404
    assert (await ctx.client.get(base+'/send-progress')).status_code==404

@pytest.mark.asyncio
async def test_failed_progress_keeps_accepted_channel(ctx):
    eid,rid,gid=await prep(ctx)
    async with _Session() as db:
        db.add(EventReminderSend(reminder_id=rid,guest_id=gid,channels_sent=['email'],error='WhatsApp was not accepted'))
        await db.commit()
    p=(await ctx.client.get(f'/api/events/{eid}/reminders/{rid}/send-progress')).json()
    assert p['accepted_guests']==1 and p['channels_accepted']['email']==1 and len(p['failures'])==1

@pytest.mark.asyncio
async def test_bulk_receipt_preserves_email_when_whatsapp_rejected(monkeypatch):
    from types import SimpleNamespace as NS
    from unittest.mock import AsyncMock
    from app.services import reminder_send as sender
    monkeypatch.setattr(sender,'build_context',lambda *a,**k:{'first_name':'Ada'})
    monkeypatch.setattr(sender,'_reminder_extras',lambda *a:{})
    monkeypatch.setattr(sender,'can_use_paid_channels',lambda e:True)
    monkeypatch.setattr(sender,'reserve_message_credit',AsyncMock(return_value=True))
    monkeypatch.setattr(sender,'send_simple_email',AsyncMock(return_value=True))
    monkeypatch.setattr(sender,'last_credit_ledger_id',lambda e:'reservation')
    receipt=AsyncMock(return_value={'provider_message_id':'id','status':'failed'})
    monkeypatch.setattr(sender.messaging,'send_custom_template_whatsapp',receipt)
    db=NS(commit=AsyncMock())
    async def ledger(_id,send_func,**kwargs):
        db.commit.assert_awaited_once()
        await send_func(**kwargs)
    monkeypatch.setattr(sender,'send_with_credit_ledger',ledger)
    e=NS(id='event',blocked_messaging_channels=[],notify_email=True,notify_whatsapp=True)
    r=NS(id='draft',channels=['email','whatsapp'],email_body='Hello',subject='Hello',whatsapp_body=None,whatsapp_template_ref='p:v',whatsapp_template_vars={'firstName':'{{first_name}}'})
    g=NS(id='guest',email='guest@example.com',phone='+18327941707',whatsapp_consent=True)
    result=await sender._send_to_guest(e,r,g,db)
    assert result==['email'] and r._last_channel_errors==['Whatsapp was not accepted by the provider']
