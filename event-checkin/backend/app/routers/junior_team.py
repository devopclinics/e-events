from datetime import datetime,timedelta,timezone
from typing import Literal
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,EmailStr,Field,field_validator,model_validator
from sqlalchemy import select,func
from ..database import get_db
from ..auth import require_event_member
from ..models import Event,EventUser,User,Membership
from ..junior_models import JuniorConfig,JuniorAudit,JuniorVolunteerProfile as Profile,JuniorVolunteerMessage as Message,JuniorVolunteerShift as Shift,JuniorVolunteerHandover as Handover
from ..services import junior_team as service
from ..services import junior_volunteers as reminders
from ..services import junior_permissions as permissions
from ..services.junior_permissions import Role,Permission,can
from .junior_volunteers import ShiftIn,allowed,save_shift,instant

router=APIRouter(prefix='/team')

class PersonIn(BaseModel):
    name:str=Field(min_length=1,max_length=255)
    email:EmailStr
    phone:str|None=Field(default=None,pattern=r'^\+[1-9]\d{7,14}$')
    role:Role='scanner'
    permissions:list[Permission]|None=Field(default=None,max_length=8)
    classrooms:list[str]=Field(default_factory=list,max_length=30)
    @model_validator(mode='after')
    def permission_role(self):
        if self.permissions is not None and self.role not in ('admin','volunteer'):raise ValueError('Choose Admin or Volunteer when assigning permissions')
        return self
    @field_validator('name')
    @classmethod
    def name_required(cls,v):
        if not v.strip():raise ValueError('Volunteer name is required')
        return v.strip()

class BatchIn(BaseModel):
    request_id:str=Field(min_length=8,max_length=80)
    rows:list[PersonIn]=Field(min_length=1,max_length=100)
    notify_email:bool=True
    @model_validator(mode='after')
    def unique(self):
        emails=[str(r.email).lower() for r in self.rows]
        if len(emails)!=len(set(emails)):raise ValueError('Use one row per email address')
        return self

class Selection(BaseModel):
    request_id:str=Field(min_length=8,max_length=80)
    event_user_ids:list[str]=Field(min_length=1,max_length=100)

class AssignIn(Selection):
    classrooms:list[str]=Field(default_factory=list,max_length=30)
    role:Role|None=None
    expected_versions:dict[str,int]=Field(default_factory=dict)
    notify_email:bool=True

class MessageIn(Selection):
    subject:str=Field(min_length=1,max_length=160)
    body:str=Field(min_length=1,max_length=3000)
    @field_validator('subject','body')
    @classmethod
    def text_required(cls,v):
        if not v.strip():raise ValueError('Message cannot be empty')
        return v.strip()
    @field_validator('subject')
    @classmethod
    def subject_one_line(cls,v):
        if '\r' in v or '\n' in v:raise ValueError('Use one line for the email subject')
        return v

class BulkShiftIn(ShiftIn):
    event_user_id:str=''
    event_user_ids:list[str]=Field(min_length=1,max_length=100)
    notify_email:bool=True


def rooms(cfg,values):
    result=list(dict.fromkeys(v.strip() for v in values if v.strip()))
    if not set(result).issubset(set(cfg.classrooms or [])):raise HTTPException(400,'Choose configured classrooms; add classrooms in Settings first')
    return result

async def context(event_id,actor,db,*,admin=False,write=True):
    event,cfg,role,owner=await allowed(event_id,actor,db,write)
    if admin and not owner:raise HTTPException(403,'Only an event administrator can add people or change staff roles/classes')
    if write:await db.refresh(cfg)
    return event,cfg,role,owner

async def selected(db,event,ids):
    ids=list(dict.fromkeys(ids));rows=(await db.execute(select(EventUser,User).join(User,User.id==EventUser.user_id).where(EventUser.event_id==event.id,EventUser.id.in_(ids)))).all()
    if len(rows)!=len(ids):raise HTTPException(404,'A selected volunteer does not belong to this event')
    if any(not u.is_active for eu,u in rows):raise HTTPException(409,'A selected account is suspended')
    order={value:index for index,value in enumerate(ids)}
    return sorted(rows,key=lambda row:order[row[0].id])

