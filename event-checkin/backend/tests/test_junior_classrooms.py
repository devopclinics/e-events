import pytest
from sqlalchemy import select
from conftest import _Session
from test_junior_programme import setup,child
from test_junior_team import add,person,users
from app.models import Event
from app.junior_models import JuniorConfig,JuniorAudit

@pytest.mark.asyncio
async def test_room_save_is_scoped_persists_and_preserves_other_settings(ctx):
    root=await setup(ctx);team,_=await add(ctx,root)
    before=(await ctx.client.get(root+'/config')).json()
    r=await ctx.client.put(root+'/classrooms',json={'expected_classrooms':['Group A','Group B'],'classrooms':['Group A','Group B',' New Room ','New Room','']});assert r.status_code==200,r.text;assert r.json()['classrooms']==['Group A','Group B','New Room']
    after=(await ctx.client.get(root+'/config')).json();assert after['classrooms']==r.json()['classrooms']
    for key in ['staff','enabled','notifications_enabled','dropoff_start_date']:assert before[key]==after[key]
    async with _Session() as db:
        assert not (await db.scalars(select(JuniorConfig).where(JuniorConfig.event_id!=ctx.ids['event_a']))).all()
        audit=await db.scalar(select(JuniorAudit).where(JuniorAudit.action=='classrooms_updated'));assert audit.detail['classrooms'][-1]=='New Room'

@pytest.mark.asyncio
async def test_stale_save_is_rejected_without_losing_new_rooms(ctx):
    root=await setup(ctx);body={'expected_classrooms':['Group A','Group B'],'classrooms':['Group A','Group B','New Room']}
    assert (await ctx.client.put(root+'/classrooms',json=body)).status_code==200
    body['classrooms']=['Group A','Group B','Lost update'];r=await ctx.client.put(root+'/classrooms',json=body);assert r.status_code==409,r.text
    assert (await ctx.client.get(root+'/config')).json()['classrooms'][-1]=='New Room'

@pytest.mark.asyncio
async def test_staff_and_other_events_cannot_change_classrooms(ctx):
    root=await setup(ctx);team,_=await add(ctx,root,[person(role='supervisor')]);ctx.login((await users(team['event_user_ids']))[0])
    body={'expected_classrooms':['Group A','Group B'],'classrooms':['Group A','Group B','New Room']}
    assert (await ctx.client.put(root+'/classrooms',json=body)).status_code==403
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.put(root+'/classrooms',json=body)).status_code==404

@pytest.mark.asyncio
async def test_classrooms_used_by_children_or_volunteers_cannot_be_removed(ctx):
    root=await setup(ctx);await child(ctx,root)
    r=await ctx.client.put(root+'/classrooms',json={'expected_classrooms':['Group A','Group B'],'classrooms':['Group B']});assert r.status_code==409,r.text
    await add(ctx,root,[person(classrooms=['Group B'])])
    r=await ctx.client.put(root+'/classrooms',json={'expected_classrooms':['Group A','Group B'],'classrooms':['Group A']});assert r.status_code==409,r.text

@pytest.mark.asyncio
async def test_practice_rooms_can_save_without_enabling_any_sending(ctx):
    root=await setup(ctx)
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a']);e.is_test=True;e.setup_preferences={'junior_practice_source':'source'};await db.commit()
    r=await ctx.client.put(root+'/classrooms',json={'expected_classrooms':['Group A','Group B'],'classrooms':['Group A','Group B','Practice room']});assert r.status_code==200,r.text
    cfg=(await ctx.client.get(root+'/config')).json();assert cfg['practice_mode'] and not cfg['notifications_enabled']
    async with _Session() as db:assert not (await db.get(JuniorConfig,ctx.ids['event_a'])).volunteer_reminders_enabled

@pytest.mark.asyncio
async def test_saving_other_settings_without_rooms_preserves_latest_classrooms(ctx):
    root=await setup(ctx)
    r=await ctx.client.put(root+'/classrooms',json={'expected_classrooms':['Group A','Group B'],'classrooms':['Group A','Group B','Room C']});assert r.status_code==200,r.text
    r=await ctx.client.put(root+'/config',json={'enabled':True,'staff':{},'notifications_enabled':False});assert r.status_code==200,r.text
    assert r.json()['classrooms']==['Group A','Group B','Room C']
