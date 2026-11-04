import uuid
from datetime import datetime,timedelta
import httpx,pytest
from sqlalchemy import select,func
from app.config import settings
from app.models import SupportAutomationConfig as Config,SupportAutomationState as State,SupportAutomationJob as Job,SupportConversation,SupportMessage
from app.services import support_automation as auto,support_whatsapp as transport
from app.services.support_answers import answer,defaults
from conftest import _Session
P='/api/platform/support/whatsapp';CHANNEL='11111111-1111-4111-8111-111111111111'
def cfg():
 d=defaults();d['enabled']=True;d['profiles']=[dict(id='pamcon',name='PAMCON 6.0',aliases=['PAMCON'],approved=True,answers={'time':'11 November 2026. Conference 10 AM. Gala 4 PM.','venue':'The Event Center, Agidingbi, Lagos.','registration':'Register on the approved public website.','programme':'','dress':''}),dict(id='private',name='Private board meeting',aliases=[],approved=False,answers={'venue':'Secret location'})];return d
def incoming(text='PAMCON where',**kw):
 d=dict(id=str(uuid.uuid4()),channelId=CHANNEL,direction='incoming',createdAt=datetime.utcnow().isoformat()+'Z',sender={'contact':{'identifierValue':'+18320000000'}},body={'type':'text','text':{'text':text}});d.update(kw);return d
@pytest.fixture(autouse=True)
def guards(monkeypatch):
 monkeypatch.setattr(settings,'support_whatsapp_enabled',True);monkeypatch.setattr(settings,'bird_whatsapp_channel_id',CHANNEL);monkeypatch.setattr(settings,'outbound_recipient_safety_enabled',False)
async def configure():
 async with _Session() as db:db.add(Config(id='main',payload=cfg(),updated_by='test'));await db.commit()
async def queue(m):
 async with _Session() as db:
  await transport.ingest(db,m);await auto.enqueue(db,m['id']);await db.commit();return await db.scalar(select(SupportConversation.id))
def test_selection_and_approved_snapshot_only():
 body,ctx,mode=answer(cfg(),{},'Hi');assert 'PAMCON' in body and 'Private board' not in body and mode=='auto'
 _,ctx,_=answer(cfg(),ctx,'1');body,_,_=answer(cfg(),ctx,'where is it?');assert 'Agidingbi' in body and 'Secret' not in body
 body,_,_=answer(cfg(),{},'PAMCON time');assert '10 AM' in body and '4 PM' in body and '3 PM' not in body
@pytest.mark.parametrize('question',['human','my pass','my seat','payment status','unknown question','PAMCON programme'])
def test_personal_or_unknown_questions_handover(question):assert answer(cfg(),{'event':'pamcon'},question)[2]=='human'
def test_ambiguous_and_malformed_preview_context():
 d=cfg();d['profiles'].append(dict(id='other',name='Another event',aliases=[],approved=True,answers={'time':'Another time'}))
 body,_,_=answer(d,{'event':{'bad':True}},'Hi');assert '1.' in body and '2.' in body
 body,_,_=answer(d,{},'PAMCON and Another event');assert 'Reply with the event' in body
@pytest.mark.asyncio
async def test_config_auth_version_and_public_projection(ctx):
 ctx.login(ctx.ids['user_a']);assert (await ctx.client.get(P+'/automation/settings')).status_code==403
 assert (await ctx.client.put(P+'/automation/settings',json={'settings':cfg(),'version':0})).status_code==403
 ctx.login(ctx.ids['superadmin']);r=await ctx.client.put(P+'/automation/settings',json={'settings':cfg(),'version':0});assert r.status_code==200,r.text
 assert (await ctx.client.put(P+'/automation/settings',json={'settings':cfg(),'version':0})).status_code==409
 assert set((await ctx.client.get(P+'/contact')).json())=={'heading','intro','message'}
 r=await ctx.client.post(P+'/automation/preview',json={'settings':cfg(),'text':'PAMCON venue'});assert r.status_code==200 and r.json()['sent'] is False
 async with _Session() as db:assert await db.scalar(select(func.count()).select_from(SupportMessage))==0
@pytest.mark.asyncio
async def test_history_never_enqueues_and_webhook_queue_unique(ctx):
 await configure();m=incoming()
 async with _Session() as db:
  await transport.ingest(db,m);await db.commit();assert await db.scalar(select(func.count()).select_from(Job))==0
  await auto.enqueue(db,m['id']);await auto.enqueue(db,m['id']);await db.commit();assert await db.scalar(select(func.count()).select_from(Job))==1
@pytest.mark.asyncio
async def test_send_once_with_automated_label(ctx,monkeypatch):
 await configure();await queue(incoming());calls=[]
 async def bird(*a,**kw):calls.append(kw);return httpx.Response(202,json={'id':str(uuid.uuid4()),'status':'accepted'})
 monkeypatch.setattr(transport,'bird',bird)
 async with _Session() as db:
  assert await auto.process_one(db);assert not await auto.process_one(db)
  rows=(await db.scalars(select(SupportMessage).where(SupportMessage.direction=='outgoing'))).all();assert len(rows)==1 and rows[0].kind=='automation' and rows[0].sent_by=='automation' and 'Agidingbi' in rows[0].body
 assert len(calls)==1
@pytest.mark.asyncio
async def test_human_pause_and_resume(ctx,monkeypatch):
 await configure();ident=await queue(incoming('human'));calls=[]
 async def bird(*a,**kw):calls.append(kw);return httpx.Response(202,json={'id':str(uuid.uuid4())})
 monkeypatch.setattr(transport,'bird',bird)
 async with _Session() as db:await auto.process_one(db);assert (await db.get(State,ident)).mode=='human'
 await queue(incoming('PAMCON where'))
 async with _Session() as db:await auto.process_one(db)
 assert len(calls)==1
 ctx.login(ctx.ids['superadmin']);assert (await ctx.client.put(P+'/conversations/'+ident+'/automation',json={'mode':'auto'})).status_code==200
 await queue(incoming())
 async with _Session() as db:await auto.process_one(db)
 assert len(calls)==2
