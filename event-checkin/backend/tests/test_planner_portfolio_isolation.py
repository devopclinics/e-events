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

async def portfolio(ctx,event_id=None):
    r=await ctx.client.get('/api/events/me/planner-events',params={'event_id':event_id} if event_id else {});assert r.status_code==200;return {e['id'] for e in r.json()}

@pytest.mark.asyncio
async def test_unscoped_clients_never_receive_other_portfolios(ctx):
    await seed(ctx)
    for user in ['user_a','user_b','superadmin']:
        ctx.login(ctx.ids[user]);assert await portfolio(ctx)==set()

@pytest.mark.asyncio
async def test_selected_event_scopes_even_operator_and_same_organization_owner(ctx):
    own,other=await seed(ctx)
    async with _Session() as db:
        sibling=Event(org_id=ctx.ids['org_a'],name='Same organization different portfolio',couples_name='',event_date=datetime(2026,12,2),checkin_base_url='http://test',planner_enabled=True);db.add(sibling);await db.commit();sibling_id=sibling.id
    ctx.login(ctx.ids['user_a']);assert await portfolio(ctx,own)=={own};assert await portfolio(ctx,sibling_id)=={sibling_id};assert await portfolio(ctx,other)==set()
    ctx.login(ctx.ids['user_b']);assert await portfolio(ctx,own)==set();assert await portfolio(ctx,other)=={other}
    ctx.login(ctx.ids['superadmin']);assert await portfolio(ctx,own)=={own};assert await portfolio(ctx,other)=={other};assert await portfolio(ctx,'unknown-event')==set()
    # Deliberate support selection is preserved, but never used as portfolio scope.
    assert {own,other,sibling_id}.issubset({e['id'] for e in (await ctx.client.get('/api/events')).json()})

@pytest.mark.asyncio
async def test_explicit_planner_assignment_does_not_include_it_in_other_event(ctx):
    own,other=await seed(ctx);ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        link=EventUser(event_id=other,user_id=ctx.ids['user_a'].id);db.add(link);await db.commit();link_id=link.id
    assert await portfolio(ctx,other)==set()
    async with _Session() as db:
        link=await db.get(EventUser,link_id);link.can_view_planner=True;await db.commit()
    assert await portfolio(ctx,other)=={other};assert await portfolio(ctx,own)=={own}
    async with _Session() as db:
        link=await db.get(EventUser,link_id);link.can_view_planner=False;link.event_role='manager';await db.commit()
    assert await portfolio(ctx,other)=={other};assert await portfolio(ctx,own)=={own}

@pytest.mark.asyncio
async def test_disabled_selected_event_never_falls_back_to_other_enabled_events(ctx):
    own,other=await seed(ctx);ctx.login(ctx.ids['superadmin'])
    async with _Session() as db:
        event=await db.get(Event,own);event.planner_enabled=False;await db.commit()
    assert await portfolio(ctx,own)==set();assert await portfolio(ctx,other)=={other}

@pytest.mark.asyncio
async def test_suspended_organization_is_excluded(ctx):
    own,_=await seed(ctx);ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        org=await db.get(Organization,ctx.ids['org_a']);org.is_active=False;await db.commit()
    assert await portfolio(ctx,own)==set()

@pytest.mark.asyncio
async def test_foreign_event_cannot_mint_planner_token(ctx,monkeypatch):
    own,other=await seed(ctx);monkeypatch.setattr(settings,'planner_internal_token','offline-test-only-signing-key-1234567890');ctx.login(ctx.ids['user_a'])
    assert (await ctx.client.post('/api/auth/planner-token',params={'event_id':other})).status_code==404
    r=await ctx.client.post('/api/auth/planner-token',params={'event_id':own});assert r.status_code==200
    claims=jwt.decode(r.json()['token'],settings.planner_internal_token,algorithms=['HS256'],audience='planner',issuer='guesthub');assert claims['event_id']==own and claims['org_id']==ctx.ids['org_a']
