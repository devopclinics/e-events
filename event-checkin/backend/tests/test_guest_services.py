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

@pytest.mark.asyncio
async def test_complete_table_manager_arrival_to_service_and_handover(ctx,monkeypatch):
    s=await setup(ctx)
    async with _Session() as db:
        e=await db.get(Event,s['event_id']);e.notify_email=False;e.notify_sms=False;e.notify_whatsapp=False
        g=await db.get(Guest,s['guests'][0].id);g.admitted=False;g.admitted_at=None;await db.commit()
    assert (await configure(ctx,s,[table(s,can_checkin=True,can_manage_meals=True),table(s,1,can_manage_meals=True)])).status_code==200
    ctx.login(s['staff']);guest=s['guests'][0]
    assert (await ctx.client.post(url(s,f'/guests/{guest.id}/seated'),json={'seated':True})).status_code==409
    scan=await ctx.client.post(url(s,'/scan'),json={'token':guest.qr_token});assert scan.status_code==200,scan.text;assert scan.json()['status']=='admitted'
    assert (await ctx.client.post(url(s,f'/guests/{guest.id}/seated'),json={'seated':True})).status_code==200
    body={'single':{s['category'].id:s['item'].id},'guest_agreed':True}
    assert (await ctx.client.post(url(s,f'/guests/{guest.id}/menu'),json=body)).status_code==200
    assert (await ctx.client.post(url(s,f'/guests/{guest.id}/services/{s["services"][0].id}/served'))).status_code==200
    ws=(await ctx.client.get(url(s))).json();row=next(g for g in ws['guests'] if g['id']==guest.id)
    assert row['admitted'] and row['seated_at'] and row['meal_services'][0]['served']
    assert row['choices'][0]['item_id']==s['item'].id
    from app.routers import tasks
    notifications=[];monkeypatch.setattr(tasks,'_notify_assignee',lambda *args:notifications.append(args))
    request={'assignment_id':ws['assignments'][0]['id'],'request_key':'full-handover-123','title':'Shift handover: water requested','priority':'high','assignee_user_id':s['staff'].id}
    first=await ctx.client.post(url(s,'/requests'),json=request);again=await ctx.client.post(url(s,'/requests'),json=request)
    assert first.status_code==200 and again.json()['task_id']==first.json()['task_id'] and len(notifications)==1
    path=f"/api/events/{s['event_id']}/tasks/{first.json()['task_id']}"
    for action in ['start','complete']:
        result=await ctx.client.post(path+'/'+action);assert result.status_code==200,result.text
    assert next(t for t in (await ctx.client.get(f"/api/events/{s['event_id']}/tasks")).json() if t['id']==first.json()['task_id'])['status']=='done'

@pytest.mark.asyncio
async def test_later_meal_can_be_chosen_without_changing_served_meal(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    async with _Session() as db:
        dinner=MenuCategory(event_id=s['event_id'],name='Dinner',selection_type='single',is_required=True,guest_visible=True,display_only=False)
        db.add(dinner);await db.flush();item=MenuItem(event_id=s['event_id'],category_id=dinner.id,name='Dinner plate');db.add(item);await db.commit()
    ctx.login(s['staff']);path=url(s,f"/guests/{s['guests'][0].id}/menu")
    body={'single':{s['category'].id:s['item'].id,dinner.id:item.id},'guest_agreed':True}
    assert (await ctx.client.post(path,json=body)).status_code==200
    assert (await ctx.client.post(url(s,f"/guests/{s['guests'][0].id}/services/{s['services'][0].id}/served"))).status_code==200
    # Dinner can be selected later even though lunch is served and legacy meal_served is true.
    assert (await ctx.client.post(path,json={'single':{dinner.id:item.id},'guest_agreed':True})).status_code==200
    ws=(await ctx.client.get(url(s))).json();row=next(g for g in ws['guests'] if g['id']==s['guests'][0].id)
    assert row['locked_category_ids']==[s['category'].id] and not row['menu_selections_locked']
    # Reposting unchanged served choices is harmless; changing them is forbidden.
    assert (await ctx.client.post(path,json=body)).status_code==200
    async with _Session() as db:
        other=MenuItem(event_id=s['event_id'],category_id=s['category'].id,name='Different lunch');db.add(other);await db.commit()
    assert (await ctx.client.post(path,json={**body,'single':{s['category'].id:other.id,dinner.id:item.id}})).status_code==400

@pytest.mark.asyncio
async def test_optional_choice_clear_and_legacy_lock(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    async with _Session() as db:
        c=await db.get(MenuCategory,s['category'].id);c.is_required=False;await db.commit()
    ctx.login(s['staff']);path=url(s,f"/guests/{s['guests'][0].id}/menu")
    assert (await ctx.client.post(path,json={'single':{s['category'].id:s['item'].id},'guest_agreed':True})).status_code==200
    assert (await ctx.client.post(path,json={'clear_categories':[s['category'].id],'guest_agreed':True})).status_code==200
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(GuestMenuChoice).where(GuestMenuChoice.guest_id==s['guests'][0].id))==0
        g=await db.get(Guest,s['guests'][0].id);g.meal_served=True;await db.commit()
    assert (await ctx.client.post(path,json={'single':{s['category'].id:s['item'].id},'guest_agreed':True})).status_code==400

@pytest.mark.asyncio
async def test_conference_entry_exit_capacity_and_wrong_room(ctx):
    s=await setup(ctx)
    async with _Session() as db:
        z=await db.get(Zone,s['zone'].id);z.capacity=1
        other=Zone(event_id=s['event_id'],name='Other hall');db.add(other);await db.commit()
    assert (await configure(ctx,s,[{'zone_id':s['zone'].id,'can_scan_zone':True}])).status_code==200
    ctx.login(s['staff'])
    async def scan(index,direction='in',zone=None):return await ctx.client.post(url(s,'/scan'),json={'token':s['guests'][index].qr_token,'zone_id':zone or s['zone'].id,'direction':direction})
    assert (await scan(0,zone=other.id)).status_code==403
    assert (await scan(0)).json()['status']=='ok'
    assert (await scan(1)).json()['status']=='denied'
    assert len((await ctx.client.get(url(s))).json()['zones'][0]['inside'])==1
    assert (await scan(0,'out')).json()['status']=='ok'
    assert (await ctx.client.get(url(s))).json()['zones'][0]['inside']==[]
    assert (await scan(1)).json()['status']=='ok'

@pytest.mark.asyncio
async def test_each_operational_grant_is_independent(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s)])).status_code==200
    ctx.login(s['staff']);g=s['guests'][0]
    assert (await ctx.client.post(url(s,'/scan'),json={'token':g.qr_token})).status_code==403
    assert (await ctx.client.post(url(s,f'/guests/{g.id}/menu'),json={'single':{s['category'].id:s['item'].id},'guest_agreed':True})).status_code==403
    assert (await ctx.client.post(url(s,f'/guests/{g.id}/services/{s["services"][0].id}/served'))).status_code==403
    assert (await ctx.client.post(url(s,f'/guests/{g.id}/seated'),json={'seated':True})).status_code==200

