from datetime import datetime, timezone
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock
import pytest
from conftest import _Session
from test_guesthub_event_app import setup
from app.models import Event, Guest
from app.services.program_audience import programme_audiences
from app.services.experience import step_applies_to_guest
from app.services import program
from app.schemas import GuestProgramOut

@pytest.mark.asyncio
async def test_authorized_family_scope_and_no_credentials(ctx):
    parent, child, guardian = await setup(ctx)
    async with _Session() as db:
        event = await db.get(Event, ctx.ids['event_a'])
        async def ids(who):
            people, profiles, contexts = await programme_audiences(event, await db.get(Guest, who), db)
            assert all(set(p) == {'guest_id','name','age_group','is_self'} for p in profiles)
            assert profiles[0]['guest_id'] == who and profiles[0]['is_self']
            return {p.id for p in people}
        assert await ids(parent) == {parent,child}
        assert await ids(child) == {child}
        assert await ids(guardian) == {guardian}
        event.guardian_authorizations = {child:[{'guardian_guest_id':guardian,'source':'guardian_hub_other','confirmed_at':'2026-10-06T12:00:00Z'}]}
        assert await ids(guardian) == {guardian,child}
        event.junior_guardian_handoff_enabled = False
        assert await ids(guardian) == {guardian}

@pytest.mark.asyncio
@pytest.mark.parametrize('conditions,expected',[
 ({},True),({'age_groups_include':['Juniors']},True),
 ({'age_groups_include':['Adults']},False),({'age_groups_exclude':['Juniors']},False),
 ({'guest_tags_include':['group-a']},True),({'guest_tags_include':['group-b']},False),
 ({'guest_tags_all':['group-a','tag-id']},True),({'guest_tags_exclude':['group-a']},False),
 ({'ticket_type_name':['Junior']},True),({'ticket_type_name':['Adult']},False),
 ({'age_groups_include':['Juniors'],'guest_tags_include':['group-b']},False)
])
async def test_cached_conditions_preserve_rules_without_per_session_queries(conditions,expected):
    db=AsyncMock()
    person=NS(id='child',ticket_type_id='ticket',is_vip=False,rsvp_status='confirmed')
    context={'age_group':'Juniors','ticket_name':'Junior','tags':{'group-a','tag-id'}}
    assert await step_applies_to_guest(NS(conditions=conditions),person,db,audience_context=context) is expected
    db.execute.assert_not_called();db.get.assert_not_called()

@pytest.mark.asyncio
async def test_program_preserves_all_but_marks_per_person_audiences(monkeypatch):
    parent, child, unknown = [NS(id=x,ticket_type_id=None,is_vip=False,rsvp_status='confirmed') for x in ('parent','child','unknown')]
    contexts={p.id:{'age_group':age,'ticket_name':'','tags':set()} for p,age in [(parent,'Adults'),(child,'Juniors'),(unknown,None)]}
    profiles=[{'guest_id':p.id,'name':p.id,'age_group':contexts[p.id]['age_group'],'is_self':p==parent} for p in (parent,child,unknown)]
    resolve=AsyncMock(return_value=([parent,child,unknown],profiles,contexts))
    monkeypatch.setattr(program,'programme_audiences',resolve)
    monkeypatch.setattr(program,'_feedback_windows',AsyncMock(return_value=[]))
    event=NS(id='event',name='Demo',event_date=datetime(2026,12,24,14),timezone='America/Indiana/Indianapolis',live_program_enabled=True)
    steps=[NS(id=key,key=key,title=key,description=None,enabled=True,type='session_attendance',is_segment=False,starts_offset_seconds=None,duration_seconds=None,sort_order=i,conditions=conditions,config={'session':{'date':'2026-12-24','start_time':'10:00','end_time':'11:00'}}) for i,(key,conditions) in enumerate([('shared',{}),('adults',{'age_groups_include':['Adults']}),('juniors',{'age_groups_include':['Juniors']})])]
    db=AsyncMock()
    result=GuestProgramOut.model_validate(await program.program_state(event,NS(id='workflow',status='published',steps=steps),db,guest=parent,now=datetime(2026,12,24,14,tzinfo=timezone.utc)))
    assert result.viewer_id=='parent' and len(result.audiences)==3
    assert {s.step_id: s.audience_guest_ids for s in result.days[0].segments} == {'shared':['parent','child','unknown'],'adults':['parent'],'juniors':['child']}
    resolve.assert_awaited_once();db.execute.assert_not_called();db.commit.assert_not_called()

