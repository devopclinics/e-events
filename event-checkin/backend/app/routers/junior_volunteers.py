from datetime import datetime,timezone
from typing import Literal
from urllib.parse import urlsplit
import ipaddress
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field,field_validator,model_validator
from sqlalchemy import select
from ..database import get_db
from ..auth import require_event_member
from ..models import Event,EventUser,User,WhatsAppTemplateSubmission
from ..junior_models import JuniorConfig,JuniorAudit,JuniorVolunteerShift as Shift,JuniorVolunteerNotice as Notice
from ..services import junior_volunteers as service

router=APIRouter(prefix='/volunteers')
Channel=Literal['email','sms','whatsapp','mms']


class ShiftIn(BaseModel):
    request_id:str=Field(min_length=8,max_length=80)
    event_user_id:str
    station:str=Field(min_length=1,max_length=120)
    starts_at:datetime
    ends_at:datetime
    minutes_before:list[int]=Field(default_factory=lambda:[30,15],max_length=20)
    exact_times:list[datetime]=Field(default_factory=list,max_length=20)
    repeat_every_minutes:int|None=Field(default=None,ge=1,le=10080)
    repeat_from_minutes:int=Field(default=60,ge=1,le=10080)
    channels:list[Channel]=Field(min_length=1,max_length=4)
    phone:str|None=Field(default=None,pattern=r'^\+[1-9]\d{7,14}$')
    consents:list[Channel]=Field(default_factory=list,max_length=4)
    whatsapp_template_ref:str|None=Field(default=None,max_length=120)
    whatsapp_template_vars:dict[str,str]=Field(default_factory=dict)
    media_url:str|None=Field(default=None,max_length=1000)
    enabled:bool=False
    version:int|None=None

    @field_validator('station')
    @classmethod
    def station_not_blank(cls,v):
        if not v.strip():raise ValueError('Station is required')
        return v.strip()

    @field_validator('minutes_before')
    @classmethod
    def positive_offsets(cls,v):
        if any(x<1 or x>10080 for x in v):raise ValueError('Reminder offsets must be 1–10080 minutes before the shift')
        return sorted(set(v),reverse=True)

    @field_validator('media_url')
    @classmethod
    def public_image(cls,v):
        if not v:return None
        url=urlsplit(v)
        if url.scheme!='https' or not url.hostname or url.username or url.password or url.hostname.lower() in ('localhost','localhost.localdomain') or url.hostname.lower().endswith(('.local','.internal')):raise ValueError('Use a public HTTPS media URL')
        try:
            if not ipaddress.ip_address(url.hostname).is_global:raise ValueError('Use a public HTTPS media URL')
        except ValueError as exc:
            if str(exc)=='Use a public HTTPS media URL':raise
        return v

    @model_validator(mode='after')
    def validate_schedule(self):
        start=service.utc(self.starts_at);end=service.utc(self.ends_at)
        if end<=start:raise ValueError('Shift end must be after shift start')
        service.reminder_times(start,self.plan())
        return self

    def plan(self):
        return self.model_dump(mode='json',exclude={'event_user_id','station','starts_at','ends_at','enabled','version','request_id'})


async def allowed(event_id,actor,db,write=True):
    from .junior import access
    result=await access(event_id,actor,db,roles=['supervisor'],write=write)
    if write:await db.scalar(select(Event).where(Event.id==event_id).with_for_update())
    return result


def instant(v):return v.replace(tzinfo=timezone.utc).isoformat()


