"""Restricted Juniors views over the existing Experience programme."""
from datetime import date,datetime,timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field,field_validator
from sqlalchemy import select
from ..auth import require_event_member
from ..database import get_db
from ..models import Event,ExperienceWorkflow,ExperienceStep,EventUser,User,Membership
from ..junior_models import JuniorChild,JuniorMovement,JuniorAudit,JuniorVolunteerShift,JuniorVolunteerProfile
from ..services import junior_programme as service,junior_days as days
from ..services.junior_permissions import can
from .junior import access

router=APIRouter(prefix='/{event_id}/junior/programme')

class GroupIn(BaseModel):
    key:str=Field(min_length=1,max_length=20,pattern=r'^[A-Za-z0-9_-]+$')
    label:str=Field(min_length=1,max_length=100)
    age_groups:list[str]=Field(default_factory=list,max_length=30)
    classrooms:list[str]=Field(default_factory=list,max_length=30)
    required_staff:int|None=Field(default=None,ge=1,le=100)
    @field_validator('age_groups','classrooms')
    @classmethod
    def clean(cls,v):
        if any(not s.strip() or len(s)>100 for s in v):raise ValueError('Use non-empty names of at most 100 characters')
        return list(dict.fromkeys(s.strip() for s in v))

class SettingsIn(BaseModel):
    workflow_id:str|None=Field(default=None,max_length=36)
    expected_revision:int=Field(ge=0)
    groups:list[GroupIn]=Field(default_factory=list,max_length=30)
    practice_preview:bool=False
    sessions_required:bool=False

@router.put('/settings')
async def save(event_id:str,body:SettingsIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,role,admin=await access(event_id,actor,db,write=True)
    if not admin:raise HTTPException(403,'Only a Juniors Admin can link the programme')
    event=await db.scalar(select(Event).where(Event.id==event_id).with_for_update().execution_options(populate_existing=True))
    old=service.settings(event)
    if old.get('revision',0)!=body.expected_revision:raise HTTPException(409,'Programme settings changed. Refresh before saving.')
    if body.practice_preview and not service.is_practice(event):raise HTTPException(400,'Draft volunteer preview is available only in a practice event')
    groups=[g.model_dump() for g in body.groups]
    if len({g['key'] for g in groups})!=len(groups):raise HTTPException(400,'Group keys must be unique')
    if any(c not in ((cfg.classrooms if cfg else []) or []) for g in groups for c in g['classrooms']):raise HTTPException(400,'Choose saved classrooms; add new rooms in Settings first')
    if body.workflow_id:
        w=await db.get(ExperienceWorkflow,body.workflow_id)
        if not w or w.event_id!=event_id or w.status=='archived':raise HTTPException(400,'Choose a draft or published Experience from this event')
        steps=(await db.scalars(select(ExperienceStep).where(ExperienceStep.workflow_id==w.id))).all()
        keys={g['key'] for g in groups}
        referenced={key for step in steps for key in ([service.metadata(step).get('group')] if service.metadata(step).get('kind')=='activity' else service.metadata(step).get('groups',[])) if key}
        if not referenced<=keys:raise HTTPException(400,'Reassign the programme activities and sessions before removing or renaming their group keys')
        if w.status=='published' and old.get('workflow_id')==w.id and {g['key']:g.get('age_groups',[]) for g in old.get('groups',[])}!={g['key']:g.get('age_groups',[]) for g in groups}:raise HTTPException(409,'Create and approve a new Experience draft before changing a published programme’s age-group audience')
        if w.status=='draft':
            by_group={g['key']:g for g in groups}
            for step in steps:
                meta=service.metadata(step)
                if meta.get('kind')=='activity' and meta.get('group') in by_group:
                    g=by_group[meta['group']]
                    step.conditions={**(step.conditions or {}),'age_groups_include':g['age_groups'] or [g['label']]}
        if not any(service.metadata(s) for s in steps):raise HTTPException(400,'This Experience has no Juniors programme metadata')
    if body.sessions_required and body.workflow_id and w.status!='published' and not (service.is_practice(event) and body.practice_preview):raise HTTPException(400,'Publish the approved source before requiring sessions outside practice')
    if body.sessions_required and not body.workflow_id:raise HTTPException(400,'Link a programme before requiring sessions')
    value={**body.model_dump(exclude={'expected_revision'}),'revision':old.get('revision',0)+1}
    event.setup_preferences={**(event.setup_preferences or {}),'junior_programme':value}
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='programme_link_updated',detail={'before':old,'after':value}))
    await db.commit()
    return {'revision':value['revision']}

