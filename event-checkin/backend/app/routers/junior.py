"""Staff-only Junior Programme. Convention admission and dated JP drop-off follow the event schedule."""
from datetime import datetime, date, timezone
from typing import Literal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field, EmailStr, field_validator
from sqlalchemy import select
from ..database import get_db
from ..auth import require_event_member, _org_role
from ..models import Event, EventUser, User, Guest
from ..services import junior_guests as shared
from ..services import junior_days as days
from ..services import junior_permissions as permissions
from ..services.junior_permissions import can, Role, Grant
from ..services.junior_practice import is_practice
from ..junior_models import (JuniorAudit, JuniorConfig, JuniorChild, JuniorContact, JuniorMovement,
    JuniorOuting, JuniorOutingMember, JuniorNotification, JuniorInventory, JuniorInventoryEntry)

router = APIRouter(prefix='/{event_id}/junior')
Relationship = Literal['parent', 'chaperone', 'adult_sibling']


async def access(event_id, actor, db, *, roles=None, enabled=True, write=True, permission=None):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, 'Event not found')
    org_role = await _org_role(actor, event.org_id, db) if not actor.is_platform_superadmin else 'owner'
    eu = await db.scalar(select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == actor.id))
    config = await db.get(JuniorConfig, event_id)
    admin = org_role in ('owner', 'admin') or bool(eu and eu.event_role == 'manager' and not eu.guest_service_scoped)
    role = permissions.principal((config.staff or {}).get(actor.id) if config and eu else None,admin)
    admin = bool(role and role.admin)
    if permission is None and roles:
        permission = 'children' if roles==['intake','supervisor'] else 'inventory' if roles==['inventory','supervisor'] else 'volunteers' if roles==['supervisor'] else 'view_children' if 'inventory' not in roles else None
    if not role or (permission and not can(role,permission)):
        raise HTTPException(403, 'Junior Programme permission required')
    if eu and org_role not in ('owner','admin') and eu.access_level == 'view' and write:
        raise HTTPException(403, 'This event access is view-only')
    if enabled and not event.junior_program_enabled:
        raise HTTPException(409, 'Junior Programme is not enabled for this event')
    return event, config, role, admin


def output_child(child, role):
    keys = ('id','guest_id','name','reference','age_group','classroom','location','allergy','accommodation',
            'allergy_cleared','accommodation_cleared','screening_wristband_assigned','version','updated_at')
    result = {k: getattr(child,k) for k in keys}
    result.update(days.view(child))
    result['convention_admitted']=bool(getattr(child,'_convention_admitted',False))
    if can(role,'support'):
        result.update(allergy_notes=child.allergy_notes, accommodation_notes=child.accommodation_notes)
    return result


async def child_for(event_id, child_id, db, lock=False):
    if lock:await db.scalar(select(Event).where(Event.id==event_id).with_for_update().execution_options(populate_existing=True))
    row = select(JuniorChild).where(JuniorChild.id == child_id, JuniorChild.event_id == event_id)
    if lock:
        row = row.with_for_update()
    child = await db.scalar(row)
    event=await db.get(Event,event_id)
    if not child:
        await shared.roster(event,db)
        child=await db.scalar(row)
    if not child:
        raise HTTPException(404, 'Child not found')
    if not await shared.refresh_child(event,child,db):raise HTTPException(409,'This child is no longer linked to an active junior in Guest List')
    await shared.refresh_contacts(event,child,db)
    return child


def check_version(row, version):
    if row.version != version:
        raise HTTPException(409, 'This record changed. Refresh before continuing.')


def tick(child):
    child.version += 1
    child.updated_at = datetime.utcnow()


async def audit(db, event, child, actor, action, *, request_id, before=None, **details):
    await shared.refresh_contacts(event,child,db)
    movement = JuniorMovement(event_id=event.id, child_id=child.id, request_id=request_id,
        action=action, from_location=before or child.location, to_location=child.location,
        actor_id=actor.id, occurred_at=days.utcnow(),programme_date=(child.programme_date if action not in ('intake','correction','contact','convention_checkin') else None) or days.day(event),wristbands={'screening':bool(child.screening_wristband_assigned),'allergy':bool(child.allergy and child.allergy_cleared),'accommodation':bool(child.accommodation and child.accommodation_cleared)}, **details)
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
        'assign_wristband':'Screening wristband recorded', 'return':'Returned from '+('clinic' if movement.from_location=='clinic' else 'temporary departure')+' to Junior Platform', 'outing_depart':'Departed for outing',
        'outing_return':'Returned from outing', 'release':'Released to authorized adult',
        'intake':'Child record created', 'correction':'Child record updated', 'screening':'Screening recorded',
        'convention_checkin':'Checked into the convention (JP drop-off is separate)', 'contact':'Guardian details updated'}
    # Never copy medical notes, free-text movement reasons or phone numbers into messages.
    body = f'{event.name} / Festio Juniors: {child.name}. {labels.get(action, action)}. {local:%b %d, %I:%M %p %Z}.'
    if movement.programme_date!=local.date().isoformat():
        body=f'{event.name} / Festio Juniors: {child.name}. Prior programme day {movement.programme_date} reconciled: {labels.get(action, action)}. Recorded {local:%b %d, %I:%M %p %Z}.'
    if action == 'classroom':
        body += f' Classroom: {child.classroom}.'
    if action == 'release':
        body += f' Collected by {movement.adult_name} ({movement.relationship.replace("_", " ")}).'
    seen_recipients=set()
    for contact in contacts or [None]:
        for channel in ('email','sms'):
            recipient = getattr(contact, 'email' if channel == 'email' else 'phone', None)
            if recipient and (channel,recipient.lower()) in seen_recipients:continue
            if recipient:seen_recipients.add((channel,recipient.lower()))
            error = None
            if not recipient:
                error = 'Guardian contact details missing'
            elif channel == 'sms' and not contact.sms_consent:
                error = 'Guardian SMS permission not recorded'
            db.add(JuniorNotification(event_id=event.id,movement_id=movement.id,
                contact_id=contact.id if contact else None,channel=channel,recipient=recipient,
                body=body,status='setup_required' if error else ('queued' if config and config.notifications_enabled and not is_practice(event) else 'paused'),error=error))
    return movement


