"""Table/room responsibility and a scoped workspace over existing operations.

Tasks, menu choices, meal fulfillment and zone scan records remain canonical.
Meal progress uses the canonical fulfillment ledger; assistance stays in Tasks.
"""
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, delete, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..auth import require_event_member, require_event_admin
from ..models import (Event, EventUser, User, Membership, SeatingTable, Zone, Guest, GuestServiceAssignment,
    GuestSeatingPresence, GuestServiceActivity, GuestServiceRequest,
    GuestMenuChoice, MenuItem, MenuCombination, MealService, GuestMealService, ScanEvent)
from ..schemas import GuestMenuSubmit, ScanZoneRequest, MealProgressIn, MealTrackingIn, MealAttendanceIn, MealAttendanceCorrectionIn
from ..services.meal_queue import meal_requests, progress_meal, RESERVED
from ..services.guest_services import member, supervisor, assignments_for, guest_scope, active_assignment

from ..services.meal_attendance import service_summaries, set_tracking, record_attendance, correct_attendance, has_orders, headcount_only_categories, meal_event_reason

router = APIRouter()


class AssignmentIn(BaseModel):
    id: str | None = None
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


class PlaceholderNameIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    if_unmodified_since: datetime | None = None


async def renameable_placeholder(user, event_user, db, org_id):
    # Real identities and shared accounts must be edited through their identity owner.
    if user.firebase_uid or not user.email.lower().endswith('.invalid') or user.is_platform_superadmin or event_user.event_role != 'staff':
        return False
    memberships = (await db.scalars(select(Membership).where(Membership.user_id == user.id))).all()
    events = await db.scalar(select(func.count()).select_from(EventUser).where(EventUser.user_id == user.id))
    return len(memberships) == 1 and memberships[0].org_id == org_id and memberships[0].role == 'staff' and events == 1


async def renameable_placeholder_ids(members,db,org_id):
    candidates={u.id for m,u in members if not u.firebase_uid and u.email.lower().endswith('.invalid') and not u.is_platform_superadmin and m.event_role=='staff'}
    if not candidates:return set()
    memberships=(await db.scalars(select(Membership).where(Membership.user_id.in_(candidates)))).all()
    counts=dict((await db.execute(select(EventUser.user_id,func.count()).where(EventUser.user_id.in_(candidates)).group_by(EventUser.user_id))).all())
    return {uid for uid in candidates if counts.get(uid)==1 and len([m for m in memberships if m.user_id==uid])==1 and any(m.user_id==uid and m.org_id==org_id and m.role=='staff' for m in memberships)}


class SeatedIn(BaseModel):
    seated: bool = True


class AssistedMenuIn(GuestMenuSubmit):
    # Unknown keys used to be dropped silently, so a malformed client got 200 "saved: 0" and a false audit row.
    model_config = ConfigDict(extra='forbid')
    guest_agreed: bool = False
    clear_categories: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def require_a_change(self):
        if not (any(self.single.values()) or any(self.multi.values()) or any(self.combo.values()) or self.clear_categories):
            raise ValueError('Choose at least one menu item, or name a category to clear')
        return self


class RequestIn(BaseModel):
    # Staff raise requests from an assignment; supervisors may name any table or room instead.
    assignment_id: str | None = None
    table_id: str | None = None
    zone_id: str | None = None
    request_key: str = Field(min_length=8, max_length=80)
    title: str = Field(min_length=1, max_length=180)
    notes: str = Field(default='', max_length=2000)
    priority: Literal['low', 'normal', 'high'] = 'normal'
    assignee_user_id: str | None = None

    @model_validator(mode='after')
    def one_target(self):
        if sum(bool(x) for x in (self.assignment_id, self.table_id, self.zone_id)) != 1:
            raise ValueError('Choose exactly one assignment, table or room')
        return self


