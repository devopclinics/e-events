"""Staff-only Junior Programme. No public endpoints or implicit convention admission."""
from datetime import datetime, date, timezone
from typing import Literal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, EmailStr, field_validator
from sqlalchemy import select
from ..database import get_db
from ..auth import require_event_member, _org_role
from ..models import Event, EventUser, User
from ..junior_models import (JuniorConfig, JuniorChild, JuniorContact, JuniorMovement,
    JuniorOuting, JuniorOutingMember, JuniorNotification, JuniorInventory, JuniorInventoryEntry)

router = APIRouter(prefix='/{event_id}/junior')
Role = Literal['scanner', 'intake', 'support', 'inventory', 'supervisor']
Relationship = Literal['parent', 'chaperone', 'adult_sibling']


async def access(event_id, actor, db, *, roles=None, enabled=True):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, 'Event not found')
    org_role = await _org_role(actor, event.org_id, db) if not actor.is_platform_superadmin else 'owner'
    eu = await db.scalar(select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == actor.id))
    config = await db.get(JuniorConfig, event_id)
    admin = org_role in ('owner', 'admin') or bool(eu and eu.event_role == 'manager' and not eu.guest_service_scoped)
    role = 'supervisor' if admin else (config.staff or {}).get(actor.id) if config and eu else None
    if not role or (roles and role not in roles):
        raise HTTPException(403, 'Junior Programme permission required')
    if eu and org_role not in ('owner','admin') and eu.access_level == 'view' and roles:
        raise HTTPException(403, 'This event access is view-only')
    if enabled and not event.junior_program_enabled:
        raise HTTPException(409, 'Junior Programme is not enabled for this event')
    return event, config, role, admin


def output_child(child, role):
    keys = ('id','name','reference','age_group','classroom','location','allergy','accommodation',
            'allergy_cleared','accommodation_cleared','version','updated_at')
    result = {k: getattr(child,k) for k in keys}
    if role in ('support','supervisor'):
        result.update(allergy_notes=child.allergy_notes, accommodation_notes=child.accommodation_notes)
    return result


async def child_for(event_id, child_id, db, lock=False):
    row = select(JuniorChild).where(JuniorChild.id == child_id, JuniorChild.event_id == event_id)
    if lock:
        row = row.with_for_update()
    child = await db.scalar(row)
    if not child:
        raise HTTPException(404, 'Child not found')
    return child


def check_version(row, version):
    if row.version != version:
        raise HTTPException(409, 'This record changed. Refresh before continuing.')


def tick(child):
    child.version += 1
    child.updated_at = datetime.utcnow()


async def audit(db, event, child, actor, action, *, request_id, before=None, **details):
    movement = JuniorMovement(event_id=event.id, child_id=child.id, request_id=request_id,
        action=action, from_location=before or child.location, to_location=child.location,
        actor_id=actor.id, **details)
    db.add(movement)
    await db.flush()
    # A missing contact still produces two visible setup-required records.
    contacts = list((await db.scalars(select(JuniorContact).where(
        JuniorContact.child_id == child.id, JuniorContact.notify.is_(True)))).all())
    config = await db.get(JuniorConfig,event.id)
    local = movement.occurred_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(event.timezone or 'UTC'))
    labels = {'dropoff':'Drop-off recorded', 'classroom':'Arrived in classroom',
        'clear_allergy':'Allergy desk visit completed', 'clear_accommodation':'Accommodation desk visit completed',
        'clinic':'Departed for clinic', 'other':'Temporary departure recorded',
        'return':'Returned to Junior Platform', 'outing_depart':'Departed for outing',
        'outing_return':'Returned from outing', 'release':'Released to authorized adult',
        'intake':'Child record created', 'correction':'Child record updated', 'screening':'Screening recorded',
        'contact':'Guardian details updated'}
    # Never copy medical notes, free-text movement reasons or phone numbers into messages.
    body = f'{event.name} / Junior Platform: {child.name}. {labels.get(action, action)}. {local:%b %d, %I:%M %p %Z}.'
    if action == 'classroom':
        body += f' Classroom: {child.classroom}.'
    if action == 'release':
        body += f' Collected by {movement.adult_name} ({movement.relationship.replace("_", " ")}).'
    for contact in contacts or [None]:
        for channel in ('email','sms'):
            recipient = getattr(contact, 'email' if channel == 'email' else 'phone', None)
            error = None
            if not recipient:
                error = 'Guardian contact details missing'
            elif channel == 'sms' and not contact.sms_consent:
                error = 'Guardian SMS permission not recorded'
            db.add(JuniorNotification(event_id=event.id,movement_id=movement.id,
                contact_id=contact.id if contact else None,channel=channel,recipient=recipient,
                body=body,status='setup_required' if error else ('queued' if config and config.notifications_enabled else 'paused'),error=error))
    return movement