class ConfigIn(BaseModel):
    enabled: bool
    classrooms: list[str] = Field(default_factory=list, max_length=100)
    staff: dict[str, Role | Grant] = Field(default_factory=dict)
    notifications_enabled: bool = False
    dropoff_start_date: date | None = None


@router.get('/config')
async def config_get(event_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    event = await db.get(Event,event_id)
    config = await db.get(JuniorConfig,event_id)
    try:
        _, _, role, admin = await access(event_id,actor,db,enabled=False,write=False)
    except HTTPException as exc:
        if exc.status_code != 403:
            raise
        role, admin = None, False
    membership=await db.scalar(select(EventUser).where(EventUser.event_id==event_id,EventUser.user_id==actor.id))
    readonly=bool(membership and membership.access_level=='view' and not actor.is_platform_superadmin and await _org_role(actor,event.org_id,db) not in ('owner','admin'))
    event_admin=actor.is_platform_superadmin or await _org_role(actor,event.org_id,db) in ('owner','admin') or bool(membership and membership.event_role=='manager' and not membership.guest_service_scoped)
    guest_access=event_admin or bool(membership and not membership.guest_service_scoped and (membership.can_view_guests or membership.can_manage_guests) and (membership.feature_permissions is None or membership.feature_permissions.get('guests') in ('view','manage')))
    practice=None
    if admin and not is_practice(event):
        candidates=(await db.scalars(select(Event).where(Event.org_id==event.org_id,Event.is_test.is_(True),Event.junior_program_enabled.is_(True),Event.cancelled.is_(False)))).all()
        practice=next((e.id for e in candidates if is_practice(e) and e.setup_preferences.get('junior_practice_source')==event_id),None)
    return {'practice_mode':is_practice(event),'practice_event_id':practice,'practice_source_event_id':event.setup_preferences.get('junior_practice_source') if is_practice(event) else None,'enabled':bool(event.junior_program_enabled),'role':role,'simple_role':'admin' if admin else 'volunteer','permissions':sorted(role.permissions) if role else [],'can_reconcile':can(role,'reconcile'),'permission_catalog':permissions.CATALOG,'can_configure':admin and not readonly,'read_only':readonly,'can_open_guest_list':guest_access,
        'classrooms':config.classrooms if config else [],
        'staff':config.staff if config and admin else {},
        'notifications_enabled':bool(config and config.notifications_enabled),'today':days.day(event),
        'dropoff_start_date':config.dropoff_start_date if config else None,
        'available_staff':[{'id':u.id,'name':u.name,'view_only':eu.access_level=='view'} for eu,u in
            (await db.execute(select(EventUser,User).join(User,User.id==EventUser.user_id).where(EventUser.event_id==event_id))).all()] if admin else []}


class ClassroomIn(BaseModel):
    classrooms: list[str] = Field(max_length=100)
    expected_classrooms: list[str] = Field(max_length=100)


@router.put('/classrooms')
async def classrooms_put(event_id: str, body: ClassroomIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,config,_,admin = await access(event_id,actor,db,enabled=False)
    if not admin:
        raise HTTPException(403,'Only the event administrator can configure classrooms')
    await db.scalar(select(Event).where(Event.id==event_id).with_for_update())
    config=await db.scalar(select(JuniorConfig).where(JuniorConfig.event_id==event_id).execution_options(populate_existing=True))
    before=list(config.classrooms or []) if config else []
    if body.expected_classrooms!=before:
        raise HTTPException(409,'Classrooms changed elsewhere. Reload saved classrooms, review your changes and save again.')
    classrooms=list(dict.fromkeys(x.strip() for x in body.classrooms if x.strip()))
    if any(len(x)>100 for x in classrooms):
        raise HTTPException(400,'Classroom names must be at most 100 characters')
    existing=set((await db.scalars(select(JuniorChild.classroom).where(JuniorChild.event_id==event_id,JuniorChild.classroom!=''))).all())
    from ..junior_models import JuniorVolunteerProfile,JuniorVolunteerShift
    profiles=(await db.scalars(select(JuniorVolunteerProfile).where(JuniorVolunteerProfile.event_id==event_id))).all()
    shifts=(await db.scalars(select(JuniorVolunteerShift).where(JuniorVolunteerShift.event_id==event_id,JuniorVolunteerShift.enabled.is_(True),JuniorVolunteerShift.checked_out_at.is_(None)))).all()
    existing.update(c for profile in profiles for c in (profile.classrooms or []))
    existing.update(shift.plan['classroom'] for shift in shifts if shift.plan.get('classroom'))
    if not existing.issubset(set(classrooms)):
        raise HTTPException(409,'Reassign children, volunteers and active shifts before removing their classroom')
    if not config:config=JuniorConfig(event_id=event_id);db.add(config)
    config.classrooms=classrooms
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='classrooms_updated',detail={'before':before,'classrooms':classrooms}))
    await db.commit()
    return {'classrooms':classrooms}