@pytest.mark.asyncio
async def test_workspace_table_metadata_scoped_and_placeholder_rename(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s)])).status_code==200
    ctx.login(s['staff']);view=(await ctx.client.get(url(s))).json()
    assert [t['id'] for t in view['tables']]==[s['tables'][0].id]
    assert view['tables'][0]['capacity']==8
    ctx.login(ctx.ids['user_a']);view=(await ctx.client.get(url(s))).json()
    member=next(m for m in view['team'] if m['id']==s['eu'].id)
    assert member['can_rename_placeholder'] is True
    assert {'capacity','category','sort_order','updated_at'} <= view['locations']['tables'][0].keys()
    path=url(s,f"/members/{s['eu'].id}/placeholder-name")
    body={'name':'  Amina   Yusuf  ','if_unmodified_since':member['updated_at']}
    assert (await ctx.client.patch(path,json=body)).status_code==200
    async with _Session() as db:
        user=await db.get(User,s['staff'].id);assert user.name=='Amina Yusuf' and user.firebase_uid is None
        row=await db.get(EventUser,s['eu'].id);assert row.guest_service_scoped
    assert (await ctx.client.patch(path,json=body)).status_code==409
    ctx.login(s['staff']);assert (await ctx.client.patch(path,json=body)).status_code==403
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.patch(path,json=body)).status_code in (403,404)

@pytest.mark.asyncio
@pytest.mark.parametrize('case',['verified','real_email','org_admin','event_manager','shared_event','shared_org','wrong_org'])
async def test_placeholder_rename_cannot_modify_real_or_shared_identity(ctx,case):
    s=await setup(ctx)
    async with _Session() as db:
        user=await db.get(User,s['staff'].id);eu=await db.get(EventUser,s['eu'].id)
        if case=='verified': user.firebase_uid='verified-fixture-identity'
        if case=='real_email': user.email='real-staff@example.com'
        if case=='wrong_org':
            m=await db.scalar(select(Membership).where(Membership.user_id==user.id));m.org_id=ctx.ids['org_b']
        if case=='org_admin':
            m=await db.scalar(select(Membership).where(Membership.user_id==user.id));m.role='admin'
        if case=='event_manager':eu.event_role='manager'
        if case=='shared_event':
            other=Event(org_id=ctx.ids['org_a'],name='Another event',couples_name='Another',event_date=datetime.utcnow(),checkin_base_url='http://test');db.add(other);await db.flush();db.add(EventUser(event_id=other.id,user_id=user.id))
        if case=='shared_org':db.add(Membership(org_id=ctx.ids['org_b'],user_id=user.id,role='staff'))
        await db.commit();version=eu.updated_at.isoformat()
    ctx.login(ctx.ids['user_a'])
    view=(await ctx.client.get(url(s))).json();member=next(m for m in view['team'] if m['id']==s['eu'].id);assert member['can_rename_placeholder'] is False
    r=await ctx.client.patch(url(s,f"/members/{s['eu'].id}/placeholder-name"),json={'name':'Changed','if_unmodified_since':version})
    assert r.status_code==409
    async with _Session() as db:assert (await db.get(User,s['staff'].id)).name=='Table host'

@pytest.mark.asyncio
async def test_guest_services_guardian_qr_and_manual_verification_preserve_policy(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[{'zone_id':s['zone'].id,'can_scan_zone':True}])).status_code==200
    child,guardian=s['guests'][:2]
    async with _Session() as db:
        event=await db.get(Event,s['event_id']);event.junior_guardian_handoff_enabled=True;event.manual_checkin_enabled=False
        event.guardian_authorizations={child.id:[{'guardian_guest_id':guardian.id,'relationship':'Parent'}]};await db.commit()
    ctx.login(s['staff']);body={'token':child.qr_token,'zone_id':s['zone'].id,'direction':'in'}
    missing=await ctx.client.post(url(s,'/scan'),json=body)
    assert missing.json()['status']=='guardian_required' and missing.json()['guardian_candidates'][0]['guardian_guest_id']==guardian.id
    assert 'service-pass' not in missing.text
    assert (await ctx.client.post(url(s,'/scan'),json={**body,'guardian_guest_id':guardian.id})).json()['status']=='guardian_required'
    assert (await ctx.client.post(url(s,'/scan'),json={**body,'guardian_token':'wrong-pass'})).json()['status']=='guardian_required'
    qr=await ctx.client.post(url(s,'/scan'),json={**body,'guardian_token':guardian.qr_token});assert qr.json()['status']=='ok' and qr.json()['guardian_verification_method']=='guardian_qr'
    async with _Session() as db:
        event=await db.get(Event,s['event_id']);event.manual_checkin_enabled=True;await db.commit()
    manual=await ctx.client.post(url(s,'/scan'),json={**body,'direction':'out','guardian_guest_id':guardian.id});assert manual.json()['status']=='ok' and manual.json()['guardian_verification_method']=='guardian_manual'

@pytest.mark.asyncio
async def test_assignment_ids_survive_legacy_save_and_explicit_shift_edit(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_checkin=True)])).status_code==200
    ctx.login(s['staff']);first=(await ctx.client.get(url(s))).json()['assignments'][0]
    assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    ctx.login(s['staff']);second=(await ctx.client.get(url(s))).json()['assignments'][0];assert first['id']==second['id']
    assert (await configure(ctx,s,[table(s,id=second['id'],is_lead=True,starts_at='2026-01-01T00:00:00Z')])).status_code==200
    ctx.login(s['staff']);third=(await ctx.client.get(url(s))).json()['assignments'][0];assert third['id']==first['id'] and third['is_lead']
    assert (await configure(ctx,s,[table(s,id='someone-elses-id')])).status_code==404

