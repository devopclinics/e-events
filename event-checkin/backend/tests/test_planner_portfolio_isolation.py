from datetime import datetime
import jwt
import pytest
from app.models import Event, EventUser, Membership, Organization
from app.config import settings
from conftest import _Session

async def seed(ctx):
    async with _Session() as db:
        own=await db.get(Event,ctx.ids['event_a']);own.planner_enabled=True
        other=Event(org_id=ctx.ids['org_b'],name='Other account private event',couples_name='',event_date=datetime(2026,12,1),checkin_base_url='http://test',planner_enabled=True)
        db.add(other);await db.commit();return own.id,other.id

@pytest.mark.asyncio
async def test_portfolio_is_personal_even_for_platform_operator(ctx):
    own,other=await seed(ctx)
    for user_id,expected in [('user_a',{own}),('user_b',{other}),('superadmin',set())]:
        ctx.login(ctx.ids[user_id]);r=await ctx.client.get('/api/events/me/planner-events');assert r.status_code==200;assert {e['id'] for e in r.json()}==expected
    # The existing support selector remains broad; portfolio is deliberately narrower.
    assert other in {e['id'] for e in (await ctx.client.get('/api/events')).json()}
    async with _Session() as db:
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=ctx.ids['superadmin'].id,role='admin'));await db.commit()
    assert {e['id'] for e in (await ctx.client.get('/api/events/me/planner-events')).json()}=={own}

@pytest.mark.asyncio
async def test_explicit_planner_assignments_are_required(ctx):
    own,other=await seed(ctx);ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        link=EventUser(event_id=other,user_id=ctx.ids['user_a'].id);db.add(link);await db.commit();link_id=link.id
    assert {e['id'] for e in (await ctx.client.get('/api/events/me/planner-events')).json()}=={own}
    async with _Session() as db:
        link=await db.get(EventUser,link_id);link.can_view_planner=True;await db.commit()
    assert {e['id'] for e in (await ctx.client.get('/api/events/me/planner-events')).json()}=={own,other}
    async with _Session() as db:
        link=await db.get(EventUser,link_id);link.can_view_planner=False;link.event_role='manager';await db.commit()
    assert {e['id'] for e in (await ctx.client.get('/api/events/me/planner-events')).json()}=={own,other}

@pytest.mark.asyncio
async def test_disabled_planner_and_suspended_org_are_excluded(ctx):
    own,other=await seed(ctx);ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        db.add(Membership(org_id=ctx.ids['org_b'],user_id=ctx.ids['user_a'].id,role='admin'))
        event=await db.get(Event,other);event.planner_enabled=False;await db.commit()
    assert {e['id'] for e in (await ctx.client.get('/api/events/me/planner-events')).json()}=={own}
    async with _Session() as db:
        org=await db.get(Organization,ctx.ids['org_a']);org.is_active=False;await db.commit()
    assert (await ctx.client.get('/api/events/me/planner-events')).json()==[]

@pytest.mark.asyncio
async def test_foreign_event_cannot_mint_planner_token(ctx,monkeypatch):
    own,other=await seed(ctx);monkeypatch.setattr(settings,'planner_internal_token','offline-test-only-signing-key-1234567890');ctx.login(ctx.ids['user_a'])
    assert (await ctx.client.post('/api/auth/planner-token',params={'event_id':other})).status_code==404
    r=await ctx.client.post('/api/auth/planner-token',params={'event_id':own});assert r.status_code==200
    claims=jwt.decode(r.json()['token'],settings.planner_internal_token,algorithms=['HS256'],audience='planner',issuer='guesthub');assert claims['event_id']==own and claims['org_id']==ctx.ids['org_a']
