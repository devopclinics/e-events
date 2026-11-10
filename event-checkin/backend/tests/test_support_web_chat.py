import uuid
from datetime import datetime,timedelta
import pytest
from sqlalchemy import select,func
from app.models import SupportWebChat,SupportAutomationConfig,SupportMessage
from app.services.support_answers import defaults
from conftest import _Session
P='/api/platform/support/chat'
async def session(ctx):
    r=await ctx.client.post(P+'/session');assert r.status_code==200,r.text
    return r.json(),{'Authorization':'Bearer '+r.json()['token']}
@pytest.mark.asyncio
async def test_approved_answers_private_sessions_and_deduplication(ctx):
    cfg=defaults();cfg['enabled']=True;cfg['profiles']=[dict(id='public',name='PAMCON',aliases=[],approved=True,answers={'venue':'The Event Center, Lagos.'}),dict(id='secret',name='Private event',approved=False,aliases=[],answers={'venue':'Hidden'})]
    async with _Session() as db:db.add(SupportAutomationConfig(id='main',payload=cfg,updated_by='test'));await db.commit()
    first,h=await session(ctx);second,other=await session(ctx)
    assert 'token' not in (await ctx.client.get(P+'/session',headers=h)).json()
    assert (await ctx.client.get(P+'/session')).status_code==401
    body={'body':'PAMCON venue','request_id':str(uuid.uuid4())}
    r=await ctx.client.post(P+'/messages',headers=h,json=body);assert r.status_code==200,r.text
    assert 'The Event Center' in r.text and 'Hidden' not in r.text
    repeated=await ctx.client.post(P+'/messages',headers=h,json=body);assert repeated.json()==r.json()
    assert len((await ctx.client.get(P+'/session',headers=other)).json()['messages'])==1
    async with _Session() as db:assert await db.scalar(select(func.count()).select_from(SupportMessage))==0
@pytest.mark.asyncio
async def test_management_only_two_way_handover_and_no_actor_leak(ctx):
    _,h=await session(ctx)
    await ctx.client.post(P+'/messages',headers=h,json={'body':'human','request_id':str(uuid.uuid4())})
    ctx.login(ctx.ids['user_a']);assert (await ctx.client.get(P+'/management')).status_code==403
    ctx.login(ctx.ids['superadmin']);rows=(await ctx.client.get(P+'/management')).json()['items'];assert len(rows)==1 and rows[0]['unread']
    ident=rows[0]['id'];assert (await ctx.client.get(P+'/management/'+ident)).status_code==200
    body={'body':'Our team is here.','request_id':str(uuid.uuid4())}
    r=await ctx.client.post(P+'/management/'+ident+'/reply',json=body);assert r.status_code==200,r.text
    assert (await ctx.client.post(P+'/management/'+ident+'/reply',json=body)).json()==r.json()
    visible=(await ctx.client.get(P+'/session',headers=h)).json();assert visible['mode']=='human' and visible['messages'][-1]['body']=='Our team is here.' and 'actor' not in str(visible)
    r=await ctx.client.post(P+'/messages',headers=h,json={'body':'Thank you','request_id':str(uuid.uuid4())});assert r.json()['messages'][-1]['role']=='customer'
@pytest.mark.asyncio
async def test_expired_chat_and_validation(ctx):
    _,h=await session(ctx)
    assert (await ctx.client.post(P+'/messages',headers=h,json={'body':' ','request_id':str(uuid.uuid4())})).status_code==422
    assert (await ctx.client.post(P+'/messages',headers=h,json={'body':'x'*1001,'request_id':str(uuid.uuid4())})).status_code==422
    async with _Session() as db:
        row=await db.scalar(select(SupportWebChat));row.expires_at=datetime.utcnow()-timedelta(seconds=1);await db.commit()
    assert (await ctx.client.get(P+'/session',headers=h)).status_code==401

@pytest.mark.asyncio
async def test_product_guidance_clarification_and_reference(ctx):
    async with _Session() as db:db.add(SupportAutomationConfig(id='main',payload={**defaults(),'enabled':True},updated_by='test'));await db.commit()
    first,h=await session(ctx)
    r=await ctx.client.post(P+'/messages',headers=h,json={'body':'What is Festio, and the difference between GuestHub, Festio Live and FestioMe?','request_id':str(uuid.uuid4())})
    assert r.status_code==200 and r.json()['mode']=='auto' and 'polls' in r.text and 'networking' in r.text
    r=await ctx.client.post(P+'/messages',headers=h,json={'body':'How do I create an event and arrange tables and seating?','request_id':str(uuid.uuid4())})
    assert r.json()['mode']=='auto' and '/setup-redesign?view=wizard' in r.text and 'seats per table' in r.text
    r=await ctx.client.post(P+'/messages',headers=h,json={'body':'Something unclear','request_id':str(uuid.uuid4())});assert r.json()['mode']=='auto' and 'Are you asking' in r.text
    r=await ctx.client.post(P+'/messages',headers=h,json={'body':'Still unclear','request_id':str(uuid.uuid4())});assert r.json()['mode']=='human' and r.json()['reference'].startswith('WEB-') and 'No response time' in r.text