@pytest.mark.asyncio
async def test_request_retry_returns_original_after_assignment_removed(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s)])).status_code==200
    ctx.login(s['staff']);assignment=(await ctx.client.get(url(s))).json()['assignments'][0]
    body={'assignment_id':assignment['id'],'request_key':'stable-retry-after-removal','title':'Water request'}
    first=await ctx.client.post(url(s,'/requests'),json=body);assert first.status_code==200
    assert (await configure(ctx,s,[])).status_code==200
    ctx.login(s['staff']);retry=await ctx.client.post(url(s,'/requests'),json=body);assert retry.status_code==200 and retry.json()['task_id']==first.json()['task_id'] and retry.json()['already_created']
    assert (await ctx.client.post(url(s,'/requests'),json={**body,'request_key':'new-request-after-removal'})).status_code==403
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(Task))==1
        membership=await db.scalar(select(Membership).where(Membership.user_id==s['staff'].id));await db.delete(membership);await db.commit()
    assert (await ctx.client.post(url(s,'/requests'),json=body)).status_code==404

@pytest.mark.asyncio
async def test_workspace_reports_upcoming_full_and_ready_meal_states(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    async with _Session() as db:
        service=await db.get(MealService,s['services'][0].id);service.starts_at=datetime.utcnow()+timedelta(days=1);await db.commit()
    ctx.login(s['staff']);view=(await ctx.client.get(url(s))).json();service=view['guests'][0]['meal_services'][0]
    assert service['availability']=='upcoming' and not service['can_serve'] and service['starts_at']
    assert (await ctx.client.post(url(s,f"/guests/{s['guests'][0].id}/services/{s['services'][0].id}/served"))).status_code==409
    async with _Session() as db:
        service=await db.get(MealService,s['services'][0].id);service.starts_at=None;service.capacity=1
        db.add(GuestMealService(service_id=service.id,guest_id=s['guests'][1].id,fulfillment_status='served'));await db.commit()
    view=(await ctx.client.get(url(s))).json();service=view['guests'][0]['meal_services'][0];assert service['availability']=='full' and not service['can_serve'] and service['remaining_capacity']==0
    ready=view['guests'][0]['meal_services'][1];assert ready['availability']=='available' and ready['can_serve']

@pytest.mark.asyncio
async def test_setup_warnings_are_supervisor_only_and_menu_batch_matches_canonical(ctx):
    from app.routers.menu import categories_out,_cat_out
    from app.models import MenuCombination,MenuCombinationItem
    s=await setup(ctx)
    async with _Session() as db:
        combo=MenuCombination(event_id=s['event_id'],category_id=s['category'].id,name='Lunch plate',sort_order=2);db.add(combo);await db.flush()
        db.add(MenuCombinationItem(combination_id=combo.id,menu_item_id=s['item'].id,quantity=2));await db.commit()
        cats=[await db.get(MenuCategory,s['category'].id)];batched=await categories_out(cats,db);ordinary=[await _cat_out(cats[0],db)];assert [r.model_dump() for r in batched]==[r.model_dump() for r in ordinary]
    ctx.login(ctx.ids['user_a']);view=(await ctx.client.get(url(s))).json();assert view['setup_warnings']['unallocated_guests']==1 and view['setup_warnings']['unclaimed_placeholders']==1 and view['setup_warnings']['services_without_windows']==2
    ctx.login(s['staff']);assert 'setup_warnings' not in (await ctx.client.get(url(s))).json()

async def selected_meal_setup(ctx, capacity=None):
    s=await setup(ctx)
    async with _Session() as db:
        for g in s['guests']:
            db.add(GuestMenuChoice(guest_id=g.id,category_id=s['category'].id,menu_item_id=s['item'].id))
        service=await db.get(MealService,s['services'][0].id);service.capacity=capacity
        await db.commit()
    assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    ctx.login(s['staff'])
    return s

def progress_url(s,row,kitchen=False):
    return (f"/api/events/{s['event_id']}/meal-services/{row['service_id']}/guests/{row['guest_id']}/progress" if kitchen else url(s,f"/guests/{row['guest_id']}/meals/{row['service_id']}/progress"))
def progress_body(row,status):return {'status':status,'expected_status':row['status'],'selection_key':row['selection_key']}

@pytest.mark.asyncio
async def test_canonical_meal_queue_scopes_progress_and_shared_kitchen(ctx):
    s=await selected_meal_setup(ctx)
    rows=(await ctx.client.get(url(s))).json()['meal_requests'];assert len(rows)==2 and all(r['guest_id']==s['guests'][0].id for r in rows)
    row=rows[0];body=progress_body(row,'preparing')
    assert (await ctx.client.post(progress_url(s,row),json=body)).status_code==200
    assert (await ctx.client.post(progress_url(s,row),json=body)).json()['already_recorded']
    # Kitchen is the same ledger, and scoped table staff do not gain kitchen access.
    assert (await ctx.client.post(progress_url(s,row,True),json=progress_body(row,'ready'))).status_code==403
    ctx.login(ctx.ids['user_a']);kitchen=(await ctx.client.get(f"/api/events/{s['event_id']}/menu/dashboard")).json()
    current=next(r for r in kitchen['meal_requests'] if r['id']==row['id']);assert current['status']=='preparing'
    assert (await ctx.client.post(progress_url(s,row,True),json=progress_body(current,'ready'))).status_code==200
    ctx.login(s['staff']);current=next(r for r in (await ctx.client.get(url(s))).json()['meal_requests'] if r['id']==row['id']);assert current['status']=='ready'
    assert (await ctx.client.post(progress_url(s,row),json=progress_body(current,'served'))).status_code==200
    async with _Session() as db:
        records=(await db.scalars(select(GuestMealService).where(GuestMealService.guest_id==row['guest_id'],GuestMealService.service_id==row['service_id']))).all();assert len(records)==1 and records[0].fulfillment_status=='served' and records[0].served_by_user_id==s['staff'].id
        assert await db.scalar(select(func.count()).select_from(GuestServiceActivity).where(GuestServiceActivity.action=='meal_progress'))==3

@pytest.mark.asyncio
async def test_meal_queue_rejects_cross_table_and_stale_choices_or_stages(ctx):
    s=await selected_meal_setup(ctx);row=(await ctx.client.get(url(s))).json()['meal_requests'][0]
    foreign={**row,'guest_id':s['guests'][1].id}
    assert (await ctx.client.post(progress_url(s,foreign),json=progress_body(row,'preparing'))).status_code==403
    assert (await ctx.client.post(progress_url(s,row),json=progress_body(row,'ready'))).status_code==409
    assert (await ctx.client.post(progress_url(s,row),json={**progress_body(row,'preparing'),'selection_key':'a'*64})).status_code==409
    assert (await ctx.client.post(progress_url(s,row),json=progress_body(row,'preparing'))).status_code==200
    assert (await ctx.client.post(progress_url(s,row),json=progress_body(row,'served'))).status_code==409
    future=(datetime.utcnow()+timedelta(days=1)).isoformat();assert (await configure(ctx,s,[table(s,can_manage_meals=True,starts_at=future)])).status_code==200
    ctx.login(s['staff']);assert (await ctx.client.post(progress_url(s,row),json={'status':'ready','expected_status':'preparing','selection_key':row['selection_key']})).status_code==403

@pytest.mark.asyncio
async def test_preparation_reserves_capacity_and_keeps_own_delivery_available(ctx):
    s=await selected_meal_setup(ctx,capacity=1);ctx.login(ctx.ids['user_a']);rows=(await ctx.client.get(url(s))).json()['meal_requests'];first=next(r for r in rows if r['service_id']==s['services'][0].id and r['guest_id']==s['guests'][0].id);other=next(r for r in rows if r['service_id']==first['service_id'] and r['guest_id']==s['guests'][1].id)
    assert (await ctx.client.post(progress_url(s,first),json=progress_body(first,'preparing'))).status_code==200
    assert (await ctx.client.post(progress_url(s,other),json=progress_body(other,'preparing'))).status_code==409
    rows=(await ctx.client.get(url(s))).json()['meal_requests'];own=next(r for r in rows if r['id']==first['id']);blocked=next(r for r in rows if r['id']==other['id']);assert own['can_progress'] and not blocked['can_progress']
    assert (await ctx.client.post(progress_url(s,own),json=progress_body(own,'ready'))).status_code==200
    assert (await ctx.client.post(progress_url(s,own),json={'status':'served','expected_status':'ready','selection_key':own['selection_key']})).status_code==200
    # The legacy scoped shortcut cannot consume another guest's reservation.
    assert (await ctx.client.post(url(s,f"/guests/{other['guest_id']}/services/{other['service_id']}/served"))).status_code==409

@pytest.mark.asyncio
async def test_guest_and_assisted_choices_lock_when_preparation_starts(ctx):
    s=await selected_meal_setup(ctx);row=(await ctx.client.get(url(s))).json()['meal_requests'][0]
    assert (await ctx.client.post(progress_url(s,row),json=progress_body(row,'preparing'))).status_code==200
    async with _Session() as db:
        item=MenuItem(event_id=s['event_id'],category_id=s['category'].id,name='Soup');db.add(item);await db.commit()
    changed={'single':{s['category'].id:item.id}}
    assert (await ctx.client.post('/api/scan/'+s['guests'][0].qr_token+'/menu',json=changed)).status_code==400
    assert (await ctx.client.post(url(s,f"/guests/{s['guests'][0].id}/menu"),json={**changed,'guest_agreed':True})).status_code==400
    unchanged={'single':{s['category'].id:s['item'].id}}
    assert (await ctx.client.post('/api/scan/'+s['guests'][0].qr_token+'/menu',json=unchanged)).status_code==200
    assert (await ctx.client.get(url(s))).json()['meal_requests'][0]['status']=='preparing'

@pytest.mark.asyncio
async def test_table_sections_persist_without_rewriting_legacy_metadata(ctx):
    s=await setup(ctx);ctx.login(ctx.ids['user_a']);tid=s['tables'][0].id;base=f"/api/events/{s['event_id']}/tables/{tid}"
    # Canonical table editing uses the existing seating route.
    response=await ctx.client.put(base,json={'name':'East 1','capacity':8,'category':'VIP','service_section':'East wing'})
    assert response.status_code==200,response.text
    assert response.json()['service_section']=='East wing'
    assert (await ctx.client.put(base,json={'name':'East 1','capacity':9,'category':'VIP'})).status_code==200
    w=(await ctx.client.get(url(s))).json();assert next(t for t in w['tables'] if t['id']==tid)['service_section']=='East wing'

@pytest.mark.asyncio
async def test_new_selectable_category_has_immediate_canonical_service(ctx):
    s=await setup(ctx);ctx.login(ctx.ids['user_a']);path=f"/api/events/{s['event_id']}/menu-categories"
    created=await ctx.client.post(path,json={'name':'Dessert','selection_type':'single','display_only':False});assert created.status_code==201,created.text
    cid=created.json()['id']
    for _ in range(2):
        assert (await ctx.client.put(path+'/'+cid,json={'name':'Dessert','selection_type':'single','display_only':False})).status_code==200
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(MealService).where(MealService.category_id==cid))==1

