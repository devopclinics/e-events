"""PIN-protected, event-scoped guest entry. No passes/tokens or service data exposed."""
import hashlib
import json
import secrets
from datetime import datetime, timedelta
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Header, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import Event, Organization, Guest, SharedGuestSheet, GuestSheetSession, GuestSheetBatch, User
from ..auth import require_guest_manage_access
from ..entitlements import assert_within_guest_cap
from ..ratelimit import rate_limit
from .guests import _normalize_phone, _norm_person_name

router = APIRouter()

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def pin_hash(pin, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ':' + hashlib.scrypt(pin.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Settings(Strict):
    enabled: bool = True
    allow_edit: bool = False
    reset_pin: bool = False

class Unlock(Strict):
    pin: str = Field(pattern=r'^[0-9]{6}$')

class Row(Strict):
    id: str | None = Field(default=None, max_length=36)
    revision: str | None = Field(default=None, max_length=64)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: str = Field(default='', max_length=255)
    phone: str = Field(default='', max_length=40)

    @field_validator('first_name', 'last_name')
    @classmethod
    def name(cls, value):
        value=value.strip()
        if not value: raise ValueError('Name is required')
        return value

    @field_validator('email')
    @classmethod
    def email_valid(cls, value):
        import re
        value=value.strip().lower()
        if value and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value): raise ValueError('Enter a valid email')
        return value

    @field_validator('phone')
    @classmethod
    def phone_valid(cls, value):
        value=value.strip()
        if value:
            value=_normalize_phone(value)
            if not value: raise ValueError('Use a valid phone number with country code')
        return value or ''

class Batch(Strict):
    request_key: str = Field(min_length=16, max_length=80)
    rows: list[Row] = Field(min_length=1, max_length=100)

def no_cache(response):
    response.headers['Cache-Control']='no-store'
    response.headers['Referrer-Policy']='no-referrer'

def config(row):
    return {'enabled':row.enabled,'allow_edit':row.allow_edit,'url':'/guest-sheet/'+row.token}

@router.get('/events/{event_id}/guest-sheet')
async def get_settings(event_id: str, response: Response, db: AsyncSession=Depends(get_db), _:User=Depends(require_guest_manage_access)):
    no_cache(response)
    row=await db.get(SharedGuestSheet,event_id)
    return config(row) if row else {'enabled':False,'allow_edit':False,'url':None}

@router.put('/events/{event_id}/guest-sheet')
async def save_settings(event_id: str, body:Settings, response:Response, db:AsyncSession=Depends(get_db), _:User=Depends(require_guest_manage_access)):
    no_cache(response)
    await db.execute(select(Event).where(Event.id==event_id).with_for_update())
    row=await db.get(SharedGuestSheet,event_id);pin=None
    if not row:
        pin=f'{secrets.randbelow(1000000):06d}'
        row=SharedGuestSheet(event_id=event_id,token=secrets.token_urlsafe(32),pin_hash=pin_hash(pin))
        db.add(row);await db.flush()
    elif body.reset_pin:
        pin=f'{secrets.randbelow(1000000):06d}';row.pin_hash=pin_hash(pin)
        row.version+=1;row.failed_attempts=0;row.attempt_window=datetime.utcnow()
    if row.enabled!=body.enabled: row.version+=1
    row.enabled=body.enabled;row.allow_edit=body.allow_edit
    await db.commit()
    return {**config(row),'pin':pin}

async def available(token, db, lock=False):
    sheet=await db.scalar(select(SharedGuestSheet).where(SharedGuestSheet.token==token))
    if not sheet: raise HTTPException(404,'Shared guest sheet unavailable')
    event_query=select(Event).where(Event.id==sheet.event_id)
    if lock: event_query=event_query.with_for_update()
    event=await db.scalar(event_query)
    if lock:
        # Use the same Event -> Sheet order as organiser settings to avoid a
        # reset/disable racing a save or creating a lock-order deadlock.
        sheet=await db.scalar(select(SharedGuestSheet).where(SharedGuestSheet.token==token).with_for_update().execution_options(populate_existing=True))
    if not sheet or not sheet.enabled: raise HTTPException(404,'Shared guest sheet unavailable')
    org=await db.get(Organization,event.org_id) if event else None
    if not event or event.status!='active' or not org or not org.is_active: raise HTTPException(403,'This event is not accepting shared guest entries')
    return sheet,event

@router.post('/guest-sheets/{token}/unlock',dependencies=[Depends(rate_limit(limit=20,window=600,scope='guest_sheet_unlock_ip',key='client_ip'))])
async def unlock(token:str,body:Unlock,response:Response,db:AsyncSession=Depends(get_db)):
    no_cache(response);sheet,event=await available(token,db,True);now=datetime.utcnow()
    if (now-sheet.attempt_window).total_seconds()>=600: sheet.attempt_window=now;sheet.failed_attempts=0
    if sheet.failed_attempts>=10: raise HTTPException(429,'Too many PIN attempts. Try again after ten minutes or ask the organiser to reset the PIN.')
    if not secrets.compare_digest(sheet.pin_hash,pin_hash(body.pin,sheet.pin_hash.split(':')[0])):
        sheet.failed_attempts+=1;await db.commit();raise HTTPException(401,'Incorrect PIN')
    secret=secrets.token_urlsafe(32)
    # Expired sessions are disposable; raw session secrets are never persisted.
    from sqlalchemy import delete
    await db.execute(delete(GuestSheetSession).where(GuestSheetSession.expires_at<now))
    db.add(GuestSheetSession(token_hash=digest(secret),event_id=event.id,version=sheet.version,expires_at=now+timedelta(hours=8)))
    await db.commit()
    return {'session':secret,'event_name':event.name,'allow_edit':sheet.allow_edit}

async def access(token, session, db, lock=False):
    sheet,event=await available(token,db,lock)
    auth=await db.get(GuestSheetSession,digest(session or ''))
    if not auth or auth.event_id!=sheet.event_id or auth.version!=sheet.version or auth.expires_at<=datetime.utcnow(): raise HTTPException(401,'Enter the PIN to unlock this sheet')
    return sheet,event

def revision(g):
    return digest(json.dumps([g.first_name,g.last_name,g.email or '',g.phone or ''],ensure_ascii=False))

def guest_row(g):
    return {'id':g.id,'first_name':g.first_name,'last_name':g.last_name,'email':g.email or '','phone':g.phone or '','revision':revision(g)}

@router.get('/guest-sheets/{token}/rows',dependencies=[Depends(rate_limit(limit=120,window=60,scope='guest_sheet_read',key='client_ip'))])
async def list_rows(token:str,response:Response,offset:int=0,limit:int=100,x_guest_sheet_session:Annotated[str|None,Header()]=None,db:AsyncSession=Depends(get_db)):
    no_cache(response);sheet,event=await access(token,x_guest_sheet_session,db)
    if offset<0 or not 1<=limit<=100: raise HTTPException(422,'Invalid page')
    rows=(await db.scalars(select(Guest).where(Guest.event_id==event.id).order_by(Guest.last_name,Guest.first_name,Guest.id).offset(offset).limit(limit))).all()
    total=await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id==event.id))
    return {'event_name':event.name,'allow_edit':sheet.allow_edit,'rows':[guest_row(g) for g in rows],'total':total}

