"""Meal attendance is independent from admission, selections and fulfillment."""
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, func
from ..models import Event, Guest, MealService, GuestMealService, GuestMenuChoice, GuestServiceActivity


def mode(service):
    return service.tracking_mode or 'orders'


def has_orders(service):
    return mode(service) in ('orders', 'both')


def has_headcount(service):
    return mode(service) in ('headcount', 'both')


async def headcount_only_categories(db, event_id):
    """A category with only headcount occurrences has no order form."""
    rows=(await db.scalars(select(MealService).where(MealService.event_id==event_id))).all()
    disabled={r.category_id for r in rows if not has_orders(r)}-{r.category_id for r in rows if has_orders(r)}
    return disabled


async def service_summaries(db, event, guests, table_names, *, writable=False, configure=False, scope='Assigned tables'):
    if not event.menu_enabled:
        return []
    services=(await db.scalars(select(MealService).where(MealService.event_id==event.id).order_by(MealService.created_at,MealService.id))).all()
    ids=[g.id for g in guests]
    records=(await db.scalars(select(GuestMealService).where(GuestMealService.guest_id.in_(ids)))).all() if ids else []
    picks=set((await db.execute(select(GuestMenuChoice.guest_id,GuestMenuChoice.category_id).where(GuestMenuChoice.guest_id.in_(ids)))).all()) if ids else set()
    by_id={g.id:g for g in guests};rows=[]
    for service in services:
        entries={r.guest_id:r for r in records if r.service_id==service.id}
        eligible={g.id for g in guests if g.rsvp_status!='declined' and (g.id not in entries or entries[g.id].eligibility_status=='eligible')}
        attended={gid for gid,r in entries.items() if r.attended_at is not None}
        ordered={gid for gid,cid in picks if cid==service.category_id}
        recent=sorted((r for r in entries.values() if r.attended_at),key=lambda r:(r.attended_at,r.guest_id),reverse=True)[:10]
        rows.append(dict(id=service.id,name=service.name,category_id=service.category_id,tracking_mode=mode(service),status=service.status,starts_at=service.starts_at,ends_at=service.ends_at,capacity=service.capacity,scope=scope,can_scan=bool(writable and has_headcount(service)),can_configure=configure,expected=len(eligible),attended=len(attended),not_yet_attended=len(eligible-attended),ordered=len(ordered),attended_without_order=len(attended-ordered),preparing=sum(r.fulfillment_status=='preparing' for r in entries.values()),ready=sum(r.fulfillment_status=='ready' for r in entries.values()),delivered=sum(r.fulfillment_status=='served' for r in entries.values()),recent_attendees=[dict(guest_id=r.guest_id,name=f'{by_id[r.guest_id].first_name} {by_id[r.guest_id].last_name}'.strip(),table_name=table_names.get(by_id[r.guest_id].table_id) or 'No table',attended_at=r.attended_at,can_correct=configure) for r in recent]))
    return rows


async def set_tracking(event_id,service_id,body,db,actor):
    service=await db.scalar(select(MealService).where(MealService.id==service_id,MealService.event_id==event_id).with_for_update().execution_options(populate_existing=True))
    if not service:raise HTTPException(404,'Meal service not found')
    if mode(service)==body.tracking_mode:return {'ok':True,'service_id':service_id,'tracking_mode':mode(service),'already_saved':True}
    if mode(service)!=body.expected_mode:raise HTTPException(409,'Meal settings changed. Refresh before saving')
    if body.tracking_mode=='orders' and await db.scalar(select(func.count()).select_from(GuestMealService).where(GuestMealService.service_id==service.id,GuestMealService.attended_at.is_not(None))):
        raise HTTPException(409,'Attendance is already recorded. Keep Headcount + orders to preserve its visibility')
    if body.tracking_mode=='headcount' and await db.scalar(select(func.count()).select_from(GuestMealService).where(GuestMealService.service_id==service.id,GuestMealService.fulfillment_status.in_(['preparing','ready','served']))):
        raise HTTPException(409,'Orders are already in progress or delivered. Keep Headcount + orders')
    db.add(GuestServiceActivity(event_id=event_id,actor_id=actor.id,action='meal_tracking_mode',detail={'service_id':service_id,'from':mode(service),'to':body.tracking_mode}))
    service.tracking_mode=body.tracking_mode
    await db.commit();return {'ok':True,'service_id':service_id,'tracking_mode':mode(service)}