@pytest.mark.asyncio
async def test_legacy_delivery_shortcut_cannot_bypass_scope_or_capacity(ctx):
    s=await selected_meal_setup(ctx,capacity=1);row=next(r for r in (await ctx.client.get(url(s))).json()['meal_requests'] if r['service_id']==s['services'][0].id)
    assert (await ctx.client.post(progress_url(s,row),json=progress_body(row,'preparing'))).status_code==200
    legacy=f"/api/events/{s['event_id']}/guests/{s['guests'][1].id}/meal-served"
    assert (await ctx.client.patch(legacy)).status_code==403
    ctx.login(ctx.ids['user_a']);assert (await ctx.client.patch(legacy)).status_code==409

async def tracking(ctx,s,index=0,mode='both',expected='orders'):
    ctx.login(ctx.ids['user_a'])
    return await ctx.client.patch(url(s,f"/meals/{s['services'][index].id}/tracking"),json={'tracking_mode':mode,'expected_mode':expected})
def attendance_path(s,index=0):return url(s,f"/meals/{s['services'][index].id}/attendance")

@pytest.mark.asyncio
async def test_meal_headcount_without_order_duplicate_and_occurrence_independence(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    for i in range(2):assert (await tracking(ctx,s,i,'headcount')).status_code==200
    ctx.login(s['staff']);body={'token':s['guests'][0].qr_token}
    for i in range(2):
        first=await ctx.client.post(attendance_path(s,i),json=body);assert first.status_code==200,first.text
        repeat=await ctx.client.post(attendance_path(s,i),json=body);assert repeat.json()['already_counted']
    view=(await ctx.client.get(url(s))).json();assert view['meal_requests']==[] and view['menu_categories']==[]
    assert all(m['expected']==1 and m['attended']==1 and m['not_yet_attended']==0 and m['ordered']==0 and m['delivered']==0 for m in view['meal_services'])
    assert not view['guests'][0]['meal_services'][0]['can_serve']
    async with _Session() as db:
        rows=(await db.scalars(select(GuestMealService).where(GuestMealService.guest_id==s['guests'][0].id))).all();assert len(rows)==2 and all(r.attended_at and r.attended_by_user_id==s['staff'].id and r.fulfillment_status=='pending' and r.served_at is None for r in rows)
        assert await db.scalar(select(func.count()).select_from(GuestMenuChoice))==0
        assert not (await db.get(Guest,s['guests'][0].id)).meal_served
        assert await db.scalar(select(func.count()).select_from(GuestServiceActivity).where(GuestServiceActivity.action=='meal_attendance'))==2
    # No hidden required menu form or backdoor order placement in headcount-only mode.
    menu=(await ctx.client.get(f"/api/events/{s['event_id']}/menu")).json();assert not any(c['id']==s['category'].id for c in menu)
    assert (await ctx.client.post('/api/scan/'+s['guests'][0].qr_token+'/menu',json={'single':{s['category'].id:s['item'].id}})).status_code==400

@pytest.mark.asyncio
async def test_both_mode_preserves_preparation_and_attendance_is_independent_capacity(ctx):
    s=await selected_meal_setup(ctx,capacity=1);assert (await tracking(ctx,s)).status_code==200
    ctx.login(s['staff']);row=next(r for r in (await ctx.client.get(url(s))).json()['meal_requests'] if r['service_id']==s['services'][0].id)
    assert (await ctx.client.post(progress_url(s,row),json=progress_body(row,'preparing'))).status_code==200
    assert (await ctx.client.post(attendance_path(s),json={'token':s['guests'][0].qr_token})).status_code==200
    view=(await ctx.client.get(url(s))).json();summary=next(m for m in view['meal_services'] if m['id']==row['service_id']);assert summary['attended']==1 and summary['ordered']==1 and summary['preparing']==1 and summary['delivered']==0
    assert next(r for r in view['meal_requests'] if r['id']==row['id'])['status']=='preparing'
    ctx.login(ctx.ids['user_a']);path=f"/api/events/{s['event_id']}/meal-services/{row['service_id']}/attendance"
    assert (await ctx.client.post(path,json={'token':s['guests'][1].qr_token})).status_code==409
    assert (await tracking(ctx,s,mode='orders',expected='both')).status_code==409
    assert (await tracking(ctx,s,mode='headcount',expected='both')).status_code==409

@pytest.mark.asyncio
async def test_meal_attendance_scope_permissions_and_event_admission_are_separate(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    assert (await tracking(ctx,s)).status_code==200;ctx.login(s['staff'])
    assert (await ctx.client.post(attendance_path(s),json={'token':s['guests'][1].qr_token})).status_code==403
    assert (await ctx.client.patch(url(s,f"/meals/{s['services'][0].id}/tracking"),json={'tracking_mode':'headcount','expected_mode':'both'})).status_code==403
    assert (await ctx.client.post(f"/api/events/{s['event_id']}/meal-services/{s['services'][0].id}/attendance",json={'token':s['guests'][0].qr_token})).status_code==403
    async with _Session() as db:
        guest=await db.get(Guest,s['guests'][0].id);guest.admitted=False;await db.commit()
    assert (await ctx.client.post(attendance_path(s),json={'token':s['guests'][0].qr_token})).status_code==409
    async with _Session() as db:assert not (await db.get(Guest,s['guests'][0].id)).admitted
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.post(attendance_path(s),json={'token':s['guests'][0].qr_token})).status_code==404

@pytest.mark.asyncio
async def test_meal_headcount_guards_windows_eligibility_and_orders_only(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    ctx.login(s['staff']);body={'token':s['guests'][0].qr_token}
    assert (await ctx.client.post(attendance_path(s),json=body)).status_code==409
    assert (await tracking(ctx,s,mode='headcount')).status_code==200
    ctx.login(s['staff'])
    for field,value in [('starts_at',datetime.utcnow()+timedelta(days=1)),('ends_at',datetime.utcnow()-timedelta(days=1)),('capacity',0),('status','closed')]:
        async with _Session() as db:
            service=await db.get(MealService,s['services'][0].id);service.starts_at=None;service.ends_at=None;service.capacity=None;service.status='open';setattr(service,field,value);await db.commit()
        assert (await ctx.client.post(attendance_path(s),json=body)).status_code==409,field
    async with _Session() as db:
        service=await db.get(MealService,s['services'][0].id);service.status='open';db.add(GuestMealService(service_id=service.id,guest_id=s['guests'][0].id,eligibility_status='not_eligible'));await db.commit()
    assert (await ctx.client.post(attendance_path(s),json=body)).status_code==403

@pytest.mark.asyncio
async def test_attendance_correction_is_audited_and_never_changes_orders(ctx):
    s=await selected_meal_setup(ctx);assert (await tracking(ctx,s)).status_code==200;ctx.login(s['staff'])
    recorded=(await ctx.client.post(attendance_path(s),json={'token':s['guests'][0].qr_token})).json();assert recorded.get('attended_at'),recorded
    path=attendance_path(s)+f"/{s['guests'][0].id}/correct";body={'expected_attended_at':recorded['attended_at'],'reason':'Wrong meal selected at the desk'}
    assert (await ctx.client.post(path,json=body)).status_code==403
    ctx.login(ctx.ids['user_a']);assert (await ctx.client.post(path,json={**body,'reason':'        '})).status_code==422
    assert (await ctx.client.post(path,json={**body,'expected_attended_at':'2000-01-01T00:00:00'})).status_code==409
    assert (await ctx.client.post(path,json=body)).status_code==200
    assert (await ctx.client.post(path,json=body)).status_code==409
    async with _Session() as db:
        record=await db.scalar(select(GuestMealService).where(GuestMealService.guest_id==s['guests'][0].id,GuestMealService.service_id==s['services'][0].id));assert record.attended_at is None and record.fulfillment_status=='pending'
        assert await db.scalar(select(func.count()).select_from(GuestMenuChoice))==3
        audit=await db.scalar(select(GuestServiceActivity).where(GuestServiceActivity.action=='meal_attendance_corrected'));assert audit.detail['reason']==body['reason'] and audit.detail['recorded_by']==s['staff'].id

@pytest.mark.asyncio
async def test_global_headcount_includes_unallocated_guests_without_expanding_staff_view(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    assert (await tracking(ctx,s,mode='headcount')).status_code==200
    async with _Session() as db:
        guest=await db.get(Guest,s['guests'][1].id);guest.table_id=None;await db.commit()
    ctx.login(ctx.ids['user_a']);view=(await ctx.client.get(url(s))).json();assert view['meal_services'][0]['expected']==4 and view['meal_services'][0]['scope']=='Entire event'
    response=await ctx.client.post(f"/api/events/{s['event_id']}/meal-services/{s['services'][0].id}/attendance",json={'token':s['guests'][1].qr_token});assert response.status_code==200,response.text
    ctx.login(s['staff']);view=(await ctx.client.get(url(s))).json();assert view['meal_services'][0]['expected']==1 and view['meal_services'][0]['attended']==0
    assert all(s['guests'][1].id!=row['guest_id'] for service in view['meal_services'] for row in service['recent_attendees'])

@pytest.mark.asyncio
async def test_audit_history_keeps_denied_scan_and_enforces_supervisor(ctx):
    s=await setup(ctx)
    assert (await configure(ctx,s,[table(s,can_checkin=True)])).status_code==200
    ctx.login(s['staff'])
    assert (await ctx.client.post(url(s,'/scan'),json={'token':s['guests'][0].qr_token,'zone_id':s['zone'].id})).status_code==403
    assert (await ctx.client.get(url(s,'/activity'))).status_code==403
    ctx.login(ctx.ids['user_a'])
    response=await ctx.client.get(url(s,'/activity'),params={'action':'scan_attempt','actor_id':s['staff'].id,'limit':1})
    assert response.status_code==200
    assert response.json()['total']==1
    assert response.json()['rows'][0]['guest_id']==s['guests'][0].id
    assert 'service-pass' not in response.text
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get(url(s,'/activity'))).status_code==404

@pytest.mark.asyncio
async def test_inactive_event_cannot_serve_and_workspace_disables_actions(ctx):
    s=await setup(ctx)
    assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    async with _Session() as db:
        event=await db.get(Event,s['event_id']);event.status='paused'
        db.add(GuestMenuChoice(guest_id=s['guests'][0].id,category_id=s['category'].id,menu_item_id=s['item'].id))
        await db.commit()
    ctx.login(s['staff'])
    response=await ctx.client.post(url(s,f"/guests/{s['guests'][0].id}/services/{s['services'][0].id}/served"))
    assert response.status_code==409,response.text
    body=(await ctx.client.get(url(s))).json()
    assert body['meal_requests'] and all(not r['can_progress'] for r in body['meal_requests'])
    assert all(not m['can_serve'] for g in body['guests'] for m in g['meal_services'])


@pytest.mark.asyncio
async def test_assisted_menu_rejects_empty_or_unknown_payloads_without_audit(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    ctx.login(s['staff']);path=url(s,f"/guests/{s['guests'][0].id}/menu")
    for body in ({'guest_agreed':True},{'selections':[1],'guest_agreed':True},{'single':{},'guest_agreed':True},{'single':{s['category'].id:s['item'].id},'surprise':1,'guest_agreed':True}):
        assert (await ctx.client.post(path,json=body)).status_code==422,body
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(GuestServiceActivity).where(GuestServiceActivity.action=='assisted_menu'))==0

@pytest.mark.asyncio
async def test_supervisor_requests_help_for_any_location_without_assignment(ctx):
    s=await setup(ctx);ctx.login(ctx.ids['user_a'])
    body={'table_id':s['tables'][2].id,'request_key':'supervisor-table-request','title':'Extra water'}
    first=await ctx.client.post(url(s,'/requests'),json=body);assert first.status_code==200 and not first.json()['already_created']
    again=await ctx.client.post(url(s,'/requests'),json=body);assert again.json()=={'task_id':first.json()['task_id'],'already_created':True}
    room=await ctx.client.post(url(s,'/requests'),json={'zone_id':s['zone'].id,'request_key':'supervisor-room-request','title':'Projector'});assert room.status_code==200
    for bad in ({'table_id':'missing'},{'table_id':s['tables'][0].id,'zone_id':s['zone'].id},{}):
        assert (await ctx.client.post(url(s,'/requests'),json={'request_key':'bad-target-key','title':'x',**bad})).status_code in (404,422),bad
    async with _Session() as db:
        titles=sorted(t.title for t in (await db.scalars(select(Task))).all());assert titles==['Conference Hall: Projector','Table 2: Extra water']

@pytest.mark.asyncio
async def test_ordinary_staff_cannot_request_for_unassigned_location(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,0)])).status_code==200
    ctx.login(s['staff'])
    assert (await ctx.client.post(url(s,'/requests'),json={'table_id':s['tables'][1].id,'request_key':'staff-unassigned-key','title':'Water'})).status_code==403
    assert (await ctx.client.post(url(s,'/requests'),json={'table_id':s['tables'][0].id,'request_key':'staff-unassigned-key2','title':'Water'})).status_code==403

