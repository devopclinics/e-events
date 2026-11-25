"""Install a reviewed-format Experience draft. No publishing or outbound sends.

Called by an authorized setup job after the workbook is converted. Existing
children, classroom assignments, active Experience and Live flags are untouched.
"""
import copy,math
from datetime import date,datetime,timedelta,timezone
from zoneinfo import ZoneInfo
from sqlalchemy import select
from ..models import Event,ExperienceWorkflow,ExperienceStep
from ..junior_models import JuniorConfig,JuniorAudit
from .experience import create_workflow
from .junior_practice import is_practice
from .junior_programme import metadata,settings

async def install(event_id,payload,actor,db,*,practice_preview=False):
    event=await db.scalar(select(Event).where(Event.id==event_id).with_for_update())
    if not event or not event.junior_program_enabled:raise ValueError('Choose an existing enabled Juniors event')
    if practice_preview and not is_practice(event):raise ValueError('Preview is practice-only')
    existing=(await db.scalars(select(ExperienceWorkflow).where(ExperienceWorkflow.event_id==event_id,ExperienceWorkflow.status!='archived'))).all()
    for w in existing:
        steps=(await db.scalars(select(ExperienceStep).where(ExperienceStep.workflow_id==w.id))).all()
        if any(metadata(s).get('source_sha256')==payload['source_sha256'] for s in steps):
            linked=settings(event).get('workflow_id')
            if linked and linked!=w.id:raise ValueError('A different programme is linked; do not overwrite it')
            if not linked:
                event.setup_preferences={**(event.setup_preferences or {}),'junior_programme':{'workflow_id':w.id,'groups':payload['groups'],'practice_preview':bool(practice_preview),'sessions_required':False,'revision':1}}
                db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='programme_draft_link_recovered',detail={'workflow_id':w.id}))
                await db.commit()
            return {'workflow_id':w.id,'created':False}
    if existing:raise ValueError('An active or draft Experience already exists. Reconcile it before installing this draft.')
    if settings(event).get('workflow_id'):raise ValueError('A programme is already linked; review it instead of replacing it')
    specs=copy.deepcopy(payload['steps']);cfg=await db.get(JuniorConfig,event_id);tz=ZoneInfo(event.timezone or 'UTC')
    anchor=event.event_date.replace(tzinfo=timezone.utc).astimezone(tz) if event.event_date.tzinfo is None else event.event_date.astimezone(tz)
    first=date(2026,12,25)
    shift=(date.fromisoformat(cfg.dropoff_start_date) if cfg and cfg.dropoff_start_date else anchor.date())-first if is_practice(event) else timedelta(0)
    for spec in specs:
        session=spec['config']['session'];meta=spec['config']['program']['junior'];mapped=date.fromisoformat(session['date'])+shift
        session['date']=mapped.isoformat();meta['date']=mapped.isoformat();meta['session_key']=mapped.isoformat()+':'+meta['session_key'].split(':')[-1]
        meta['source_sha256']=payload['source_sha256'];meta['source_file']=payload['source_file']
        spec['config']['announce']={'enabled':False}
        if spec.get('is_segment'):
            start=datetime.fromisoformat(mapped.isoformat()+'T'+session['start_time']).replace(tzinfo=tz)
            end=datetime.fromisoformat(mapped.isoformat()+'T'+session['end_time']).replace(tzinfo=tz)
            spec['starts_offset_seconds']=math.ceil((start-anchor).total_seconds());spec['duration_seconds']=int((end-start).total_seconds())
            if spec['starts_offset_seconds']<0 and is_practice(event):spec['starts_offset_seconds']=None
            elif spec['starts_offset_seconds']<0:raise ValueError('Programme dates must follow event start')
            if spec['duration_seconds']<=0:raise ValueError('Programme activities need positive durations')
    w=await create_workflow(event,db,name=payload['name']+(' · Practice' if is_practice(event) else ''),step_specs=specs,actor_user_id=actor.id)
    # create_workflow commits only the draft and its existing audit event.
    event=await db.scalar(select(Event).where(Event.id==event_id).with_for_update().execution_options(populate_existing=True))
    if settings(event).get('workflow_id'):
        if settings(event)['workflow_id']!=w.id:raise ValueError('Programme changed while draft was prepared; review before linking')
        return {'workflow_id':w.id,'created':True,'status':w.status,'steps':len(specs)}
    event.setup_preferences={**(event.setup_preferences or {}),'junior_programme':{'workflow_id':w.id,'groups':payload['groups'],'practice_preview':bool(practice_preview),'sessions_required':False,'revision':1}}
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='programme_draft_installed',detail={'workflow_id':w.id,'source_sha256':payload['source_sha256'],'steps':len(specs),'practice_preview':bool(practice_preview)}))
    await db.commit()
    return {'workflow_id':w.id,'created':True,'status':w.status,'steps':len(specs),'practice_date_shift':shift.days}
