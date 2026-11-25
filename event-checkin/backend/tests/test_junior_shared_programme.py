from datetime import datetime,timedelta
import pytest
from sqlalchemy import select,func
from conftest import _Session
from app.models import Event,ExperienceWorkflow,ExperienceStep,EventUser,User
from app.junior_models import JuniorMovement,JuniorNotification,JuniorVolunteerProfile
from app.services import junior_days as days
from test_junior_programme import setup,child,act

async def source(ctx,root,practice=False,notes=None):
    today=days.day((await event(ctx)))
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a'])
        if practice:e.is_test=True;e.setup_preferences={'junior_practice':True,'junior_practice_source':'other'}
        e.plan_tier='comp';e.is_paid=True;e.experience_enabled=True
        w=ExperienceWorkflow(event_id=e.id,name='JP source',status='draft' if practice else 'published',version=1,is_default=False);db.add(w);await db.flush()
        for key,kind,title,start,end in [('daytime','custody_session','Daytime JP','00:00','23:59'),('gala','custody_session','Gala childcare','00:00','23:59'),('quiet','activity','Quiet time','12:00','13:00')]:
            s=ExperienceStep(workflow_id=w.id,key=key,type='custom',title=title,required=False,enabled=True,is_segment=kind=='activity',config={'session':{'date':today,'start_time':start,'end_time':end},'program':{'junior':{'kind':kind,'date':today,'groups':['B'],'group':'B' if kind=='activity' else None,'session_key':today+':'+key,'review_notes':notes or []}}});db.add(s)
        await db.commit();wid=w.id
    r=await ctx.client.put(root+'/programme/settings',json={'workflow_id':wid,'expected_revision':0,'groups':[{'key':'B','label':'Group B','age_groups':['5–6'],'classrooms':['Group A']}],'practice_preview':practice,'sessions_required':True})
    assert r.status_code==200,r.text
    data=(await ctx.client.get(root+'/programme')).json()
    return data

async def event(ctx):
    async with _Session() as db:return await db.get(Event,ctx.ids['event_a'])

@pytest.mark.asyncio
async def test_shared_schedule_no_duplicate_storage_and_gala_complete_cycle(ctx):
    root=await setup(ctx);c=await child(ctx,root);data=await source(ctx,root)
    assert [x['title'] for x in data['items']]==['Quiet time']
    assert data['session_recording_available'] and len(data['sessions'])==2
    ids={s['title']:s['id'] for s in data['sessions']}
    c=await act(ctx,root,c,'dropoff',session_id=ids['Daytime JP'],adult_name='Maryam Yusuf',relationship='parent',identity_checked=True,allergy=False,accommodation=False,screening_wristband_assigned=True)
    assert c['session_id']==ids['Daytime JP']
    await act(ctx,root,c,'dropoff',expected=409,session_id=ids['Gala childcare'],adult_name='Maryam',relationship='parent',identity_checked=True,allergy=False,accommodation=False,screening_wristband_assigned=True)
    detail=(await ctx.client.get(root+'/children/'+c['id'])).json();contact=detail['contacts'][0]['id']
    c=await act(ctx,root,c,'release',contact_id=contact,identity_checked=True)
    c=await act(ctx,root,c,'dropoff',session_id=ids['Gala childcare'],contact_id=contact,identity_checked=True,allergy=True,accommodation=True,screening_wristband_assigned=True)
    assert c['location']=='support_desk' and c['session_id']==ids['Gala childcare']
    await act(ctx,root,c,'classroom',expected=409)
    c=await act(ctx,root,c,'clear_allergy',notes='SECRET MEDICAL',wristband_assigned=True)
    c=await act(ctx,root,c,'clear_accommodation',notes='SECRET SUPPORT',wristband_assigned=True)
    c=await act(ctx,root,c,'classroom')
    c=await act(ctx,root,c,'release',contact_id=contact,identity_checked=True)
    d=(await ctx.client.get(root+'/children/'+c['id'])).json();assert d['session_name']=='Gala childcare'
    assert set(m['session_name'] for m in d['history'] if m['action'] in ('release','dropoff'))=={'Daytime JP','Gala childcare'}
    data=(await ctx.client.get(root+'/programme')).json();assert all(s['counts']['arrivals']==1 and s['counts']['pickups']==1 and s['counts']['outstanding']==0 for s in data['sessions'])
    notices=(await ctx.client.get(root+'/notifications')).json();assert any('Session: Gala childcare.' in n['body'] for n in notices)
    assert not any('SECRET' in n['body'] for n in notices)