@pytest.mark.asyncio
async def test_served_meal_request_is_labelled_delivered(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    ctx.login(s['staff']);g=s['guests'][0]
    assert (await ctx.client.post(url(s,f"/guests/{g.id}/menu"),json={'single':{s['category'].id:s['item'].id},'guest_agreed':True})).status_code==200
    assert (await ctx.client.post(url(s,f"/guests/{g.id}/services/{s['services'][0].id}/served"))).status_code==200
    row=[r for r in (await ctx.client.get(url(s))).json()['meal_requests'] if r['guest_id']==g.id and r['service_id']==s['services'][0].id][0]
    assert row['status']=='served' and row['availability_reason']=='Delivered' and not row['can_progress']

@pytest.mark.asyncio
async def test_location_request_uses_explicit_references_and_preserves_retry_receipts(ctx):
    from app.models import GuestServiceRequest
    s=await setup(ctx);ctx.login(ctx.ids['user_a'])
    assert not ctx.ids['user_a'].is_platform_superadmin
    async with _Session() as db:
        membership=await db.scalar(select(Membership).where(Membership.user_id==ctx.ids['user_a'].id,Membership.org_id==ctx.ids['org_a']));membership.role='admin';await db.commit()
    bodies=[{'table_id':s['tables'][0].id,'request_key':'explicit-table-request','title':'Water'},
            {'zone_id':s['zone'].id,'request_key':'explicit-zone-request','title':'Sound'}]
    for body in bodies:
        first=await ctx.client.post(url(s,'/requests'),json=body);assert first.status_code==200,first.text
        retry=await ctx.client.post(url(s,'/requests'),json=body)
        assert retry.json()=={'task_id':first.json()['task_id'],'already_created':True}
    async with _Session() as db:
        rows=(await db.scalars(select(GuestServiceRequest).where(GuestServiceRequest.event_id==s['event_id']))).all()
        assert len(rows)==2
        assert all(r.assignment_id is None for r in rows)
        assert {r.table_id for r in rows}=={None,s['tables'][0].id}
        assert {r.zone_id for r in rows}=={None,s['zone'].id}
        assert await db.scalar(select(func.count()).select_from(Task))==2

@pytest.mark.asyncio
async def test_supervisor_location_request_rejects_other_event_table_and_room(ctx):
    s=await setup(ctx)
    async with _Session() as db:
        event=Event(org_id=ctx.ids['org_b'],name='Other event',couples_name='Other',event_date=datetime.utcnow(),checkin_base_url='http://test');db.add(event);await db.flush()
        t=SeatingTable(event_id=event.id,name='Other table',capacity=4);z=Zone(event_id=event.id,name='Other room')
        db.add_all([t,z]);await db.commit()
    ctx.login(ctx.ids['user_a'])
    for field,value in [('table_id',t.id),('zone_id',z.id)]:
        response=await ctx.client.post(url(s,'/requests'),json={field:value,'request_key':'foreign-location-'+field,'title':'Water'})
        assert response.status_code==404,response.text
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(Task))==0