@router.get('')
async def programme(event_id:str,on:date|None=None,group:str|None=None,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,role,admin=await access(event_id,actor,db,write=False)
    prefs=service.settings(event);workflow,steps=await service.source(event,db)
    supervisor=admin or can(role,'volunteers') or can(role,'reconcile')
    visible=service.can_preview(event,workflow,admin)
    groups=prefs.get('groups',[]);rooms=await service.assigned_classrooms(event,actor,db)
    mine=[g['key'] for g in groups if set(g.get('classrooms',[]))&set(rooms)]
    selected=on.isoformat() if on else days.day(event)
    items=[service.step_out(s,event) for s in steps] if visible else []
    sessions=[x for x in items if x['kind']=='custody_session' and x['date']==selected]
    timeline=[x for x in items if x['kind']!='custody_session' and x['date']==selected and (not group or x['group']==group)]
    now=days.utcnow().replace(tzinfo=timezone.utc).astimezone(ZoneInfo(event.timezone or 'UTC'))
    for x in timeline:
        start=datetime.fromisoformat(x['starts_at']) if x['starts_at'] else None
        end=datetime.fromisoformat(x['ends_at']) if x['ends_at'] else None
        x['state']='now' if start and end and start<=now<end else 'ended' if end and end<=now else 'upcoming'
    children=(await db.scalars(select(JuniorChild).where(JuniorChild.event_id==event_id))).all() if can(role,'view_children') else []
    totals={};group_counts={g['key']:{} for g in groups};unmapped=0;away=[];session_counts={s['id']:{} for s in sessions}
    for c in children:
        state=days.view(c,event);key=service.group_for(c,groups);location=state['location']
        if not key:unmapped+=1
        # Custody sessions use the same event-wide child access as reception/Gala.
        if c.session_id in session_counts and c.programme_date==selected:session_counts[c.session_id][location]=session_counts[c.session_id].get(location,0)+1
        if not supervisor and key not in mine:continue
        totals[location]=totals.get(location,0)+1
        if key:
            group_counts[key][location]=group_counts[key].get(location,0)+1
        if location in ('clinic','other','outing'):
            away.append({'id':c.id,'name':c.name,'location':location,'group':key,'session_id':c.session_id,'prior_day_unresolved':state['prior_day_unresolved']})
    if sessions and can(role,'view_children'):
        movements=(await db.scalars(select(JuniorMovement).where(JuniorMovement.event_id==event_id,JuniorMovement.session_id.in_([s['id'] for s in sessions])).order_by(JuniorMovement.occurred_at,JuniorMovement.id))).all()
        by_id={c.id:c for c in children}
        latest={};arrivals={s['id']:set() for s in sessions}
        for m in movements:
            c=by_id.get(m.child_id)
            if not c:continue
            latest[(m.session_id,m.child_id)]=m
            if m.action=='dropoff':arrivals[m.session_id].add(m.child_id)
        for session in sessions:
            records=[m for (sid,cid),m in latest.items() if sid==session['id'] and cid in arrivals[sid]]
            session_counts[session['id']].update(arrivals=len(arrivals[session['id']]),pickups=sum(m.action=='release' for m in records),outstanding=sum(m.action!='release' for m in records))
    eu_rows=(await db.execute(select(EventUser,User).join(User,User.id==EventUser.user_id).where(EventUser.event_id==event_id))).all()
    users={eu.id:u for eu,u in eu_rows}
    event_users={eu.id:eu for eu,u in eu_rows}
    org_admins=set((await db.scalars(select(Membership.user_id).where(Membership.org_id==event.org_id,Membership.role.in_(['owner','admin'])))).all())
    profiles=(await db.scalars(select(JuniorVolunteerProfile).where(JuniorVolunteerProfile.event_id==event_id))).all()
    profile_map={p.event_user_id:p for p in profiles}
    shifts=(await db.scalars(select(JuniorVolunteerShift).where(JuniorVolunteerShift.event_id==event_id,JuniorVolunteerShift.enabled.is_(True)))).all()
    coverage=[]
    for g in groups:
        if not supervisor and g['key'] not in mine:continue
        on_duty=[];upcoming=[]
        for s in shifts:
            profile=profile_map.get(s.event_user_id);classroom=(s.plan or {}).get('classroom')
            if not classroom or classroom not in g.get('classrooms',[]):continue
            if not profile or classroom not in (profile.classrooms or []):continue
            u=users.get(s.event_user_id)
            if not u or not u.is_active:continue
            from ..services.junior_permissions import principal
            eu=event_users[s.event_user_id]
            if not principal((cfg.staff or {}).get(u.id) if cfg else None,u.is_platform_superadmin or u.id in org_admins or (eu.event_role=='manager' and not eu.guest_service_scoped)):continue
            record={'id':s.id,'name':profile.name,'station':s.station,'starts_at':s.starts_at,'ends_at':s.ends_at,'checked_in':bool(s.checked_in_at),'finished':bool(s.checked_out_at)}
            if s.checked_in_at and not s.checked_out_at and days.day(event,s.starts_at)==selected:on_duty.append(record)
            elif not s.checked_out_at and s.starts_at.replace(tzinfo=timezone.utc)>now and days.day(event,s.starts_at)==selected:upcoming.append(record)
        target=g.get('required_staff')
        coverage.append({'group':g['key'],'on_duty':on_duty,'upcoming':sorted(upcoming,key=lambda x:x['starts_at']),'required_staff':target,'gap':max(0,target-len(on_duty)) if target else None})
    issues=[]
    for s in steps:
        for issue in service.metadata(s).get('review_notes',[]):
            if issue not in issues:issues.append(issue)
    workflows=[]
    if admin:
        ws=(await db.scalars(select(ExperienceWorkflow).where(ExperienceWorkflow.event_id==event_id,ExperienceWorkflow.status!='archived').order_by(ExperienceWorkflow.version.desc()))).all()
        workflows=[{'id':w.id,'name':w.name,'status':w.status} for w in ws]
    return {'source':{'id':workflow.id,'name':workflow.name,'status':workflow.status} if workflow else None,'visible':visible,
        'preview':bool(workflow and workflow.status!='published'),'practice_mode':service.is_practice(event),'timezone':event.timezone or 'UTC',
        'can_view_children':can(role,'view_children'),'headcount_date':days.day(event),'today':days.day(event),'selected_date':selected,'dates':sorted({x['date'] for x in items if x['date']}),'groups':groups,'my_groups':mine,'assigned_classrooms':rooms,
        'items':timeline,'sessions':[{**s,'counts':session_counts[s['id']]} for s in sessions],
        'session_recording_available':service.session_available(event,workflow),'sessions_required':bool(prefs.get('sessions_required')),
        'totals':totals if can(role,'view_children') else None,'group_counts':group_counts if supervisor else {k:v for k,v in group_counts.items() if k in mine},'unmapped_children':unmapped if supervisor else None,
        'away':away,'coverage':coverage,'can_configure':admin,'can_supervise':supervisor,'issues':issues if visible else [],
        'settings':prefs if admin else None,'workflows':workflows,'classrooms':cfg.classrooms if cfg else []}

class ReviewIn(BaseModel):
    expected_revision:int=Field(ge=0)
    resolved_notes:list[str]=Field(max_length=30)
    confirmed:bool=False

@router.post('/review')
async def review(event_id:str,body:ReviewIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,role,admin=await access(event_id,actor,db,write=True)
    if not admin:raise HTTPException(403,'Only a Juniors Admin can confirm programme review')
    event=await db.scalar(select(Event).where(Event.id==event_id).with_for_update().execution_options(populate_existing=True))
    prefs=service.settings(event)
    if prefs.get('revision',0)!=body.expected_revision:raise HTTPException(409,'Programme settings changed; refresh before reviewing')
    if not body.confirmed or not body.resolved_notes:raise HTTPException(400,'Confirm the selected questions have been resolved in the Experience draft')
    workflow,steps=await service.source(event,db)
    if not workflow or workflow.status!='draft':raise HTTPException(409,'Review the linked draft before publishing')
    current={note for s in steps for note in service.metadata(s).get('review_notes',[])}
    if not set(body.resolved_notes)<=current:raise HTTPException(409,'Review notes changed; refresh before confirming')
    for s in steps:
        meta=service.metadata(s)
        if meta.get('review_notes'):
            s.config={**s.config,'program':{**s.config['program'],'junior':{**meta,'review_notes':[n for n in meta['review_notes'] if n not in body.resolved_notes]}}}
    event.setup_preferences={**event.setup_preferences,'junior_programme':{**prefs,'revision':prefs.get('revision',0)+1}}
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='programme_review_confirmed',detail={'workflow_id':workflow.id,'resolved_notes':body.resolved_notes}))
    await db.commit()
    return {'reviewed':len(body.resolved_notes)}