@pytest.mark.asyncio
async def test_tenant_and_draft_scope_and_concurrency(ctx):
    root=await setup(ctx);c=await child(ctx,root);data=await source(ctx,root)
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.get(root+'/programme')).status_code==404
    ctx.login(ctx.ids['user_a'])
    assert (await ctx.client.put(root+'/programme/settings',json={'workflow_id':data['source']['id'],'expected_revision':0,'groups':[]})).status_code==409
    async with _Session() as db:
        w=await db.get(ExperienceWorkflow,data['source']['id']);w.status='draft';await db.commit()
    await act(ctx,root,c,'dropoff',expected=409,session_id=data['sessions'][0]['id'],adult_name='Maryam',relationship='parent',identity_checked=True,allergy=False,accommodation=False,screening_wristband_assigned=True)
    sid=data['sessions'][0]['id']
    async with _Session() as db:
        w=await db.get(ExperienceWorkflow,data['source']['id']);w.status='published';s=await db.get(ExperienceStep,sid);s.config={**s.config,'session':{**s.config['session'],'date':'2000-01-01'}};await db.commit()
    await act(ctx,root,c,'dropoff',expected=409,session_id=sid,adult_name='Maryam',relationship='parent',identity_checked=True,allergy=False,accommodation=False,screening_wristband_assigned=True)

@pytest.mark.asyncio
async def test_review_and_live_publishing_requires_resolved_draft(ctx):
    root=await setup(ctx);data=await source(ctx,root,notes=['Confirm Group C outing'])
    async with _Session() as db:
        w=await db.get(ExperienceWorkflow,data['source']['id']);w.status='draft';await db.commit()
    path=f"/api/events/{ctx.ids['event_a']}/experience/workflows/{data['source']['id']}/publish"
    assert (await ctx.client.post(path)).status_code==409
    r=await ctx.client.post(root+'/programme/review',json={'expected_revision':1,'resolved_notes':['Confirm Group C outing'],'confirmed':False});assert r.status_code==400
    r=await ctx.client.post(root+'/programme/review',json={'expected_revision':1,'resolved_notes':['Confirm Group C outing'],'confirmed':True});assert r.status_code==200,r.text
    async with _Session() as db:
        ss=(await db.scalars(select(ExperienceStep).where(ExperienceStep.workflow_id==data['source']['id']))).all();assert not any(s.config['program']['junior']['review_notes'] for s in ss)

@pytest.mark.asyncio
async def test_source_change_and_cross_event_sessions_rejected(ctx):
    root=await setup(ctx);c=await child(ctx,root);data=await source(ctx,root)
    async with _Session() as db:
        foreign=Event(org_id=ctx.ids['org_b'],name='Other',couples_name='Other',event_date=datetime.utcnow(),checkin_base_url='http://x');db.add(foreign);await db.flush()
        w=ExperienceWorkflow(event_id=foreign.id,name='Other',status='published',version=9);db.add(w);await db.flush();s=ExperienceStep(workflow_id=w.id,key='other',type='custom',title='Other session',required=False,enabled=True,config={'program':{'junior':{'kind':'custody_session'}}});db.add(s);await db.commit();sid=s.id;wid=w.id
    r=await ctx.client.put(root+'/programme/settings',json={'workflow_id':wid,'expected_revision':1,'groups':[]});assert r.status_code==400
    await act(ctx,root,c,'dropoff',expected=409,session_id=sid,adult_name='Maryam',relationship='parent',identity_checked=True,allergy=False,accommodation=False,screening_wristband_assigned=True)

@pytest.mark.asyncio
async def test_volunteer_has_filtered_classroom_no_settings_edit_and_hidden_real_draft(ctx):
    from test_junior_permissions import invite
    root=await setup(ctx);c=await child(ctx,root);data=await source(ctx,root)
    user,euid=await invite(ctx,root,permissions=['checkin'])
    async with _Session() as db:
        p=await db.get(JuniorVolunteerProfile,euid);p.classrooms=['Group A'];await db.commit()
    ctx.login(user)
    d=(await ctx.client.get(root+'/programme')).json();assert d['my_groups']==['B'] and not d['can_configure'] and not d['can_supervise'] and d['settings'] is None and not d['workflows']
    assert (await ctx.client.put(root+'/programme/settings',json={'expected_revision':1,'groups':[]})).status_code==403
    assert (await ctx.client.post(root+'/programme/review',json={'expected_revision':1,'resolved_notes':['x'],'confirmed':True})).status_code==403
    async with _Session() as db:
        w=await db.get(ExperienceWorkflow,data['source']['id']);w.status='draft';await db.commit()
    d=(await ctx.client.get(root+'/programme')).json();assert not d['visible'] and not d['items'] and not d['sessions']
    assert (await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/experience/workflows")).status_code==403

@pytest.mark.asyncio
async def test_practice_preview_is_explicit_and_movement_not_time_driven(ctx):
    root=await setup(ctx);c=await child(ctx,root);data=await source(ctx,root,practice=True)
    assert data['practice_mode'] and data['preview'] and data['session_recording_available']
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(JuniorMovement).where(JuniorMovement.action=='dropoff'))==0
    c=await act(ctx,root,c,'dropoff',session_id=data['sessions'][0]['id'],adult_name='Parent',relationship='parent',identity_checked=True,allergy=False,accommodation=False,screening_wristband_assigned=True)
    assert c['location']=='reception'
    notices=(await ctx.client.get(root+'/notifications')).json();assert all(n['status']!='queued' for n in notices)

