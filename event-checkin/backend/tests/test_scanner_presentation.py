import pytest
from sqlalchemy import select
from app.models import Event,ExperienceWorkflow,ExperienceStep,Zone,EventUser
from conftest import _Session
async def setup(ctx):
    eid=ctx.ids['event_a'];ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        w=ExperienceWorkflow(event_id=eid,status='published');db.add(w);await db.flush()
        session=ExperienceStep(workflow_id=w.id,key='conference',title='Conference',type='session_attendance',enabled=True)
        extra=ExperienceStep(workflow_id=w.id,key='welcome',title='Welcome',type='custom',enabled=True)
        zone=Zone(event_id=eid,name='Conference');db.add_all([session,extra,zone]);await db.commit()
        return eid,session.id,extra.id,zone.id
@pytest.mark.asyncio
async def test_scanner_settings_scoped_validated_and_revision_guarded(ctx):
    eid,sid,extra,zid=await setup(ctx);url=f'/api/events/{eid}/scanner-presentation'
    r=await ctx.client.get(url);assert r.status_code==200,r.text;original=r.json()
    body={**original,'focused':True,'admission_step_ids':[],'zone_step_ids':{zid:[extra]},'attendance_step_ids':{zid:sid}}
    r=await ctx.client.put(url,json=body);assert r.status_code==200,r.text;assert r.json()['attendance_step_ids']=={zid:sid}
    assert (await ctx.client.put(url,json=body)).status_code==409
    fresh=r.json()
    for patch in [{'zone_step_ids':{'foreign':[extra]}},{'attendance_step_ids':{zid:extra}},{'admission_step_ids':[sid]},{'admission_step_ids':['foreign']}]:
        assert (await ctx.client.put(url,json={**fresh,**patch})).status_code==422
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.get(url)).status_code in (403,404)
@pytest.mark.asyncio
async def test_bound_step_requires_zone(ctx):
    eid,sid,extra,zid=await setup(ctx);url=f'/api/events/{eid}/scanner-presentation';current=(await ctx.client.get(url)).json()
    assert (await ctx.client.put(url,json={**current,'focused':True,'attendance_step_ids':{zid:sid}})).status_code==200
    async with _Session() as db:
        from app.models import Guest
        e=await db.get(Event,eid);e.experience_enabled=True;g=await db.scalar(select(Guest).where(Guest.event_id==eid));gid=g.id;await db.commit()
    r=await ctx.client.put(f'/api/events/{eid}/experience/guests/{gid}/steps/{sid}',json={'status':'completed'})
    assert r.status_code==409 and 'check-in zone' in r.json()['detail']

@pytest.mark.asyncio
async def test_scanner_permission_does_not_grant_settings_control(ctx):
    from test_staff_feature_access import staff
    eid,sid,extra,zid=await setup(ctx);url=f'/api/events/{eid}/scanner-presentation'
    body=(await ctx.client.get(url)).json()
    await staff(ctx,{'scanner':'manage'},role='staff')
    assert (await ctx.client.get(url)).status_code==403
    assert (await ctx.client.put(url,json={**body,'focused':True})).status_code==403
