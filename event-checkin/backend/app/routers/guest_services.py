"""Table/room responsibility and a scoped workspace over existing operations.

Tasks, menu choices, meal fulfillment and zone scan records remain canonical.
No alternate order, session-attendance or assistance status machine is created.
"""
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..auth import require_event_member, require_event_admin
from ..models import (Event, EventUser, User, SeatingTable, Zone, Guest, GuestServiceAssignment,
    GuestSeatingPresence, GuestServiceActivity, GuestServiceRequest,
    GuestMenuChoice, MenuItem, MenuCombination, MealService, GuestMealService, ScanEvent)
from ..schemas import GuestMenuSubmit, ScanZoneRequest
from ..services.guest_services import member, supervisor, assignments_for, guest_scope, active_assignment

router = APIRouter()


class AssignmentIn(BaseModel):
    table_id: str | None = None
    zone_id: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_lead: bool = False
    can_checkin: bool = False
    can_manage_meals: bool = False
    can_scan_zone: bool = False

    @model_validator(mode='after')
    def validate_scope(self):
        if bool(self.table_id) == bool(self.zone_id):
            raise ValueError('Choose exactly one existing table or room/zone')
        for field in ('starts_at', 'ends_at'):
            value = getattr(self, field)
            if value and value.tzinfo:
                setattr(self, field, value.astimezone(timezone.utc).replace(tzinfo=None))
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError('Shift end must follow its start')
        if self.zone_id and (self.can_checkin or self.can_manage_meals):
            raise ValueError('Room assignments grant zone scans, not event admission or table meal access')
        if self.table_id and self.can_scan_zone:
            raise ValueError('Zone scanning requires a room/zone assignment')
        return self


class AssignmentUpdate(BaseModel):
    scoped: bool = True
    if_unmodified_since: datetime | None = None
    assignments: list[AssignmentIn] = Field(default_factory=list, max_length=100)


class SeatedIn(BaseModel):
    seated: bool = True


class AssistedMenuIn(GuestMenuSubmit):
    guest_agreed: bool = False


class RequestIn(BaseModel):
    assignment_id: str
    request_key: str = Field(min_length=8, max_length=80)
    title: str = Field(min_length=1, max_length=180)
    notes: str = Field(default='', max_length=2000)
    priority: Literal['low', 'normal', 'high'] = 'normal'
    assignee_user_id: str | None = None


class ScanIn(BaseModel):
    token: str = Field(min_length=1, max_length=500)
    zone_id: str | None = None
    direction: Literal['in', 'out'] = 'in'


def audit(db, event_id, actor, action, guest_id=None, detail=None):
    db.add(GuestServiceActivity(event_id=event_id, actor_id=actor.id, action=action, guest_id=guest_id, detail=detail))


def assignment_out(row, tables, zones):
    return {**{key: getattr(row, key) for key in ('id','event_user_id','table_id','zone_id','starts_at','ends_at','is_lead','can_checkin','can_manage_meals','can_scan_zone')},
            'name': tables.get(row.table_id) or zones.get(row.zone_id) or 'Removed location', 'active': active_assignment(row)}


async def event_and_guest(event_id, guest_id, actor, db, permission=None):
    event = await db.get(Event, event_id)
    await member(event, actor, db)
    if not event.is_paid and not actor.is_platform_superadmin:
        raise HTTPException(402, 'This event needs an Event Pass for guest operations')
    guest = await db.scalar(select(Guest).where(Guest.id == guest_id, Guest.event_id == event_id).with_for_update().execution_options(populate_existing=True))
    if not guest:
        raise HTTPException(404, 'Guest not found')
    await guest_scope(event, actor, guest, db, permission=permission)
    return event, guest


