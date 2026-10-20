"""One queue over canonical menu choices and GuestMealService; no duplicate orders."""
import hashlib
import json
from fastapi import HTTPException
from sqlalchemy import select, func
from ..models import Guest, GuestMenuChoice, MenuItem, MenuCombination, MealService, GuestMealService, Event, GuestServiceActivity

from .meal_attendance import has_orders, meal_event_reason, require_meal_event

RESERVED = ('preparing', 'ready', 'served')
LABELS = {'pending': 'New', 'preparing': 'Preparing', 'ready': 'Ready', 'served': 'Delivered', 'skipped': 'Skipped', 'denied': 'Denied'}


def selection_key(choices):
    return hashlib.sha256(json.dumps(sorted((c.category_id, c.menu_item_id or '', c.combination_id or '') for c in choices)).encode()).hexdigest()


async def meal_requests(db, event, guests, table_names, *, writable=True):
    if not event.menu_enabled or not guests:
        return []
    from ..routers.menu import meal_service_availability
    ids = [g.id for g in guests]
    choices = (await db.execute(select(GuestMenuChoice, MenuItem.name, MenuCombination.name).outerjoin(MenuItem, MenuItem.id == GuestMenuChoice.menu_item_id).outerjoin(MenuCombination, MenuCombination.id == GuestMenuChoice.combination_id).where(GuestMenuChoice.guest_id.in_(ids)))).all()
    selected = {}
    for choice, item, combo in choices:
        selected.setdefault((choice.guest_id, choice.category_id), []).append((choice, item or combo or 'Selection'))
    services = (await db.scalars(select(MealService).where(MealService.event_id == event.id).order_by(MealService.created_at, MealService.id))).all()
    records = {(r.guest_id, r.service_id): r for r in (await db.scalars(select(GuestMealService).where(GuestMealService.guest_id.in_(ids)))).all()}
    used = dict((await db.execute(select(GuestMealService.service_id, func.count()).where(GuestMealService.service_id.in_([s.id for s in services]), GuestMealService.fulfillment_status.in_(RESERVED)).group_by(GuestMealService.service_id))).all()) if services else {}
    rows = []
    for guest in guests:
        for service in services:
            if not has_orders(service):continue
            picks = selected.get((guest.id, service.category_id), [])
            if not picks:
                continue
            record = records.get((guest.id, service.id))
            status = record.fulfillment_status if record else 'pending'
            reserved = bool(record and status in ('preparing', 'ready'))
            available, reason = meal_service_availability(service, used.get(service.id, 0) - int(reserved))
            if guest.rsvp_status == 'declined' or (record and record.eligibility_status != 'eligible'):
                available, reason = 'not_eligible', 'Guest is not eligible'
            elif not guest.admitted:
                available, reason = 'checkin_required', 'Guest must check in first'
            if meal_event_reason(event):
                available, reason = 'event_inactive', meal_event_reason(event)
            if status == 'served':
                available, reason = 'served', 'Delivered'
            if not writable:
                reason = 'View-only access'
            next_status = {'pending': 'preparing', 'preparing': 'ready', 'ready': 'served'}.get(status)
            rows.append(dict(id=f'{guest.id}:{service.id}', guest_id=guest.id, guest_name=f'{guest.first_name} {guest.last_name}'.strip(), table_id=guest.table_id, table_name=table_names.get(guest.table_id) or 'No table', service_id=service.id, service_name=service.name, category_id=service.category_id, choices=[name for _, name in picks], selection_key=selection_key([c for c, _ in picks]), status=status, status_label=LABELS.get(status, status), next_status=next_status, can_progress=bool(writable and next_status and available == 'available'), availability=available, availability_reason=reason, updated_at=record.updated_at if record else None))
    return rows


async def progress_meal(event_id, service_id, guest_id, body, db, actor, *, scoped=False):
    """Caller authorizes. Guest then service row locks serialize choices and capacity."""
    from ..routers.menu import fulfill_category, meal_service_availability
    guest = await db.scalar(select(Guest).where(Guest.id == guest_id).with_for_update().execution_options(populate_existing=True))
    service = await db.scalar(select(MealService).where(MealService.id == service_id).with_for_update().execution_options(populate_existing=True))
    if not guest or guest.event_id != event_id or not service or service.event_id != event_id:
        raise HTTPException(404, 'Guest or meal service not found')
    event = await db.get(Event, event_id)
    require_meal_event(event, actor)
    if scoped:
        from .guest_services import guest_scope
        await guest_scope(event,actor,guest,db,permission='can_manage_meals')
    if not has_orders(service):raise HTTPException(409,'Orders are disabled for this headcount-only meal')
    choices = (await db.scalars(select(GuestMenuChoice).where(GuestMenuChoice.guest_id == guest_id, GuestMenuChoice.category_id == service.category_id))).all()
    if not choices or selection_key(choices) != body.selection_key:
        raise HTTPException(409, 'Meal choices changed. Refresh before continuing')
    record = await db.scalar(select(GuestMealService).where(GuestMealService.service_id == service_id, GuestMealService.guest_id == guest_id))
    status = record.fulfillment_status if record else 'pending'
    if record and record.eligibility_status != 'eligible' or guest.rsvp_status == 'declined':
        raise HTTPException(403, 'Guest is not eligible for this meal service')
    if status == body.status:
        return {'ok': True, 'status': status, 'already_recorded': True}
    if status != body.expected_status or {'pending': 'preparing', 'preparing': 'ready', 'ready': 'served'}.get(status) != body.status:
        raise HTTPException(409, 'Meal progress changed. Refresh before continuing')
    if not guest.admitted:
        raise HTTPException(409, 'Guest must check in first')
    used = await db.scalar(select(func.count()).select_from(GuestMealService).where(GuestMealService.service_id == service_id, GuestMealService.guest_id != guest_id, GuestMealService.fulfillment_status.in_(RESERVED)))
    availability, reason = meal_service_availability(service, used)
    if availability != 'available':
        raise HTTPException(409, reason)
    db.add(GuestServiceActivity(event_id=event_id,actor_id=actor.id,guest_id=guest_id,action='meal_progress',detail={'service_id':service_id,'from':status,'to':body.status}))
    if body.status == 'served':
        result = await fulfill_category(event_id, service.category_id, guest_id, None, db, actor, service=service, enforce_service_limits=True)
        return {**result, 'status': 'served'}
    if not record:
        record = GuestMealService(service_id=service_id, guest_id=guest_id, eligibility_status='eligible')
        db.add(record)
    record.fulfillment_status = body.status
    await db.commit()
    return {'ok': True, 'status': body.status}
