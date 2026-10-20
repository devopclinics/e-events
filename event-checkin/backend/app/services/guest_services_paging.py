"""Bounded workspace reads. Authorisation is recomputed before every revision check."""
import hashlib
import json
from datetime import datetime
from sqlalchemy import select, func, case, and_, or_, literal, union_all
from sqlalchemy.orm import aliased
from ..models import (Guest, GuestMenuChoice, GuestMealService, GuestSeatingPresence,
    MealService, MenuCategory, MenuItem, MenuCombination, SeatingTable, ScanEvent, EventUser, User)
from .meal_attendance import has_orders


async def revision(db, event, actor, assignments, tables, zones, services, scope):
    guest_filter=Guest.event_id==event.id
    queries=[select(literal('guests'),func.count(Guest.id),func.max(Guest.updated_at)).where(guest_filter),
        select(literal('choices'),func.count(GuestMenuChoice.id),func.max(GuestMenuChoice.chosen_at)).join(Guest,Guest.id==GuestMenuChoice.guest_id).where(guest_filter),
        select(literal('fulfillment'),func.count(GuestMealService.id),func.max(GuestMealService.updated_at)).join(MealService,MealService.id==GuestMealService.service_id).where(MealService.event_id==event.id),
        select(literal('seated'),func.count(GuestSeatingPresence.guest_id),func.max(GuestSeatingPresence.seated_at)).join(Guest,Guest.id==GuestSeatingPresence.guest_id).where(guest_filter),
        select(literal('scans'),func.count(ScanEvent.id),func.max(ScanEvent.scanned_at)).where(ScanEvent.event_id==event.id),
        select(literal('team'),func.count(EventUser.id),func.max(EventUser.updated_at)).where(EventUser.event_id==event.id)]
    stamps=(await db.execute(union_all(*queries))).all()
    names=(await db.execute(select(User.id,User.name).join(EventUser,EventUser.user_id==User.id).where(EventUser.event_id==event.id).order_by(User.id))).all()
    menu=[]
    for model in [MenuCategory,MenuItem,MenuCombination]:
        rows=(await db.scalars(select(model).where(model.event_id==event.id))).all()
        menu.extend([{c.name:getattr(row,c.name) for c in model.__table__.columns} for row in rows])
    now=datetime.utcnow()
    fields=lambda row:{c.name:getattr(row,c.name) for c in row.__table__.columns}
    payload=[actor.id,[list(row) for row in names],scope,event.updated_at,event.status,event.is_paid,event.menu_enabled,event.manual_checkin_enabled,
        sorted([fields(a) for a in assignments],key=lambda r:r['id']),
        sorted([fields(t) for t in tables],key=lambda r:r['id']),
        sorted([fields(z) for z in zones],key=lambda r:r['id']),
        sorted([{**fields(s),'started':not s.starts_at or now>=s.starts_at,'ended':bool(s.ends_at and now>s.ends_at)} for s in services],key=lambda r:r['id']),
        [list(r) for r in stamps],sorted(menu,key=lambda r:r['id'])]
    return hashlib.sha256(json.dumps(payload,default=str,sort_keys=True).encode()).hexdigest()


def needs_attention(event, meal_tables, disabled_categories=()):
    seated=select(GuestSeatingPresence.guest_id).where(GuestSeatingPresence.guest_id==Guest.id,GuestSeatingPresence.table_id==Guest.table_id).exists()
    chosen=select(GuestMenuChoice.id).where(GuestMenuChoice.guest_id==Guest.id,GuestMenuChoice.category_id==MenuCategory.id).correlate(Guest,MenuCategory).exists()
    missing=select(MenuCategory.id).where(MenuCategory.event_id==event.id,MenuCategory.is_required.is_(True),MenuCategory.guest_visible.is_(True),MenuCategory.display_only.is_(False),MenuCategory.id.notin_(disabled_categories),~chosen).correlate(Guest).exists()
    record=aliased(GuestMealService);other=aliased(GuestMealService)
    reserved=select(func.count(other.id)).where(other.service_id==MealService.id,other.guest_id!=Guest.id,other.fulfillment_status.in_(['preparing','ready','served'])).correlate(MealService,Guest).scalar_subquery()
    blocked=select(record.id).where(record.service_id==MealService.id,record.guest_id==Guest.id,or_(record.fulfillment_status=='served',record.eligibility_status!='eligible')).correlate(MealService,Guest).exists()
    now=datetime.utcnow()
    available=select(MealService.id).where(MealService.event_id==event.id,MealService.status=='open',MealService.tracking_mode.in_(['orders','both']),or_(MealService.starts_at.is_(None),MealService.starts_at<=now),or_(MealService.ends_at.is_(None),MealService.ends_at>=now),or_(MealService.capacity.is_(None),reserved<MealService.capacity),~blocked).correlate(Guest).exists()
    meals=and_(Guest.table_id.in_(meal_tables),or_(missing,and_(literal(event.status=='active'),Guest.rsvp_status!='declined',available))) if event.menu_enabled else literal(False)
    return and_(Guest.admitted.is_(True),or_(~seated,meals))