async def record_attendance(event_id,service_id,token,db,actor,*,scoped=False):
    from .guest_services import guest_scope
    from ..routers.menu import meal_service_availability
    event=await db.get(Event,event_id)
    if not event:raise HTTPException(404,'Event not found')
    if not event.is_paid and not actor.is_platform_superadmin:raise HTTPException(402,'This event needs an Event Pass for guest operations')
    if not event.menu_enabled or event.status!='active':raise HTTPException(409,'Meal attendance requires an active event with meals enabled')
    guest=await db.scalar(select(Guest).where(Guest.event_id==event_id,Guest.qr_token==token).with_for_update().execution_options(populate_existing=True))
    if not guest:raise HTTPException(404,'Pass not found in this event')
    if scoped:await guest_scope(event,actor,guest,db,permission='can_manage_meals')
    service=await db.scalar(select(MealService).where(MealService.id==service_id,MealService.event_id==event_id).with_for_update().execution_options(populate_existing=True))
    if not service:raise HTTPException(404,'Meal service not found')
    if not has_headcount(service):raise HTTPException(409,'Attendance is disabled for this meal; choose Headcount only or Headcount + orders')
    record=await db.scalar(select(GuestMealService).where(GuestMealService.service_id==service.id,GuestMealService.guest_id==guest.id))
    if record and record.attended_at:
        return {'ok':True,'service_id':service_id,'already_counted':True,'guest_name':f'{guest.first_name} {guest.last_name}'.strip(),'attended_at':record.attended_at,'message':'Already counted for this meal'}
    if not guest.admitted:raise HTTPException(409,'Check the guest into the event first; a meal scan does not admit them')
    if guest.rsvp_status=='declined' or record and record.eligibility_status!='eligible':raise HTTPException(403,'Guest is not eligible for this meal')
    count=await db.scalar(select(func.count()).select_from(GuestMealService).where(GuestMealService.service_id==service.id,GuestMealService.attended_at.is_not(None)))
    availability,reason=meal_service_availability(service,count)
    if availability!='available':raise HTTPException(409,reason)
    if not record:
        record=GuestMealService(service_id=service.id,guest_id=guest.id,eligibility_status='eligible',fulfillment_status='pending');db.add(record)
    record.attended_at=datetime.utcnow();record.attended_by_user_id=actor.id
    db.add(GuestServiceActivity(event_id=event_id,actor_id=actor.id,guest_id=guest.id,action='meal_attendance',detail={'service_id':service.id}))
    await db.commit()
    return {'ok':True,'service_id':service_id,'already_counted':False,'guest_name':f'{guest.first_name} {guest.last_name}'.strip(),'attended_at':record.attended_at,'message':'Meal attendance recorded; order and delivery unchanged'}


async def correct_attendance(event_id,service_id,guest_id,body,db,actor):
    # Same guest -> service lock ordering as recording and fulfillment.
    guest=await db.scalar(select(Guest).where(Guest.id==guest_id,Guest.event_id==event_id).with_for_update())
    service=await db.scalar(select(MealService).where(MealService.id==service_id,MealService.event_id==event_id).with_for_update())
    if not guest or not service:raise HTTPException(404,'Guest or meal service not found')
    if len(body.reason.strip())<8:raise HTTPException(422,'Give a meaningful correction reason')
    record=await db.scalar(select(GuestMealService).where(GuestMealService.guest_id==guest_id,GuestMealService.service_id==service_id))
    expected=body.expected_attended_at
    if expected.tzinfo:expected=expected.astimezone(timezone.utc).replace(tzinfo=None)
    if not record or not record.attended_at or record.attended_at!=expected:raise HTTPException(409,'Attendance changed. Refresh before correcting it')
    db.add(GuestServiceActivity(event_id=event_id,actor_id=actor.id,guest_id=guest_id,action='meal_attendance_corrected',detail={'service_id':service_id,'attended_at':record.attended_at.isoformat(),'recorded_by':record.attended_by_user_id,'reason':body.reason.strip()}))
    record.attended_at=None;record.attended_by_user_id=None
    await db.commit();return {'ok':True,'service_id':service_id,'corrected':True,'message':'Attendance corrected; order and delivery unchanged'}