@pytest.mark.asyncio
async def test_scan_activity_records_real_outcomes_without_pass_tokens(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_checkin=True)])).status_code==200
    ctx.login(s['staff'])
    assert (await ctx.client.post(url(s,'/scan'),json={'token':s['guests'][0].qr_token})).status_code==200
    assert (await ctx.client.post(url(s,'/scan'),json={'token':s['guests'][1].qr_token})).status_code==403
    assert (await ctx.client.post(url(s,'/scan'),json={'token':'unknown-secret-token'})).status_code==404
    async with _Session() as db:
        rows=(await db.scalars(select(GuestServiceActivity).where(GuestServiceActivity.event_id==s['event_id'],GuestServiceActivity.action=='scan_attempt'))).all()
        assert len(rows)==3
        outcomes={r.detail['outcome'] for r in rows}
        assert 'denied' in outcomes and 'not_found' in outcomes and len(outcomes)==3
        assert all('secret-token' not in str(r.detail) and 'service-pass' not in str(r.detail) for r in rows)

@pytest.mark.asyncio
async def test_paged_workspace_is_bounded_and_keeps_whole_scope_totals(ctx):
    s=await setup(ctx);ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        db.add_all([Guest(event_id=s['event_id'],first_name=f'Extra {i:03}',last_name='Guest',table_id=s['tables'][0].id,qr_token=f'paged-{i}',admitted=True,rsvp_status='confirmed') for i in range(70)])
        await db.commit()
    response=await ctx.client.get(url(s),params={'paged':True,'view':'tables'})
    assert response.status_code==200,response.text
    body=response.json();assert body['guests']==[] and body['metrics']['assigned']==73
    assert next(t for t in body['tables'] if t['id']==s['tables'][0].id)['metrics']['assigned']==71
    params={'paged':True,'view':'guests','page':1}
    first=(await ctx.client.get(url(s),params=params)).json()
    assert len(first['guests'])==24 and first['pagination']['total']==73
    second=(await ctx.client.get(url(s),params={**params,'page':2})).json()
    assert len(second['guests'])==24 and not ({g['id'] for g in first['guests']}&{g['id'] for g in second['guests']})
    unchanged=(await ctx.client.get(url(s),params={**params,'since':first['revision']})).json()
    assert unchanged['unchanged'] is True and 'guests' not in unchanged
    async with _Session() as db:
        guest=await db.get(Guest,s['guests'][0].id);guest.first_name='Changed';await db.commit()
    changed=(await ctx.client.get(url(s),params={**params,'since':first['revision']})).json()
    assert not changed.get('unchanged') and changed['revision']!=first['revision']

