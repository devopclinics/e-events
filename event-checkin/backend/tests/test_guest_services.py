"""Scope, shared-ledger and backwards-compatibility regressions."""
from datetime import datetime, timedelta
import pytest
from sqlalchemy import select, func
from conftest import _Session
from app.models import (User, Membership, EventUser, Guest, SeatingTable, Zone, Event, MenuCategory, MenuItem, MealService, GuestMealService, GuestMenuChoice, Task, GuestServiceActivity, GuestSeatingPresence, ScanEvent)

async def setup(ctx):
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a']);e.is_paid=True;e.status='active';e.menu_enabled=True;e.venue_access_enabled=True
        staff=User(name='Table host',email='host@test.invalid',role='official');db.add(staff);await db.flush()
        db.add(Membership(org_id=e.org_id,user_id=staff.id,role='staff'))
        eu=EventUser(event_id=e.id,user_id=staff.id)
        tables=[SeatingTable(event_id=e.id,name=f'Table {i}',capacity=8) for i in range(3)]
        zone=Zone(event_id=e.id,name='Conference Hall');db.add_all([eu,zone,*tables]);await db.flush()
        guests=[Guest(event_id=e.id,first_name=f'Guest {i}',last_name='Person',table_id=t.id,seat_number='1',qr_token=f'service-pass-{i}',rsvp_status='confirmed',admitted=True) for i,t in enumerate(tables)]
        category=MenuCategory(event_id=e.id,name='Lunch',selection_type='single',is_required=True,guest_visible=True,display_only=False)
        db.add_all([*guests,category]);await db.flush()
        item=MenuItem(event_id=e.id,category_id=category.id,name='Rice');services=[MealService(event_id=e.id,category_id=category.id,name=f'Meal {i}',status='open') for i in range(2)]
        db.add_all([item,*services]);await db.commit()
        return dict(staff=staff,eu=eu,tables=tables,guests=guests,zone=zone,category=category,item=item,services=services,event_id=e.id)

async def configure(ctx,s,assignments,**extra):
    ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        m=await db.get(EventUser,s['eu'].id);version=m.updated_at.isoformat() if m.updated_at else None
    return await ctx.client.put(url(s,f"/members/{s['eu'].id}"),json={'scoped':True,'if_unmodified_since':version,'assignments':assignments,**extra})
def table(s,index=0,**kw):return {'table_id':s['tables'][index].id,**kw}
def url(s,path=''):return f"/api/events/{s['event_id']}/guest-services{path}"

@pytest.mark.asyncio
async def test_multiple_tables_scope_and_no_credentials(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,0),table(s,1)])).status_code==200
    ctx.login(s['staff']);r=await ctx.client.get(url(s));assert r.status_code==200
    assert {g['id'] for g in r.json()['guests']}=={g.id for g in s['guests'][:2]}
    assert 'team' not in r.json() and 'service-pass' not in r.text and 'email' not in r.text
    assert (await ctx.client.post(url(s,f"/guests/{s['guests'][2].id}/seated"),json={'seated':True})).status_code==403
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.get(url(s))).status_code==404

@pytest.mark.asyncio
async def test_validation_and_concurrency(ctx):
    s=await setup(ctx)
    assert (await configure(ctx,s,[table(s),table(s)])).status_code==400
    assert (await configure(ctx,s,[{'table_id':s['tables'][0].id,'zone_id':s['zone'].id}])).status_code==422
    assert (await configure(ctx,s,[table(s,starts_at='2026-10-20T12:00:00Z',ends_at='2026-10-19T12:00:00Z')])).status_code==422
    assert (await configure(ctx,s,[{'table_id':'missing'}])).status_code==404
    assert (await configure(ctx,s,[table(s)],if_unmodified_since='2000-01-01T00:00:00')).status_code==409
    assert (await configure(ctx,s,[table(s)],if_unmodified_since=None)).status_code==409
    assert (await configure(ctx,s,[table(s)])).status_code==200
    ctx.login(s['staff']);assert (await ctx.client.put(url(s,f"/members/{s['eu'].id}"),json={'assignments':[]})).status_code==403

@pytest.mark.asyncio
async def test_foreign_location(ctx):
    s=await setup(ctx)
    async with _Session() as db:
        e=Event(org_id=ctx.ids['org_b'],name='Other',couples_name='Other',event_date=datetime.utcnow(),checkin_base_url='http://test');db.add(e);await db.flush()
        t=SeatingTable(event_id=e.id,name='Private',capacity=5);db.add(t);await db.commit()
    assert (await configure(ctx,s,[{'table_id':t.id}])).status_code==404