@router.get('/{event_id}/guest-services')
async def workspace(event_id: str, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    from .menu import _cat_out
    from ..models import MenuCategory
    event = await db.get(Event, event_id)
    eu = await member(event, actor, db)
    is_supervisor = await supervisor(event, actor, db)
    can_write = await supervisor(event, actor, db, write=True)
    tables = (await db.scalars(select(SeatingTable).where(SeatingTable.event_id == event_id))).all()
    zones = (await db.scalars(select(Zone).where(Zone.event_id == event_id, Zone.is_active.is_(True)))).all()
    table_names = {t.id: t.name for t in tables}; zone_names = {z.id: z.name for z in zones}
    all_rows = (await db.scalars(select(GuestServiceAssignment).join(EventUser, EventUser.id == GuestServiceAssignment.event_user_id).where(EventUser.event_id == event_id))).all()
    mine = [r for r in all_rows if eu and r.event_user_id == eu.id]
    active = [r for r in mine if active_assignment(r)]
    table_ids = list(table_names) if is_supervisor else list({r.table_id for r in active if r.table_id})
    zone_ids = list(zone_names) if is_supervisor else list({r.zone_id for r in active if r.zone_id in zone_names})
    guests = (await db.scalars(select(Guest).where(Guest.event_id == event_id, Guest.table_id.in_(table_ids)).order_by(Guest.table_id, Guest.last_name, Guest.first_name))).all() if table_ids else []
    ids = [g.id for g in guests]
    seated = {r.guest_id: r for r in (await db.scalars(select(GuestSeatingPresence).where(GuestSeatingPresence.guest_id.in_(ids)))).all()} if ids else {}
    choices = (await db.execute(select(GuestMenuChoice, MenuItem.name, MenuCombination.name).outerjoin(MenuItem, MenuItem.id == GuestMenuChoice.menu_item_id).outerjoin(MenuCombination, MenuCombination.id == GuestMenuChoice.combination_id).where(GuestMenuChoice.guest_id.in_(ids)))).all() if ids else []
    by_guest = {}
    for choice, item, combo in choices:
        by_guest.setdefault(choice.guest_id, []).append({'category_id': choice.category_id, 'item_id': choice.menu_item_id, 'combination_id': choice.combination_id, 'name': item or combo})
    services = (await db.scalars(select(MealService).where(MealService.event_id == event_id))).all() if event.menu_enabled else []
    fulfills = {(r.guest_id, r.service_id): r for r in (await db.scalars(select(GuestMealService).where(GuestMealService.guest_id.in_(ids)))).all()} if ids else {}
    out = []
    for g in guests:
        can_meals = can_write if is_supervisor else any(r.table_id == g.table_id and r.can_manage_meals for r in active)
        out.append({'id':g.id, 'name':f'{g.first_name} {g.last_name}'.strip(), 'table_id':g.table_id, 'table_name':table_names.get(g.table_id), 'seat_number':g.seat_number,
            'admitted':g.admitted, 'seated_at':seated[g.id].seated_at if g.id in seated and seated[g.id].table_id == g.table_id else None,
            'can_checkin':can_write if is_supervisor else any(r.table_id == g.table_id and r.can_checkin for r in active),
            'can_manage_meals':can_meals, 'choices':by_guest.get(g.id,[]) if can_meals else [],
            'meal_services':[{'id':s.id,'category_id':s.category_id,'name':s.name,'status':s.status,
                'eligible':g.rsvp_status != 'declined' and (not fulfills.get((g.id,s.id)) or fulfills[(g.id,s.id)].eligibility_status == 'eligible'),
                'served':bool(fulfills.get((g.id,s.id)) and fulfills[(g.id,s.id)].fulfillment_status == 'served')} for s in services] if can_meals else []})
    # Zone attendance is derived from canonical accepted movements, not registration/admission.
    movements = (await db.execute(select(ScanEvent, Guest.first_name, Guest.last_name).join(Guest, Guest.id == ScanEvent.guest_id).where(ScanEvent.event_id == event_id, ScanEvent.zone_id.in_(zone_ids), ScanEvent.denied.is_(False)).order_by(ScanEvent.scanned_at.desc(), ScanEvent.id.desc()))).all() if zone_ids else []
    latest = {}
    for movement, first, last in movements:
        latest.setdefault((movement.zone_id,movement.guest_id), {'guest_id':movement.guest_id,'name':f'{first} {last}'.strip(),'direction':movement.direction})
    cats = (await db.scalars(select(MenuCategory).where(MenuCategory.event_id == event_id, MenuCategory.guest_visible.is_(True), MenuCategory.display_only.is_(False)).order_by(MenuCategory.sort_order))).all() if any(g['can_manage_meals'] for g in out) and event.menu_enabled else []
    request_members=(await db.execute(select(User.id,User.name).join(EventUser,EventUser.user_id==User.id).where(EventUser.event_id==event_id))).all() if active or is_supervisor else []
    result = {'request_assignees':[{'id':uid,'name':name} for uid,name in request_members], 'event_id':event_id,'event_name':event.name,'is_supervisor':is_supervisor,'can_configure':can_write,
        'assignments':[assignment_out(r,table_names,zone_names) for r in mine], 'guests':out,
        'zones':[{'id':z.id,'name':z.name,'can_scan':can_write if is_supervisor else any(r.zone_id==z.id and r.can_scan_zone for r in active), 'inside':[v for (zone_id,_),v in latest.items() if zone_id==z.id and v['direction']=='in']} for z in zones if z.id in zone_ids],
        'menu_categories':[await _cat_out(c,db) for c in cats]}
    if is_supervisor:
        members=(await db.execute(select(EventUser,User).join(User,User.id==EventUser.user_id).where(EventUser.event_id==event_id))).all()
        result['team']=[{'id':m.id,'user_id':u.id,'name':u.name,'event_role':m.event_role,'scoped':m.guest_service_scoped,'updated_at':m.updated_at,'assignments':[assignment_out(r,table_names,zone_names) for r in all_rows if r.event_user_id==m.id]} for m,u in members]
        result['locations']={'tables':[{'id':t.id,'name':t.name} for t in tables], 'zones':[{'id':z.id,'name':z.name} for z in zones]}
    return result


@router.put('/{event_id}/guest-services/members/{member_id}')
async def configure(event_id: str, member_id: str, body: AssignmentUpdate, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_admin)):
    eu=await db.scalar(select(EventUser).where(EventUser.id==member_id,EventUser.event_id==event_id).with_for_update())
    if not eu: raise HTTPException(404,'Event team member not found')
    from ..auth import _org_role
    target=await db.get(User,eu.user_id)
    ev=await db.get(Event,event_id)
    if body.scoped and await _org_role(target,ev.org_id,db) in ('owner','admin'): raise HTTPException(400,'Organisation administrators retain organisation-wide access')
    if body.scoped and eu.event_role=='manager': raise HTTPException(400,'Event managers retain event-wide access; choose a staff member')
    expected=body.if_unmodified_since
    if expected and expected.tzinfo: expected=expected.astimezone(timezone.utc).replace(tzinfo=None)
    if expected != eu.updated_at: raise HTTPException(409,'Team access changed. Refresh before saving')
    if body.scoped and any((eu.can_manage_menu,eu.can_reassign_seats,eu.can_view_guests,eu.can_manage_guests,eu.can_view_dashboard)):
        raise HTTPException(409,'Remove event-wide guest, seat, menu and dashboard grants in Team before enabling scoped service access')
    seen=set()
    for item in body.assignments:
        key=(item.table_id,item.zone_id,item.starts_at,item.ends_at)
        if key in seen: raise HTTPException(400,'Duplicate assignment')
        seen.add(key)
        location=await db.get(SeatingTable if item.table_id else Zone,item.table_id or item.zone_id)
        if not location or location.event_id!=event_id: raise HTTPException(404,'Location not found in this event')
        if item.zone_id and not location.is_active: raise HTTPException(400,'Choose an active zone')
    await db.execute(delete(GuestServiceAssignment).where(GuestServiceAssignment.event_user_id==eu.id))
    for item in body.assignments: db.add(GuestServiceAssignment(event_user_id=eu.id,**item.model_dump()))
    eu.guest_service_scoped=body.scoped; eu.updated_at=datetime.utcnow()
    audit(db,event_id,actor,'assignments_updated',detail={'member_id':eu.id,'scoped':body.scoped,'assignments':[i.model_dump(mode='json') for i in body.assignments]})
    await db.commit()
    return {'ok':True}