async def table_metrics(db,event,table_ids,meal_tables,disabled_categories):
    attention=needs_attention(event,meal_tables,disabled_categories)
    seated=select(GuestSeatingPresence.guest_id).where(GuestSeatingPresence.guest_id==Guest.id,GuestSeatingPresence.table_id==Guest.table_id).exists()
    rows=(await db.execute(select(Guest.table_id,func.count(Guest.id),func.sum(case((Guest.admitted.is_(True),1),else_=0)),func.sum(case((seated,1),else_=0)),func.sum(case((attention,1),else_=0))).where(Guest.event_id==event.id,Guest.table_id.in_(table_ids)).group_by(Guest.table_id))).all()
    delivered=dict((await db.execute(select(Guest.table_id,func.count(GuestMealService.id)).join(GuestMealService,GuestMealService.guest_id==Guest.id).join(MealService,MealService.id==GuestMealService.service_id).where(Guest.event_id==event.id,MealService.event_id==event.id,Guest.table_id.in_(meal_tables),GuestMealService.fulfillment_status=='served').group_by(Guest.table_id))).all())
    return {tid:dict(assigned=count,admitted=admitted or 0,seated=seated_count or 0,attention=attention_count or 0,delivered=delivered.get(tid,0)) for tid,count,admitted,seated_count,attention_count in rows}


async def attendance_summaries(db,event,guest_filter,table_names,*,writable,configure,allow_unpaid,scope):
    from .meal_attendance import mode,has_headcount,meal_event_reason
    services=(await db.scalars(select(MealService).where(MealService.event_id==event.id).order_by(MealService.created_at,MealService.id))).all()
    result=[]
    for service in services:
        record=aliased(GuestMealService)
        ordered=select(GuestMenuChoice.id).where(GuestMenuChoice.guest_id==Guest.id,GuestMenuChoice.category_id==service.category_id).exists()
        eligible=and_(Guest.rsvp_status!='declined',or_(record.id.is_(None),record.eligibility_status=='eligible'))
        attended=record.attended_at.is_not(None)
        predicates=[eligible,attended,and_(eligible,~attended),ordered,and_(attended,~ordered),record.fulfillment_status=='preparing',record.fulfillment_status=='ready',record.fulfillment_status=='served']
        values=(await db.execute(select(*[func.coalesce(func.sum(case((p,1),else_=0)),0) for p in predicates]).select_from(Guest).outerjoin(record,and_(record.guest_id==Guest.id,record.service_id==service.id)).where(Guest.event_id==event.id,guest_filter))).one()
        recent=(await db.execute(select(Guest.id,Guest.first_name,Guest.last_name,Guest.table_id,record.attended_at).join(record,and_(record.guest_id==Guest.id,record.service_id==service.id)).where(Guest.event_id==event.id,guest_filter,attended).order_by(record.attended_at.desc(),Guest.id.desc()).limit(10))).all()
        counts=dict(zip(['expected','attended','not_yet_attended','ordered','attended_without_order','preparing','ready','delivered'],values))
        result.append(dict(id=service.id,name=service.name,category_id=service.category_id,tracking_mode=mode(service),status=service.status,starts_at=service.starts_at,ends_at=service.ends_at,capacity=service.capacity,scope=scope,can_scan=bool(writable and not meal_event_reason(event) and (event.is_paid or allow_unpaid) and has_headcount(service)),can_configure=configure,**counts,recent_attendees=[dict(guest_id=gid,name=f'{first} {last}'.strip(),table_name=table_names.get(tid) or 'No table',attended_at=at,can_correct=configure) for gid,first,last,tid,at in recent]))
    return result


async def meal_page(db,event,table_ids,*,page,stage,table_id,query):
    status=func.coalesce(GuestMealService.fulfillment_status,'pending')
    statement=select(Guest.id.label('guest_id'),MealService.id.label('service_id')).select_from(Guest).join(GuestMenuChoice,GuestMenuChoice.guest_id==Guest.id).join(MealService,and_(MealService.category_id==GuestMenuChoice.category_id,MealService.event_id==event.id)).outerjoin(GuestMealService,and_(GuestMealService.guest_id==Guest.id,GuestMealService.service_id==MealService.id)).outerjoin(SeatingTable,SeatingTable.id==Guest.table_id).outerjoin(MenuItem,MenuItem.id==GuestMenuChoice.menu_item_id).outerjoin(MenuCombination,MenuCombination.id==GuestMenuChoice.combination_id).where(Guest.event_id==event.id,Guest.table_id.in_(table_ids),MealService.tracking_mode.in_(['orders','both']))
    if table_id!='all':statement=statement.where(Guest.table_id==table_id)
    if stage!='all':statement=statement.where(status.in_(['pending','preparing','ready']) if stage=='outstanding' else status==stage)
    if query:
        q='%'+query.lower()+'%'
        statement=statement.where(or_(func.lower(Guest.first_name+' '+Guest.last_name).like(q),func.lower(SeatingTable.name).like(q),func.lower(MenuItem.name).like(q),func.lower(MenuCombination.name).like(q)))
    statement=statement.distinct().subquery()
    total=await db.scalar(select(func.count()).select_from(statement))
    pairs=(await db.execute(select(statement.c.guest_id,statement.c.service_id).order_by(statement.c.guest_id,statement.c.service_id).offset((page-1)*25).limit(25))).all()
    return set(pairs),total


async def outstanding_meals(db,event_id,table_ids):
    pairs=select(Guest.id,MealService.id).select_from(Guest).join(GuestMenuChoice,GuestMenuChoice.guest_id==Guest.id).join(MealService,and_(MealService.category_id==GuestMenuChoice.category_id,MealService.event_id==event_id)).outerjoin(GuestMealService,and_(GuestMealService.guest_id==Guest.id,GuestMealService.service_id==MealService.id)).where(Guest.event_id==event_id,Guest.table_id.in_(table_ids),MealService.tracking_mode.in_(['orders','both']),func.coalesce(GuestMealService.fulfillment_status,'pending').in_(['pending','preparing','ready'])).distinct().subquery()
    return await db.scalar(select(func.count()).select_from(pairs))