@pytest.mark.asyncio
async def test_paged_meals_and_attendance_match_legacy_totals_without_expanding_staff_scope(ctx):
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    async with _Session() as db:
        for guest in s['guests']:db.add(GuestMenuChoice(guest_id=guest.id,category_id=s['category'].id,menu_item_id=s['item'].id))
        await db.commit()
    ctx.login(s['staff'])
    legacy=(await ctx.client.get(url(s))).json()
    paged=await ctx.client.get(url(s),params={'paged':True,'view':'attendance'})
    assert paged.status_code==200,paged.text
    for expected,actual in zip(legacy['meal_services'],paged.json()['meal_services']):
        for key in ['expected','ordered','attended','delivered','not_yet_attended']:assert expected[key]==actual[key],(key,expected,actual)
    meals=await ctx.client.get(url(s),params={'paged':True,'view':'meals'})
    assert meals.status_code==200,meals.text
    assert meals.json()['pagination']['total']==2
    assert all(r['guest_id']==s['guests'][0].id for r in meals.json()['meal_requests'])
    before=meals.json()['revision']
    ctx.login(ctx.ids['user_a']);assert (await configure(ctx,s,[])).status_code==200
    ctx.login(s['staff'])
    after=(await ctx.client.get(url(s),params={'paged':True,'view':'meals','since':before})).json()
    assert not after.get('unchanged') and after['guests']==[] and after['meal_requests']==[]