@pytest.mark.asyncio
async def test_scan_scope_shifts_and_revocation(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_checkin=True)])).status_code==200
    ctx.login(s['staff'])
    assert (await ctx.client.post('/api/scan/'+s['guests'][2].qr_token)).status_code==403
    assert (await ctx.client.get('/api/scan/offline-manifest/'+s['event_id'])).status_code==403
    assert (await ctx.client.post('/api/scan/'+s['guests'][0].qr_token+'/daily-attendance')).status_code==403
    r=await ctx.client.post(url(s,'/scan'),json={'token':s['guests'][0].qr_token});assert r.status_code==200 and r.json()['status']=='already_admitted';assert 'guest' not in r.json()
    future=(datetime.utcnow()+timedelta(days=1)).isoformat();assert (await configure(ctx,s,[table(s,can_checkin=True,starts_at=future)])).status_code==200
    ctx.login(s['staff']);assert (await ctx.client.post(url(s,'/scan'),json={'token':s['guests'][0].qr_token})).status_code==403
    assert (await ctx.client.get(url(s))).json()['guests']==[]
    assert (await configure(ctx,s,[])).status_code==200
    ctx.login(s['staff']);assert (await ctx.client.post('/api/scan/'+s['guests'][0].qr_token)).status_code==403

@pytest.mark.asyncio
async def test_legacy_endpoints_cannot_bypass_scope(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s)])).status_code==200
    ctx.login(s['staff'])
    for path in ['guests','seating','menu/dashboard']:
        assert (await ctx.client.get(f"/api/events/{s['event_id']}/{path}")).status_code==403,path
    ctx.login(ctx.ids['user_a']);assert (await ctx.client.patch(f"/api/events/{s['event_id']}/members/{s['staff'].id}/permissions",json={'can_manage_menu':True})).status_code==409

@pytest.mark.asyncio
async def test_seated_distinct_idempotent_and_table_move(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s)])).status_code==200
    ctx.login(s['staff']);path=url(s,f"/guests/{s['guests'][0].id}/seated")
    assert (await ctx.client.post(path,json={'seated':True})).status_code==200
    assert (await ctx.client.post(path,json={'seated':True})).json()['already_seated']
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(GuestSeatingPresence))==1
        g=await db.get(Guest,s['guests'][0].id);g.table_id=s['tables'][2].id;g.seat_number='2';await db.commit()
    assert (await ctx.client.post(path,json={'seated':False})).status_code==403
    ctx.login(ctx.ids['user_a']);assert next(g for g in (await ctx.client.get(url(s))).json()['guests'] if g['id']==s['guests'][0].id)['seated_at'] is None

@pytest.mark.asyncio
async def test_assisted_menu_existing_rules_and_audit(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    ctx.login(s['staff']);path=url(s,f"/guests/{s['guests'][0].id}/menu");body={'single':{s['category'].id:s['item'].id},'guest_agreed':True}
    assert (await ctx.client.post(path,json={**body,'guest_agreed':False})).status_code==400
    assert (await ctx.client.post(path,json={'single':{s['category'].id:'wrong'},'guest_agreed':True})).status_code==400
    assert (await ctx.client.post(path,json=body)).status_code==200
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(GuestMenuChoice).where(GuestMenuChoice.guest_id==s['guests'][0].id))==1
        rows=(await db.scalars(select(GuestServiceActivity).where(GuestServiceActivity.action=='assisted_menu'))).all();assert len(rows)==1 and rows[0].actor_id==s['staff'].id

@pytest.mark.asyncio
async def test_serve_exact_occurrence_duplicate_and_eligibility(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    ctx.login(s['staff']);path=url(s,f"/guests/{s['guests'][0].id}/services/{s['services'][1].id}/served")
    assert (await ctx.client.post(path)).status_code==200
    assert (await ctx.client.post(path)).json()['already_served']
    async with _Session() as db:
        rows=(await db.scalars(select(GuestMealService))).all();assert len(rows)==1 and rows[0].service_id==s['services'][1].id
        db.add(GuestMealService(service_id=s['services'][0].id,guest_id=s['guests'][0].id,eligibility_status='not_eligible'));await db.commit()
    assert (await ctx.client.post(url(s,f"/guests/{s['guests'][0].id}/services/{s['services'][0].id}/served"))).status_code==403
    assert (await ctx.client.post(url(s,f"/guests/{s['guests'][0].id}/menu"),json={'single':{s['category'].id:s['item'].id},'guest_agreed':True})).status_code==400

@pytest.mark.asyncio
async def test_assistance_reuses_one_task(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s)])).status_code==200
    ctx.login(s['staff']);a=(await ctx.client.get(url(s))).json()['assignments'][0]
    body={'assignment_id':a['id'],'request_key':'request-once-123','title':'Need water'}
    one=await ctx.client.post(url(s,'/requests'),json=body);two=await ctx.client.post(url(s,'/requests'),json=body)
    assert one.status_code==200 and two.json()['task_id']==one.json()['task_id'] and two.json()['already_created']
    tasks=(await ctx.client.get(f"/api/events/{s['event_id']}/tasks")).json();assert len(tasks)==1 and tasks[0]['id']==one.json()['task_id']
    async with _Session() as db:
        task=await db.get(Task,one.json()['task_id']);task.status='in_progress';await db.commit()
    assert (await ctx.client.get(f"/api/events/{s['event_id']}/tasks")).json()[0]['status']=='in_progress'