@router.put('/config')
async def config_put(event_id: str, body: ConfigIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,config,_,admin = await access(event_id,actor,db,enabled=False)
    if not admin:
        raise HTTPException(403,'Only the event administrator can configure this module')
    await db.scalar(select(Event).where(Event.id==event_id).with_for_update())
    config=await db.scalar(select(JuniorConfig).where(JuniorConfig.event_id==event_id).execution_options(populate_existing=True))
    if body.dropoff_start_date and not (days.day(event,event.event_date)<=body.dropoff_start_date.isoformat()<=days.day(event,event.event_end_date or event.event_date)):
        raise HTTPException(400,'Drop-off start date must be within the event dates')
    staff=body.model_dump(mode='json')['staff'] if 'staff' in body.model_fields_set else (config.staff or {}) if config else {}
    if config and 'staff' in body.model_fields_set and any(isinstance(v,dict) and not isinstance(staff.get(k),dict) for k,v in (config.staff or {}).items()):raise HTTPException(409,'Refresh the app and manage Admin/Volunteer permissions in Volunteers')
    assigned = set((await db.scalars(select(EventUser.user_id).where(EventUser.event_id == event_id))).all())
    if not set(body.staff).issubset(assigned):
        raise HTTPException(400,'Junior staff must already be assigned to this event')
    classrooms = list(dict.fromkeys(x.strip() for x in (body.classrooms if 'classrooms' in body.model_fields_set else (config.classrooms if config else [])) if x.strip()))
    if any(len(x)>100 for x in classrooms):
        raise HTTPException(400,'Classroom names must be at most 100 characters')
    existing = set((await db.scalars(select(JuniorChild.classroom).where(JuniorChild.event_id==event_id,JuniorChild.classroom!=''))).all())
    if not existing.issubset(set(classrooms)):
        raise HTTPException(409,'Reassign children before removing their classroom')
    if body.notifications_enabled and is_practice(event):raise HTTPException(409,'Guardian sending is disabled in practice events')
    if body.notifications_enabled:
        await shared.roster(event,db)
        from ..config import settings
        from services import messaging
        if {'email','sms'} & set(event.blocked_messaging_channels or []):
            raise HTTPException(409,'A required guardian channel is blocked by the platform')
        if not (settings.resend_api_key or settings.smtp_host or (settings.bird_email_api_base and settings.bird_access_key and settings.bird_workspace_id)):
            raise HTTPException(409,'Verify the email provider before enabling guardian sending')
        contacts=(await db.scalars(select(JuniorContact).join(JuniorChild,JuniorChild.id==JuniorContact.child_id).where(
            JuniorChild.event_id==event_id,JuniorContact.notify.is_(True)))).all()
        if not contacts or any(not c.email or not c.phone or not c.sms_consent for c in contacts):
            raise HTTPException(409,'Complete email, mobile and SMS permission for every designated guardian first')
        if not all(messaging._channel_ready('sms',c.phone) for c in contacts):
            raise HTTPException(409,'Verify SMS provider readiness before enabling guardian sending')
    if not config:
        config=JuniorConfig(event_id=event_id)
        db.add(config)
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='settings_updated',detail={
        'enabled':body.enabled,'classrooms':classrooms,'staff':staff,'notifications_enabled':body.notifications_enabled}))
    event.junior_program_enabled=body.enabled
    config.classrooms=classrooms
    config.staff=staff
    config.notifications_enabled=body.notifications_enabled
    if 'dropoff_start_date' in body.model_fields_set:
        config.dropoff_start_date=body.dropoff_start_date.isoformat() if body.dropoff_start_date else None
        db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='dropoff_schedule_updated',detail={'dropoff_start_date':config.dropoff_start_date}))
    await db.commit()
    return await config_get(event_id,db,actor)


class ContactIn(BaseModel):
    guardian_guest_id: str | None = None
    guardian_updated_at: datetime | None = None
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
    guest_id: str | None = None
    confirm_junior: bool = False
    name: str = Field(min_length=1,max_length=255)
    reference: str | None = Field(default=None,max_length=100)
    age_group: str = Field(default='Pending confirmation',max_length=80)
    classroom: str = Field(default='',max_length=100)
    guardian: ContactIn | None = None
    confirm_same_name: bool = False

    @field_validator('name')
    @classmethod
    def not_blank(cls,value):
        if not value.strip(): raise ValueError('This field is required')
        return value.strip()

    @field_validator('age_group','classroom')
    @classmethod
    def optional_text(cls,value):
        return value.strip()


