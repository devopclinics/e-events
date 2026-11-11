import uuid
from datetime import datetime,timedelta
import pytest
from sqlalchemy import select
from app.models import Event,Guest,GuestSheetSession
from conftest import _Session

async def setup(ctx):
    ctx.login(ctx.ids['user_a']);eid=ctx.ids['event_a']
    async with _Session() as db:
        event=await db.get(Event,eid);event.status='active';await db.commit()
    r=await ctx.client.put(f'/api/events/{eid}/guest-sheet',json={});assert r.status_code==200,r.text
    data=r.json();token=data['url'].split('/')[-1]
    r=await ctx.client.post(f'/api/guest-sheets/{token}/unlock',json={'pin':data['pin']});assert r.status_code==200,r.text
    return token,{'X-Guest-Sheet-Session':r.json()['session']},data

def payload(rows,key=None):return {'request_key':key or str(uuid.uuid4()),'rows':rows}
def row(**kw):return {'first_name':'Ada','last_name':'Planner','email':'ada@example.test','phone':'+2348023044426',**kw}

@pytest.mark.asyncio
async def test_sheet_add_visible_dedup_idempotency_and_no_guest_secrets(ctx):
    token,headers,data=await setup(ctx);ctx.login(None);base=f'/api/guest-sheets/{token}'
    assert (await ctx.client.get(base+'/rows')).status_code==401
    body=payload([row(),row()]);r=await ctx.client.post(base+'/rows',headers=headers,json=body);assert r.status_code==200,r.text
    assert r.json()=={'added':1,'updated':0,'duplicate_rows':[2]}
    r=await ctx.client.post(base+'/rows',headers=headers,json=body);assert r.json()['already_saved']
    body['rows']=[row(first_name='Different')];assert (await ctx.client.post(base+'/rows',headers=headers,json=body)).status_code==409
    r=await ctx.client.get(base+'/rows',headers=headers);assert r.headers['cache-control']=='no-store';assert r.json()['total']==2
    assert set(r.json()['rows'][0])=={'id','first_name','last_name','email','phone','revision'}
    async with _Session() as db:
        guest=await db.scalar(select(Guest).where(Guest.first_name=='Ada'));assert guest.admitted_at is None and guest.rsvp_status!='confirmed'

@pytest.mark.asyncio
async def test_sheet_edit_permissions_conflict_and_cross_event(ctx):
    token,h,_=await setup(ctx);base=f'/api/guest-sheets/{token}'
    existing=(await ctx.client.get(base+'/rows',headers=h)).json()['rows'][0];edit={**existing,'first_name':'Updated'}
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([edit]))).status_code==403
    r=await ctx.client.put(f"/api/events/{ctx.ids['event_a']}/guest-sheet",json={'allow_edit':True});assert r.status_code==200
    r=await ctx.client.post(base+'/rows',headers=h,json=payload([edit]));assert r.status_code==200,r.text
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([edit]))).status_code==409
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([{**edit,'id':str(uuid.uuid4())}]))).status_code==404
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guest-sheet")).status_code==404

@pytest.mark.asyncio
async def test_sheet_reset_disable_expiry_and_closed_event(ctx):
    token,h,old=await setup(ctx);base=f'/api/guest-sheets/{token}';admin=f"/api/events/{ctx.ids['event_a']}/guest-sheet"
    r=await ctx.client.put(admin,json={'reset_pin':True});assert r.status_code==200
    assert (await ctx.client.get(base+'/rows',headers=h)).status_code==401
    r=await ctx.client.post(base+'/unlock',json={'pin':r.json()['pin']});h={'X-Guest-Sheet-Session':r.json()['session']}
    await ctx.client.put(admin,json={'enabled':False});assert (await ctx.client.get(base+'/rows',headers=h)).status_code==404
    await ctx.client.put(admin,json={'enabled':True});assert (await ctx.client.get(base+'/rows',headers=h)).status_code==401
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a']);e.status='ended';await db.commit()
    assert (await ctx.client.post(base+'/unlock',json={'pin':old['pin']})).status_code==403

@pytest.mark.asyncio
async def test_sheet_pin_throttle_and_validation(ctx):
    token,h,d=await setup(ctx);base=f'/api/guest-sheets/{token}';wrong='000000' if d['pin']!='000000' else '111111'
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([row(email='bad')]))).status_code==422
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([row(first_name='  ')]))).status_code==422
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([row(phone='x')]))).status_code==422
    for _ in range(10):assert (await ctx.client.post(base+'/unlock',json={'pin':wrong})).status_code==401
    assert (await ctx.client.post(base+'/unlock',json={'pin':d['pin']})).status_code==429
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([row(is_vip=True)]))).status_code==422

@pytest.mark.asyncio
async def test_sheet_expired_session_and_batch_cap_rollback(ctx,monkeypatch):
    from app.routers import guest_sheets
    from fastapi import HTTPException
    token,h,d=await setup(ctx);base=f'/api/guest-sheets/{token}'
    def cap(*args):raise HTTPException(403,'Guest cap reached')
    monkeypatch.setattr(guest_sheets,'assert_within_guest_cap',cap)
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([row()]))).status_code==403
    assert (await ctx.client.get(base+'/rows',headers=h)).json()['total']==1
    async with _Session() as db:
        session=await db.scalar(select(GuestSheetSession));session.expires_at=datetime.utcnow()-timedelta(seconds=1);await db.commit()
    assert (await ctx.client.get(base+'/rows',headers=h)).status_code==401

