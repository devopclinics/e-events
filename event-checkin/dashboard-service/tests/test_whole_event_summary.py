"""Whole-event totals must reconcile independently of day/zone filters."""
from datetime import datetime
from app.models import Event, Zone, SeatingTable, GuestGroupPass, GroupPassMember, ExperienceWorkflow, ExperienceStep

async def test_filtered_attendance_keeps_reconciled_event_totals(ctx):
    async with ctx.session_factory() as db:
        event = await db.get(Event, ctx.event_id)
        event.venue_access_enabled = True
        db.add_all([Zone(id='conference',event_id=event.id,name='Conference',capacity=None,is_active=True),
                    Zone(id='dinner',event_id=event.id,name='Dinner',capacity=80,is_active=True)])
        c1=await ctx.add_guest(db,id='confirmed-scanned')
        await ctx.add_guest(db,id='confirmed-legacy',admitted=True,admitted_at=datetime(2026,8,2,14))
        other=await ctx.add_guest(db,id='other',rsvp_status='invited')
        missing=await ctx.add_guest(db,id='missing')
        for zone,hour in [('conference',12),('conference',13),('dinner',14)]:
            await ctx.add_scan(db,c1.id,'in',datetime(2026,8,2,hour),zone_id=zone)
        await ctx.add_scan(db,other.id,'in',datetime(2026,8,2,15),zone_id='dinner')
        await ctx.add_scan(db,missing.id,'in',datetime(2026,8,2,16),zone_id='dinner',denied=True)
        db.add_all([SeatingTable(id='table',event_id=event.id,name='Dinner 01',capacity=8),
                    GuestGroupPass(guest_id=c1.id,event_id=event.id,admission_limit=10,enabled=True),
                    GroupPassMember(id='member',pass_guest_id=c1.id,guest_id=other.id)])
        other.table_id='table'
        await db.commit()
    response=await ctx.client.get(f'/api/results/events/{ctx.event_id}/command-center?venue_id=dinner')
    assert response.status_code==200,response.text
    payload=response.json();s=payload['event_summary'];r=s['rsvp']
    assert payload['attendance']['checked_in']==2
    assert (r['guests'],r['confirmed'],r['checked_in'])==(4,3,3)
    assert (r['confirmed_arrived'],r['confirmed_not_arrived'],r['other_arrivals'])==(2,1,1)
    assert [z['unique_arrivals']for z in s['zones']]==[1,2]
    assert s['zones'][0]['capacity'] is None
    assert s['zone_overlap']==1 and s['zone_unique_arrivals']==2
    assert s['seating']=={'tables':1,'seats':8,'assigned':1}
    assert payload['table_group_capacity']==[]
    assert s['shared_passes']=={'passes':1,'admission_slots':10,'members':1}
    assert s['denied_scans']=={'attempts':1,'affected_guests':1}
    assert s['exit_tracking_recorded'] is False
    unfiltered=(await ctx.client.get(f'/api/results/events/{ctx.event_id}/command-center')).json()
    assert unfiltered['event_summary']==s

async def test_zone_periods_distinguish_preevent_entries_and_empty_zones(ctx):
    async with ctx.session_factory()as db:
        db.add_all([Zone(id='hall',event_id=ctx.event_id,name='Hall',is_active=True),Zone(id='unused',event_id=ctx.event_id,name='Unused',is_active=True)])
        a=await ctx.add_guest(db);b=await ctx.add_guest(db)
        await ctx.add_scan(db,a.id,'in',datetime(2026,8,1,12),zone_id='hall')
        await ctx.add_scan(db,b.id,'in',datetime(2026,8,2,12),zone_id='hall')
        await db.commit()
    s=(await ctx.client.get(f'/api/results/events/{ctx.event_id}/command-center?day=2026-08-02')).json()['event_summary']
    assert [z['unique_arrivals']for z in s['zones']]==[1,0]
    assert [z['unique_arrivals']for z in s['zones_all_time']]==[2,0]
    assert s['zone_unique_arrivals']==1 and s['zone_unique_arrivals_all_time']==2

async def test_exit_tracking_is_zone_and_cutoff_specific(ctx):
    async with ctx.session_factory()as db:
        event=await db.get(Event,ctx.event_id);event.venue_access_enabled=True
        db.add_all([Zone(id='a',event_id=ctx.event_id,name='A',is_active=True),Zone(id='b',event_id=ctx.event_id,name='B',is_active=True)])
        g=await ctx.add_guest(db)
        await ctx.add_scan(db,g.id,'in',datetime(2026,8,2,12),zone_id='a')
        await ctx.add_scan(db,g.id,'out',datetime(2026,8,2,13),zone_id='a')
        await ctx.add_scan(db,g.id,'in',datetime(2026,8,2,14),zone_id='b')
        await db.commit()
    payload=(await ctx.client.get(f'/api/results/events/{ctx.event_id}/command-center?venue_id=b')).json()
    assert payload['event_summary']['exit_tracking_recorded'] is True
    assert payload['attendance']['exit_tracking_recorded'] is False
    assert payload['attendance']['occupancy_mode']=='historical'

async def test_past_session_without_end_is_unknown_not_upcoming(ctx):
    async with ctx.session_factory()as db:
        event=await db.get(Event,ctx.event_id);event.experience_enabled=True
        db.add(ExperienceWorkflow(id='wf',event_id=event.id,name='Program',status='published',version=1))
        await db.flush()
        db.add(ExperienceStep(id='gala',key='gala',workflow_id='wf',type='session_attendance',title='Gala',enabled=True,sort_order=1,config={'session':{'date':'2026-08-02','start_time':'16:00'}}))
        await db.commit()
    response=await ctx.client.get(f'/api/results/events/{ctx.event_id}/command-center')
    assert response.status_code==200,response.text
    program=response.json()['program']
    assert program['up_next'] is None
    assert program['status_unknown'][0]['topic']=='Gala'
    detail=(await ctx.client.get(f'/api/results/events/{ctx.event_id}/analytics/program')).json()
    assert detail['unknown_count']==1 and detail['upcoming_count']==0

async def test_empty_event_has_real_zero_inventory_and_no_fake_tracking(ctx):
    payload=(await ctx.client.get(f'/api/results/events/{ctx.event_id}/command-center')).json()
    s=payload['event_summary']
    assert s['seating']=={'tables':0,'seats':0,'assigned':0}
    assert s['rsvp']['confirmed_arrived']==0 and s['rsvp']['other_arrivals']==0
    assert s['zones']==[] and s['exit_tracking_recorded'] is False