async def create_child(event,config,body,actor,db,*,rows=None):
    if body.classroom and body.classroom not in (config.classrooms or []):
        raise HTTPException(400,'Choose a configured classroom')
    if rows is None:rows=await shared.roster(event,db)
    ref=(body.reference or '').strip() or None
    if ref and any(c.reference==ref for c in rows):
        raise HTTPException(409,'This roster reference already exists')
    if not body.confirm_same_name and any(c.name.casefold()==body.name.casefold() for c in rows):
        raise HTTPException(409,'A child with this name exists. Review the roster before confirming a different child.')
    if body.guest_id and any(c.guest_id==body.guest_id for c in rows):
        raise HTTPException(409,'This junior is already in Junior Platform. Open their existing record.')
    guest=await shared.resolve_person(event,db,guest_id=body.guest_id,name=body.name,junior=True,
        confirm_same_name=body.confirm_same_name,confirm_junior=body.confirm_junior)
    child=JuniorChild(id=guest.id,guest_id=guest.id,event_id=event.id,name=shared.person_name(guest),reference=ref,age_group=body.age_group.strip() or 'Pending confirmation',classroom=body.classroom.strip())
    db.add(child)
    await db.flush()
    if body.guardian:
        await add_contact(event,child,body.guardian,actor,db)
        await db.flush()
    await audit(db,event,child,actor,'intake',request_id='intake:'+child.id)
    await shared.refresh_child(event,child,db)
    return child


async def add_contact(event,child,body,actor,db):
    if body.pickup_authorized and not body.adult_verified:
        raise HTTPException(400,'Verify adulthood before authorizing pickup')
    guardian=None
    if not body.guardian_guest_id:
        matches=[g for g in (await db.scalars(select(Guest).where(Guest.event_id==event.id))).all() if shared.person_name(g).casefold()==body.name.casefold()]
        if len(matches)>1:raise HTTPException(409,'Multiple guests share this name. Select the correct guardian from Guest List.')
        if matches:
            guardian=matches[0]
            if (body.email and str(body.email)!=guardian.email) or (body.phone and body.phone!=guardian.phone):
                raise HTTPException(409,'Guardian exists in Guest List with different contact details. Select and review that record first.')
    guardian=guardian or await shared.resolve_person(event,db,guest_id=body.guardian_guest_id,name=body.name,
        email=str(body.email) if body.email else None,phone=body.phone,sms_consent=body.sms_consent)
    if guardian.id==child.guest_id or shared.is_junior(event,guardian):raise HTTPException(400,'Choose an adult guardian, not a junior')
    if await db.scalar(select(JuniorContact.id).where(JuniorContact.child_id==child.id,JuniorContact.guardian_guest_id==guardian.id)):
        raise HTTPException(409,'This guardian is already linked. Edit the existing contact.')
    shared.set_authorization(event,child,guardian.id,body.relationship,body.pickup_authorized)
    row=JuniorContact(child_id=child.id,guardian_guest_id=guardian.id,verified_by=actor.id,
        name=shared.person_name(guardian),email=guardian.email,phone=guardian.phone,sms_consent=bool(guardian.sms_consent),
        relationship=body.relationship,adult_verified=body.adult_verified,pickup_authorized=body.pickup_authorized,notify=body.notify)
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