class ScanIn(BaseModel):
    token: str = Field(min_length=1, max_length=500)
    zone_id: str | None = None
    direction: Literal['in', 'out'] = 'in'
    guardian_token: str | None = Field(default=None, max_length=500)
    guardian_guest_id: str | None = Field(default=None, max_length=36)


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
    from .menu import categories_out, meal_service_availability
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
    service_counts = dict((await db.execute(select(GuestMealService.service_id,func.count()).where(GuestMealService.service_id.in_([s.id for s in services]),GuestMealService.fulfillment_status.in_(RESERVED)).group_by(GuestMealService.service_id))).all()) if services else {}
    now = datetime.utcnow()
    fulfills = {(r.guest_id, r.service_id): r for r in (await db.scalars(select(GuestMealService).where(GuestMealService.guest_id.in_(ids)))).all()} if ids else {}
    out = []
    for g in guests:
        can_meals = can_write if is_supervisor else any(r.table_id == g.table_id and r.can_manage_meals for r in active)
        locked_categories = sorted({s.category_id for s in services if fulfills.get((g.id,s.id)) and fulfills[(g.id,s.id)].fulfillment_status in RESERVED})
        out.append({'id':g.id, 'name':f'{g.first_name} {g.last_name}'.strip(), 'table_id':g.table_id, 'table_name':table_names.get(g.table_id), 'seat_number':g.seat_number,
            'admitted':g.admitted, 'seated_at':seated[g.id].seated_at if g.id in seated and seated[g.id].table_id == g.table_id else None,
            'can_checkin':can_write if is_supervisor else any(r.table_id == g.table_id and r.can_checkin for r in active),
            'can_manage_meals':can_meals, 'locked_category_ids':locked_categories if can_meals else [], 'menu_selections_locked':bool(g.meal_served and not locked_categories), 'choices':by_guest.get(g.id,[]) if can_meals else [],
            'meal_services':[]})
        if can_meals:
            for service in services:
                record=fulfills.get((g.id,service.id))
                served=bool(record and record.fulfillment_status=='served')
                eligible=g.rsvp_status!='declined' and (not record or record.eligibility_status=='eligible')
                availability,reason=meal_service_availability(service,service_counts.get(service.id,0)-int(bool(record and record.fulfillment_status in ('preparing','ready'))),now)
                if not has_orders(service):availability,reason='headcount_only','Headcount only — no food order required'
                if served: availability,reason='served','Served — choices locked'
                elif not eligible: availability,reason='not_eligible','Guest is not eligible'
                elif not g.admitted: availability,reason='checkin_required','Guest must check in first'
                if meal_event_reason(event): availability,reason='event_inactive',meal_event_reason(event)
                out[-1]['meal_services'].append({'id':service.id,'category_id':service.category_id,'name':service.name,'status':service.status,'tracking_mode':service.tracking_mode,'attended_at':record.attended_at if record else None,'eligible':eligible,'served':served,'starts_at':service.starts_at,'ends_at':service.ends_at,'remaining_capacity':max(0,service.capacity-service_counts.get(service.id,0)) if service.capacity is not None else None,'availability':availability,'availability_reason':reason,'can_serve':availability=='available'})

    # Zone attendance is derived from canonical accepted movements, not registration/admission.
    ranked = select(ScanEvent.id.label('scan_id'),func.row_number().over(partition_by=(ScanEvent.zone_id,ScanEvent.guest_id),order_by=(ScanEvent.scanned_at.desc(),ScanEvent.id.desc())).label('position')).where(ScanEvent.event_id==event_id,ScanEvent.zone_id.in_(zone_ids),ScanEvent.denied.is_(False)).subquery()
    movements = (await db.execute(select(ScanEvent,Guest.first_name,Guest.last_name).join(ranked,ranked.c.scan_id==ScanEvent.id).join(Guest,Guest.id==ScanEvent.guest_id).where(ranked.c.position==1))).all() if zone_ids else []
    latest = {}
    for movement, first, last in movements:
        latest.setdefault((movement.zone_id,movement.guest_id), {'guest_id':movement.guest_id,'name':f'{first} {last}'.strip(),'direction':movement.direction})
    cats = (await db.scalars(select(MenuCategory).where(MenuCategory.event_id == event_id, MenuCategory.guest_visible.is_(True), MenuCategory.display_only.is_(False)).order_by(MenuCategory.sort_order))).all() if any(g['can_manage_meals'] for g in out) and event.menu_enabled else []
    request_members=(await db.execute(select(User.id,User.name).join(EventUser,EventUser.user_id==User.id).where(EventUser.event_id==event_id))).all() if active or is_supervisor else []
    result = {'request_assignees':[{'id':uid,'name':name} for uid,name in request_members], 'event_id':event_id,'event_name':event.name,'is_supervisor':is_supervisor,'can_configure':can_write,
        'assignments':[assignment_out(r,table_names,zone_names) for r in mine], 'guests':out,
        'zones':[{'id':z.id,'name':z.name,'can_scan':can_write if is_supervisor else any(r.zone_id==z.id and r.can_scan_zone for r in active), 'inside':[v for (zone_id,_),v in latest.items() if zone_id==z.id and v['direction']=='in']} for z in zones if z.id in zone_ids],
        'menu_categories':await categories_out(cats,db),
        'manual_guardian_verification_enabled':bool(event.manual_checkin_enabled),
        'tables':[{'id':t.id,'name':t.name,'capacity':t.capacity,'service_section':t.service_section} for t in tables if t.id in table_ids]}
    meal_guest_ids={g['id'] for g in out if g['can_manage_meals']}
    disabled_categories=await headcount_only_categories(db,event_id)
    result['menu_categories']=[c for c in result['menu_categories'] if c.id not in disabled_categories]
    attendance_guests=(await db.scalars(select(Guest).where(Guest.event_id==event_id))).all() if is_supervisor else [g for g in guests if g.id in meal_guest_ids]
    result['meal_services']=await service_summaries(db,event,attendance_guests,table_names,writable=can_write if is_supervisor else bool(meal_guest_ids),configure=can_write,scope='Entire event' if is_supervisor else 'Assigned tables',allow_unpaid=actor.is_platform_superadmin)
    result['meal_requests']=await meal_requests(db,event,[g for g in guests if g.id in meal_guest_ids],table_names,writable=can_write if is_supervisor else True)
    if is_supervisor:
        members=(await db.execute(select(EventUser,User).join(User,User.id==EventUser.user_id).where(EventUser.event_id==event_id))).all()
        renameable_ids=await renameable_placeholder_ids(members,db,event.org_id) if can_write else set()
        guest_counts=(await db.execute(select(func.count(Guest.id),func.count(Guest.table_id)).where(Guest.event_id==event_id))).one()
        result['setup_warnings']={'unallocated_guests':guest_counts[0]-guest_counts[1],'unclaimed_placeholders':sum(not u.firebase_uid and u.email.lower().endswith('.invalid') for _,u in members),'services_without_windows':sum(x.status=='open' and (not x.starts_at or not x.ends_at) for x in services),'open_demo_services':sum(x.status=='open' and 'demo' in x.name.lower() for x in services)}
        result['team']=[{'id':m.id,'user_id':u.id,'name':u.name,'event_role':m.event_role,'scoped':m.guest_service_scoped,'updated_at':m.updated_at,'can_rename_placeholder':u.id in renameable_ids,'assignments':[assignment_out(r,table_names,zone_names) for r in all_rows if r.event_user_id==m.id]} for m,u in members]
        result['locations']={'tables':[{'id':t.id,'name':t.name,'capacity':t.capacity,'category':t.category,'service_section':t.service_section,'sort_order':t.sort_order,'updated_at':t.updated_at} for t in tables], 'zones':[{'id':z.id,'name':z.name} for z in zones]}
    return result


