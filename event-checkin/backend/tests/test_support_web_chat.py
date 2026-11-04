import uuid
from datetime import datetime,timedelta
import pytest
from sqlalchemy import select,func
from app.models import SupportWebChat,SupportAutomationConfig,SupportMessage
from app.services.support_answers import defaults
from conftest import _Session
P='/api/support/chat'
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
