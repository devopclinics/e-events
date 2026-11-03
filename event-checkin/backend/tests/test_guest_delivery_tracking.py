from datetime import datetime, timedelta
import pytest
from sqlalchemy import select
from app.models import Guest,Event,EmailDeliveryEvent,EventMessageDeliveryLog,MessageCreditLedger
from app.routers import guests as routes
from app.services.guest_delivery import state
from conftest import _Session

@pytest.mark.parametrize('raw,expected',[('sent','accepted'),('posted','unknown'),('delivered','delivered'),('read','read'),('queued','pending'),('failed','failed'),('refunded','unknown')])
def test_status_is_evidence_not_assumed_delivery(raw,expected): assert state(raw)==expected

async def fixture(ctx):
 ctx.login(ctx.ids['superadmin'])
 async with _Session() as db:
  e=await db.get(Event,ctx.ids['event_a']);e.notify_whatsapp=True;e.notify_email=True
  g=await db.scalar(select(Guest).where(Guest.event_id==e.id));g.phone=None;g.email='delivery@example.invalid';g.qr_generated_at=datetime.utcnow()
  db.add(EmailDeliveryEvent(event_id=e.id,guest_id=g.id,recipient=g.email,event_type='email.delivered',status='delivered',message_kind='ticket_qr',occurred_at=datetime.utcnow()-timedelta(minutes=2)))
  db.add(EventMessageDeliveryLog(event_id=e.id,guest_id=g.id,channel='whatsapp',status='skipped',error_message='Missing phone number'))
  await db.commit();return e.id,g.id

@pytest.mark.asyncio
async def test_channel_independence_history_and_partition(ctx):
 e,g=await fixture(ctx)
 result=await ctx.client.get(f'/api/events/{e}/guests/delivery-summary');assert result.status_code==200,result.text
 data=result.json();row=next(r for r in data['guests'] if r['id']==g)
 assert row['channels']['email']['status']=='delivered'
 assert row['channels']['whatsapp']['status']=='skipped'
 assert row['channels']['sms']['status']=='not_attempted'
 for values in data['counts'].values():assert sum(values.values())==data['total']
 result=await ctx.client.get(f'/api/events/{e}/guests/{g}/delivery-history');assert result.status_code==200
 assert {r['channel'] for r in result.json()['records']}=={'email','whatsapp'}
 async with _Session() as db:
  other=Event(org_id=ctx.ids['org_b'],name='Other',couples_name='Other',event_date=datetime.utcnow(),checkin_base_url='http://test');db.add(other);await db.commit();other_id=other.id
 result=await ctx.client.get(f'/api/events/{other_id}/guests/{g}/delivery-history');assert result.status_code==404

@pytest.mark.asyncio
async def test_missing_phone_retry_is_preview_only_and_cannot_send(ctx):
 e,g=await fixture(ctx);root=f'/api/events/{e}/guests/{g}/retry-channel'
 result=await ctx.client.post(root,json={'channel':'whatsapp'});assert result.status_code==200
 assert not result.json()['eligible'] and result.json()['reason']=='Missing phone number'
 result=await ctx.client.post(root,json={'channel':'whatsapp','preview':False});assert result.status_code==409
 result=await ctx.client.post(root,json={'channel':'invalid'});assert result.status_code==400

@pytest.mark.asyncio
async def test_retry_limits_actual_dispatch_to_selected_channel(ctx,monkeypatch):
 e,g=await fixture(ctx);sent=[]
 async def email(*args,**kw):sent.append('email');return True
 monkeypatch.setattr(routes,'send_invite_email',email)
 monkeypatch.setattr(routes,'channels_for_flow',lambda *a,**kw:{'email','sms','whatsapp','mms'})
 monkeypatch.setattr(routes,'_invite_recipients_allowed',lambda *a,**kw:True)
 response=await ctx.client.post(f'/api/events/{e}/guests/{g}/retry-channel',json={'channel':'email','preview':False})
 assert response.status_code==200,response.text
 assert response.json()['channel']=='email' and sent==['email']

@pytest.mark.asyncio
async def test_refund_does_not_invent_delivery_failure(ctx):
 e,g=await fixture(ctx)
 async with _Session() as db:
  event=await db.get(Event,e)
  db.add(MessageCreditLedger(event_id=e,org_id=event.org_id,guest_id=g,channel='sms',action='refund',status='refunded',reason='reconciliation'))
  await db.commit()
 result=await ctx.client.get(f'/api/events/{e}/guests/delivery-summary')
 row=next(r for r in result.json()['guests'] if r['id']==g)
 assert row['channels']['sms']['status']=='unknown'

@pytest.mark.asyncio
async def test_other_organization_access_denied(ctx):
 e,g=await fixture(ctx);ctx.login(ctx.ids['user_b'])
 for path in [f'/api/events/{e}/guests/delivery-summary',f'/api/events/{e}/guests/{g}/delivery-history']:
  response=await ctx.client.get(path);assert response.status_code in (401,403,404)

@pytest.mark.asyncio
async def test_priority_policy_does_not_create_false_pending_channel(ctx,monkeypatch):
 from fastapi import BackgroundTasks
 e,g=await fixture(ctx)
 async def dispatch(*args,**kwargs):return True
 monkeypatch.setattr(routes,'_dispatch_invite_impl',dispatch)
 monkeypatch.setattr(routes,'channels_for_flow',lambda *a,**kw:{'email'})
 async with _Session() as db:
  event=await db.get(Event,e);guest=await db.get(Guest,g);guest.phone='+15555550111';guest.whatsapp_consent=True
  await routes._dispatch_invite(BackgroundTasks(),event,guest,db)
  await db.commit()
 result=await ctx.client.get(f'/api/events/{e}/guests/delivery-summary')
 row=next(r for r in result.json()['guests'] if r['id']==g)
 assert row['channels']['whatsapp']['status']=='not_selected'
 assert row['channels']['email']['prior_delivery_at']