@router.get('/{event_id}/guest-services/activity')
async def activity(event_id: str, guest_id: str | None = None, actor_id: str | None = None,
                   action: str | None = None, since: datetime | None = None, until: datetime | None = None,
                   offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
                   db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    event = await db.get(Event, event_id)
    await member(event, actor, db)
    if not await supervisor(event, actor, db):
        raise HTTPException(403, 'Supervisor access required for activity history')
    filters = [GuestServiceActivity.event_id == event_id]
    for column, value in [(GuestServiceActivity.guest_id, guest_id), (GuestServiceActivity.actor_id, actor_id), (GuestServiceActivity.action, action)]:
        if value: filters.append(column == value)
    for value, lower in [(since, True), (until, False)]:
        if value:
            value = value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value
            filters.append(GuestServiceActivity.created_at >= value if lower else GuestServiceActivity.created_at <= value)
    total = await db.scalar(select(func.count()).select_from(GuestServiceActivity).where(*filters))
    rows = (await db.execute(select(GuestServiceActivity, User.name, Guest.first_name, Guest.last_name)
        .outerjoin(User, User.id == GuestServiceActivity.actor_id)
        .outerjoin(Guest, (Guest.id == GuestServiceActivity.guest_id) & (Guest.event_id == event_id))
        .where(*filters).order_by(GuestServiceActivity.created_at.desc(), GuestServiceActivity.id.desc()).offset(offset).limit(limit))).all()
    return {'total': total, 'offset': offset, 'limit': limit, 'rows': [dict(id=row.id, created_at=row.created_at,
        action=row.action, actor_id=row.actor_id, actor_name=name or 'Former staff member', guest_id=row.guest_id,
        guest_name=' '.join(x for x in (first, last) if x) or None, detail=row.detail) for row,name,first,last in rows]}


@router.patch('/{event_id}/guest-services/members/{member_id}/placeholder-name')
async def rename_placeholder(event_id: str, member_id: str, body: PlaceholderNameIn, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_admin)):
    event = await db.get(Event, event_id)
    if not event or not await supervisor(event, actor, db, write=True):
        raise HTTPException(403, 'Event administrator access required')
    eu = await db.scalar(select(EventUser).where(EventUser.id == member_id, EventUser.event_id == event_id).with_for_update())
    if not eu: raise HTTPException(404, 'Event staff member not found')
    user = await db.scalar(select(User).where(User.id == eu.user_id).with_for_update())
    if not await renameable_placeholder(user, eu, db, event.org_id):
        raise HTTPException(409, 'Only unclaimed placeholder accounts for this event can be renamed here. Use Team for real identities.')
    expected = body.if_unmodified_since
    if expected and expected.tzinfo: expected = expected.astimezone(timezone.utc).replace(tzinfo=None)
    if expected != eu.updated_at: raise HTTPException(409, 'Team access changed. Refresh before saving')
    name = ' '.join(body.name.split())
    if not name: raise HTTPException(400, 'A display name is required')
    user.name = name
    eu.updated_at = datetime.utcnow()
    audit(db, event_id, actor, 'placeholder_name_updated', detail={'member_id':eu.id,'name':name})
    await db.commit()
    return {'ok':True}


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
    existing=(await db.scalars(select(GuestServiceAssignment).where(GuestServiceAssignment.event_user_id==eu.id))).all()
    by_id={r.id:r for r in existing};seen=set();retained=set();updates=[]
    for item in body.assignments:
        key=(item.table_id,item.zone_id,item.starts_at,item.ends_at)
        if key in seen: raise HTTPException(400,'Duplicate assignment')
        seen.add(key)
        location=await db.get(SeatingTable if item.table_id else Zone,item.table_id or item.zone_id)
        if not location or location.event_id!=event_id: raise HTTPException(404,'Location not found in this event')
        if item.zone_id and not location.is_active: raise HTTPException(400,'Choose an active zone')
        row=by_id.get(item.id) if item.id else next((r for r in existing if r.id not in retained and (r.table_id,r.zone_id,r.starts_at,r.ends_at)==key),None)
        if item.id and not row: raise HTTPException(404,'Assignment not found for this staff member')
        if row and row.id in retained: raise HTTPException(400,'Duplicate assignment identifier')
        if row:retained.add(row.id)
        updates.append((row,item))
    for row,item in updates:
        values=item.model_dump(exclude={'id'})
        if row:
            for field,value in values.items():setattr(row,field,value)
        else:db.add(GuestServiceAssignment(event_user_id=eu.id,**values))
    for row in existing:
        if row.id not in retained:await db.delete(row)
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
    return await save_guest_menu(g,GuestMenuSubmit(**body.model_dump(exclude={'guest_agreed','clear_categories'})),db,actor_user_id=actor.id,category_locks=True,clear_category_ids=body.clear_categories)


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
    detail={'zone_id':body.zone_id,'direction':body.direction if body.zone_id else 'in','outcome':'attempted'}
    attempt=GuestServiceActivity(event_id=event_id,actor_id=actor.id,action='scan_attempt',guest_id=g.id if g else None,detail=detail)
    db.add(attempt)
    await db.commit()
    attempt_id=attempt.id
    if not g:
        attempt.detail={**detail,'outcome':'not_found','http_status':404}
        await db.commit()
        raise HTTPException(404,'Pass not found in this event')
    try:
        if body.zone_id:
            if not await supervisor(event,actor,db,write=True) and not any(r.zone_id==body.zone_id and r.can_scan_zone for r in await assignments_for(event,actor,db)):
                raise HTTPException(403,'Zone scan is outside your active assignments')
            result=await scan_qr_zone(body.token,ScanZoneRequest(zone_id=body.zone_id,direction=body.direction,guardian_token=body.guardian_token,guardian_guest_id=body.guardian_guest_id),background_tasks,db,actor)
        else:
            await guest_scope(event,actor,g,db,permission='can_checkin')
            result=await scan_qr(body.token,background_tasks,None,db,actor)
    except HTTPException as exc:
        # Scanner errors may roll back their transaction. Reload only the already
        # persisted attempt, then record the denial without committing scan writes.
        await db.rollback()
        attempt=await db.get(GuestServiceActivity,attempt_id)
        attempt.detail={**detail,'outcome':'denied','http_status':exc.status_code}
        await db.commit()
        raise
    attempt.detail={**detail,'outcome':result.status,'http_status':200}
    await db.commit()
    # Do not forward the legacy scanner's full GuestOut (contacts/pass credentials).
    return {'guardian_candidates':getattr(result,'guardian_candidates',[]) if result.status=='guardian_required' else [],'guardian_name':getattr(result,'guardian_name',None),'guardian_verification_method':getattr(result,'guardian_verification_method',None),'guest_name':getattr(result,'guest_name',None),'status':result.status,'message':getattr(result, 'message', None) or getattr(result, 'deny_reason', None) or f'{result.guest_name}: {result.zone_name} {result.direction}'}


