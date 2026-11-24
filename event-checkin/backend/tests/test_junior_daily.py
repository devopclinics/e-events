from datetime import datetime,timedelta
import uuid
import pytest
from fastapi import HTTPException
from sqlalchemy import select,func
from conftest import _Session
from app.models import Event,Guest,AttendanceRecord,User,Membership,EventUser,SeatingTable,ExperienceWorkflow,ExperienceStep
from app.junior_models import JuniorChild,JuniorMovement,JuniorConfig
from app.services import junior_days as days
from app.routers import junior,scanner
from test_junior_programme import setup,child,act,drop

async def clock_setup(ctx,monkeypatch):
    root=await setup(ctx);clock=[datetime(2026,12,24,22,0)]
    monkeypatch.setattr(days,'utcnow',lambda:clock[0])
    class Clock(datetime):
        @classmethod
        def utcnow(cls):return clock[0]
    monkeypatch.setattr(scanner,'datetime',Clock)
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a']);e.timezone='America/Indiana/Indianapolis';e.event_date=datetime(2026,12,24,14);e.event_end_date=datetime(2026,12,28,23);e.daily_checkin_enabled=True;await db.commit()
    return root,clock

async def detail(ctx,root,c):return (await ctx.client.get(root+'/children/'+c['id'])).json()
async def release(ctx,root,c):
    d=await detail(ctx,root,c)
    return await act(ctx,root,d,'release',contact_id=d['contacts'][0]['id'],identity_checked=True)

@pytest.mark.asyncio
async def test_verified_dropoff_records_convention_and_canonical_daily_attendance(ctx,monkeypatch):
    root,clock=await clock_setup(ctx,monkeypatch);c=await child(ctx,root)
    assert c['convention_admitted'] is False and not c['started_today']
    c=await drop(ctx,root,c)
    assert c['convention_admitted'] and c['started_today'] and c['programme_date']=='2026-12-24'
    async with _Session() as db:
        g=await db.get(Guest,c['guest_id']);assert g.admitted and g.admitted_at==clock[0]
        daily=await db.scalar(select(AttendanceRecord).where(AttendanceRecord.guest_id==g.id));assert daily.scope=='daily' and daily.scope_key=='2026-12-24'
    normal=await ctx.client.post('/api/scan/'+g.qr_token+'/daily-attendance');assert normal.json()['status']=='already_recorded'

@pytest.mark.asyncio
async def test_new_day_starts_fresh_without_erasing_prior_day_or_resetting_convention(ctx,monkeypatch):
    root,clock=await clock_setup(ctx,monkeypatch);c=await child(ctx,root);c=await drop(ctx,root,c);c=await act(ctx,root,c,'classroom');c=await release(ctx,root,c)
    first_at=clock[0];first_version=c['version'];clock[0]+=timedelta(days=1)
    d=await detail(ctx,root,c)
    assert d['today']=='2026-12-25' and d['programme_date']=='2026-12-24'
    assert d['location']=='not_arrived' and not d['started_today'] and not d['prior_day_unresolved']
    assert d['convention_admitted'] and d['allergy'] is None and not d['screening_wristband_assigned']
    assert d['version']==first_version
    guest_list=(await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")).json()
    assert next(g for g in guest_list if g['id']==c['guest_id'])['junior_platform_status']=='not_arrived'
    async with _Session() as db:
        raw=await db.get(JuniorChild,c['id']);assert raw.location=='released' and raw.programme_date=='2026-12-24'
    c=await drop(ctx,root,d)
    async with _Session() as db:
        g=await db.get(Guest,c['guest_id']);assert g.admitted_at==first_at
        records=(await db.scalars(select(AttendanceRecord).where(AttendanceRecord.guest_id==g.id).order_by(AttendanceRecord.scope_key))).all()
        assert [r.scope_key for r in records]==['2026-12-24','2026-12-25']
        movements=(await db.scalars(select(JuniorMovement).where(JuniorMovement.child_id==c['id'],JuniorMovement.action=='dropoff').order_by(JuniorMovement.occurred_at))).all()
        assert [m.programme_date for m in movements]==['2026-12-24','2026-12-25']

@pytest.mark.asyncio
async def test_same_day_reentry_does_not_duplicate_daily_record_or_admission_time(ctx,monkeypatch):
    root,clock=await clock_setup(ctx,monkeypatch);c=await child(ctx,root);c=await drop(ctx,root,c);first=clock[0]
    c=await release(ctx,root,c);clock[0]+=timedelta(minutes=10);c=await drop(ctx,root,c)
    async with _Session() as db:
        assert (await db.get(Guest,c['guest_id'])).admitted_at==first
        assert await db.scalar(select(func.count(AttendanceRecord.id)).where(AttendanceRecord.guest_id==c['guest_id']))==1
        assert await db.scalar(select(func.count(JuniorMovement.id)).where(JuniorMovement.child_id==c['id'],JuniorMovement.action=='dropoff'))==2

@pytest.mark.asyncio
@pytest.mark.parametrize('where',['reception','classroom','clinic','other','outing'])
async def test_overnight_open_custody_is_not_silently_reset_and_needs_supervisor(ctx,monkeypatch,where):
    root,clock=await clock_setup(ctx,monkeypatch);c=await child(ctx,root);c=await drop(ctx,root,c)
    if where!='reception':c=await act(ctx,root,c,'classroom')
    if where in ('clinic','other'):c=await act(ctx,root,c,where,adult_name='Volunteer',notes='Internal reason')
    if where=='outing':
        r=await ctx.client.post(root+'/outings',json={'name':'Day one trip','outing_date':'2026-12-24','child_ids':[c['id']],'permission_verified':True});assert r.status_code==201,r.text
        c=await act(ctx,root,c,'outing_depart',outing_id=r.json()['id'])
    clock[0]+=timedelta(days=1);d=await detail(ctx,root,c)
    assert d['location']==where and d['prior_day_unresolved'] and not d['started_today']
    await act(ctx,root,d,'dropoff',expected=409,adult_name='Parent',relationship='parent',identity_checked=True)
    async with _Session() as db:
        u=User(name='Daily scanner',email='daily-scanner@example.com',role='official');db.add(u);await db.flush()
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=u.id,role='staff'));db.add(EventUser(event_id=ctx.ids['event_a'],user_id=u.id,event_role='staff',access_level='edit'))
        cfg=await db.get(JuniorConfig,ctx.ids['event_a']);cfg.staff={u.id:'scanner'};await db.commit()
    ctx.login(u)
    r=await act(ctx,root,d,'release',expected=409,contact_id=d['contacts'][0]['id'],identity_checked=True);assert 'supervisor' in r['detail'].lower()
    async with _Session() as db:assert await db.scalar(select(func.count(AttendanceRecord.id)).where(AttendanceRecord.guest_id==c['guest_id']))==1