class StepIn(BaseModel):
    expected_revision:int=Field(ge=0)
    title:str=Field(min_length=1,max_length=120)
    date:date
    start_time:str=Field(pattern=r'^\d{2}:\d{2}$')
    end_time:str=Field(pattern=r'^\d{2}:\d{2}$')
    room:str=Field(default='',max_length=100)
    group:str|None=Field(default=None,max_length=20)
    groups:list[str]|None=Field(default=None,max_length=30)

@router.put('/steps/{step_id}')
async def edit_step(event_id:str,step_id:str,body:StepIn,db=Depends(get_db),actor=Depends(require_event_member)):
    import math
    from ..junior_models import JuniorMovement
    from .experience import _assert_experience_plan,_ensure_draft
    event,cfg,role,admin=await access(event_id,actor,db,write=True)
    if not admin:raise HTTPException(403,'Only a Juniors Admin can edit its programme draft')
    _assert_experience_plan(event)
    event=await db.scalar(select(Event).where(Event.id==event_id).with_for_update().execution_options(populate_existing=True))
    prefs=service.settings(event)
    if prefs.get('revision',0)!=body.expected_revision:raise HTTPException(409,'The programme changed. Refresh before editing.')
    workflow,steps=await service.source(event,db)
    if not workflow:raise HTTPException(404,'Linked programme not found')
    _ensure_draft(workflow)
    step=next((s for s in steps if s.id==step_id),None)
    if not step:raise HTTPException(404,'Step not found in the linked Juniors programme')
    if await db.scalar(select(JuniorMovement.id).where(JuniorMovement.session_id==step.id).limit(1)):raise HTTPException(409,'This session has custody history. Add a replacement instead of editing it.')
    tz=ZoneInfo(event.timezone or 'UTC')
    try:
        start=datetime.fromisoformat(body.date.isoformat()+'T'+body.start_time).replace(tzinfo=tz)
        end=datetime.fromisoformat(body.date.isoformat()+'T'+body.end_time).replace(tzinfo=tz)
    except ValueError:raise HTTPException(400,'Use valid start and end times')
    if end<=start:raise HTTPException(400,'The finish must follow the start on the selected day')
    anchor=event.event_date.replace(tzinfo=timezone.utc).astimezone(tz) if event.event_date.tzinfo is None else event.event_date.astimezone(tz)
    if start<anchor and not service.is_practice(event):raise HTTPException(400,'The activity must follow the event start')
    meta=service.metadata(step)
    if meta.get('kind')=='activity' and body.group not in {g['key'] for g in prefs.get('groups',[])}:raise HTTPException(400,'Choose a configured programme group')
    before=service.step_out(step,event)
    meta={**meta,'date':body.date.isoformat()}
    if meta.get('kind')=='custody_session' and body.groups is not None:
        if not body.groups or not set(body.groups)<={g['key'] for g in prefs.get('groups',[])}:raise HTTPException(400,'Choose configured groups for this session')
        meta['groups']=list(dict.fromkeys(body.groups))
    if meta.get('kind')=='activity':
        meta['group']=body.group
        g=next(g for g in prefs['groups'] if g['key']==body.group)
        step.conditions={**(step.conditions or {}),'age_groups_include':g.get('age_groups') or [g['label']]}
    step.title=body.title.strip()
    if not step.title:raise HTTPException(400,'A title is required')
    step.config={**(step.config or {}),'session':{**((step.config or {}).get('session') or {}),'date':body.date.isoformat(),'start_time':body.start_time,'end_time':body.end_time,'room':body.room.strip()},'program':{**((step.config or {}).get('program') or {}),'junior':meta}}
    if step.is_segment:
        offset=math.ceil((start-anchor).total_seconds());step.starts_offset_seconds=offset if offset>=0 else None;step.duration_seconds=int((end-start).total_seconds())
    event.setup_preferences={**event.setup_preferences,'junior_programme':{**prefs,'revision':prefs['revision']+1}}
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='programme_step_updated',detail={'workflow_id':workflow.id,'step_id':step.id,'before':before,'after':service.step_out(step,event)}))
    await db.commit()
    return {'updated':step.id}