@router.get('')
async def roster(event_id:str,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,_,owner=await context(event_id,actor,db,write=False)
    rows=(await db.execute(select(EventUser,User).join(User,User.id==EventUser.user_id).where(EventUser.event_id==event_id).order_by(User.name))).all()
    profiles={p.event_user_id:p for p in (await db.scalars(select(Profile).where(Profile.event_id==event_id))).all()}
    org_roles=dict((await db.execute(select(Membership.user_id,Membership.role).where(Membership.org_id==event.org_id))).all())
    people=[]
    for eu,u in rows:
        if u.id not in (cfg.staff or {}) and not (eu.event_role=='manager' and not eu.guest_service_scoped):continue
        p=profiles.get(eu.id)
        people.append({'event_user_id':eu.id,'user_id':u.id,'name':p.name if p else u.name,'email':u.email,'phone':p.phone if p else None,'classrooms':p.classrooms if p else [],**permissions.info((cfg.staff or {}).get(u.id),u.is_platform_superadmin or org_roles.get(u.id) in ('owner','admin') or (eu.event_role=='manager' and not eu.guest_service_scoped)),'inherited_admin':bool(u.is_platform_superadmin or org_roles.get(u.id) in ('owner','admin') or (eu.event_role=='manager' and not eu.guest_service_scoped)),'version':p.version if p else 0,'account_status':'linked' if u.firebase_uid else 'awaiting_sign_in','active':u.is_active,'read_only':eu.access_level=='view'})
    return {'people':people,'classrooms':cfg.classrooms or [],'can_manage':owner,'practice_mode':service.is_practice(event),'app_url':service.app_url(event),'permission_catalog':permissions.CATALOG}

@router.post('/bulk',status_code=201)
async def bulk_add(event_id:str,body:BatchIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,_,_=await context(event_id,actor,db,admin=True)
    key,fingerprint,previous=await service.prior(db,event,actor,'volunteer_batch_added',body)
    if previous:return previous
    for row in body.rows:rooms(cfg,row.classrooms)
    result={'event_user_ids':[],'messages':[],'practice_mode':service.is_practice(event)}
    for row in body.rows:
        eu,user,p=await service.provision(db,event,row.name,str(row.email).lower(),row.phone,row.role,rooms(cfg,row.classrooms),cfg,permissions=row.permissions)
        result['event_user_ids'].append(eu.id)
        if body.notify_email:
            msg=await service.queue(db,event,eu,user,'invite',key+':'+eu.id,actor);result['messages'].append({'id':msg.id,'status':msg.status})
    service.finish(db,event,actor,'volunteer_batch_added',key,fingerprint,result);await db.commit();return result

@router.post('/assign')
async def bulk_assign(event_id:str,body:AssignIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,_,_=await context(event_id,actor,db,admin=True);classes=rooms(cfg,body.classrooms)
    key,fingerprint,previous=await service.prior(db,event,actor,'volunteer_classes_assigned',body)
    if previous:return previous
    people=await selected(db,event,body.event_user_ids);result={'updated':len(people),'messages':[]}
    for eu,user in people:
        p=await db.get(Profile,eu.id)
        active=(await db.scalars(select(Shift).where(Shift.event_id==event_id,Shift.event_user_id==eu.id,Shift.checked_in_at.is_not(None),Shift.checked_out_at.is_(None)))).all()
        if active and ((body.role and permissions.signature(permissions.entry(body.role))!=permissions.signature((cfg.staff or {}).get(user.id,body.role))) or any(s.plan.get('classroom') and s.plan['classroom'] not in classes for s in active)):raise HTTPException(409,'Finish the active classroom handover before reassigning this volunteer')
        if body.expected_versions.get(eu.id,p.version if p else 0)!=(p.version if p else 0):raise HTTPException(409,'Volunteer details changed. Refresh before assigning.')
        if not p:p=Profile(event_user_id=eu.id,event_id=event_id,name=user.name,classrooms=classes);db.add(p)
        else:p.classrooms=classes;p.version+=1;p.updated_at=datetime.utcnow()
        if body.role:cfg.staff={**(cfg.staff or {}),user.id:permissions.entry(body.role)}
        elif user.id not in (cfg.staff or {}) and eu.event_role!='manager':raise HTTPException(409,'Grant a Festio Juniors role before assigning this volunteer')
        await db.flush()
        if body.notify_email:
            msg=await service.queue(db,event,eu,user,'assignment',key+':'+eu.id,actor);result['messages'].append({'id':msg.id,'status':msg.status})
    service.finish(db,event,actor,'volunteer_classes_assigned',key,fingerprint,result);await db.commit();return result

class AccessIn(Selection):
    role:Literal['admin','volunteer']
    permissions:list[Permission]=Field(default_factory=lambda:['checkin'],max_length=8)
    expected_versions:dict[str,int]
    notify_email:bool=True

@router.post('/access')
async def set_access(event_id:str,body:AccessIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,_,_=await context(event_id,actor,db,admin=True)
    key,fingerprint,previous=await service.prior(db,event,actor,'volunteer_access_updated',body)
    if previous:return previous
    value=permissions.entry(body.role,body.permissions);result={'updated':0,'messages':[]}
    org_roles=dict((await db.execute(select(Membership.user_id,Membership.role).where(Membership.org_id==event.org_id))).all())
    for eu,user in await selected(db,event,body.event_user_ids):
        inherited=user.is_platform_superadmin or org_roles.get(user.id) in ('owner','admin') or (eu.event_role=='manager' and not eu.guest_service_scoped)
        if inherited and body.role!='admin':raise HTTPException(409,'Event owners and managers keep their inherited Admin access')
        p=await db.get(Profile,eu.id)
        if body.expected_versions.get(eu.id)!=(p.version if p else 0):raise HTTPException(409,'Volunteer access changed. Refresh before saving permissions.')
        active=await db.scalar(select(Shift.id).where(Shift.event_id==event_id,Shift.event_user_id==eu.id,Shift.checked_in_at.is_not(None),Shift.checked_out_at.is_(None)))
        if active and permissions.signature((cfg.staff or {}).get(user.id),inherited)!=permissions.signature(value,inherited):raise HTTPException(409,'Finish the active shift handover before changing permissions')
        if not p:p=Profile(event_user_id=eu.id,event_id=event_id,name=user.name,classrooms=[]);db.add(p)
        else:p.version+=1;p.updated_at=datetime.utcnow()
        cfg.staff={**(cfg.staff or {}),user.id:value};await db.flush();result['updated']+=1
        if body.notify_email:
            msg=await service.queue(db,event,eu,user,'assignment',key+':'+eu.id,actor);result['messages'].append({'id':msg.id,'status':msg.status})
    service.finish(db,event,actor,'volunteer_access_updated',key,fingerprint,result);await db.commit();return result

@router.post('/message')
async def send_message(event_id:str,body:MessageIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,_,_=await context(event_id,actor,db);key,fingerprint,previous=await service.prior(db,event,actor,'volunteer_message',body)
    if previous:return previous
    result={'messages':[]}
    for eu,user in await selected(db,event,body.event_user_ids):
        if not await reminders.team_member(event,type('Duty',(),{'event_user_id':eu.id})(),db):raise HTTPException(409,'Select active Festio Juniors volunteers')
        msg=await service.queue(db,event,eu,user,'message',key+':'+eu.id,actor,body=body.body,subject=body.subject);result['messages'].append({'id':msg.id,'status':msg.status})
    service.finish(db,event,actor,'volunteer_message',key,fingerprint,result);await db.commit();return result

@router.post('/shifts/bulk',status_code=201)
async def bulk_shifts(event_id:str,body:BulkShiftIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,_,_=await context(event_id,actor,db);key,fingerprint,previous=await service.prior(db,event,actor,'volunteer_shifts_assigned',body)
    if previous:return previous
    if body.phone and len(set(body.event_user_ids))>1:raise HTTPException(400,'Bulk shifts use each volunteer’s saved mobile, not one shared number')
    people=await selected(db,event,body.event_user_ids);result={'shifts':[],'messages':[]}
    for eu,user in people:
        individual=ShiftIn.model_validate({**body.model_dump(exclude={'event_user_ids','notify_email'}),'event_user_id':eu.id,'request_id':service.operation_id(event_id,'shift',body.request_id+':'+eu.id)})
        saved=await save_shift(event_id,individual,db,actor,commit=False);result['shifts'].append(saved)
        if body.notify_email:
            local=individual.starts_at.astimezone(ZoneInfo(event.timezone or 'UTC'))
            text=f'{event.name}: your Festio Juniors shift at {body.station} starts {local:%b %d, %I:%M %p %Z}. Open the app to review your classroom, reminder plan and handover.'
            msg=await service.queue(db,event,eu,user,'assignment',key+':'+eu.id,actor,body=text,subject='Your Festio Juniors shift assignment');result['messages'].append({'id':msg.id,'status':msg.status})
    service.finish(db,event,actor,'volunteer_shifts_assigned',key,fingerprint,result);await db.commit();return result

async def my_context(event_id,actor,db,write=False):
    from .junior import access
    event,cfg,role,admin=await access(event_id,actor,db,roles=['scanner','intake','support','inventory','supervisor'],write=write)
    if write:await db.scalar(select(Event).where(Event.id==event_id).with_for_update())
    return event,cfg,role,admin

async def duty(db,event,shift_id,actor,admin=False):
    shift=await db.scalar(select(Shift).where(Shift.id==shift_id,Shift.event_id==event.id).with_for_update())
    if not shift:raise HTTPException(404,'Shift not found in this event')
    user=await reminders.team_member(event,shift,db)
    if not user:raise HTTPException(409,'This volunteer is no longer active')
    if actor.id!=user.id and not admin:raise HTTPException(403,'This action is for your own shift')
    return shift,user

async def shift_data(db,event,s,cache=None):
    cache={} if cache is None else cache;room=s.plan.get('classroom')
    if room not in cache:cache[room]=await service.snapshot(db,event,room)
    snap=cache[room]
    return {'id':s.id,'event_user_id':s.event_user_id,'station':s.station,'classroom':s.plan.get('classroom'),'starts_at':instant(s.starts_at),'ends_at':instant(s.ends_at),'version':s.version,'enabled':s.enabled,'checked_in_at':instant(s.checked_in_at) if s.checked_in_at else None,'checked_out_at':instant(s.checked_out_at) if s.checked_out_at else None,'snapshot':snap}

async def handover_data(db,event,h,cache=None,role=None):
    cache={} if cache is None else cache
    if h.classroom not in cache:cache[h.classroom]=await service.snapshot(db,event,h.classroom)
    safe=role is None or can(role,'view_children')
    snapshot=h.snapshot if safe else {**h.snapshot,'away':[]}
    current=cache[h.classroom] if safe else {**cache[h.classroom],'away':[]}
    return {'id':h.id,'from_shift_id':h.from_shift_id,'to_shift_id':h.to_shift_id,'from_name':h.from_name,'to_name':h.to_name,'from_user_id':h.from_user_id,'to_user_id':h.to_user_id,'classroom':h.classroom,'status':h.status,'version':h.version,'headcount':h.headcount,'snapshot':snapshot,'current_snapshot':current,'notes':h.notes if safe else None,'created_at':instant(h.created_at),'accepted_at':instant(h.accepted_at) if h.accepted_at else None}

@router.get('/mine')
async def mine(event_id:str,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,role,admin=await my_context(event_id,actor,db)
    shifts=(await db.scalars(select(Shift).join(EventUser,EventUser.id==Shift.event_user_id).where(Shift.event_id==event_id,EventUser.user_id==actor.id).order_by(Shift.starts_at))).all()
    handovers=(await db.scalars(select(Handover).where(Handover.event_id==event_id,(Handover.from_user_id==actor.id)|(Handover.to_user_id==actor.id)).order_by(Handover.created_at.desc()).limit(100))).all()
    candidates=(await db.execute(select(Shift,User).join(EventUser,EventUser.id==Shift.event_user_id).join(User,User.id==EventUser.user_id).where(Shift.event_id==event_id,Shift.enabled.is_(True),((Shift.ends_at>datetime.utcnow())|((Shift.checked_in_at.is_not(None))&(Shift.checked_out_at.is_(None)))),User.id!=actor.id))).all()
    own_shifts=[await shift_data(db,event,s) for s in shifts];own_hands=[await handover_data(db,event,h,role=role) for h in handovers]
    if not can(role,'view_children'):
        for row in own_shifts:row['snapshot']={**row['snapshot'],'away':[]}
        for row in own_hands:
            for key in ('snapshot','current_snapshot'):row[key]={**row[key],'away':[]}
    return {'user_id':actor.id,'shifts':own_shifts,'handovers':own_hands,
        'incoming':[{'id':s.id,'name':u.name,'station':s.station,'classroom':s.plan.get('classroom'),'version':s.version,'starts_at':instant(s.starts_at),'ends_at':instant(s.ends_at)} for s,u in candidates if await reminders.team_member(event,s,db)]}

class CheckIn(BaseModel):
    version:int
    physically_present:bool

@router.post('/shifts/{shift_id}/checkin')
async def checkin(event_id:str,shift_id:str,body:CheckIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,_,role,admin=await my_context(event_id,actor,db,True);s,user=await duty(db,event,shift_id,actor,admin)
    if not body.physically_present:raise HTTPException(400,'Confirm the volunteer is physically at their station')
    if body.version!=s.version:raise HTTPException(409,'Shift changed; refresh')
    if not s.enabled or s.checked_out_at:raise HTTPException(409,'This shift is paused or already finished')
    now=datetime.utcnow()
    if now<s.starts_at-timedelta(hours=1) or now>s.ends_at:raise HTTPException(409,'Shift check-in is available from one hour before start until shift end')
    if not s.checked_in_at:
        other=await db.scalar(select(Shift.id).where(Shift.event_id==event_id,Shift.event_user_id==s.event_user_id,Shift.id!=s.id,Shift.checked_in_at.is_not(None),Shift.checked_out_at.is_(None)))
        if other:raise HTTPException(409,'Finish or hand over your existing active shift before checking in to another')
        s.checked_in_at=now;db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='volunteer_checked_in',detail={'shift_id':s.id,'volunteer_user_id':user.id}))
    await db.commit();return {'checked_in_at':instant(s.checked_in_at)}

@router.post('/shifts/{shift_id}/checkout')
async def checkout(event_id:str,shift_id:str,body:CheckIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,_,role,admin=await my_context(event_id,actor,db,True);s,user=await duty(db,event,shift_id,actor,admin)
    if not body.physically_present or body.version!=s.version:raise HTTPException(409,'Confirm the current shift and physical handoff')
    if not s.checked_in_at:raise HTTPException(409,'Record shift check-in first')
    if not s.checked_out_at:
        snap=await service.snapshot(db,event,s.plan.get('classroom'))
        accepted=False
        for hand in (await db.scalars(select(Handover).where(Handover.event_id==event_id,Handover.from_shift_id==s.id,Handover.status=='accepted'))).all():
            incoming=await db.get(Shift,hand.to_shift_id) if hand.to_shift_id else None
            if incoming and incoming.enabled and incoming.checked_in_at and not incoming.checked_out_at and hand.from_version==s.version and hand.to_version==incoming.version and hand.classroom==s.plan.get('classroom') and await reminders.team_member(event,incoming,db):accepted=True
        if s.plan.get('classroom') and (snap['expected_count'] or snap['away'] or snap['prior_day_unresolved']) and not accepted:raise HTTPException(409,'Children remain in this class. The incoming volunteer must accept the handover before you finish.')
        s.checked_out_at=datetime.utcnow();db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='volunteer_checked_out',detail={'shift_id':s.id,'volunteer_user_id':user.id,'snapshot':snap}))
    await db.commit();return {'checked_out_at':instant(s.checked_out_at)}

class OfferIn(BaseModel):
    request_id:str=Field(min_length=8,max_length=80)
    from_shift_id:str
    to_shift_id:str
    from_version:int
    to_version:int
    headcount:int=Field(ge=0,le=10000)
    counts_confirmed:bool
    open_movements_reviewed:bool
    notes:str|None=Field(default=None,max_length=2000)

@router.post('/handovers',status_code=201)
async def offer(event_id:str,body:OfferIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,_,role,admin=await my_context(event_id,actor,db,True);old=await db.scalar(select(Handover).where(Handover.event_id==event_id,Handover.request_key==body.request_id))
    if old:
        if old.from_user_id!=actor.id and not admin:raise HTTPException(403,'This handover belongs to another outgoing volunteer')
        if old.headcount!=body.headcount or old.notes!=body.notes or old.from_version!=body.from_version or old.to_version!=body.to_version:raise HTTPException(409,'Request ID already used for a different handover')
        if old.from_shift_id!=body.from_shift_id or old.to_shift_id!=body.to_shift_id:raise HTTPException(409,'Request ID already used for a different handover')
        return await handover_data(db,event,old,role=role)
    first,user=await duty(db,event,body.from_shift_id,actor,admin)
    if first.id==body.to_shift_id:raise HTTPException(400,'Choose a different incoming shift')
    second=await db.get(Shift,body.to_shift_id)
    if not second or second.event_id!=event_id:raise HTTPException(404,'Incoming shift not found in this event')
    incoming=await reminders.team_member(event,second,db)
    if (second.ends_at<=datetime.utcnow() and not second.checked_in_at) or (second.starts_at>first.ends_at+timedelta(hours=2) and not second.checked_in_at):raise HTTPException(409,'Choose an incoming shift near the outgoing shift’s end, not an expired or distant shift')
    if not incoming or incoming.id==user.id:raise HTTPException(400,'Choose a different active incoming volunteer')
    if not first.enabled or not second.enabled or not first.checked_in_at or first.checked_out_at or second.checked_out_at:raise HTTPException(409,'Use an active, checked-in outgoing shift and an available incoming shift')
    if first.version!=body.from_version or second.version!=body.to_version:raise HTTPException(409,'Shift assignment changed; refresh')
    classroom=first.plan.get('classroom')
    if classroom!=second.plan.get('classroom') or (not classroom and first.station.casefold()!=second.station.casefold()):raise HTTPException(400,'Handovers must cover the same classroom or station')
    if not body.counts_confirmed or not body.open_movements_reviewed:raise HTTPException(400,'Confirm the physical count and review all open movements')
    pending=await db.scalar(select(Handover.id).where(Handover.from_shift_id==first.id,Handover.status.in_(['pending','attention'])))
    if pending:raise HTTPException(409,'A handover is already awaiting acceptance for this shift')
    snap=await service.snapshot(db,event,classroom)
    h=Handover(event_id=event_id,request_key=body.request_id,from_shift_id=first.id,to_shift_id=second.id,from_user_id=user.id,to_user_id=incoming.id,from_name=user.name,to_name=incoming.name,from_version=first.version,to_version=second.version,classroom=classroom,headcount=body.headcount,snapshot=snap,notes=body.notes,offered_by=actor.id,status='pending' if snap['expected_count']==body.headcount else 'attention');db.add(h);await db.flush()
    eu=await db.get(EventUser,second.event_user_id)
    await service.queue(db,event,eu,incoming,'handover',h.id+':offered',actor,body=f'{event.name}: {user.name} has offered you a handover for {classroom or first.station}. Open Festio Juniors, review current headcounts and open movements, then accept in person.',subject='Festio Juniors handover needs your acceptance')
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='volunteer_handover_offered',detail={'handover_id':h.id,'status':h.status}));await db.commit();return await handover_data(db,event,h,role=role)

class AcceptIn(BaseModel):
    version:int
    headcount:int=Field(ge=0,le=10000)
    snapshot_token:str
    counts_confirmed:bool
    open_movements_reviewed:bool

@router.post('/handovers/{handover_id}/accept')
async def accept(event_id:str,handover_id:str,body:AcceptIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,_,role,_=await my_context(event_id,actor,db,True);h=await db.scalar(select(Handover).where(Handover.id==handover_id,Handover.event_id==event_id).with_for_update())
    if not h:raise HTTPException(404,'Handover not found')
    if h.to_user_id!=actor.id:raise HTTPException(403,'Only the assigned incoming volunteer can accept this handover')
    if h.status=='accepted':return await handover_data(db,event,h,role=role)
    if h.status not in ('pending','attention') or body.version!=h.version:raise HTTPException(409,'Handover changed; refresh')
    first=await db.get(Shift,h.from_shift_id) if h.from_shift_id else None;second=await db.get(Shift,h.to_shift_id) if h.to_shift_id else None
    if not first or not second or not first.enabled or not second.enabled or not first.checked_in_at or first.checked_out_at or first.version!=h.from_version or second.version!=h.to_version:raise HTTPException(409,'Shift assignment changed. Cancel this handover and create a current one.')
    incoming=await reminders.team_member(event,second,db)
    if not incoming or incoming.id!=actor.id or not second.checked_in_at or second.checked_out_at:raise HTTPException(409,'Check in to your incoming shift before accepting')
    snap=await service.snapshot(db,event,h.classroom)
    if not body.counts_confirmed or not body.open_movements_reviewed or snap['token']!=body.snapshot_token or snap['expected_count']!=body.headcount:raise HTTPException(409,'Counts changed or do not match. Refresh, reconcile child movements and confirm the current physical count.')
    h.status='accepted';h.version+=1;h.accepted_at=datetime.utcnow();h.accepted_by=actor.id;h.accepted_snapshot={**snap,'physical_count':body.headcount}
    eu=await db.get(EventUser,first.event_user_id);user=await db.get(User,h.from_user_id)
    if eu and user:await service.queue(db,event,eu,user,'handover',h.id+':accepted',actor,body=f'{event.name}: {actor.name} accepted your handover for {h.classroom or first.station}. You can now finish your outgoing shift in Festio Juniors.',subject='Festio Juniors handover accepted')
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='volunteer_handover_accepted',detail={'handover_id':h.id,'snapshot':snap}));await db.commit();return await handover_data(db,event,h,role=role)

class CancelIn(BaseModel):version:int;reason:str=Field(min_length=3,max_length=1000)
@router.post('/handovers/{handover_id}/cancel')
async def cancel(event_id:str,handover_id:str,body:CancelIn,db=Depends(get_db),actor=Depends(require_event_member)):
    event,_,role,admin=await my_context(event_id,actor,db,True);h=await db.scalar(select(Handover).where(Handover.id==handover_id,Handover.event_id==event_id).with_for_update())
    if not h:raise HTTPException(404,'Handover not found')
    if actor.id!=h.from_user_id and not can(role,'volunteers'):raise HTTPException(403,'Ask the outgoing volunteer or supervisor to cancel')
    if h.version!=body.version or h.status not in ('pending','attention'):raise HTTPException(409,'Only a current pending handover can be cancelled')
    h.status='cancelled';h.version+=1;db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='volunteer_handover_cancelled',detail={'handover_id':h.id,'reason':body.reason}));await db.commit();return {'status':h.status}

@router.get('/dashboard')
async def dashboard(event_id:str,db=Depends(get_db),actor=Depends(require_event_member)):
    event,cfg,role,_=await context(event_id,actor,db,write=False)
    # Receipt reconciliation is performed by the worker; dashboard reads do not submit email.
    shifts=(await db.scalars(select(Shift).where(Shift.event_id==event_id).order_by(Shift.starts_at))).all();now=datetime.utcnow();rows=[];cache={}
    for s in shifts:
        user=await reminders.team_member(event,s,db)
        if user:rows.append({**(await shift_data(db,event,s,cache)),'name':user.name,'user_id':user.id})
    hands=(await db.scalars(select(Handover).where(Handover.event_id==event_id,Handover.status.in_(['pending','attention'])).order_by(Handover.created_at))).all()
    hands+=(await db.scalars(select(Handover).where(Handover.event_id==event_id,Handover.status.not_in(['pending','attention'])).order_by(Handover.created_at.desc()).limit(100))).all()
    messages=(await db.scalars(select(Message).where(Message.event_id==event_id).order_by(Message.created_at.desc()).limit(300))).all()
    from ..junior_models import JuniorVolunteerNotice
    notices=(await db.scalars(select(JuniorVolunteerNotice).where(JuniorVolunteerNotice.event_id==event_id))).all();counts={}
    for model in [Message,JuniorVolunteerNotice]:
        for status,count in (await db.execute(select(model.status,func.count()).where(model.event_id==event_id).group_by(model.status))).all():counts[status]=counts.get(status,0)+count
    classes=[]
    for classroom in cfg.classrooms or []:
        snap=await service.snapshot(db,event,classroom);on=[s for s in rows if s['classroom']==classroom and s['enabled'] and s['checked_in_at'] and not s['checked_out_at']]
        classes.append({'classroom':classroom,'children_present':snap['expected_count'],'volunteers_on_duty':len(on),'needs_cover':bool(snap['expected_count'] and not on)})
    hand_rows=[await handover_data(db,event,h,cache) for h in hands]
    if not can(role,'view_children'):
        for row in rows:row['snapshot']={**row['snapshot'],'away':[]}
        for row in hand_rows:
            row['notes']=None
            for key in ('snapshot','current_snapshot'):row[key]={**row[key],'away':[]}
    return {'shifts':rows,'classes':classes,'handovers':hand_rows,
        'summary':{'on_duty':sum(bool(s['checked_in_at'] and not s['checked_out_at'] and s['enabled']) for s in rows),'upcoming':sum(s['enabled'] and datetime.fromisoformat(s['starts_at'])>now.replace(tzinfo=timezone.utc) for s in rows),'pending_handovers':sum(h.status=='pending' for h in hands),'attention_handovers':sum(h.status=='attention' or (h.status in ('pending','attention') and (not h.from_shift_id or not h.to_shift_id)) for h in hands),'overdue_shifts':sum(bool(s['checked_in_at'] and not s['checked_out_at'] and datetime.fromisoformat(s['ends_at'])<now.replace(tzinfo=timezone.utc)) for s in rows),'coverage_gaps':sum(c['needs_cover'] for c in classes),'email_and_reminder_status':counts},
        'messages':[{'id':m.id,'kind':m.kind,'recipient':m.recipient,'subject':m.subject,'body':m.body,'status':m.status,'error':m.error,'created_at':instant(m.created_at)} for m in messages]}