@pytest.mark.asyncio
async def test_supervisor_can_reconcile_old_clinic_then_start_today_with_fresh_dropoff(ctx,monkeypatch):
    root,clock=await clock_setup(ctx,monkeypatch);c=await child(ctx,root);c=await drop(ctx,root,c);c=await act(ctx,root,c,'clinic',adult_name='Clinic volunteer')
    clock[0]+=timedelta(days=1);c=await act(ctx,root,c,'return');assert c['programme_date']=='2026-12-24' and c['prior_day_unresolved']
    c=await release(ctx,root,c);assert c['location']=='not_arrived' and not c['started_today']
    notices=(await ctx.client.get(root+'/notifications')).json();assert any('Prior programme day 2026-12-24 reconciled' in n['body'] for n in notices)
    c=await drop(ctx,root,c);assert c['programme_date']=='2026-12-25' and c['started_today']

@pytest.mark.asyncio
async def test_stale_day_form_and_previous_day_request_cannot_start_today(ctx,monkeypatch):
    root,clock=await clock_setup(ctx,monkeypatch);c=await child(ctx,root)
    request={'request_id':str(uuid.uuid4()),'version':c['version'],'action':'dropoff','adult_name':'Parent','relationship':'parent','identity_checked':True,'programme_date':'2026-12-24','allergy':False,'accommodation':False}
    r=await ctx.client.post(root+f"/children/{c['id']}/actions",json=request);assert r.status_code==200;c=r.json();c=await release(ctx,root,c);clock[0]+=timedelta(days=1)
    assert (await ctx.client.post(root+f"/children/{c['id']}/actions",json=request)).status_code==409
    await act(ctx,root,c,'dropoff',expected=409,programme_date='2026-12-24',adult_name='Parent',relationship='parent',identity_checked=True)
    assert not (await detail(ctx,root,c))['started_today']

