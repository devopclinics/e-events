import uuid
import pytest
from app.services.support_answers import answer,defaults
from app.models import SupportAutomationConfig
from conftest import _Session
P='/api/platform/support/chat'
def test_topic_followup_price_and_typo():
 cfg=defaults();cfg['enabled']=True
 _,ctx,mode=answer(cfg,{},'How do I create an event and arrange tables and seating?');assert mode=='auto'
 body,ctx,mode=answer(cfg,ctx,'Yes, I already have an event. What should I do next?');assert mode=='auto' and 'existing event' in body and 'Create tables' in body and 'organising an event, or attending' not in body
 body,ctx,mode=answer(cfg,ctx,'What is the exact seating price for 500 Nigerian guests?');assert mode=='auto' and 'exact NGN price' in body and '500 guests' in body and '/pricing' in body and 'To arrange seating' not in body and '₦' not in body
 body,_,mode=answer(cfg,ctx,'how d i create an evevnt');assert mode=='auto' and '/setup-redesign?view=wizard' in body

@pytest.mark.asyncio
async def test_unscoped_named_event_selection_and_missing_event(ctx,monkeypatch):
 from app.routers import support_web_chat as web
 async with _Session() as db:db.add(SupportAutomationConfig(id='main',payload={**defaults(),'enabled':True},updated_by='test'));await db.commit()
 async def directory(text):return [{'slug':'qa-a','name':'QA Event A'},{'slug':'qa-b','name':'QA Event B'}] if 'QA' in text else []
 async def facts(slug):return dict(id='site-'+slug,name='QA Event '+slug[-1].upper(),approved=True,aliases=[],answers={'time':'11 November, 10 AM','venue':'Hall '+slug[-1].upper()})
 monkeypatch.setattr(web,'find_published_events',directory);monkeypatch.setattr(web,'published_profile',facts)
 r=await ctx.client.post(P+'/session');h={'Authorization':'Bearer '+r.json()['token']}
 async def send(text):return (await ctx.client.post(P+'/messages',headers=h,json={'body':text,'request_id':str(uuid.uuid4())})).json()
 r=await send('What are the date and venue for QA Event?');assert r['mode']=='auto' and 'Which published event' in r['messages'][-1]['body']
 r=await send('2');assert r['mode']=='auto' and 'Hall B' in r['messages'][-1]['body'] and '10 AM' in r['messages'][-1]['body'] and 'Hall A' not in r['messages'][-1]['body']
 # A new unknown event gets a name/link clarification, even after earlier clarification.
 r=await ctx.client.post(P+'/session');h={'Authorization':'Bearer '+r.json()['token']}
 r=await send('When and where is the event?');assert r['mode']=='auto' and 'event name' in r['messages'][-1]['body']
 r=await send('QA Event');assert r['mode']=='auto' and 'Which published event' in r['messages'][-1]['body']
 r=await send('1');assert 'Hall A' in r['messages'][-1]['body'] and '10 AM' in r['messages'][-1]['body']