@pytest.mark.asyncio
async def test_per_person_registration_age_precedes_shared_party_answers(ctx, monkeypatch):
    from app.services import program_audience
    parent, child, _ = await setup(ctx)
    monkeypatch.setattr(program_audience, 'guest_age_group', AsyncMock(return_value='Adults'))
    async with _Session() as db:
        person=await db.get(Guest,child)
        person.rsvp_notes='Age group: Ages 3–4 | Private dietary note'
        await db.flush()
        event=await db.get(Event,ctx.ids['event_a'])
        _, profiles, contexts=await programme_audiences(event,await db.get(Guest,parent),db)
        assert contexts[child]['age_group']=='Ages 3–4'
        assert next(p for p in profiles if p['guest_id']==child)['age_group']=='Ages 3–4'
        assert 'Private dietary' not in str(profiles)

@pytest.mark.asyncio
async def test_guest_endpoint_includes_personal_audiences(ctx):
    from test_experience_guest_hub import _setup, TOKEN
    from app.models import ExperienceWorkflow, ExperienceStep
    from sqlalchemy import select
    guest_id, _ = await _setup(ctx, with_consent=False)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.live_program_enabled=True
        guest=await db.get(Guest,guest_id);guest.rsvp_notes='Age group: Adults'
        wf=await db.scalar(select(ExperienceWorkflow).where(ExperienceWorkflow.event_id==event.id))
        for title, groups in [('Shared',None),('Adults',['Adults']),('Juniors',['Juniors']),('Gala Night',None)]:
            db.add(ExperienceStep(workflow_id=wf.id,key=title,title=title,type='session_attendance',enabled=True,required=False,conditions={'age_groups_include':groups} if groups else {},config={'session':{'date':'2026-12-24','start_time':'16:00' if title=='Gala Night' else '10:00','end_time':None if title=='Gala Night' else '11:00'}}))
        await db.commit()
    response=await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/experience/me?token={TOKEN}")
    assert response.status_code==200, response.text
    timetable=response.json()['program']
    assert timetable['viewer_id']==guest_id
    assert {s['title']:s['audience_guest_ids'] for s in timetable['days'][0]['segments']}=={'Shared':[guest_id],'Adults':[guest_id],'Juniors':[],'Gala Night':[guest_id]}
    assert next(s for s in timetable['days'][0]['segments'] if s['title']=='Gala Night')['ends_at'] is None

@pytest.mark.asyncio
@pytest.mark.parametrize('hour,state,in_next', [(8,'upcoming',True),(15,'scheduled',False),(22,'scheduled',False)])
async def test_start_only_programme_is_visible_without_becoming_live(monkeypatch,hour,state,in_next):
    monkeypatch.setattr(program,'_feedback_windows',AsyncMock(return_value=[]))
    event=NS(id='event',name='Conference',event_date=datetime(2026,11,11,9),timezone='Africa/Lagos',live_program_enabled=True)
    step=NS(id='gala',key='gala',title='Gala Night',description=None,enabled=True,type='session_attendance',is_segment=False,starts_offset_seconds=21600,duration_seconds=None,sort_order=1,conditions={},config={'session':{'room':'The Event Center'}})
    workflow=NS(id='workflow',status='published',steps=[step]);db=AsyncMock()
    result=GuestProgramOut.model_validate(await program.program_state(event,workflow,db,now=datetime(2026,11,11,hour,tzinfo=timezone.utc)))
    assert len(result.days)==1 and result.days[0].date=='2026-11-11'
    segment=result.days[0].segments[0]
    assert segment.title=='Gala Night' and segment.starts_at.hour==16
    assert segment.ends_at is None and not segment.active and segment.state==state
    assert not result.current_segments
    assert bool(result.next_segments)==in_next
    assert program.segment_steps(workflow)==[]  # no timed announcements or feedback
    db.commit.assert_not_called();db.execute.assert_not_called()

@pytest.mark.asyncio
async def test_start_only_preserves_timed_and_overnight_sessions(monkeypatch):
    monkeypatch.setattr(program,'_feedback_windows',AsyncMock(return_value=[]))
    event=NS(id='event',name='Conference',event_date=datetime(2026,11,11,9),timezone='Africa/Lagos',live_program_enabled=True)
    def step(key,start,end):
        return NS(id=key,key=key,title=key,description=None,enabled=True,type='session_attendance',is_segment=False,starts_offset_seconds=None,duration_seconds=None,sort_order=0,conditions={},config={'session':{'date':'2026-11-11','start_time':start,'end_time':end}})
    workflow=NS(id='workflow',status='published',steps=[step('gala','16:00',None),step('conference','10:00','15:00'),step('overnight','12:00','11:00'),step('invalid','13:00','not-a-time')])
    result=GuestProgramOut.model_validate(await program.program_state(event,workflow,AsyncMock(),now=datetime(2026,11,11,10,tzinfo=timezone.utc)))
    assert [s.title for s in result.days[0].segments]==['conference','overnight','gala']
    assert [s.title for s in result.current_segments]==['conference']