class ConfigIn(BaseModel):
    enabled: bool
    classrooms: list[str] = Field(default_factory=list, max_length=100)
    staff: dict[str, Role] = Field(default_factory=dict)
    notifications_enabled: bool = False


@router.get('/config')
async def config_get(event_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    event = await db.get(Event,event_id)
    config = await db.get(JuniorConfig,event_id)
    try:
        _, _, role, admin = await access(event_id,actor,db,enabled=False)
    except HTTPException as exc:
        if exc.status_code != 403:
            raise
        role, admin = None, False
    return {'enabled':bool(event.junior_program_enabled),'role':role,'can_configure':admin,
        'classrooms':config.classrooms if config else [],
        'staff':config.staff if config and admin else {},
        'notifications_enabled':bool(config and config.notifications_enabled),
        'available_staff':[{'id':u.id,'name':u.name,'view_only':eu.access_level=='view'} for eu,u in
            (await db.execute(select(EventUser,User).join(User,User.id==EventUser.user_id).where(EventUser.event_id==event_id))).all()] if admin else []}


@router.put('/config')
async def config_put(event_id: str, body: ConfigIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,config,_,admin = await access(event_id,actor,db,enabled=False,roles=['supervisor'])
    if not admin:
        raise HTTPException(403,'Only the event administrator can configure this module')
    assigned = set((await db.scalars(select(EventUser.user_id).where(EventUser.event_id == event_id))).all())
    if not set(body.staff).issubset(assigned):
        raise HTTPException(400,'Junior staff must already be assigned to this event')
    classrooms = list(dict.fromkeys(x.strip() for x in body.classrooms if x.strip()))
    if any(len(x)>100 for x in classrooms):
        raise HTTPException(400,'Classroom names must be at most 100 characters')
    existing = set((await db.scalars(select(JuniorChild.classroom).where(JuniorChild.event_id==event_id))).all())
    if not existing.issubset(set(classrooms)):
        raise HTTPException(409,'Reassign children before removing their classroom')
    if body.notifications_enabled and (not event.notify_email or not event.notify_sms):
        raise HTTPException(409,'Enable event email and SMS channels and verify sending readiness first')
    if not config:
        config=JuniorConfig(event_id=event_id)
        db.add(config)
    event.junior_program_enabled=body.enabled
    config.classrooms=classrooms
    config.staff=body.staff
    config.notifications_enabled=body.notifications_enabled
    await db.commit()
    return await config_get(event_id,db,actor)


class ContactIn(BaseModel):
    name: str = Field(min_length=1,max_length=255)
    relationship: Relationship
    email: EmailStr | None = None
    phone: str | None = Field(default=None,pattern=r'^\+[1-9]\d{7,14}$')
    sms_consent: bool = False
    adult_verified: bool = False
    pickup_authorized: bool = False
    notify: bool = True

    @field_validator('name')
    @classmethod
    def name_not_blank(cls,value):
        if not value.strip(): raise ValueError('Name is required')
        return value.strip()


class ChildIn(BaseModel):
    name: str = Field(min_length=1,max_length=255)
    reference: str | None = Field(default=None,max_length=100)
    age_group: str = Field(min_length=1,max_length=80)
    classroom: str = Field(min_length=1,max_length=100)
    guardian: ContactIn | None = None
    confirm_same_name: bool = False

    @field_validator('name','age_group','classroom')
    @classmethod
    def not_blank(cls,value):
        if not value.strip(): raise ValueError('This field is required')
        return value.strip()


async def create_child(event,config,body,actor,db):
    if body.classroom not in (config.classrooms or []):
        raise HTTPException(400,'Choose a configured classroom')
    rows=(await db.scalars(select(JuniorChild).where(JuniorChild.event_id==event.id))).all()
    ref=(body.reference or '').strip() or None
    if ref and any(c.reference==ref for c in rows):
        raise HTTPException(409,'This roster reference already exists')
    if not body.confirm_same_name and any(c.name.casefold()==body.name.casefold() for c in rows):
        raise HTTPException(409,'A child with this name exists. Review the roster before confirming a different child.')
    child=JuniorChild(event_id=event.id,name=body.name,reference=ref,age_group=body.age_group,classroom=body.classroom)
    db.add(child)
    await db.flush()
    if body.guardian:
        add_contact(child,body.guardian,actor,db)
        await db.flush()
    await audit(db,event,child,actor,'intake',request_id='intake:'+child.id)
    return child


def add_contact(child,body,actor,db):
    if body.pickup_authorized and not body.adult_verified:
        raise HTTPException(400,'Verify adulthood before authorizing pickup')
    row=JuniorContact(child_id=child.id,verified_by=actor.id,**body.model_dump(mode='json'))
    db.add(row)
    return row


@router.post('/children',status_code=201)
async def child_add(event_id: str, body: ChildIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,config,role,_=await access(event_id,actor,db,roles=['intake','supervisor'])
    # Serialize roster additions per event for deterministic duplicate detection.
    await db.scalar(select(Event).where(Event.id==event_id).with_for_update())
    child=await create_child(event,config,body,actor,db)
    await db.commit()
    return output_child(child,role)


class ImportIn(BaseModel):
    children: list[ChildIn] = Field(min_length=1,max_length=200)


@router.post('/import',status_code=201)
async def roster_import(event_id: str, body: ImportIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,config,role,_=await access(event_id,actor,db,roles=['intake','supervisor'])
    await db.scalar(select(Event).where(Event.id==event_id).with_for_update())
    result=[]
    for row in body.children:
        result.append(output_child(await create_child(event,config,row,actor,db),role))
    await db.commit()
    return result


@router.get('/children')
async def children(event_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    _,_,role,_=await access(event_id,actor,db)
    if role=='inventory':raise HTTPException(403,'Inventory role has no child roster access')
    rows=(await db.scalars(select(JuniorChild).where(JuniorChild.event_id==event_id).order_by(JuniorChild.name))).all()
    return [output_child(c,role) for c in rows]


@router.get('/children/{child_id}')
async def child_detail(event_id: str, child_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    _,_,role,_=await access(event_id,actor,db)
    if role=='inventory':raise HTTPException(403,'Inventory role has no child roster access')
    child=await child_for(event_id,child_id,db)
    result=output_child(child,role)
    contacts=(await db.scalars(select(JuniorContact).where(JuniorContact.child_id==child_id))).all()
    result['contacts']=[{k:getattr(c,k) for k in
        (('id','name','relationship','adult_verified','pickup_authorized','email','phone','sms_consent','notify')
         if role in ('intake','supervisor') else ('id','name','relationship','adult_verified','pickup_authorized'))} for c in contacts]
    history=(await db.scalars(select(JuniorMovement).where(JuniorMovement.child_id==child_id).order_by(JuniorMovement.occurred_at.desc()).limit(100))).all()
    result['history']=[{k:getattr(m,k) for k in ('id','action','from_location','to_location','adult_name','relationship','actor_id','occurred_at')} for m in history]
    return result


class CorrectionIn(BaseModel):
    version: int
    name: str = Field(min_length=1,max_length=255)
    classroom: str = Field(min_length=1,max_length=100)
    reason: str = Field(min_length=3,max_length=1000)


@router.patch('/children/{child_id}')
async def child_correct(event_id: str, child_id: str, body: CorrectionIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,config,role,_=await access(event_id,actor,db,roles=['intake','supervisor'])
    child=await child_for(event_id,child_id,db,True)
    check_version(child,body.version)
    if not body.name.strip() or body.classroom not in config.classrooms:
        raise HTTPException(400,'Provide a name and configured classroom')
    old={'name':child.name,'classroom':child.classroom}
    child.name=body.name.strip()
    child.classroom=body.classroom
    tick(child)
    import json
    await audit(db,event,child,actor,'correction',request_id='correction:'+child.id+':'+str(child.version),
        notes=json.dumps({'before':old,'reason':body.reason}))
    await db.commit()
    return output_child(child,role)


@router.post('/children/{child_id}/contacts',status_code=201)
async def contact_add(event_id: str, child_id: str, body: ContactIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,_,_,_=await access(event_id,actor,db,roles=['intake','supervisor'])
    child=await child_for(event_id,child_id,db,True)
    contact=add_contact(child,body,actor,db)
    await db.flush()
    tick(child)
    await audit(db,event,child,actor,'contact',request_id='contact:'+contact.id)
    await db.commit()
    return {'id':contact.id}


@router.delete('/children/{child_id}/contacts/{contact_id}',status_code=204)
async def contact_remove(event_id: str, child_id: str, contact_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    event,_,_,_=await access(event_id,actor,db,roles=['intake','supervisor'])
    child=await child_for(event_id,child_id,db,True)
    contact=await db.scalar(select(JuniorContact).where(JuniorContact.id==contact_id,JuniorContact.child_id==child.id))
    if not contact:raise HTTPException(404,'Contact not found')
    await db.delete(contact)
    tick(child)
    await audit(db,event,child,actor,'contact',request_id='remove-contact:'+contact.id)
    await db.commit()


class ActionIn(BaseModel):
    request_id: str = Field(min_length=8,max_length=80)
    version: int
    action: Literal['dropoff','screening','clear_allergy','clear_accommodation','classroom','clinic','other','return','outing_depart','outing_return','release']
    adult_name: str | None = Field(default=None,max_length=255)
    relationship: Relationship | None = None
    phone: str | None = Field(default=None,pattern=r'^\+[1-9]\d{7,14}$')
    adult_verified: bool = False
    contact_id: str | None = None
    identity_checked: bool = False
    allergy: bool | None = None
    accommodation: bool | None = None
    notes: str | None = Field(default=None,max_length=2000)
    wristband_assigned: bool = False
    outing_id: str | None = None


@router.post('/children/{child_id}/actions')
async def action(event_id: str, child_id: str, body: ActionIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,_,role,_=await access(event_id,actor,db,roles=['scanner','intake','support','supervisor'])
    child=await child_for(event_id,child_id,db,True)
    prior=await db.scalar(select(JuniorMovement).where(JuniorMovement.event_id==event_id,JuniorMovement.request_id==body.request_id))
    if prior:
        if prior.child_id!=child_id or prior.action!=body.action:
            raise HTTPException(409,'Request ID was already used for another operation')
        return output_child(child,role)
    check_version(child,body.version)
    before=child.location
    a=body.action
    details={}
    if a=='dropoff':
        if before not in ('not_arrived','released'):raise HTTPException(409,'Child is already in JP custody')
        if not body.adult_name or not body.adult_name.strip() or not body.relationship or not body.identity_checked:
            raise HTTPException(400,'Record the dropping-off adult, relationship and staff verification')
        if body.relationship=='adult_sibling' and not body.adult_verified:
            raise HTTPException(400,'Verify sibling is 18 or older')
        child.allergy=body.allergy
        child.accommodation=body.accommodation
        child.allergy_cleared=False
        child.accommodation_cleared=False
        child.location='support_desk' if body.allergy or body.accommodation else 'reception'
        details={'adult_name':body.adult_name.strip(),'relationship':body.relationship,'phone':body.phone}
    elif a=='screening':
        if before not in ('reception','support_desk'):raise HTTPException(409,'Screening requires a child at reception or support desk')
        if body.allergy is None or body.accommodation is None:raise HTTPException(400,'Answer both screening questions')
        child.allergy=body.allergy
        child.accommodation=body.accommodation
        child.allergy_cleared=False
        child.accommodation_cleared=False
        child.location='support_desk' if body.allergy or body.accommodation else 'reception'
    elif a in ('clear_allergy','clear_accommodation'):
        if role not in ('support','supervisor'):raise HTTPException(403,'Support desk permission required')
        field='allergy' if a=='clear_allergy' else 'accommodation'
        if before!='support_desk' or not getattr(child,field):raise HTTPException(409,'No matching desk referral pending')
        if getattr(child,field+'_cleared'):raise HTTPException(409,'This referral is already cleared')
        if not body.notes or not body.notes.strip() or not body.wristband_assigned:
            raise HTTPException(400,'Record restricted desk details and confirm wristband assignment')
        setattr(child,field+'_notes',body.notes.strip())
        setattr(child,field+'_cleared',True)
    elif a=='classroom':
        if before not in ('reception','support_desk'):raise HTTPException(409,'Record return to JP before classroom arrival')
        if child.allergy is None or child.accommodation is None:raise HTTPException(409,'Complete both screening questions first')
        if (child.allergy and not child.allergy_cleared) or (child.accommodation and not child.accommodation_cleared):
            raise HTTPException(409,'Complete all support-desk referrals and wristbands first')
        child.location='classroom'
    elif a in ('clinic','other'):
        if before not in ('classroom','reception','support_desk'):raise HTTPException(409,'Child must be present in JP')
        if not body.adult_name or not body.adult_name.strip():raise HTTPException(400,'Record the accompanying adult')
        if a=='other' and (not body.notes or not body.notes.strip()):raise HTTPException(400,'Specify the temporary departure reason')
        child.location=a
        details={'adult_name':body.adult_name.strip(),'notes':body.notes}
    elif a=='return':
        if before not in ('clinic','other'):raise HTTPException(409,'Use outing return for children on an outing')
        child.location='reception'
    elif a in ('outing_depart','outing_return'):
        if not body.outing_id:raise HTTPException(400,'Select the outing')
        outing=await db.scalar(select(JuniorOuting).where(JuniorOuting.id==body.outing_id,JuniorOuting.event_id==event_id).with_for_update())
        member=await db.get(JuniorOutingMember,(body.outing_id,child_id))
        if not outing or outing.closed or not member:raise HTTPException(409,'Child must be on an open, permission-verified outing roster')
        if a=='outing_depart':
            today=datetime.now(ZoneInfo(event.timezone or 'UTC')).date().isoformat()
            if outing.outing_date!=today:raise HTTPException(409,'Outing departure is only available on its scheduled date')
            if before!='classroom' or member.departed_at:raise HTTPException(409,'Child must be in class and not already departed')
            member.departed_at=datetime.utcnow()
            child.location='outing'
        else:
            if before!='outing' or not member.departed_at or member.returned_at:raise HTTPException(409,'No outstanding outing departure')
            member.returned_at=datetime.utcnow()
            child.location='reception'
        details={'notes':'Outing '+outing.id}
    elif a=='release':
        if before not in ('classroom','reception','support_desk'):raise HTTPException(409,'Reconcile temporary departures or outings before final release')
        contact=await db.scalar(select(JuniorContact).where(JuniorContact.child_id==child_id,JuniorContact.id==body.contact_id))
        if not contact or not contact.pickup_authorized or not contact.adult_verified:
            raise HTTPException(409,'An authorized adult collector is required. Ask the help desk to resolve missing authorization.')
        if not body.identity_checked:raise HTTPException(400,'Staff must verify the collecting adult in person')
        child.location='released'
        details={'adult_name':contact.name,'relationship':contact.relationship,'contact_id':contact.id}
    tick(child)
    await audit(db,event,child,actor,a,request_id=body.request_id,before=before,**details)
    await db.commit()
    return output_child(child,role)


class OutingIn(BaseModel):
    name: str = Field(min_length=1,max_length=255)
    outing_date: date
    child_ids: list[str] = Field(min_length=1,max_length=1000)
    permission_verified: bool


@router.post('/outings',status_code=201)
async def outing_add(event_id: str, body: OutingIn, db=Depends(get_db), actor=Depends(require_event_member)):
    await access(event_id,actor,db,roles=['supervisor'])
    if not body.permission_verified:raise HTTPException(400,'Verify outing permission for every selected child')
    ids=set(body.child_ids)
    rows=(await db.scalars(select(JuniorChild.id).where(JuniorChild.event_id==event_id,JuniorChild.id.in_(ids)))).all()
    if set(rows)!=ids:raise HTTPException(400,'All children must belong to this event')
    outing=JuniorOuting(event_id=event_id,name=body.name.strip(),outing_date=body.outing_date.isoformat())
    db.add(outing)
    await db.flush()
    for child_id in ids:db.add(JuniorOutingMember(outing_id=outing.id,child_id=child_id,permission_verified_by=actor.id))
    await db.commit()
    return {'id':outing.id}


@router.get('/outings')
async def outings(event_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    _,_,role,_=await access(event_id,actor,db)
    if role=='inventory':raise HTTPException(403,'Inventory role has no child roster access')
    result=[]
    for outing in (await db.scalars(select(JuniorOuting).where(JuniorOuting.event_id==event_id))).all():
        members=(await db.execute(select(JuniorOutingMember,JuniorChild.name).join(JuniorChild,JuniorChild.id==JuniorOutingMember.child_id).where(JuniorOutingMember.outing_id==outing.id))).all()
        result.append({'id':outing.id,'name':outing.name,'date':outing.outing_date,'closed':outing.closed,'expected':len(members),
            'departed':sum(bool(m.departed_at) for m,_ in members),'returned':sum(bool(m.returned_at) for m,_ in members),
            'outstanding':[{'id':m.child_id,'name':name} for m,name in members if m.departed_at and not m.returned_at],
            'members':[{'id':m.child_id,'name':name,'departed_at':m.departed_at,'returned_at':m.returned_at} for m,name in members]})
    return result


@router.post('/outings/{outing_id}/close')
async def outing_close(event_id: str, outing_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    await access(event_id,actor,db,roles=['supervisor'])
    outing=await db.scalar(select(JuniorOuting).where(JuniorOuting.id==outing_id,JuniorOuting.event_id==event_id).with_for_update())
    if not outing:raise HTTPException(404,'Outing not found')
    pending=await db.scalar(select(JuniorOutingMember.child_id).where(JuniorOutingMember.outing_id==outing_id,JuniorOutingMember.departed_at.is_not(None),JuniorOutingMember.returned_at.is_(None)).limit(1))
    if pending:raise HTTPException(409,'Reconcile all outstanding children before closing the outing')
    outing.closed=True
    await db.commit()
    return {'closed':True}


@router.get('/notifications')
async def notifications(event_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    await access(event_id,actor,db,roles=['intake','supervisor'])
    rows=(await db.scalars(select(JuniorNotification).where(JuniorNotification.event_id==event_id).order_by(JuniorNotification.created_at.desc()).limit(300))).all()
    return [{k:getattr(row,k) for k in ('id','movement_id','channel','recipient','body','status','error','provider_id','created_at')} for row in rows]


@router.post('/notifications/{notification_id}/retry')
async def retry_notice(event_id: str, notification_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    _,config,_,_=await access(event_id,actor,db,roles=['intake','supervisor'])
    row=await db.scalar(select(JuniorNotification).where(JuniorNotification.id==notification_id,JuniorNotification.event_id==event_id).with_for_update())
    if not row:raise HTTPException(404,'Notification not found')
    if row.status not in ('setup_required','paused') or row.attempted_at:
        raise HTTPException(409,'Only unattempted notices may be queued. Reconcile attempted provider outcomes first.')
    if (datetime.utcnow()-row.created_at).total_seconds()>86400:raise HTTPException(409,'This historical notice has expired')
    if not config.notifications_enabled:raise HTTPException(409,'Guardian sending is paused')
    contact=await db.get(JuniorContact,row.contact_id) if row.contact_id else None
    if not contact or not contact.notify:raise HTTPException(409,'Resolve guardian notification contact first')
    recipient=getattr(contact,'email' if row.channel=='email' else 'phone')
    if not recipient or (row.channel=='sms' and not contact.sms_consent):raise HTTPException(409,'Contact details and SMS permission must be complete')
    row.recipient=recipient;row.status='queued';row.error=None
    await db.commit()
    return {'status':'queued'}


class ItemIn(BaseModel):
    name: str = Field(min_length=1,max_length=255)
    total: int = Field(ge=1,le=1000000)


@router.get('/inventory')
async def inventory(event_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    await access(event_id,actor,db,roles=['inventory','supervisor'])
    rows=(await db.scalars(select(JuniorInventory).where(JuniorInventory.event_id==event_id).order_by(JuniorInventory.name))).all()
    return [{k:getattr(r,k) for k in ('id','name','total','issued','damaged','lost','version')} for r in rows]


@router.post('/inventory',status_code=201)
async def inventory_add(event_id: str, body: ItemIn, db=Depends(get_db), actor=Depends(require_event_member)):
    await access(event_id,actor,db,roles=['inventory','supervisor'])
    if not body.name.strip():raise HTTPException(400,'Item name required')
    item=JuniorInventory(event_id=event_id,name=body.name.strip(),total=body.total)
    db.add(item)
    await db.commit()
    return {'id':item.id}


class ItemActionIn(BaseModel):
    request_id: str = Field(min_length=8,max_length=80)
    version: int
    action: Literal['issue','return','damaged','lost']
    quantity: int = Field(ge=1,le=1000000)
    responsible: str = Field(min_length=1,max_length=255)
    notes: str | None = Field(default=None,max_length=1000)


@router.post('/inventory/{item_id}/actions')
async def inventory_action(event_id: str, item_id: str, body: ItemActionIn, db=Depends(get_db), actor=Depends(require_event_member)):
    await access(event_id,actor,db,roles=['inventory','supervisor'])
    item=await db.scalar(select(JuniorInventory).where(JuniorInventory.id==item_id,JuniorInventory.event_id==event_id).with_for_update())
    if not item:raise HTTPException(404,'Item not found')
    if await db.scalar(select(JuniorInventoryEntry.id).where(JuniorInventoryEntry.item_id==item_id,JuniorInventoryEntry.request_id==body.request_id)):
        return {'ok':True}
    check_version(item,body.version)
    if not body.responsible.strip():raise HTTPException(400,'Responsible person required')
    available=item.total-item.issued-item.damaged-item.lost
    if body.action=='issue':
        if body.quantity>available:raise HTTPException(409,'Not enough available items')
        item.issued+=body.quantity
    else:
        if body.quantity>item.issued:raise HTTPException(409,'Quantity exceeds issued stock')
        item.issued-=body.quantity
        if body.action!='return':setattr(item,body.action,getattr(item,body.action)+body.quantity)
    item.version+=1
    db.add(JuniorInventoryEntry(item_id=item.id,actor_id=actor.id,**body.model_dump(exclude={'version'})))
    await db.commit()
    return {'ok':True}


@router.get('/inventory/{item_id}/history')
async def inventory_history(event_id: str, item_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    await access(event_id,actor,db,roles=['inventory','supervisor'])
    item=await db.scalar(select(JuniorInventory).where(JuniorInventory.id==item_id,JuniorInventory.event_id==event_id))
    if not item:raise HTTPException(404,'Item not found')
    rows=(await db.scalars(select(JuniorInventoryEntry).where(JuniorInventoryEntry.item_id==item_id).order_by(JuniorInventoryEntry.created_at.desc()).limit(200))).all()
    return [{k:getattr(r,k) for k in ('action','quantity','responsible','notes','actor_id','created_at')} for r in rows]