@pytest.mark.asyncio
async def test_organiser_greeting_and_published_scope(ctx,monkeypatch):
    from app.routers import support_web_chat as web
    async with _Session() as db:db.add(SupportAutomationConfig(id='main',payload={**defaults(),'enabled':True,'profiles':[{'id':'wrong','name':'Other event','approved':True,'aliases':[],'answers':{'venue':'Wrong venue'}}]},updated_by='test'));await db.commit()
    async def published(slug):
        assert slug=='public-event'
        return {'id':'site-one','name':'Published event','approved':True,'aliases':[],'answers':{'venue':'Published Hall','time':'10 AM'}}
    monkeypatch.setattr(web,'published_profile',published)
    r=await ctx.client.post(P+'/session',json={'page':'organiser'});assert 'set up seating' in r.text
    r=await ctx.client.post(P+'/session',json={'page':'event','site_slug':'public-event'});h={'Authorization':'Bearer '+r.json()['token']}
    r=await ctx.client.post(P+'/messages',headers=h,json={'body':'Where is it?','request_id':str(uuid.uuid4())});assert 'Published Hall' in r.text and 'Wrong venue' not in r.text
    r=await ctx.client.post(P+'/messages',headers=h,json={'body':'my pass','request_id':str(uuid.uuid4())});assert r.json()['mode']=='human'
    assert (await ctx.client.post(P+'/session',json={'site_slug':'../private'})).status_code==422

@pytest.mark.asyncio
async def test_event_facts_outage_does_not_block_human_handover(ctx,monkeypatch):
    from app.routers import support_web_chat as web
    from fastapi import HTTPException
    async with _Session() as db:db.add(SupportAutomationConfig(id='main',payload={**defaults(),'enabled':True},updated_by='test'));await db.commit()
    async def published(slug):return {'id':'site-one','name':'Event','approved':True,'aliases':[],'answers':{'time':'10 AM'}}
    monkeypatch.setattr(web,'published_profile',published)
    r=await ctx.client.post(P+'/session',json={'site_slug':'one'});h={'Authorization':'Bearer '+r.json()['token']}
    async def unavailable(slug):raise HTTPException(503,'Published event information unavailable')
    monkeypatch.setattr(web,'published_profile',unavailable)
    r=await ctx.client.post(P+'/messages',headers=h,json={'body':'human','request_id':str(uuid.uuid4())});assert r.status_code==200 and r.json()['mode']=='human'

@pytest.mark.asyncio
@pytest.mark.parametrize('question',['What are the services offered by festio','What services do you offer?','Show me Festio features','What servcices does Festio provide?'])
async def test_services_overview_after_seating_in_event_chat(ctx,monkeypatch,question):
    from app.routers import support_web_chat as web
    async def initial_profile(_):return {'id':'site-one','name':'Example event','approved':True,'aliases':[],'answers':{'venue':'Example Hall'}}
    monkeypatch.setattr(web,'published_profile',initial_profile)
    async with _Session() as db:
        db.add(SupportAutomationConfig(id='main',payload={**defaults(),'enabled':True},updated_by='test'));await db.commit()
    r=await ctx.client.post(P+'/session',json={'page':'event','site_slug':'public-event'})
    h={'Authorization':'Bearer '+r.json()['token']}
    await ctx.client.post(P+'/messages',headers=h,json={'body':'How do I arrange tables and seating?','request_id':str(uuid.uuid4())})
    async def must_not_fetch(_):raise AssertionError('Product question must not retrieve event facts')
    monkeypatch.setattr(web,'published_profile',must_not_fetch)
    r=await ctx.client.post(P+'/messages',headers=h,json={'body':question,'request_id':str(uuid.uuid4())})
    assert r.status_code==200,r.text
    result=r.json();body=result['messages'][-1]['body']
    assert result['mode']=='auto'
    for feature in ['Invitations','QR check-in','Planner','Menu management','Messaging','Registry','Festio Live']:assert feature in body
    assert 'Are you asking' not in body and 'Do you already have an event?' not in body
    assert '/setup-redesign?view=wizard' in body
