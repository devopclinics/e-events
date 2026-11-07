"""Shared passes retain session authorization, atomic batches and retry safety."""
import uuid
import pytest
from sqlalchemy import select, func
from conftest import _Session
from app.models import Guest, Event, Zone, GuestSessionAccess, SeatingTable, ScanEvent

async def setup(ctx, seating=False):
    ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a']);e.status='active';e.is_paid=True;e.venue_access_enabled=True;e.seating_enabled=seating
        g=await db.scalar(select(Guest).where(Guest.event_id==e.id))
        c=Zone(event_id=e.id,name='Conference');d=Zone(event_id=e.id,name='Dinner');db.add_all([c,d]);await db.flush()
        e.setup_preferences={'restricted_session_ids':[c.id,d.id],'session_seating_modes':{c.id:'none',d.id:'event' if seating else 'none'}}
        db.add_all([GuestSessionAccess(event_id=e.id,guest_id=g.id,zone_id=z.id,decision='allow') for z in [c,d]])
        await db.commit();info=dict(event=e.id,guest=g.id,token=g.qr_token,conference=c.id,dinner=d.id)
    res=await ctx.client.put(config(info),json={'enabled':True,'admission_limit':3});assert res.status_code==200,res.text
    return info

def path(i):return f"/api/scan/{i['token']}/group-pass"
def config(i):return f"/api/events/{i['event']}/guests/{i['guest']}/group-pass"
def body(i,qty,zone='conference'):return dict(request_id=str(uuid.uuid4()),quantity=qty,zone_id=i[zone])

@pytest.mark.asyncio
async def test_retry_and_independent_session_counts(ctx):
    i=await setup(ctx)
    assert (await ctx.client.get(path(i),params={'zone_id':i['conference']})).json()['remaining']==3
    request=body(i,2);first=await ctx.client.post(path(i),json=request)
    assert first.status_code==200,first.text
    assert first.json()['remaining']==1
    assert (await ctx.client.post(path(i),json=request)).json()['replayed'] is True
    dinner=await ctx.client.post(path(i),json=body(i,2,'dinner'));assert dinner.status_code==200,dinner.text
    assert {m['guest_id'] for m in dinner.json()['members']}=={m['guest_id'] for m in first.json()['members']}
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id==i['event']))==2
        assert await db.scalar(select(func.count()).select_from(ScanEvent).where(ScanEvent.event_id==i['event']))==4
        assert all(g.table_id is None for g in (await db.scalars(select(Guest).where(Guest.event_id==i['event']))).all())
    assert (await ctx.client.post(path(i),json=body(i,2))).status_code==409
    assert (await ctx.client.post(path(i),json=body(i,1))).status_code==200

@pytest.mark.asyncio
async def test_access_and_bypass(ctx):
    i=await setup(ctx)
    assert (await ctx.client.post(f"/api/scan/{i['token']}/zone",json={'zone_id':i['conference'],'direction':'in'})).status_code==409
    assert (await ctx.client.post(f"/api/scan/{i['token']}")).json()['status']=='group_pass_required'
    async with _Session() as db:
        rule=await db.scalar(select(GuestSessionAccess).where(GuestSessionAccess.guest_id==i['guest'],GuestSessionAccess.zone_id==i['dinner']));rule.decision='block';await db.commit()
    assert (await ctx.client.post(path(i),json=body(i,1,'dinner'))).status_code==409
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.post(path(i),json=body(i,1))).status_code==403
    assert (await ctx.client.put(config(i),json={'enabled':True,'admission_limit':10})).status_code in (403,404)

@pytest.mark.asyncio
async def test_limit_and_exit_validation(ctx):
    i=await setup(ctx)
    assert (await ctx.client.put(config(i),json={'enabled':True})).status_code==422
    assert (await ctx.client.put(config(i),json={'enabled':True,'admission_limit':0})).status_code==422
    async with _Session() as db:
        z=await db.get(Zone,i['dinner']);z.direction_mode='exit';await db.commit()
    assert (await ctx.client.post(path(i),json=body(i,1,'dinner'))).status_code==409
    assert (await ctx.client.post(path(i),json=body(i,2))).status_code==200
    assert (await ctx.client.put(config(i),json={'enabled':True,'admission_limit':1})).status_code==409

@pytest.mark.asyncio
async def test_batch_rollback_on_seating_failure(ctx):
    i=await setup(ctx,seating=True)
    async with _Session() as db:
        db.add(SeatingTable(event_id=i['event'],name='Only table',capacity=1));await db.commit()
    result=await ctx.client.post(path(i),json=body(i,2,'dinner'));assert result.status_code==409,result.text
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(ScanEvent).where(ScanEvent.event_id==i['event']))==0
        assert await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id==i['event']))==1
        g=await db.get(Guest,i['guest']);assert not g.admitted and g.table_id is None
    assert (await ctx.client.get(path(i),params={'zone_id':i['dinner']})).json()['used']==0

@pytest.mark.asyncio
async def test_gate_preserves_access_and_individual_exit_does_not_replenish(ctx):
    from app.models import Gate
    i=await setup(ctx)
    async with _Session() as db:
        gate=Gate(event_id=i['event'],name='Entry',zone_id=i['conference'],direction='in');db.add(gate);await db.commit();gid=gate.id
    direct=await ctx.client.post(f"/api/events/{i['event']}/gates/{gid}/scan",json={'qr_token':i['token']})
    assert direct.status_code==409
    request=body(i,2);request['gate_id']=gid;request.pop('zone_id')
    admitted=await ctx.client.post(path(i),json=request);assert admitted.status_code==200,admitted.text
    async with _Session() as db:
        child=await db.get(Guest,admitted.json()['members'][1]['guest_id']);qr=child.qr_token
    exit_result=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':i['conference'],'direction':'out'})
    assert not exit_result.json()['denied']
    assert (await ctx.client.get(path(i),params={'zone_id':i['conference']})).json()['remaining']==1

@pytest.mark.asyncio
async def test_staff_least_privilege_and_plan_cap(ctx):
    from app.models import Membership, EventUser
    i=await setup(ctx)
    async with _Session() as db:
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=ctx.ids['user_b'].id,role='staff'))
        link=EventUser(event_id=i['event'],user_id=ctx.ids['user_b'].id,event_role='staff',can_view_guests=True,can_manage_guests=False,access_level='view')
        db.add(link);await db.commit()
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get(config(i))).status_code==200
    assert (await ctx.client.put(config(i),json={'enabled':True,'admission_limit':10})).status_code==403

@pytest.mark.asyncio
async def test_personal_pass_unchanged(ctx):
    i=await setup(ctx)
    await ctx.client.put(config(i),json={'enabled':False,'admission_limit':3})
    result=await ctx.client.post(f"/api/scan/{i['token']}/zone",json={'zone_id':i['conference']})
    assert result.status_code==200 and not result.json()['denied'],result.text