@router.get('')
async def list_shifts(event_id:str,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,_,_=await allowed(event_id,actor,db,False)
    team=(await db.execute(select(EventUser,User).join(User,User.id==EventUser.user_id).where(EventUser.event_id==event_id))).all()
    members=[{'event_user_id':eu.id,'user_id':u.id,'name':u.name,'email':u.email} for eu,u in team if u.is_active and ((eu.event_role=='manager' and not eu.guest_service_scoped) or u.id in (cfg.staff or {}))]
    people={eu.id:u for eu,u in team}
    shifts=(await db.scalars(select(Shift).where(Shift.event_id==event_id).order_by(Shift.starts_at))).all()
    rows=[]
    for s in shifts:
        user=await service.team_member(event,s,db)
        blockers=[await service.channel_blocker(event,s,user,c,db) for c in s.plan['channels']] if user else ['Assign an active Junior Platform team member']
        notices=(await db.scalars(select(Notice).where(Notice.shift_id==s.id).order_by(Notice.due_at,Notice.channel))).all()
        rows.append({'id':s.id,'event_user_id':s.event_user_id,'name':people[s.event_user_id].name if s.event_user_id in people else 'Former team member','station':s.station,'starts_at':instant(s.starts_at),'ends_at':instant(s.ends_at),'enabled':s.enabled,'version':s.version,'plan':s.plan,'blockers':list(dict.fromkeys(x for x in blockers if x)),
            'notices':[{'id':n.id,'due_at':instant(n.due_at),'channel':n.channel,'status':n.status,'error':n.error,'provider_id':n.provider_id} for n in notices]})
    templates=(await db.scalars(select(WhatsAppTemplateSubmission).where(WhatsAppTemplateSubmission.status=='approved',(WhatsAppTemplateSubmission.org_id==event.org_id)|WhatsAppTemplateSubmission.is_shared.is_(True)))).all()
    return {'sending_enabled':bool(cfg.volunteer_reminders_enabled),'members':members,'shifts':rows,'channels':['email','sms','whatsapp','mms'],
        'whatsapp_templates':[{'ref':t.bird_project_id+':'+t.bird_channel_template_id,'name':t.name,'variables':t.variables} for t in templates if t.bird_project_id and t.bird_channel_template_id]}


async def save_shift(event_id,body,db,actor,shift_id=None):
    event,cfg,_,_=await allowed(event_id,actor,db)
    if not shift_id:
        prior=await db.scalar(select(Shift).where(Shift.event_id==event_id,Shift.request_key==body.request_id))
        if prior:return {'id':prior.id,'version':prior.version}
    eu=await db.get(EventUser,body.event_user_id)
    if not eu or eu.event_id!=event_id:raise HTTPException(404,'Team member not found in this event')
    shift=await db.scalar(select(Shift).where(Shift.id==shift_id,Shift.event_id==event_id).with_for_update()) if shift_id else None
    if shift_id and not shift:raise HTTPException(404,'Shift not found')
    if shift and body.version!=shift.version:raise HTTPException(409,'Shift changed; refresh before editing')
    if shift:
        notices=(await db.scalars(select(Notice).where(Notice.shift_id==shift.id))).all()
        if any(n.status=='sending' for n in notices):raise HTTPException(409,'A reminder is being sent; wait for its outcome before editing')
        for n in notices:
            if n.status in ('scheduled','paused','setup_required'):n.status='cancelled';n.error='Shift edited or cancelled'
        shift.version+=1
    else:
        shift=Shift(event_id=event_id,event_user_id=body.event_user_id,version=1,request_key=body.request_id);db.add(shift)
    shift.event_user_id=body.event_user_id;shift.station=body.station;shift.starts_at=service.utc(body.starts_at);shift.ends_at=service.utc(body.ends_at)
    shift.plan=body.plan();shift.enabled=body.enabled;shift.updated_by=actor.id
    user=await service.team_member(event,shift,db)
    if not user:raise HTTPException(409,'Choose an active Junior Platform team member')
    await db.flush()
    now=datetime.utcnow()
    for due in service.reminder_times(shift.starts_at,shift.plan):
        for channel in dict.fromkeys(shift.plan['channels']):
            db.add(Notice(event_id=event_id,shift_id=shift.id,generation=shift.version,due_at=due,channel=channel,status='expired' if due<=now else 'scheduled' if shift.enabled else 'paused'))
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='volunteer_shift_saved',detail={'shift_id':shift.id,'version':shift.version,'enabled':shift.enabled,'channels':shift.plan['channels']}))
    await db.commit()
    return {'id':shift.id,'version':shift.version}


@router.post('',status_code=201)
async def create_shift(event_id:str,body:ShiftIn,db=Depends(get_db),actor=Depends(require_event_member)):
    return await save_shift(event_id,body,db,actor)


@router.put('/{shift_id}')
async def update_shift(event_id:str,shift_id:str,body:ShiftIn,db=Depends(get_db),actor=Depends(require_event_member)):
    return await save_shift(event_id,body,db,actor,shift_id)


class SendingIn(BaseModel):enabled:bool


@router.put('/sending/state')
async def set_sending(event_id:str,body:SendingIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,_,_=await allowed(event_id,actor,db)
    from ..services.junior_practice import is_practice
    if body.enabled and is_practice(event):raise HTTPException(409,'Volunteer sending is disabled in practice events')
    if body.enabled:
        shifts=(await db.scalars(select(Shift).where(Shift.event_id==event_id,Shift.enabled.is_(True),Shift.starts_at>datetime.utcnow()))).all()
        if not shifts:raise HTTPException(409,'Create at least one enabled future shift before enabling sending')
        for shift in shifts:
            user=await service.team_member(event,shift,db)
            if not user:raise HTTPException(409,'An assigned volunteer is no longer active')
            for channel in shift.plan['channels']:
                reason=await service.channel_blocker(event,shift,user,channel,db)
                if reason:raise HTTPException(409,reason)
    cfg.volunteer_reminders_enabled=body.enabled
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='volunteer_sending_updated',detail={'enabled':body.enabled}))
    await db.commit();return {'enabled':body.enabled}
