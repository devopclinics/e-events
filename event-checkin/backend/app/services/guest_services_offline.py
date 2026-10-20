"""Replay positive observations; stale or unauthorised actions require staff review."""
import hashlib,json
from datetime import datetime,timezone,timedelta
from typing import Literal
from pydantic import BaseModel,Field,ConfigDict,model_validator
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from ..models import (Event,GuestServiceOfflineReceipt,GuestSeatingPresence,GuestMealService,
    MealService,GuestMenuChoice,GuestServiceActivity)
from .guest_services import member
from .meal_attendance import record_attendance
from .meal_queue import selection_key


class OfflineActionIn(BaseModel):
    model_config=ConfigDict(extra='forbid')
    client_key: str=Field(min_length=16,max_length=80)
    action: Literal['seated','served','attendance']
    guest_id: str=Field(min_length=1,max_length=36)
    table_id: str=Field(min_length=1,max_length=36)
    service_id: str | None=Field(default=None,max_length=36)
    captured_at: datetime
    expected_seated_at: datetime | None=None
    expected_record_updated_at: datetime | None=None
    expected_selection_key: str | None=Field(default=None,max_length=64)

    @model_validator(mode='after')
    def action_target(self):
        if self.action=='seated' and self.service_id:raise ValueError('Seating does not target a meal service')
        if self.action!='seated' and not self.service_id:raise ValueError('Choose a meal service for this action')
        return self


def naive(value):
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value and value.tzinfo else value


async def replay(event_id,body,db,actor):
    from ..routers.guest_services import event_and_guest
    from ..routers.menu import fulfill_category
    event=await db.get(Event,event_id);await member(event,actor,db)
    payload_hash=hashlib.sha256(json.dumps(body.model_dump(mode='json'),sort_keys=True).encode()).hexdigest()
    filters=(GuestServiceOfflineReceipt.event_id==event_id,GuestServiceOfflineReceipt.actor_id==actor.id,GuestServiceOfflineReceipt.client_key==body.client_key)
    receipt=await db.scalar(select(GuestServiceOfflineReceipt).where(*filters))
    if receipt:
        if receipt.payload_hash!=payload_hash:raise HTTPException(409,'This queue key already belongs to another action')
        return {**receipt.result,'already_synced':True}
    captured=naive(body.captured_at);now=datetime.utcnow()
    if captured<now-timedelta(hours=12) or captured>now+timedelta(minutes=5):raise HTTPException(409,'Queued action expired or has an invalid clock; review it online')
    event,guest=await event_and_guest(event_id,body.guest_id,actor,db,permission='table_id' if body.action=='seated' else 'can_manage_meals')
    # Guest row lock also serializes concurrent retries for this queue key.
    receipt=await db.scalar(select(GuestServiceOfflineReceipt).where(*filters))
    if receipt:
        if receipt.payload_hash!=payload_hash:raise HTTPException(409,'This queue key already belongs to another action')
        return {**receipt.result,'already_synced':True}
    if guest.table_id!=body.table_id:raise HTTPException(409,'Guest moved tables; review this queued action')
    if not guest.admitted:raise HTTPException(409,'Guest must already be admitted; offline recording does not check them in')
    if event.status!='active':raise HTTPException(409,'Event is not active; review the queued action')
    if body.action=='seated':
        presence=await db.get(GuestSeatingPresence,guest.id)
        observed=presence.seated_at if presence and presence.table_id==guest.table_id else None
        if observed!=naive(body.expected_seated_at):raise HTTPException(409,'Seating changed since this action was queued')
        if not presence:
            db.add(GuestSeatingPresence(guest_id=guest.id,table_id=guest.table_id,seated_by=actor.id))
        elif presence.table_id!=guest.table_id:
            presence.table_id=guest.table_id;presence.seated_by=actor.id;presence.seated_at=now
    else:
        service=await db.scalar(select(MealService).where(MealService.id==body.service_id,MealService.event_id==event_id).with_for_update().execution_options(populate_existing=True))
        if not service:raise HTTPException(404,'Meal service not found')
        record=await db.scalar(select(GuestMealService).where(GuestMealService.guest_id==guest.id,GuestMealService.service_id==service.id))
        if (record.updated_at if record else None)!=naive(body.expected_record_updated_at):raise HTTPException(409,'Meal record changed; review the queued action')
        if body.action=='served':
            if guest.rsvp_status=='declined':raise HTTPException(409,'Guest is not eligible for this meal')
            choices=(await db.scalars(select(GuestMenuChoice).where(GuestMenuChoice.guest_id==guest.id,GuestMenuChoice.category_id==service.category_id))).all()
            if not body.expected_selection_key or selection_key(choices)!=body.expected_selection_key:raise HTTPException(409,'Meal selections changed; review the queued delivery')
            await fulfill_category(event_id,service.category_id,guest.id,None,db,actor,service=service,enforce_service_limits=True,commit=False)
        else:
            await record_attendance(event_id,service.id,guest.qr_token,db,actor,scoped=True,commit=False)
    db.add(GuestServiceActivity(event_id=event_id,actor_id=actor.id,guest_id=guest.id,action='offline_'+body.action,detail={'table_id':guest.table_id,'service_id':body.service_id,'captured_at':captured.isoformat(),'synced_at':now.isoformat()}))
    await db.flush()
    latest=await db.scalar(select(GuestMealService).where(GuestMealService.guest_id==guest.id,GuestMealService.service_id==body.service_id)) if body.service_id else None
    result={'record_updated_at':latest.updated_at.isoformat() if latest else None,'ok':True,'action':body.action,'guest_id':guest.id,'service_id':body.service_id,'already_synced':False}
    db.add(GuestServiceOfflineReceipt(event_id=event_id,actor_id=actor.id,client_key=body.client_key,guest_id=guest.id,action=body.action,payload_hash=payload_hash,result=result))
    try:await db.commit()
    except IntegrityError:
        await db.rollback()
        receipt=await db.scalar(select(GuestServiceOfflineReceipt).where(*filters))
        if receipt and receipt.payload_hash==payload_hash:return {**receipt.result,'already_synced':True}
        raise HTTPException(409,'This queue key was used by another action')
    return result