@pytest.mark.asyncio
async def test_conference_reuses_zone_movements(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[{'zone_id':s['zone'].id,'can_scan_zone':True}])).status_code==200
    ctx.login(s['staff']);assert (await ctx.client.get(url(s))).json()['guests']==[]
    r=await ctx.client.post(url(s,'/scan'),json={'token':s['guests'][1].qr_token,'zone_id':s['zone'].id,'direction':'in'});assert r.status_code==200,r.text;assert r.json()['status']=='ok'
    assert len((await ctx.client.get(url(s))).json()['zones'][0]['inside'])==1
    assert (await ctx.client.post(url(s,'/scan'),json={'token':s['guests'][1].qr_token})).status_code==403

@pytest.mark.asyncio
async def test_existing_unscoped_scanner_unchanged(ctx):
    s=await setup(ctx);ctx.login(s['staff']);r=await ctx.client.post('/api/scan/'+s['guests'][2].qr_token)
    assert r.status_code==200 and r.json()['status']=='already_admitted'

@pytest.mark.asyncio
async def test_service_limits_closed_capacity_and_shift_end(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    ctx.login(s['staff']);path=url(s,f"/guests/{s['guests'][0].id}/services/{s['services'][0].id}/served")
    async with _Session() as db:
        service=await db.get(MealService,s['services'][0].id);service.capacity=0;await db.commit()
    assert (await ctx.client.post(path)).status_code==409
    async with _Session() as db:
        service=await db.get(MealService,s['services'][0].id);service.capacity=None;service.starts_at=datetime.utcnow()+timedelta(days=1);await db.commit()
    assert (await ctx.client.post(path)).status_code==409
    async with _Session() as db:
        service=await db.get(MealService,s['services'][0].id);service.starts_at=None;service.status='closed';await db.commit()
    assert (await ctx.client.post(path)).status_code==409
    past=(datetime.utcnow()-timedelta(minutes=1)).isoformat()
    assert (await configure(ctx,s,[table(s,can_manage_meals=True,ends_at=past)])).status_code==200
    ctx.login(s['staff']);assert (await ctx.client.get(url(s))).json()['guests']==[]

@pytest.mark.asyncio
async def test_no_bypass_via_experience_or_without_event_pass(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True,can_checkin=True)])).status_code==200
    ctx.login(s['staff'])
    r=await ctx.client.get(f"/api/events/{s['event_id']}/experience/guests/{s['guests'][2].id}/next-steps");assert r.status_code==403
    async with _Session() as db:
        event=await db.get(Event,s['event_id']);event.is_paid=False;await db.commit()
    assert (await ctx.client.post(url(s,'/scan'),json={'token':s['guests'][0].qr_token})).status_code==402
    assert (await ctx.client.post(url(s,f"/guests/{s['guests'][0].id}/seated"),json={'seated':True})).status_code==402

@pytest.mark.asyncio
async def test_shared_table_support_and_view_only_supervisor(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,is_lead=True)])).status_code==200
    async with _Session() as db:
        supporting=User(name='Support host',email='support@test.invalid',role='official');db.add(supporting);await db.flush()
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=supporting.id,role='staff'))
        m=EventUser(event_id=s['event_id'],user_id=supporting.id,event_role='manager',access_level='view');db.add(m);await db.commit()
    ctx.login(supporting)
    r=await ctx.client.get(url(s));assert r.status_code==200 and r.json()['is_supervisor'] and not r.json()['can_configure']
    assert (await ctx.client.post(url(s,f"/guests/{s['guests'][0].id}/seated"),json={'seated':True})).status_code==403
    ctx.login(ctx.ids['user_a'])
    assert (await ctx.client.put(url(s,f'/members/{m.id}'),json={'scoped':True,'if_unmodified_since':m.updated_at.isoformat(),'assignments':[table(s)]})).status_code==400

@pytest.mark.asyncio
async def test_two_staff_can_share_one_table(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,is_lead=True)])).status_code==200
    async with _Session() as db:
        user=User(name='Supporting host',email='supporting@test.invalid',role='official');db.add(user);await db.flush()
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=user.id,role='staff'))
        eu=EventUser(event_id=s['event_id'],user_id=user.id);db.add(eu);await db.commit()
    assert (await configure(ctx,{**s,'eu':eu},[table(s)])).status_code==200
    for staff in [s['staff'],user]:
        ctx.login(staff);r=await ctx.client.get(url(s));assert [g['id'] for g in r.json()['guests']]==[s['guests'][0].id]
    ctx.login(ctx.ids['user_a']);r=await ctx.client.get(url(s));assert len([m for m in r.json()['team'] if any(a['table_id']==s['tables'][0].id for a in m['assignments'])])==2