class PublishIn(BaseModel):
    expected_revision:int=Field(ge=0)
    confirmed:bool=False

@router.post('/publish')
async def publish(event_id:str,body:PublishIn,db=Depends(get_db),actor=Depends(require_event_member)):
    from .experience import publish as publish_existing
    event,cfg,role,admin=await access(event_id,actor,db,write=True)
    if not admin:raise HTTPException(403,'Only a Juniors Admin can publish its approved programme')
    if not body.confirmed:raise HTTPException(400,'Confirm the timetable and staffing/classroom assignments are approved')
    event=await db.scalar(select(Event).where(Event.id==event_id).with_for_update().execution_options(populate_existing=True))
    if service.settings(event).get('revision',0)!=body.expected_revision:raise HTTPException(409,'Programme changed. Refresh before publishing.')
    workflow,steps=await service.source(event,db)
    if not workflow or not steps:raise HTTPException(409,'Link a Juniors programme draft first')
    # Use the existing publisher and its no-replacement, draft, review and sync guards.
    result=await publish_existing(event_id,workflow.id,replace_workflow_id=None,db=db,current_user=actor)
    return {'workflow_id':result.id,'status':result.status}

class SessionIn(StepIn):
    groups:list[str]=Field(min_length=1,max_length=30)
    session_type:str=Field(default='gala',pattern=r'^(daytime|gala|other)$')