def offline_body(s,action='seated',**extra):
    return {'client_key':'offline-operation-unique-key','action':action,'guest_id':s['guests'][0].id,'table_id':s['tables'][0].id,'captured_at':datetime.utcnow().isoformat(),**extra}

@pytest.mark.asyncio
async def test_offline_seating_receipt_is_atomic_and_cannot_reapply_after_correction(ctx):
    from app.models import GuestServiceOfflineReceipt
    s=await setup(ctx);assert (await configure(ctx,s,[table(s)])).status_code==200;ctx.login(s['staff'])
    body=offline_body(s)
    response=await ctx.client.post(url(s,'/offline-actions'),json=body);assert response.status_code==200,response.text
    async with _Session() as db:
        row=await db.get(GuestSeatingPresence,s['guests'][0].id);await db.delete(row);await db.commit()
    retry=await ctx.client.post(url(s,'/offline-actions'),json=body)
    assert retry.status_code==200 and retry.json()['already_synced']
    async with _Session() as db:
        assert await db.get(GuestSeatingPresence,s['guests'][0].id) is None
        assert await db.scalar(select(func.count()).select_from(GuestServiceOfflineReceipt))==1
    other={**body,'guest_id':s['guests'][1].id}
    assert (await ctx.client.post(url(s,'/offline-actions'),json=other)).status_code==409

@pytest.mark.asyncio
async def test_offline_replay_rechecks_current_table_shift_admission_and_capacity(ctx):
    from app.models import GuestServiceOfflineReceipt
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200;ctx.login(s['staff'])
    body=offline_body(s)
    async with _Session() as db:
        g=await db.get(Guest,s['guests'][0].id);g.admitted=False;await db.commit()
    assert (await ctx.client.post(url(s,'/offline-actions'),json=body)).status_code==409
    ctx.login(ctx.ids['user_a']);assert (await configure(ctx,s,[])).status_code==200;ctx.login(s['staff'])
    assert (await ctx.client.post(url(s,'/offline-actions'),json=body)).status_code==403
    ctx.login(ctx.ids['user_a']);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    async with _Session() as db:
        g=await db.get(Guest,s['guests'][0].id);g.admitted=True
        service=await db.get(MealService,s['services'][0].id);service.tracking_mode='both';service.capacity=0
        await db.commit()
    ctx.login(s['staff'])
    headcount=offline_body(s,'attendance',service_id=s['services'][0].id)
    assert (await ctx.client.post(url(s,'/offline-actions'),json=headcount)).status_code==409
    async with _Session() as db:assert await db.scalar(select(func.count()).select_from(GuestServiceOfflineReceipt))==0

@pytest.mark.asyncio
async def test_offline_delivery_and_attendance_use_canonical_ledgers_and_reject_stale_choices(ctx):
    from app.services.meal_queue import selection_key
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,can_manage_meals=True)])).status_code==200
    async with _Session() as db:
        service=await db.get(MealService,s['services'][0].id);service.tracking_mode='both'
        choice=GuestMenuChoice(guest_id=s['guests'][0].id,category_id=s['category'].id,menu_item_id=s['item'].id);db.add(choice);await db.flush();key=selection_key([choice]);await db.commit()
    ctx.login(s['staff'])
    body=offline_body(s,'served',service_id=s['services'][0].id,expected_selection_key='bad-choice')
    assert (await ctx.client.post(url(s,'/offline-actions'),json=body)).status_code==409
    body['expected_selection_key']=key
    served=await ctx.client.post(url(s,'/offline-actions'),json=body);assert served.status_code==200,served.text
    attendance=offline_body(s,'attendance',client_key='another-offline-operation',service_id=s['services'][0].id,expected_record_updated_at=served.json()['record_updated_at'])
    counted=await ctx.client.post(url(s,'/offline-actions'),json=attendance);assert counted.status_code==200,counted.text
    async with _Session() as db:
        record=await db.scalar(select(GuestMealService).where(GuestMealService.guest_id==s['guests'][0].id,GuestMealService.service_id==s['services'][0].id))
        assert record.fulfillment_status=='served' and record.attended_at is not None

@pytest.mark.asyncio
async def test_offline_expiry_and_table_move_never_write_a_receipt(ctx):
    from app.models import GuestServiceOfflineReceipt
    s=await setup(ctx);assert (await configure(ctx,s,[table(s,0),table(s,1)])).status_code==200;ctx.login(s['staff'])
    expired=offline_body(s,captured_at=(datetime.utcnow()-timedelta(hours=13)).isoformat())
    assert (await ctx.client.post(url(s,'/offline-actions'),json=expired)).status_code==409
    body=offline_body(s)
    async with _Session() as db:
        guest=await db.get(Guest,s['guests'][0].id);guest.table_id=s['tables'][1].id;guest.seat_number='2';await db.commit()
    assert (await ctx.client.post(url(s,'/offline-actions'),json=body)).status_code==409
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(GuestServiceOfflineReceipt))==0
        assert await db.get(GuestSeatingPresence,s['guests'][0].id) is None

@pytest.mark.asyncio
async def test_activity_guest_lookup_is_supervisor_only_and_includes_unallocated_guests(ctx):
    s=await setup(ctx);ctx.login(ctx.ids['user_a'])
    response=await ctx.client.get(url(s,'/guest-search'),params={'q':'G One'})
    assert response.status_code==200 and len(response.json())==1,response.text
    assert set(response.json()[0])=={'id','name'}
    assert 'email' not in response.text and 'token' not in response.text
    ctx.login(s['staff']);assert (await ctx.client.get(url(s,'/guest-search'))).status_code==403
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.get(url(s,'/guest-search'))).status_code==404