@pytest.mark.asyncio
@pytest.mark.parametrize('gate',['declined','draft','seating','required_step','outside_dates'])
async def test_convention_and_daily_rules_cannot_be_bypassed_by_dropoff(ctx,monkeypatch,gate):
    root,clock=await clock_setup(ctx,monkeypatch);c=await child(ctx,root)
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a']);g=await db.get(Guest,c['guest_id'])
        if gate=='declined':g.rsvp_status='declined'
        elif gate=='draft':e.status='draft'
        elif gate=='seating':
            e.seating_enabled=True
            table=SeatingTable(event_id=e.id,name='Full table',capacity=1);db.add(table);await db.flush()
            db.add(Guest(event_id=e.id,first_name='Already',last_name='Seated',table_id=table.id,seat_number='1',admitted=True))
        elif gate=='required_step':
            e.experience_enabled=True
            workflow=ExperienceWorkflow(event_id=e.id,name='Required steps',status='published',is_default=True,version=1);db.add(workflow);await db.flush()
            db.add(ExperienceStep(workflow_id=workflow.id,key='required',type='custom',title='Required safety step',sort_order=1,required=True,blocks_checkin=True,config={}))
        else:e.event_end_date=datetime(2026,12,23)
        await db.commit()
    await act(ctx,root,c,'dropoff',expected=409,adult_name='Parent',relationship='parent',identity_checked=True)
    async with _Session() as db:
        assert not (await db.get(Guest,c['guest_id'])).admitted
        raw=await db.get(JuniorChild,c['id']);assert raw.programme_date is None and raw.location=='not_arrived'
        assert await db.scalar(select(func.count(AttendanceRecord.id)).where(AttendanceRecord.guest_id==c['guest_id']))==0

@pytest.mark.asyncio
async def test_dropoff_admission_and_daily_mark_roll_back_if_jp_audit_fails(ctx,monkeypatch):
    root,clock=await clock_setup(ctx,monkeypatch);c=await child(ctx,root)
    async def failed(*args,**kwargs):raise HTTPException(409,'Simulated JP failure')
    monkeypatch.setattr(junior,'audit',failed)
    await act(ctx,root,c,'dropoff',expected=409,adult_name='Parent',relationship='parent',identity_checked=True)
    async with _Session() as db:
        assert not (await db.get(Guest,c['guest_id'])).admitted
        raw=await db.get(JuniorChild,c['id']);assert raw.location=='not_arrived' and raw.programme_date is None
        assert await db.scalar(select(func.count(AttendanceRecord.id)).where(AttendanceRecord.guest_id==c['guest_id']))==0

@pytest.mark.asyncio
async def test_day_boundary_uses_event_timezone_not_utc_midnight(ctx,monkeypatch):
    root,clock=await clock_setup(ctx,monkeypatch);c=await child(ctx,root);c=await drop(ctx,root,c);c=await release(ctx,root,c)
    clock[0]=datetime(2026,12,25,2,0)
    d=await detail(ctx,root,c);assert d['today']=='2026-12-24' and d['location']=='released'
    clock[0]=datetime(2026,12,25,5,0)
    d=await detail(ctx,root,c);assert d['today']=='2026-12-25' and d['location']=='not_arrived'


@pytest.mark.asyncio
async def test_existing_convention_entry_is_preserved_and_no_duplicate_admission_messages_are_sent(ctx,monkeypatch):
    root,clock=await clock_setup(ctx,monkeypatch);c=await child(ctx,root)
    calls=[]
    async def unexpected(*args,**kwargs):calls.append('sent')
    monkeypatch.setattr(scanner,'send_admission_email',unexpected)
    monkeypatch.setattr(scanner.messaging,'send_custom_sms',unexpected)
    monkeypatch.setattr(scanner.messaging,'send_admission_sms',unexpected)
    async with _Session() as db:
        g=await db.get(Guest,c['guest_id']);g.email='child@example.com';g.phone='+12025550146';g.sms_consent=True
        e=await db.get(Event,ctx.ids['event_a']);e.notify_email=True;e.notify_sms=True;e.is_paid=True;e.paid_channels=True;e.message_credits=100
        await db.commit()
    c=await drop(ctx,root,c);assert c['convention_admitted'];assert not calls
    first_at=clock[0];c=await release(ctx,root,c);clock[0]+=timedelta(days=1);c=await drop(ctx,root,c)
    async with _Session() as db:
        assert (await db.get(Guest,c['guest_id'])).admitted_at==first_at
        assert (await db.get(JuniorConfig,ctx.ids['event_a'])).notifications_enabled is False
    assert not calls

@pytest.mark.asyncio
async def test_released_guest_with_daily_record_can_still_be_deleted(ctx,monkeypatch):
    root,clock=await clock_setup(ctx,monkeypatch);c=await child(ctx,root);c=await drop(ctx,root,c);c=await release(ctx,root,c)
    response=await ctx.client.delete(f"/api/events/{ctx.ids['event_a']}/guests/{c['guest_id']}")
    assert response.status_code==204,response.text
    async with _Session() as db:
        assert await db.get(Guest,c['guest_id']) is None
        assert await db.scalar(select(func.count(AttendanceRecord.id)).where(AttendanceRecord.guest_id==c['guest_id']))==0