@router.post('/sessions',status_code=201)
async def add_session(event_id:str,body:SessionIn,db=Depends(get_db),actor=Depends(require_event_member)):
    from uuid import uuid4
    from .experience import _assert_experience_plan,_ensure_draft
    event,cfg,role,admin=await access(event_id,actor,db,write=True)
    if not admin:raise HTTPException(403,'Only a Juniors Admin can add a programme session')
    _assert_experience_plan(event)
    event=await db.scalar(select(Event).where(Event.id==event_id).with_for_update().execution_options(populate_existing=True))
    if service.settings(event).get('revision',0)!=body.expected_revision:raise HTTPException(409,'Programme changed; refresh before adding a session')
    workflow,steps=await service.source(event,db)
    if not workflow:raise HTTPException(404,'Link an Experience draft first')
    _ensure_draft(workflow)
    step=ExperienceStep(workflow_id=workflow.id,key='jp-session-'+str(uuid4()),type='custom',title=body.title,required=False,enabled=True,is_segment=False,sort_order=max([s.sort_order for s in steps] or [0])+10,config={'program':{'junior':{'kind':'custody_session','date':body.date.isoformat(),'session_key':body.date.isoformat()+':'+body.session_type,'groups':body.groups or []}}})
    db.add(step);await db.flush()
    return await edit_step(event_id,step.id,body,db,actor)