@router.get('/guests')
async def guest_candidates(event_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    event,_,_,_=await access(event_id,actor,db,roles=['intake','supervisor'],write=False)
    rows=(await db.scalars(select(Guest).where(Guest.event_id==event_id).order_by(Guest.first_name,Guest.last_name))).all()
    enrolled=set((await db.scalars(select(JuniorChild.guest_id).where(JuniorChild.event_id==event_id))).all())
    return [{'id':g.id,'name':shared.person_name(g),'email':g.email,'phone':g.phone,'sms_consent':bool(g.sms_consent),
        'is_junior':shared.is_junior(event,g),'enrolled':g.id in enrolled or shared.is_junior(event,g)} for g in rows]


class ResolveIn(BaseModel):
    token: str = Field(min_length=1,max_length=1000)


@router.post('/resolve')
async def resolve_badge(event_id: str, body: ResolveIn, db=Depends(get_db), actor=Depends(require_event_member)):
    from urllib.parse import urlsplit
    from sqlalchemy import or_
    event,_,_,_=await access(event_id,actor,db,roles=['scanner','intake','support','supervisor'],write=False)
    token=body.token.strip()
    if token.startswith('festio-jp:'):
        child=await child_for(event_id,token[len('festio-jp:'):],db)
    else:
        if '://' in token:token=urlsplit(token).path.rstrip('/').split('/')[-1]
        guest=await db.scalar(select(Guest).where(Guest.event_id==event_id,or_(Guest.qr_token==token,Guest.invite_token==token)))
        if not guest:raise HTTPException(404,'Badge not found in this event’s Guest List')
        if not shared.is_junior(event,guest):raise HTTPException(409,'This guest is not marked as a junior. Ask intake to review their Guest List record.')
        await shared.roster(event,db)
        child=await db.scalar(select(JuniorChild).where(JuniorChild.event_id==event_id,JuniorChild.guest_id==guest.id))
    await db.commit()
    return {'child_id':child.id,'guest_id':child.guest_id}


@router.post('/import',status_code=201)
async def roster_import(event_id: str, body: ImportIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,config,role,_=await access(event_id,actor,db,roles=['intake','supervisor'])
    await db.scalar(select(Event).where(Event.id==event_id).with_for_update())
    result=[]
    existing=await shared.roster(event,db)
    for row in body.children:
        created=await create_child(event,config,row,actor,db,rows=existing)
        existing.append(created)
        result.append(output_child(created,role))
    await db.commit()
    return result


@router.get('/children')
async def children(event_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    event,_,role,_=await access(event_id,actor,db,write=False)
    if not can(role,'view_children'):raise HTTPException(403,'Permission to view children is required')
    rows=await shared.roster(event,db)
    await db.commit()
    return [output_child(c,role) for c in rows]


@router.get('/children/{child_id}')
async def child_detail(event_id: str, child_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    _,_,role,_=await access(event_id,actor,db,write=False)
    if not can(role,'view_children'):raise HTTPException(403,'Permission to view children is required')
    child=await child_for(event_id,child_id,db)
    result=output_child(child,role)
    import base64, io, qrcode
    image=io.BytesIO()
    guest=await db.get(Guest,child.guest_id)
    qrcode.make(guest.qr_token).save(image,format='PNG')
    result['badge_data_url']='data:image/png;base64,'+base64.b64encode(image.getvalue()).decode()
    contacts=(await db.scalars(select(JuniorContact).where(JuniorContact.child_id==child_id))).all()
    result['contacts']=[{k:getattr(c,k) for k in
        (('id','guardian_guest_id','name','relationship','adult_verified','pickup_authorized','email','phone','sms_consent','notify')
         if can(role,'children') or can(role,'messages') else ('id','guardian_guest_id','name','relationship','adult_verified','pickup_authorized'))} for c in contacts]
    if can(role,'children'):
        for entry,contact in zip(result['contacts'],contacts):
            guardian=await db.get(Guest,contact.guardian_guest_id) if contact.guardian_guest_id else None
            entry['guardian_updated_at']=guardian.updated_at if guardian else None
    history=(await db.scalars(select(JuniorMovement).where(JuniorMovement.child_id==child_id).order_by(JuniorMovement.occurred_at.desc()).limit(100))).all()
    result['history']=[{k:getattr(m,k) for k in ('id','action','from_location','to_location','adult_name','relationship','actor_id','occurred_at','wristbands','programme_date')} for m in history]
    actor_ids={m.actor_id for m in history}
    names={u.id:u.name for u in (await db.scalars(select(User).where(User.id.in_(actor_ids)))).all()}
    for entry,m in zip(result['history'],history):
        entry['actor_name']=names.get(m.actor_id,'Former volunteer')
        if can(role,'children') and m.action=='correction':
            import json
            entry['correction']=json.loads(m.notes) if m.notes else None
    await db.commit()
    return result


class CorrectionIn(BaseModel):
    version: int
    name: str = Field(min_length=1,max_length=255)
    classroom: str = Field(default='',max_length=100)
    age_group: str | None = Field(default=None,min_length=1,max_length=80)
    reason: str = Field(min_length=3,max_length=1000)


@router.patch('/children/{child_id}')
async def child_correct(event_id: str, child_id: str, body: CorrectionIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,config,role,_=await access(event_id,actor,db,roles=['intake','supervisor'])
    child=await child_for(event_id,child_id,db,True)
    check_version(child,body.version)
    if not body.name.strip() or (body.classroom and body.classroom not in config.classrooms):
        raise HTTPException(400,'Provide a name and configured classroom')
    if child.location=='classroom' and not body.classroom:
        raise HTTPException(409,'Record departure before clearing an occupied classroom assignment')
    old={'name':child.name,'classroom':child.classroom,'age_group':child.age_group}
    child.name=body.name.strip()
    guest=await db.get(Guest,child.guest_id)
    guest.first_name,guest.last_name=shared.split_name(body.name)
    child.classroom=body.classroom
    if body.age_group is not None:child.age_group=body.age_group.strip() or child.age_group
    tick(child)
    import json
    await audit(db,event,child,actor,'correction',request_id='correction:'+child.id+':'+str(child.version),
        notes=json.dumps({'before':old,'after':{'name':child.name,'classroom':child.classroom,'age_group':child.age_group},'reason':body.reason}))
    await db.commit()
    return output_child(child,role)


@router.post('/children/{child_id}/contacts',status_code=201)
async def contact_add(event_id: str, child_id: str, body: ContactIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,_,_,_=await access(event_id,actor,db,roles=['intake','supervisor'])
    child=await child_for(event_id,child_id,db,True)
    existing=(await db.scalars(select(JuniorContact).where(JuniorContact.child_id==child.id))).all()
    if any(c.name.casefold()==body.name.casefold() and c.relationship==body.relationship for c in existing):
        raise HTTPException(409,'This contact exists. Edit their details or authorization instead.')
    contact=await add_contact(event,child,body,actor,db)
    await db.flush()
    tick(child)
    await audit(db,event,child,actor,'contact',request_id='contact:'+contact.id)
    await db.commit()
    return {'id':contact.id}


class ContactUpdateIn(ContactIn):
    version: int


@router.put('/children/{child_id}/contacts/{contact_id}')
async def contact_update(event_id: str, child_id: str, contact_id: str, body: ContactUpdateIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,_,_,_=await access(event_id,actor,db,roles=['intake','supervisor'])
    child=await child_for(event_id,child_id,db,True)
    check_version(child,body.version)
    contact=await db.scalar(select(JuniorContact).where(JuniorContact.id==contact_id,JuniorContact.child_id==child.id))
    if not contact:raise HTTPException(404,'Contact not found')
    if body.pickup_authorized and not body.adult_verified:raise HTTPException(400,'Verify adulthood before authorizing pickup')
    guardian=await db.get(Guest,contact.guardian_guest_id) if contact.guardian_guest_id else None
    if not guardian or guardian.event_id!=event_id:raise HTTPException(409,'Guardian is no longer in Guest List')
    if body.guardian_updated_at and guardian.updated_at.replace(tzinfo=None)!=body.guardian_updated_at.replace(tzinfo=None):
        raise HTTPException(409,'Guardian details changed in Guest List. Refresh before editing.')
    if shared.is_junior(event,guardian):raise HTTPException(400,'A junior cannot be an adult guardian')
    if body.guardian_guest_id and body.guardian_guest_id!=guardian.id:raise HTTPException(409,'Remove this link before choosing a different guardian')
    guardian.first_name,guardian.last_name=shared.split_name(body.name)
    guardian.email=str(body.email) if body.email else None;guardian.phone=body.phone;guardian.sms_consent=body.sms_consent
    for k,v in body.model_dump(mode='json',exclude={'version','guardian_guest_id','guardian_updated_at'}).items():setattr(contact,k,v)
    shared.set_authorization(event,child,guardian.id,body.relationship,body.pickup_authorized)
    contact.verified_by=actor.id
    tick(child)
    await audit(db,event,child,actor,'contact',request_id='contact-update:'+child.id+':'+str(child.version))
    await db.commit()
    return {'id':contact.id}


@router.delete('/children/{child_id}/contacts/{contact_id}',status_code=204)
async def contact_remove(event_id: str, child_id: str, contact_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    event,_,_,_=await access(event_id,actor,db,roles=['intake','supervisor'])
    child=await child_for(event_id,child_id,db,True)
    contact=await db.scalar(select(JuniorContact).where(JuniorContact.id==contact_id,JuniorContact.child_id==child.id))
    if not contact:raise HTTPException(404,'Contact not found')
    shared.set_authorization(event,child,contact.guardian_guest_id,contact.relationship,False)
    await db.delete(contact)
    tick(child)
    await audit(db,event,child,actor,'contact',request_id='remove-contact:'+contact.id)
    await db.commit()


class ActionIn(BaseModel):
    request_id: str = Field(min_length=8,max_length=80)
    version: int
    action: Literal['convention_checkin','dropoff','screening','assign_wristband','clear_allergy','clear_accommodation','classroom','clinic','other','return','outing_depart','outing_return','release']
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
    screening_wristband_assigned: bool = False
    outing_id: str | None = None
    programme_date: str | None = Field(default=None,pattern=r'^\d{4}-\d{2}-\d{2}$')


@router.post('/children/{child_id}/actions')
async def action(event_id: str, child_id: str, body: ActionIn, background_tasks: BackgroundTasks, db=Depends(get_db), actor=Depends(require_event_member)):
    event,config,role,_=await access(event_id,actor,db,roles=['scanner','intake','support','supervisor'])
    if not can(role,'support' if body.action in ('clear_allergy','clear_accommodation') else 'checkin'):raise HTTPException(403,'Permission for this child movement is required')
    child=await child_for(event_id,child_id,db,True)
    prior=await db.scalar(select(JuniorMovement).where(JuniorMovement.event_id==event_id,JuniorMovement.request_id==body.request_id))
    if prior:
        if prior.child_id!=child_id or prior.action!=body.action:
            raise HTTPException(409,'Request ID was already used for another operation')
        if body.action=='dropoff' and (prior.programme_date or days.day(event,prior.occurred_at))!=days.day(event):
            raise HTTPException(409,'That drop-off request belongs to a previous day. Refresh and record a new drop-off for today.')
        return output_child(child,role)
    check_version(child,body.version)
    before=child.location
    a=body.action
    details={}
    today=days.day(event)
    if days.view(child,event)['prior_day_unresolved'] and not can(role,'reconcile'):
        raise HTTPException(409,'Previous-day custody is still open. Ask a supervisor to reconcile it before today’s drop-off.')
    newly_admitted=False
    if a in ('dropoff','convention_checkin'):
        guest=await db.get(Guest,child.guest_id)
        if not shared.is_junior(event,guest):raise HTTPException(409,'Confirm junior status in Guest List before a new drop-off')
        if body.programme_date and body.programme_date!=today:raise HTTPException(409,'The event day changed. Refresh and record today’s drop-off.')
        if event.daily_checkin_enabled and not (days.day(event,event.event_date)<=today<=days.day(event,event.event_end_date or event.event_date)):
            raise HTTPException(409,'Attendance can only be recorded on an event date. Check the event schedule before proceeding.')
        if a=='convention_checkin':
            if before not in ('not_arrived','released'):raise HTTPException(409,'Child is already in JP custody')
            if not body.identity_checked:raise HTTPException(400,'Verify the child’s convention registration in person')
        else:
            if config and config.dropoff_start_date:
                if today<config.dropoff_start_date:raise HTTPException(409,'Convention check-in only today. JP drop-off starts on '+config.dropoff_start_date+'.')
                if not guest.admitted:raise HTTPException(409,'Check this child into the convention before recording JP drop-off.')
            if before not in ('not_arrived','released'):raise HTTPException(409,'Child is already in JP custody; reconcile the previous handoff before a new drop-off')
            adult_name,relationship,phone=body.adult_name,body.relationship,body.phone
            dropoff_contact=None
            if body.contact_id:
                dropoff_contact=await db.scalar(select(JuniorContact).where(JuniorContact.id==body.contact_id,JuniorContact.child_id==child.id))
                if not dropoff_contact or not await shared.refresh_contact(event,child,dropoff_contact,db):
                    raise HTTPException(409,'This guardian is no longer linked to this child. Refresh and choose the person present.')
                adult_name=dropoff_contact.name
                relationship=dropoff_contact.relationship if dropoff_contact.relationship in ('parent','chaperone','adult_sibling') else body.relationship
                phone=dropoff_contact.phone
            if not adult_name or not adult_name.strip() or not relationship or not body.identity_checked:
                raise HTTPException(400,'Record the dropping-off adult, relationship and staff verification')
            if relationship=='adult_sibling' and not body.adult_verified:
                raise HTTPException(400,'Verify sibling is 18 or older')
        from .scanner import checkin_guard,perform_admission
        blocked=await checkin_guard(event,actor,db,guest=guest,operation='checkin')
        if blocked:raise HTTPException(409,'Convention check-in: '+blocked.message)
        if guest.rsvp_status=='declined':raise HTTPException(409,'Convention check-in: This ticket has been cancelled and cannot be admitted.')
        if not guest.admitted:
            admission=await perform_admission(guest,event,background_tasks,db,commit=False,notifications=False,broadcast_event=False)
            if admission.status not in ('admitted','already_admitted'):
                raise HTTPException(409,'Convention check-in: '+admission.message)
            newly_admitted=admission.status=='admitted'
        from ..models import AttendanceRecord
        from sqlalchemy.exc import IntegrityError
        existing=await db.scalar(select(AttendanceRecord).where(AttendanceRecord.event_id==event_id,AttendanceRecord.guest_id==guest.id,AttendanceRecord.scope=='daily',AttendanceRecord.scope_key==today))
        if not existing:
            try:
                async with db.begin_nested():
                    db.add(AttendanceRecord(event_id=event_id,guest_id=guest.id,scope='daily',scope_key=today,recorded_at=days.utcnow(),recorded_by=actor.id))
                    await db.flush()
            except IntegrityError:
                if not await db.scalar(select(AttendanceRecord.id).where(AttendanceRecord.event_id==event_id,AttendanceRecord.guest_id==guest.id,AttendanceRecord.scope=='daily',AttendanceRecord.scope_key==today)):raise
        child._convention_admitted=True
        if a=='dropoff':
            child.programme_date=today
            child._programme_today=today
            child.screening_wristband_assigned=body.screening_wristband_assigned
            child.allergy=body.allergy
            child.accommodation=body.accommodation
            child.allergy_cleared=False
            child.accommodation_cleared=False
            child.location='support_desk' if body.allergy or body.accommodation else 'reception'
            details={'adult_name':adult_name.strip(),'relationship':relationship,'phone':phone,'contact_id':dropoff_contact.id if dropoff_contact else None}
    elif a=='screening':
        if before not in ('reception','support_desk'):raise HTTPException(409,'Screening requires a child at reception or support desk')
        if body.allergy is None or body.accommodation is None:raise HTTPException(400,'Answer both screening questions')
        child.screening_wristband_assigned=bool(child.screening_wristband_assigned or body.screening_wristband_assigned)
        child.allergy=body.allergy
        child.accommodation=body.accommodation
        child.allergy_cleared=False
        child.accommodation_cleared=False
        child.location='support_desk' if body.allergy or body.accommodation else 'reception'
    elif a=='assign_wristband':
        if before not in ('reception','support_desk'):raise HTTPException(409,'Record screening wristbands at reception or the support desk')
        if child.allergy is None or child.accommodation is None:raise HTTPException(409,'Complete both screening questions before recording the screening wristband')
        if not body.screening_wristband_assigned:raise HTTPException(400,'Confirm the standard screening wristband was physically assigned')
        if child.screening_wristband_assigned:raise HTTPException(409,'The screening wristband is already recorded')
        child.screening_wristband_assigned=True
    elif a in ('clear_allergy','clear_accommodation'):
        if not can(role,'support'):raise HTTPException(403,'Support desk permission required')
        field='allergy' if a=='clear_allergy' else 'accommodation'
        if before!='support_desk' or not getattr(child,field):raise HTTPException(409,'No matching desk referral pending')
        if getattr(child,field+'_cleared'):raise HTTPException(409,'This referral is already cleared')
        if not body.notes or not body.notes.strip() or not body.wristband_assigned:
            raise HTTPException(400,'Record restricted desk details and confirm wristband assignment')
        setattr(child,field+'_notes',body.notes.strip())
        setattr(child,field+'_cleared',True)
    elif a=='classroom':
        config=await db.get(JuniorConfig,event_id)
        if not child.classroom or child.classroom not in config.classrooms:
            raise HTTPException(409,'Confirm classroom assignment at the help desk first')
        if before not in ('reception','support_desk'):raise HTTPException(409,'Record return to JP before classroom arrival')
        if child.allergy is None or child.accommodation is None:raise HTTPException(409,'Complete both screening questions first')
        if (child.allergy and not child.allergy_cleared) or (child.accommodation and not child.accommodation_cleared):
            raise HTTPException(409,'Complete all support-desk referrals and wristbands first')
        if not child.screening_wristband_assigned:
            raise HTTPException(409,'Assign and record the standard screening wristband before classroom arrival')
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
            today=days.day(event)
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
    if newly_admitted:
        from . import broadcast
        background_tasks.add_task(broadcast,event_id,{'type':'admitted','guest_id':child.guest_id,'name':child.name,'email':guest.email,'admitted_at':guest.admitted_at.isoformat() if guest.admitted_at else None,'is_walk_in':bool(guest.is_walk_in)})
    return output_child(child,role)


class OutingIn(BaseModel):
    name: str = Field(min_length=1,max_length=255)
    outing_date: date
    child_ids: list[str] = Field(min_length=1,max_length=1000)
    permission_verified: bool


@router.post('/outings',status_code=201)
async def outing_add(event_id: str, body: OutingIn, db=Depends(get_db), actor=Depends(require_event_member)):
    event,_,_,_=await access(event_id,actor,db,permission='outings')
    await shared.roster(event,db)
    if not body.permission_verified:raise HTTPException(400,'Verify outing permission for every selected child')
    if not body.name.strip():raise HTTPException(400,'Outing name required')
    ids=set(body.child_ids)
    rows=(await db.scalars(select(JuniorChild.id).where(JuniorChild.event_id==event_id,JuniorChild.id.in_(ids)))).all()
    if set(rows)!=ids:raise HTTPException(400,'All children must belong to this event')
    outing=JuniorOuting(event_id=event_id,name=body.name.strip(),outing_date=body.outing_date.isoformat())
    db.add(outing)
    await db.flush()
    for child_id in ids:db.add(JuniorOutingMember(outing_id=outing.id,child_id=child_id,permission_verified_by=actor.id))
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='outing_created',detail={'outing_id':outing.id,'name':outing.name,'child_ids':sorted(ids),'date':outing.outing_date,'permission_verified':True}))
    await db.commit()
    return {'id':outing.id}


@router.get('/outings')
async def outings(event_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    event,_,role,_=await access(event_id,actor,db,write=False)
    if not can(role,'view_children'):raise HTTPException(403,'Permission to view children is required')
    await shared.roster(event,db)
    result=[]
    for outing in (await db.scalars(select(JuniorOuting).where(JuniorOuting.event_id==event_id))).all():
        members=(await db.execute(select(JuniorOutingMember,JuniorChild.name).join(JuniorChild,JuniorChild.id==JuniorOutingMember.child_id).where(JuniorOutingMember.outing_id==outing.id))).all()
        result.append({'id':outing.id,'name':outing.name,'date':outing.outing_date,'closed':outing.closed,'expected':len(members),
            'departed':sum(bool(m.departed_at) for m,_ in members),'returned':sum(bool(m.returned_at) for m,_ in members),
            'outstanding':[{'id':m.child_id,'name':name} for m,name in members if m.departed_at and not m.returned_at],
            'members':[{'id':m.child_id,'name':name,'departed_at':m.departed_at,'returned_at':m.returned_at} for m,name in members]})
    await db.commit()
    return result


@router.post('/outings/{outing_id}/close')
async def outing_close(event_id: str, outing_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    await access(event_id,actor,db,permission='outings')
    outing=await db.scalar(select(JuniorOuting).where(JuniorOuting.id==outing_id,JuniorOuting.event_id==event_id).with_for_update())
    if not outing:raise HTTPException(404,'Outing not found')
    pending=await db.scalar(select(JuniorOutingMember.child_id).where(JuniorOutingMember.outing_id==outing_id,JuniorOutingMember.departed_at.is_not(None),JuniorOutingMember.returned_at.is_(None)).limit(1))
    if pending:raise HTTPException(409,'Reconcile all outstanding children before closing the outing')
    outing.closed=True
    db.add(JuniorAudit(event_id=event_id,actor_id=actor.id,action='outing_closed',detail={'outing_id':outing.id}))
    await db.commit()
    return {'closed':True}


@router.get('/notifications')
async def notifications(event_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    await access(event_id,actor,db,permission='messages',write=False)
    rows=(await db.scalars(select(JuniorNotification).where(JuniorNotification.event_id==event_id).order_by(JuniorNotification.created_at.desc()).limit(300))).all()
    return [{k:getattr(row,k) for k in ('id','movement_id','channel','recipient','body','status','error','provider_id','created_at')} for row in rows]


@router.post('/notifications/{notification_id}/retry')
async def retry_notice(event_id: str, notification_id: str, db=Depends(get_db), actor=Depends(require_event_member)):
    event,config,_,_=await access(event_id,actor,db,permission='messages')
    row=await db.scalar(select(JuniorNotification).where(JuniorNotification.id==notification_id,JuniorNotification.event_id==event_id).with_for_update())
    if not row:raise HTTPException(404,'Notification not found')
    if row.status not in ('setup_required','paused') or row.attempted_at:
        raise HTTPException(409,'Only unattempted notices may be queued. Reconcile attempted provider outcomes first.')
    if (datetime.utcnow()-row.created_at).total_seconds()>86400:raise HTTPException(409,'This historical notice has expired')
    if not config.notifications_enabled:raise HTTPException(409,'Guardian sending is paused')
    contact=await db.get(JuniorContact,row.contact_id) if row.contact_id else None
    if contact:
        child=await child_for(event_id,contact.child_id,db)
        await shared.refresh_contact(event,child,contact,db)
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
    await access(event_id,actor,db,roles=['inventory','supervisor'],write=False)
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
    await access(event_id,actor,db,roles=['inventory','supervisor'],write=False)
    item=await db.scalar(select(JuniorInventory).where(JuniorInventory.id==item_id,JuniorInventory.event_id==event_id))
    if not item:raise HTTPException(404,'Item not found')
    rows=(await db.scalars(select(JuniorInventoryEntry).where(JuniorInventoryEntry.item_id==item_id).order_by(JuniorInventoryEntry.created_at.desc()).limit(200))).all()
    return [{k:getattr(r,k) for k in ('action','quantity','responsible','notes','actor_id','created_at')} for r in rows]


from .junior_volunteers import router as volunteer_router
router.include_router(volunteer_router)

from .junior_team import router as team_router
router.include_router(team_router)
