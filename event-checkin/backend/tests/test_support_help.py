import uuid
import pytest
from app.services.support_help import CATALOG,find_help
from app.services.support_product_knowledge import product_answer
from app.services.support_answers import answer,defaults
from app.models import SupportAutomationConfig
from conftest import _Session

def test_public_help_is_shared_and_operator_material_excluded():
    assert CATALOG['source']=='frontend/src/guideContent.mjs'
    assert len(CATALOG['topics'])>50
    assert all(t['role'] in ['organizer','staff','guest'] and not t['id'].startswith('op-') for t in CATALOG['topics'])
    assert find_help('How do I import guests?')['id']=='org-guests'
    result=product_answer('How do I use the planner budget?')
    assert '/guide.html#org-planner' in result and 'Planner' in result
    assert '/guide.html#org-create' in product_answer('how do i create event')
    assert '/guide.html#org-seating' in product_answer('how do I arrange tables and seating')

def test_help_does_not_replace_personal_or_event_answers():
    cfg=defaults();cfg['profiles']=[dict(id='one',name='PAMCON',aliases=[],approved=True,answers={'programme':'The actual programme'})]
    body,_,mode=answer(cfg,{},'PAMCON programme');assert mode=='auto' and 'The actual programme' in body
    assert answer(cfg,{},'my seat')[2]=='human'
    assert find_help('delete event') is None

@pytest.mark.asyncio
async def test_explicit_resume_keeps_transcript_and_respects_pause(ctx):
    prefix='/api/platform/support/chat'
    async with _Session() as db:db.add(SupportAutomationConfig(id='main',payload={**defaults(),'enabled':True},updated_by='test'));await db.commit()
    created=await ctx.client.post(prefix+'/session');headers={'Authorization':'Bearer '+created.json()['token']}
    response=await ctx.client.post(prefix+'/messages',headers=headers,json={'body':'human','request_id':str(uuid.uuid4())});assert response.json()['mode']=='human';count=len(response.json()['messages']);reference=response.json()['reference']
    assert (await ctx.client.post(prefix+'/automation')).status_code==401
    resumed=await ctx.client.post(prefix+'/automation',headers=headers);assert resumed.json()['mode']=='auto' and resumed.json()['reference']==reference and len(resumed.json()['messages'])==count+1
    again=await ctx.client.post(prefix+'/automation',headers=headers);assert len(again.json()['messages'])==count+1
    reply=await ctx.client.post(prefix+'/messages',headers=headers,json={'body':'how do i create event','request_id':str(uuid.uuid4())});assert reply.json()['mode']=='auto' and '/guide.html#org-create' in reply.text
    async with _Session() as db:
        row=await db.get(SupportAutomationConfig,'main');row.payload={**row.payload,'enabled':False};await db.commit()
    assert (await ctx.client.post(prefix+'/automation',headers=headers)).status_code==409
