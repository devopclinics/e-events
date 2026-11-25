"""Juniors reads the existing Experience programme; custody remains staff-confirmed."""
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select
from ..models import ExperienceWorkflow, ExperienceStep, EventUser
from ..junior_models import JuniorVolunteerProfile, JuniorVolunteerShift
from .junior_practice import is_practice
from . import junior_days as days


def settings(event):
    value=(event.setup_preferences or {}).get('junior_programme')
    return value if isinstance(value,dict) else {}


def metadata(step):
    config=getattr(step,'config',None)
    program=config.get('program') if isinstance(config,dict) else None
    value=program.get('junior') if isinstance(program,dict) else None
    return value if isinstance(value,dict) else {}


async def source(event,db):
    cfg=settings(event)
    workflow=await db.get(ExperienceWorkflow,cfg.get('workflow_id')) if cfg.get('workflow_id') else None
    if workflow and workflow.event_id!=event.id:
        raise HTTPException(409,'The programme source belongs to another event')
    if not workflow or workflow.status=='archived':return None,[]
    steps=(await db.scalars(select(ExperienceStep).where(ExperienceStep.workflow_id==workflow.id,ExperienceStep.enabled.is_(True)).order_by(ExperienceStep.sort_order))).all()
    return workflow,[s for s in steps if metadata(s)]


def can_preview(event,workflow,admin):
    return bool(workflow and (workflow.status=='published' or admin or (is_practice(event) and settings(event).get('practice_preview'))))


def session_available(event,workflow):
    return bool(workflow and (workflow.status=='published' or (is_practice(event) and settings(event).get('practice_preview'))))


def time_window(step,event):
    from .engagement_sync_outbox import _snapshot
    from types import SimpleNamespace
    data=_snapshot(event,SimpleNamespace(id=step.workflow_id),step,'draft')
    return data.get('starts_at'),data.get('ends_at')


def step_out(step,event):
    meta=metadata(step);start,end=time_window(step,event)
    return {'id':step.id,'key':step.key,'title':step.title,'description':step.description,'starts_at':start,'ends_at':end,
            'group':meta.get('group'),'groups':meta.get('groups',[]),'session_key':meta.get('session_key'),'kind':meta.get('kind','activity'),
            'date':start[:10] if start else meta.get('date'),'review_notes':meta.get('review_notes',[]),'room':((step.config or {}).get('session') or {}).get('room') or None}


async def assigned_classrooms(event,actor,db):
    eu=await db.scalar(select(EventUser).where(EventUser.event_id==event.id,EventUser.user_id==actor.id))
    if not eu:return []
    profile=await db.get(JuniorVolunteerProfile,eu.id)
    result=set(profile.classrooms or []) if profile and profile.event_id==event.id else set()
    shifts=(await db.scalars(select(JuniorVolunteerShift).where(JuniorVolunteerShift.event_id==event.id,JuniorVolunteerShift.event_user_id==eu.id,JuniorVolunteerShift.enabled.is_(True)))).all()
    for shift in shifts:
        room=(shift.plan or {}).get('classroom')
        if room:result.add(room)
    return sorted(result)


def group_for(child,groups):
    # Explicit mappings only: never guess a child's age or move a classroom.
    exact=[g['key'] for g in groups if child.age_group and child.age_group in g.get('age_groups',[])]
    if len(exact)==1:return exact[0]
    rooms=[g['key'] for g in groups if child.classroom and child.classroom in g.get('classrooms',[])]
    return rooms[0] if len(rooms)==1 else None


async def validate_session(event,child,session_id,db):
    workflow,steps=await source(event,db)
    if not session_available(event,workflow):raise HTTPException(409,'Publish the approved programme before recording session attendance. Practice preview is separate.')
    step=next((s for s in steps if s.id==session_id and metadata(s).get('kind')=='custody_session'),None)
    if not step:raise HTTPException(409,'Choose a current session from this event programme')
    meta=metadata(step)
    start_at,end_at=time_window(step,event)
    if (start_at[:10] if start_at else meta.get('date'))!=days.day(event):raise HTTPException(409,'This session is not scheduled for today')
    group=group_for(child,settings(event).get('groups',[]))
    if not group or group not in meta.get('groups',[]):raise HTTPException(409,'Confirm this child’s programme group before session drop-off')
    session=(step.config or {}).get('session') or {}
    local=days.utcnow().replace(tzinfo=timezone.utc).astimezone(__import__('zoneinfo').ZoneInfo(event.timezone or 'UTC'))
    start=datetime.fromisoformat(start_at).strftime('%H:%M') if start_at else None
    end=datetime.fromisoformat(end_at).strftime('%H:%M') if end_at else None
    if not start or not end or (not is_practice(event) and not (start<=local.strftime('%H:%M')<end)):raise HTTPException(409,'This session is outside its scheduled admission window')
    return step