@pytest.mark.asyncio
async def test_custody_history_protects_draft_from_edit_and_delete(ctx):
    root=await setup(ctx);c=await child(ctx,root);data=await source(ctx,root,practice=True);sid=data['sessions'][0]['id']
    c=await act(ctx,root,c,'dropoff',session_id=sid,adult_name='Parent',relationship='parent',identity_checked=True,allergy=False,accommodation=False,screening_wristband_assigned=True)
    base=f"/api/events/{ctx.ids['event_a']}/experience/workflows/{data['source']['id']}"
    assert (await ctx.client.delete(base)).status_code==409
    assert (await ctx.client.delete(base+'/steps/'+sid)).status_code==409
    assert (await ctx.client.put(base+'/steps/'+sid,json={'title':'Changed'})).status_code==409

@pytest.mark.asyncio
async def test_draft_install_idempotent_and_never_publishes_or_changes_flags(ctx):
    from app.services.junior_programme_draft import install
    from pathlib import Path
    import json
    root=await setup(ctx)
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a']);e.event_date=datetime(2026,12,24);e.event_end_date=datetime(2026,12,28);await db.commit()
        payload=json.loads((Path(__file__).resolve().parents[2]/'docs/juniors/jp-2026-draft.json').read_text());before=(e.experience_enabled,e.live_program_enabled,e.engagement_enabled)
        result=await install(e.id,payload,ctx.ids['user_a'],db);again=await install(e.id,payload,ctx.ids['user_a'],db);assert result['created'] and not again['created'] and result['workflow_id']==again['workflow_id']
        await db.refresh(e);assert before==(e.experience_enabled,e.live_program_enabled,e.engagement_enabled)
        w=await db.get(ExperienceWorkflow,result['workflow_id']);assert w.status=='draft'
        from app.models import EngagementSyncOutbox
        assert await db.scalar(select(func.count()).select_from(EngagementSyncOutbox).where(EngagementSyncOutbox.event_id==e.id))==0

@pytest.mark.asyncio
async def test_juniors_admin_can_edit_and_publish_only_linked_draft(ctx):
    from test_junior_permissions import invite
    root=await setup(ctx);data=await source(ctx,root)
    async with _Session() as db:
        w=await db.get(ExperienceWorkflow,data['source']['id']);w.status='draft';await db.commit()
    user,euid=await invite(ctx,root,'admin');ctx.login(user)
    item=data['items'][0]
    edit={'expected_revision':1,'title':'Reviewed quiet time','date':data['today'],'start_time':'14:00','end_time':'15:30','room':'Group A','group':'B'}
    r=await ctx.client.put(root+'/programme/steps/'+item['id'],json=edit);assert r.status_code==200,r.text
    assert (await ctx.client.put(root+'/programme/steps/'+item['id'],json=edit)).status_code==409
    r=await ctx.client.post(root+'/programme/publish',json={'expected_revision':2,'confirmed':False});assert r.status_code==400
    r=await ctx.client.post(root+'/programme/publish',json={'expected_revision':2,'confirmed':True});assert r.status_code==200,r.text
    async with _Session() as db:
        w=await db.get(ExperienceWorkflow,data['source']['id']);assert w.status=='published'
    assert (await ctx.client.put(root+'/programme/steps/'+item['id'],json={**edit,'expected_revision':2})).status_code==409

@pytest.mark.asyncio
async def test_custody_sessions_are_staff_only_and_new_sessions_use_same_source(ctx):
    from app.services.experience import step_applies_to_guest
    from app.models import Guest
    root=await setup(ctx);c=await child(ctx,root);data=await source(ctx,root)
    async with _Session() as db:
        session=await db.get(ExperienceStep,data['sessions'][0]['id']);guest=await db.get(Guest,c['guest_id']);assert not await step_applies_to_guest(session,guest,db)
        w=await db.get(ExperienceWorkflow,data['source']['id']);w.status='draft';await db.commit()
    body={'expected_revision':1,'title':'Additional care','date':data['today'],'start_time':'19:30','end_time':'23:00','groups':['B'],'session_type':'gala'}
    r=await ctx.client.post(root+'/programme/sessions',json=body);assert r.status_code==201,r.text
    after=(await ctx.client.get(root+'/programme')).json();assert len(after['sessions'])==3 and after['source']['id']==data['source']['id']
    assert (await ctx.client.post(root+'/programme/sessions',json=body)).status_code==409
    r=await ctx.client.post(root+'/programme/sessions',json={**body,'expected_revision':2,'groups':[]});assert r.status_code==422