@router.post('/{event_id}/guest-services/guests/{guest_id}/meals/{service_id}/progress')
async def meal_progress(event_id: str, guest_id: str, service_id: str, body: MealProgressIn, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    await event_and_guest(event_id,guest_id,actor,db,permission='can_manage_meals')
    return await progress_meal(event_id,service_id,guest_id,body,db,actor,scoped=True)


@router.post('/{event_id}/guest-services/requests')
async def assistance(event_id: str, body: RequestIn, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    event=await db.get(Event,event_id); await member(event,actor,db)
    # Acknowledging the caller's own completed request does not require the old shift/location to still exist.
    existing=await db.scalar(select(GuestServiceRequest).where(GuestServiceRequest.event_id==event_id,GuestServiceRequest.actor_id==actor.id,GuestServiceRequest.request_key==body.request_key))
    if existing:return {'task_id':existing.task_id,'already_created':True}
    assignment=None
    if body.assignment_id:
        assignment=await db.get(GuestServiceAssignment,body.assignment_id)
        eu=await db.get(EventUser,assignment.event_user_id) if assignment else None
        if not eu or eu.event_id!=event_id or not active_assignment(assignment): raise HTTPException(403,'Active assignment required')
        if eu.user_id!=actor.id and not await supervisor(event,actor,db,write=True): raise HTTPException(403,'Assignment belongs to another staff member')
        location_id,location_kind=assignment.table_id or assignment.zone_id,SeatingTable if assignment.table_id else Zone
    else:
        # Supervisors look after the whole event, so they can raise help for any of its tables or rooms without being assigned.
        if not await supervisor(event,actor,db,write=True): raise HTTPException(403,'Active assignment required')
        location_id,location_kind=body.table_id or body.zone_id,SeatingTable if body.table_id else Zone
    if not body.title.strip(): raise HTTPException(400,'Request title is required')
    if body.assignee_user_id and not await db.scalar(select(EventUser.id).where(EventUser.event_id==event_id,EventUser.user_id==body.assignee_user_id)):
        raise HTTPException(400,'Assign requests to this event team only')
    existing=await db.scalar(select(GuestServiceRequest).where(GuestServiceRequest.event_id==event_id,GuestServiceRequest.actor_id==actor.id,GuestServiceRequest.request_key==body.request_key))
    if existing: return {'task_id':existing.task_id,'already_created':True}
    location=await db.get(location_kind,location_id)
    if location and location.event_id!=event_id: location=None
    from .tasks import add_task_record, _notify_assignee
    from ..schemas import TaskCreate
    if not location: raise HTTPException(404 if not assignment else 409,'Location not found in this event' if not assignment else 'This location was removed; refresh assignments')
    event,task,assignee=await add_task_record(event_id,TaskCreate(title=f'{location.name}: {body.title.strip()}'[:255],notes=body.notes,priority=body.priority,assignee_user_id=body.assignee_user_id),actor,db)
    db.add(GuestServiceRequest(event_id=event_id,actor_id=actor.id,request_key=body.request_key,assignment_id=assignment.id if assignment else None,table_id=location.id if location_kind is SeatingTable else None,zone_id=location.id if location_kind is Zone else None,task_id=task.id))
    try: await db.commit()
    except IntegrityError:
        await db.rollback()
        existing=await db.scalar(select(GuestServiceRequest).where(GuestServiceRequest.event_id==event_id,GuestServiceRequest.actor_id==actor.id,GuestServiceRequest.request_key==body.request_key))
        if not existing: raise
        return {'task_id':existing.task_id,'already_created':True}
    if assignee: _notify_assignee(background_tasks,event,task,assignee)
    return {'task_id':task.id,'already_created':False}


@router.patch('/{event_id}/guest-services/meals/{service_id}/tracking')
async def configure_meal_tracking(event_id: str, service_id: str, body: MealTrackingIn, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_admin)):
    event=await db.get(Event,event_id);await member(event,actor,db)
    if not await supervisor(event,actor,db,write=True):raise HTTPException(403,'Supervisor permission required')
    return await set_tracking(event_id,service_id,body,db,actor)


@router.post('/{event_id}/guest-services/meals/{service_id}/attendance')
async def meal_attendance_scan(event_id: str, service_id: str, body: MealAttendanceIn, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_member)):
    event=await db.get(Event,event_id);await member(event,actor,db)
    return await record_attendance(event_id,service_id,body.token,db,actor,scoped=True)


@router.post('/{event_id}/guest-services/meals/{service_id}/attendance/{guest_id}/correct')
async def meal_attendance_correction(event_id: str, service_id: str, guest_id: str, body: MealAttendanceCorrectionIn, db: AsyncSession = Depends(get_db), actor: User = Depends(require_event_admin)):
    event=await db.get(Event,event_id);await member(event,actor,db)
    if not await supervisor(event,actor,db,write=True):raise HTTPException(403,'Supervisor permission required')
    return await correct_attendance(event_id,service_id,guest_id,body,db,actor)