@pytest.mark.asyncio
async def test_unknown_provider_outcome_not_retried(ctx,monkeypatch):
 await configure();await queue(incoming())
 async def bird(*a,**kw):raise TimeoutError()
 monkeypatch.setattr(transport,'bird',bird)
 async with _Session() as db:
  await auto.process_one(db);assert not await auto.process_one(db);m=await db.scalar(select(SupportMessage).where(SupportMessage.direction=='outgoing'));assert m.status=='unknown'
@pytest.mark.asyncio
async def test_stale_and_recipient_guard(ctx,monkeypatch):
 await configure();await queue(incoming(createdAt=(datetime.utcnow()-timedelta(hours=2)).isoformat()+'Z'))
 async with _Session() as db:assert await db.scalar(select(func.count()).select_from(Job))==0
 await queue(incoming());monkeypatch.setattr(auto,'recipient_allowed',lambda *a:False)
 async with _Session() as db:await auto.process_one(db);assert await db.scalar(select(func.count()).select_from(SupportMessage).where(SupportMessage.direction=='outgoing'))==0
@pytest.mark.asyncio
async def test_manual_reply_pauses_automation(ctx,monkeypatch):
 await configure();ident=await queue(incoming())
 async def bird(*a,**kw):return httpx.Response(202,json={'id':str(uuid.uuid4())})
 monkeypatch.setattr(transport,'bird',bird);ctx.login(ctx.ids['superadmin']);r=await ctx.client.post(P+'/conversations/'+ident+'/reply',json={'body':'A teammate is helping you.','request_id':str(uuid.uuid4())});assert r.status_code==200,r.text
 async with _Session() as db:
  assert (await db.get(State,ident)).mode=='human';await auto.process_one(db);assert await db.scalar(select(func.count()).select_from(SupportMessage).where(SupportMessage.sent_by=='automation'))==0

@pytest.mark.asyncio
async def test_global_disable_and_rate_limit_still_handover(ctx,monkeypatch):
 await configure();ident=await queue(incoming('human'))
 async with _Session() as db:
  for n in range(3):db.add(SupportMessage(conversation_id=ident,direction='outgoing',body='Prior automatic reply',kind='automation',status='delivered',sent_by='automation',occurred_at=datetime.utcnow()))
  await db.commit();await auto.process_one(db)
  assert (await db.get(State,ident)).mode=='human'
  assert (await db.scalar(select(Job))).status=='rate-limited'
  config=await db.get(Config,'main');config.payload={**config.payload,'enabled':False};await db.commit()
  m=incoming();await transport.ingest(db,m);await auto.enqueue(db,m['id']);await db.commit()
  assert await db.scalar(select(func.count()).select_from(Job))==1

@pytest.mark.asyncio
async def test_event_team_cannot_preview_or_change_conversation_mode(ctx):
 ident=await queue(incoming())
 ctx.login(ctx.ids['user_a'])
 assert (await ctx.client.post(P+'/automation/preview',json={'settings':cfg(),'text':'Hi'})).status_code==403
 assert (await ctx.client.put(P+'/conversations/'+ident+'/automation',json={'mode':'auto'})).status_code==403

@pytest.mark.asyncio
async def test_unapproved_event_and_missing_answers_never_shared_after_edit(ctx):
 d=cfg();d['profiles'][0]['approved']=False
 body,_,mode=answer(d,{'event':'pamcon'},'where')
 assert mode=='human' and 'Agidingbi' not in body
 ctx.login(ctx.ids['superadmin']);d=cfg();d['profiles'].append({**d['profiles'][0],'id':'duplicate-name'})
 assert (await ctx.client.put(P+'/automation/settings',json={'settings':d,'version':0})).status_code==422

@pytest.mark.asyncio
async def test_verified_webhook_creates_only_one_job(ctx,monkeypatch):
 await configure();m=incoming('PAMCON time');monkeypatch.setattr(transport,'verify_signature',lambda *a:None)
 async def bird(method,path,**kwargs):assert method=='GET';return httpx.Response(200,json=m)
 monkeypatch.setattr(transport,'bird',bird)
 for _ in range(2):assert (await ctx.client.post(P+'/bird',json={'id':m['id']})).status_code==204
 async with _Session() as db:assert await db.scalar(select(func.count()).select_from(Job))==1

@pytest.mark.asyncio
async def test_resuming_does_not_reply_to_messages_queued_before_handover(ctx,monkeypatch):
 await configure();ident=await queue(incoming())
 ctx.login(ctx.ids['superadmin'])
 for mode in ['human','auto']:assert (await ctx.client.put(P+'/conversations/'+ident+'/automation',json={'mode':mode})).status_code==200
 async def forbidden(*a,**kw):raise AssertionError('Old question must not be sent after resume')
 monkeypatch.setattr(transport,'bird',forbidden)
 async with _Session() as db:
  await auto.process_one(db)
  assert await db.scalar(select(func.count()).select_from(SupportMessage).where(SupportMessage.direction=='outgoing'))==0

@pytest.mark.asyncio
async def test_enabling_does_not_replay_recent_old_incoming_messages(ctx):
 m=incoming()
 async with _Session() as db:await transport.ingest(db,m);await db.commit()
 await configure()
 async with _Session() as db:
  await auto.enqueue(db,m['id']);await db.commit()
  assert await db.scalar(select(func.count()).select_from(Job))==0