@router.post('/{event_id}/guest-services/guests/{guest_id}/seated')
async def mark_seated(event_id: str, guest_id: str, body: SeatedIn, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    event,g=await event_and_guest(event_id,guest_id,actor,db,permission='table_id')
    if not g.admitted or not g.table_id: raise HTTPException(409,'Check the guest in and assign a table first')
    row=await db.get(GuestSeatingPresence,g.id)
    if body.seated:
        if row and row.table_id==g.table_id: return {'ok':True,'already_seated':True}
        if row: row.table_id=g.table_id; row.seated_at=datetime.utcnow(); row.seated_by=actor.id
        else: db.add(GuestSeatingPresence(guest_id=g.id,table_id=g.table_id,seated_by=actor.id))
    elif row: await db.delete(row)
    audit(db,event_id,actor,'seated' if body.seated else 'seating_corrected',g.id,{'table_id':g.table_id})
    await db.commit(); return {'ok':True}


@router.post('/{event_id}/guest-services/guests/{guest_id}/menu')
async def assisted_menu(event_id: str, guest_id: str, body: AssistedMenuIn, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    from .scanner import save_guest_menu
    _,g=await event_and_guest(event_id,guest_id,actor,db,permission='can_manage_meals')
    if not body.guest_agreed: raise HTTPException(400,'Confirm the guest agreed to these selections')
    audit(db,event_id,actor,'assisted_menu',g.id,{'guest_agreed':True})
    return await save_guest_menu(g,GuestMenuSubmit(**body.model_dump(exclude={'guest_agreed'})),db,actor_user_id=actor.id)


@router.post('/{event_id}/guest-services/guests/{guest_id}/services/{service_id}/served')
async def serve(event_id: str, guest_id: str, service_id: str, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    from .menu import fulfill_category
    event,g=await event_and_guest(event_id,guest_id,actor,db,permission='can_manage_meals')
    service=await db.get(MealService,service_id)
    if not event.menu_enabled or not service or service.event_id!=event_id: raise HTTPException(404,'Meal service not found')
    if not g.admitted or g.rsvp_status=='declined': raise HTTPException(409,'Guest must be checked in and eligible')
    audit(db,event_id,actor,'meal_served',g.id,{'service_id':service.id})
    return await fulfill_category(event_id,service.category_id,g.id,None,db,actor,service=service,enforce_service_limits=True)


@router.post('/{event_id}/guest-services/scan')
async def scan(event_id: str, body: ScanIn, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    from .scanner import scan_qr, scan_qr_zone
    event=await db.get(Event,event_id); await member(event,actor,db)
    if not event.is_paid and not actor.is_platform_superadmin: raise HTTPException(402,'This event needs an Event Pass for guest operations')
    g=await db.scalar(select(Guest).where(Guest.event_id==event_id,Guest.qr_token==body.token))
    if not g: raise HTTPException(404,'Pass not found in this event')
    audit(db,event_id,actor,'scan_attempt',g.id,{'zone_id':body.zone_id,'direction':body.direction if body.zone_id else 'in'})
    if body.zone_id:
        if not await supervisor(event,actor,db,write=True) and not any(r.zone_id==body.zone_id and r.can_scan_zone for r in await assignments_for(event,actor,db)):
            raise HTTPException(403,'Zone scan is outside your active assignments')
        result=await scan_qr_zone(body.token,ScanZoneRequest(zone_id=body.zone_id,direction=body.direction),background_tasks,db,actor)
    else:
        await guest_scope(event,actor,g,db,permission='can_checkin')
        result=await scan_qr(body.token,background_tasks,None,db,actor)
    await db.commit()
    # Do not forward the legacy scanner's full GuestOut (contacts/pass credentials).
    return {'status':result.status,'message':getattr(result, 'message', None) or getattr(result, 'deny_reason', None) or f'{result.guest_name}: {result.zone_name} {result.direction}'}


@router.post('/{event_id}/guest-services/requests')
async def assistance(event_id: str, body: RequestIn, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    event=await db.get(Event,event_id); await member(event,actor,db)
    assignment=await db.get(GuestServiceAssignment,body.assignment_id)
    eu=await db.get(EventUser,assignment.event_user_id) if assignment else None
    if not eu or eu.event_id!=event_id or not active_assignment(assignment): raise HTTPException(403,'Active assignment required')
    if eu.user_id!=actor.id and not await supervisor(event,actor,db,write=True): raise HTTPException(403,'Assignment belongs to another staff member')
    if not body.title.strip(): raise HTTPException(400,'Request title is required')
    if body.assignee_user_id and not await db.scalar(select(EventUser.id).where(EventUser.event_id==event_id,EventUser.user_id==body.assignee_user_id)):
        raise HTTPException(400,'Assign requests to this event team only')
    existing=await db.scalar(select(GuestServiceRequest).where(GuestServiceRequest.event_id==event_id,GuestServiceRequest.actor_id==actor.id,GuestServiceRequest.request_key==body.request_key))
    if existing: return {'task_id':existing.task_id,'already_created':True}
    location=await db.get(SeatingTable if assignment.table_id else Zone,assignment.table_id or assignment.zone_id)
    from .tasks import add_task_record, _notify_assignee
    from ..schemas import TaskCreate
    if not location: raise HTTPException(409,'This location was removed; refresh assignments')
    event,task,assignee=await add_task_record(event_id,TaskCreate(title=f'{location.name}: {body.title.strip()}'[:255],notes=body.notes,priority=body.priority,assignee_user_id=body.assignee_user_id),actor,db)
    db.add(GuestServiceRequest(event_id=event_id,actor_id=actor.id,request_key=body.request_key,assignment_id=assignment.id,task_id=task.id))
    try: await db.commit()
    except IntegrityError:
        await db.rollback()
        existing=await db.scalar(select(GuestServiceRequest).where(GuestServiceRequest.event_id==event_id,GuestServiceRequest.actor_id==actor.id,GuestServiceRequest.request_key==body.request_key))
        if not existing: raise
        return {'task_id':existing.task_id,'already_created':True}
    if assignee: _notify_assignee(background_tasks,event,task,assignee)
    return {'task_id':task.id,'already_created':False}