@router.post('/guest-sheets/{token}/rows',dependencies=[Depends(rate_limit(limit=30,window=60,scope='guest_sheet_write',key='client_ip'))])
async def save_rows(token:str,body:Batch,response:Response,x_guest_sheet_session:Annotated[str|None,Header()]=None,db:AsyncSession=Depends(get_db)):
    no_cache(response);sheet,event=await access(token,x_guest_sheet_session,db,True)
    # access() holds the event and sheet locks until this batch commits.
    fingerprint=digest(json.dumps([r.model_dump() for r in body.rows],sort_keys=True))
    previous=await db.scalar(select(GuestSheetBatch).where(GuestSheetBatch.event_id==event.id,GuestSheetBatch.request_key==body.request_key))
    if previous:
        if previous.payload_hash!=fingerprint: raise HTTPException(409,'This request key was already used for different rows')
        return {**previous.result,'already_saved':True}
    existing=(await db.scalars(select(Guest).where(Guest.event_id==event.id))).all()
    by_id={g.id:g for g in existing};by_name={(_norm_person_name(g.first_name),_norm_person_name(g.last_name)):g.id for g in existing}
    added=updated=0;duplicates=[];seen=set()
    for index,row in enumerate(body.rows):
        key=(_norm_person_name(row.first_name),_norm_person_name(row.last_name))
        if row.id:
            if not sheet.allow_edit: raise HTTPException(403,'Editing existing guests is not enabled')
            if row.id in seen: raise HTTPException(422,'A guest can only appear once per batch')
            seen.add(row.id);g=by_id.get(row.id)
            if not g: raise HTTPException(404,'Guest not found on this sheet')
            if not row.revision or row.revision!=revision(g): raise HTTPException(409,'A guest changed since you opened the sheet. Refresh before editing.')
            if key in by_name and by_name[key]!=g.id: raise HTTPException(409,'Another guest already has this name. Ask the organiser to review.')
            by_name.pop((_norm_person_name(g.first_name),_norm_person_name(g.last_name)),None)
            for field in ['first_name','last_name','email','phone']:setattr(g,field,getattr(row,field))
            by_name[key]=g.id;updated+=1
        else:
            if key in by_name: duplicates.append(index+1);continue
            assert_within_guest_cap(event,len(existing)+added)
            g=Guest(event_id=event.id,first_name=row.first_name,last_name=row.last_name,email=row.email,phone=row.phone or None,is_test=event.is_test is True)
            db.add(g);await db.flush();by_name[key]=g.id;added+=1
    result={'added':added,'updated':updated,'duplicate_rows':duplicates}
    db.add(GuestSheetBatch(event_id=event.id,request_key=body.request_key,payload_hash=fingerprint,result=result))
    await db.commit()
    return result