@pytest.mark.asyncio
async def test_sheet_session_does_not_cross_events_and_invalid_batches_are_atomic(ctx):
    token,h,_=await setup(ctx);base=f'/api/guest-sheets/{token}'
    async with _Session() as db:
        e=Event(org_id=ctx.ids['org_a'],name='Another event',couples_name='Another',event_date=datetime(2026,11,11),checkin_base_url='http://x',status='active');db.add(e);await db.commit();eid=e.id
    config=(await ctx.client.put(f'/api/events/{eid}/guest-sheet',json={})).json()
    other=config['url'].split('/')[-1]
    assert (await ctx.client.get(f'/api/guest-sheets/{other}/rows',headers=h)).status_code==401
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([row(),row(id=str(uuid.uuid4()),revision='x')]))).status_code==403
    assert (await ctx.client.get(base+'/rows',headers=h)).json()['total']==1
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([]))).status_code==422
    assert (await ctx.client.get(base+'/rows?offset=-1',headers=h)).status_code==422
    assert (await ctx.client.post('/api/guest-sheets/not-a-link/unlock',json={'pin':'123456'})).status_code==404

@pytest.mark.asyncio
async def test_sheet_defaults_grant_both_only_to_new_guests_and_replay_is_safe(ctx):
    from app.models import Zone,GuestSessionAccess
    token,h,_=await setup(ctx);eid=ctx.ids['event_a'];base=f'/api/guest-sheets/{token}'
    async with _Session() as db:
        zones=[Zone(event_id=eid,name=n)for n in ['Conference','Dinner']];db.add_all(zones);await db.flush();ids=[z.id for z in zones];await db.commit()
    settings=f'/api/events/{eid}/guest-sheet'
    r=await ctx.client.put(settings,json={'default_zone_ids':ids,'allow_edit':True});assert r.status_code==200,r.text
    # Routine enable/edit saves must preserve selected zone defaults.
    assert (await ctx.client.put(settings,json={'allow_edit':True})).json()['default_zone_ids']==ids
    body=payload([row()]);assert (await ctx.client.post(base+'/rows',headers=h,json=body)).status_code==200
    assert (await ctx.client.post(base+'/rows',headers=h,json=body)).json()['already_saved']
    async with _Session()as db:
        g=await db.scalar(select(Guest).where(Guest.first_name=='Ada'));gid=g.id
        access=(await db.scalars(select(GuestSessionAccess).where(GuestSessionAccess.guest_id==gid))).all()
        assert {a.zone_id for a in access}==set(ids) and all(a.decision=='allow'for a in access)
        access[0].decision='block';await db.commit()
    records=(await ctx.client.get(base+'/rows',headers=h)).json()['rows'];edit=next(r for r in records if r['id']==gid);edit['phone']='+2348032396576'
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([edit]))).status_code==200
    async with _Session()as db:
        access=(await db.scalars(select(GuestSessionAccess).where(GuestSessionAccess.guest_id==gid))).all();assert len(access)==2 and sum(a.decision=='block'for a in access)==1
    # Public contributors cannot choose or elevate zones.
    assert (await ctx.client.post(base+'/rows',headers=h,json=payload([row(default_zone_ids=ids)]))).status_code==422

@pytest.mark.asyncio
async def test_sheet_defaults_reject_foreign_or_inactive_zones_and_rollback(ctx):
    from app.models import Zone
    token,h,_=await setup(ctx);eid=ctx.ids['event_a'];base=f'/api/guest-sheets/{token}'
    async with _Session()as db:
        foreign=Event(org_id=ctx.ids['org_a'],name='Other',couples_name='Other',event_date=datetime(2026,11,11),checkin_base_url='http://test',status='active');db.add(foreign);await db.flush()
        other=Zone(event_id=foreign.id,name='Foreign');local=Zone(event_id=eid,name='Dinner');db.add_all([other,local]);await db.flush();foreign_id=other.id;local_id=local.id;await db.commit()
    settings=f'/api/events/{eid}/guest-sheet'
    assert (await ctx.client.put(settings,json={'default_zone_ids':[foreign_id]})).status_code==422
    assert (await ctx.client.put(settings,json={'default_zone_ids':[local_id]})).status_code==200
    async with _Session()as db:
        z=await db.get(Zone,local_id);z.is_active=False;await db.commit()
    r=await ctx.client.post(base+'/rows',headers=h,json=payload([row()]));assert r.status_code==409,r.text
    async with _Session()as db:assert await db.scalar(select(Guest).where(Guest.first_name=='Ada')) is None

@pytest.mark.asyncio
async def test_sheet_zone_defaults_require_access_management(ctx):
    from app.models import User,Membership,EventUser
    await setup(ctx);eid=ctx.ids['event_a']
    async with _Session()as db:
        u=User(name='Guest editor',email='sheet-editor@example.test',role='official');db.add(u);await db.flush();uid=u.id
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=uid,role='staff'))
        db.add(EventUser(event_id=eid,user_id=uid,event_role='staff',can_manage_guests=True,feature_permissions={'settings':'manage','guests':'manage'}));await db.commit()
    ctx.login(u)
    url=f'/api/events/{eid}/guest-sheet'
    r=await ctx.client.put(url,json={'default_zone_ids':[]});assert r.status_code==403,r.text
    # Ordinary sheet controls keep their original permission requirements.
    assert (await ctx.client.put(url,json={'allow_edit':True})).status_code==200
