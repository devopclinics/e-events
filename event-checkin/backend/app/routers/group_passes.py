import uuid
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.auth import require_official, require_guest_manage_access, require_guest_view_access, _org_role
from app.models import (Guest, Event, EventUser, Zone, Gate, GuestGroupPass, GroupPassMember, GroupPassRedemption, GroupPassConfigAudit, GuestSessionAccess, GuestTagLink)
from app.services.group_passes import members, used_guests, claim_active

router=APIRouter()

class GroupConfig(BaseModel):
    enabled: bool = False
    admission_limit: int | None = Field(default=None, ge=1, le=500, strict=True)

class GroupEntry(BaseModel):
    request_id: uuid.UUID
    quantity: int = Field(default=1, ge=1, le=50, strict=True)
    zone_id: str | None = None
    gate_id: str | None = None

async def guest_for_event(event_id,guest_id,db):
    guest=await db.get(Guest,guest_id)
    if not guest or guest.event_id!=event_id:raise HTTPException(404,'Guest not found')
    return guest

async def snapshot(db,guest,config):
    from app.models import Zone
    zones=(await db.scalars(select(Zone).where(Zone.event_id==guest.event_id,Zone.is_active.is_(True)).order_by(Zone.sort_order))).all()
    counts=[{'zone_id':None,'name':'Event entry','used':len(await used_guests(db,guest.id))}]
    counts += [{'zone_id':z.id,'name':z.name,'used':len(await used_guests(db,guest.id,z.id))} for z in zones]
    return {'enabled':bool(config and config.enabled),'admission_limit':config.admission_limit if config else None,'group_name':f'{guest.first_name} {guest.last_name}'.strip(),'counts':counts}

@router.get('/events/{event_id}/guests/{guest_id}/group-pass')
async def get_config(event_id:str,guest_id:str,db:AsyncSession=Depends(get_db),actor=Depends(require_guest_view_access)):
    g=await guest_for_event(event_id,guest_id,db);c=await db.get(GuestGroupPass,guest_id)
    result=await snapshot(db,g,c)
    rows=(await db.scalars(select(GroupPassRedemption).where(GroupPassRedemption.pass_guest_id==guest_id).order_by(GroupPassRedemption.created_at.desc()).limit(20))).all()
    result['history']=[{'time':r.created_at,'actor_id':r.actor_id,**r.result} for r in rows]
    return result

@router.put('/events/{event_id}/guests/{guest_id}/group-pass')
async def set_config(event_id:str,guest_id:str,body:GroupConfig,db:AsyncSession=Depends(get_db),actor=Depends(require_guest_manage_access)):
    g=await guest_for_event(event_id,guest_id,db)
    c=await db.scalar(select(GuestGroupPass).where(GuestGroupPass.guest_id==guest_id).with_for_update())
    event=await db.get(Event,event_id)
    if body.enabled and (g.is_junior or event.junior_guardian_handoff_enabled):raise HTTPException(409,'Use individual passes for guardian-verified attendees.')
    if body.enabled and not body.admission_limit:raise HTTPException(422,'Set a positive admission limit before enabling this shared QR.')
    before={'enabled':bool(c and c.enabled),'admission_limit':c.admission_limit if c else None}
    if c:
        allocated=await members(db,guest_id)
        if body.admission_limit and body.admission_limit < len(allocated):raise HTTPException(409,f'Limit cannot be lower than the {len(allocated)} existing group attendee records.')
    else:
        # No claims can exist before the configuration row exists.
        await db.scalar(select(Guest).where(Guest.id==guest_id).with_for_update())
        c=await db.get(GuestGroupPass,guest_id)
        if c:raise HTTPException(409,'Group settings changed. Refresh and try again.')
        c=GuestGroupPass(guest_id=guest_id,event_id=event_id);db.add(c);await db.flush()
        db.add(GroupPassMember(pass_guest_id=guest_id,guest_id=guest_id,slot=1))
    c.enabled=body.enabled;c.admission_limit=body.admission_limit;c.updated_by=actor.id
    after={'enabled':c.enabled,'admission_limit':c.admission_limit}
    db.add(GroupPassConfigAudit(pass_guest_id=guest_id,actor_id=actor.id,before=before,after=after));await db.commit()
    return await snapshot(db,g,c)

async def scan_context(qr_token,db,actor,zone_id=None,gate_id=None):
    g=await db.scalar(select(Guest).where(Guest.qr_token==qr_token))
    if not g:raise HTTPException(404,'Pass not found')
    e=await db.get(Event,g.event_id)
    if not e or e.status!='active':raise HTTPException(409,'This event is not active')
    if not actor.is_platform_superadmin:
        role=await _org_role(actor,e.org_id,db)
        if not role:raise HTTPException(403,'You are not assigned to this event')
        if role=='staff' and not await db.scalar(select(EventUser.id).where(EventUser.event_id==e.id,EventUser.user_id==actor.id)):raise HTTPException(403,'You are not assigned to this event')
    if gate_id:
        gate=await db.get(Gate,gate_id)
        if not gate or gate.event_id!=e.id or not gate.is_active:raise HTTPException(404,'Gate not found')
        if gate.direction=='out':raise HTTPException(409,'Shared group QR supports entry only')
        zone_id=gate.zone_id
    zone=await db.get(Zone,zone_id) if zone_id else None
    if zone_id and (not zone or zone.event_id!=e.id or not zone.is_active):raise HTTPException(404,'Zone not found')
    if zone and zone.direction_mode=='exit':raise HTTPException(409,'Shared group QR supports entry only')
    from app.services.guest_services import enforce_scoped_scan
    await enforce_scoped_scan(e,actor,db,guest=g,operation='zone' if zone else 'checkin',zone_id=zone_id)
    return g,e,zone

@router.get('/scan/{qr_token}/group-pass')
async def preflight(qr_token:str,zone_id:str|None=None,gate_id:str|None=None,db:AsyncSession=Depends(get_db),actor=Depends(require_official)):
    g,e,z=await scan_context(qr_token,db,actor,zone_id,gate_id);c=await db.get(GuestGroupPass,g.id)
    if not c or not c.enabled:return {'enabled':False}
    used=len(await used_guests(db,g.id,z.id if z else None))
    return {'enabled':True,'group_name':f'{g.first_name} {g.last_name}'.strip(),'admission_limit':c.admission_limit,'used':used,'remaining':max(0,(c.admission_limit or 0)-used),'scope':z.name if z else 'Event entry','zone_id':z.id if z else None}

@router.post('/scan/{qr_token}/group-pass')
async def enter_group(qr_token:str,body:GroupEntry,tasks:BackgroundTasks,db:AsyncSession=Depends(get_db),actor=Depends(require_official)):
    g,e,z=await scan_context(qr_token,db,actor,body.zone_id,body.gate_id)
    # Event first: same order as Dinner seating and shared across group caps.
    await db.scalar(select(Event).where(Event.id==e.id).with_for_update())
    c=await db.scalar(select(GuestGroupPass).where(GuestGroupPass.guest_id==g.id).with_for_update().execution_options(populate_existing=True))
    if not c or not c.enabled or not c.admission_limit:raise HTTPException(409,'Shared group admission is not enabled with a limit')
    scope=z.id if z else 'event';request_id=str(body.request_id)
    prior=await db.get(GroupPassRedemption,request_id)
    if prior:
        if prior.pass_guest_id!=g.id or prior.scope!=scope or prior.result['admitted_count']!=body.quantity:raise HTTPException(409,'This request identifier belongs to a different admission')
        return {**prior.result,'replayed':True}
    if g.is_junior or e.junior_guardian_handoff_enabled:raise HTTPException(409,'Use individual passes for guardian-verified attendees.')
    if g.rsvp_status=='declined':raise HTTPException(409,'This group registration is cancelled')
    if z:
        from app.services.session_access import session_decision
        allowed,reason=await session_decision(e,g,z.id,db)
        if not allowed:raise HTTPException(409,reason)
    used=await used_guests(db,g.id,z.id if z else None)
    if body.quantity > c.admission_limit-len(used):raise HTTPException(409,f'Only {max(0,c.admission_limit-len(used))} admissions remain for this session.')
    rows=list(await members(db,g.id));available=[r for r in rows if r.guest_id not in used];local_tasks=BackgroundTasks();admitted=[]
    # Scanner helpers commit their unit of work. Savepoints prevent those commits
    # from releasing this outer transaction's group lock or partially admitting a batch.
    extra=max(0,body.quantity-len(available))
    from app.entitlements import assert_within_guest_cap
    count=await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id==e.id)) or 0
    assert_within_guest_cap(e,count,adding=extra)
    # Establish a real write transaction before helper savepoints (also on SQLite).
    await db.execute(text('UPDATE guest_group_passes SET enabled=enabled WHERE guest_id=:guest_id'), {'guest_id':g.id})
    connection=await db.connection()
    inner=AsyncSession(bind=connection,expire_on_commit=False,join_transaction_mode='create_savepoint')
    token=claim_active.set(True)
    try:
        for index in range(body.quantity):
            if index < len(available):member=await db.get(Guest,available[index].guest_id)
            else:
                slot=len(rows)+1
                if slot>c.admission_limit:raise HTTPException(409,'The group attendee limit has been reached')
                member=Guest(event_id=e.id,first_name=g.first_name,last_name=(f'{g.last_name} · Group guest {slot}')[:100],rsvp_status=g.rsvp_status,is_test=g.is_test,household_id=g.household_id,ticket_type_id=g.ticket_type_id,assigned_table_group_id=g.assigned_table_group_id,sms_consent=False,whatsapp_consent=False)
                db.add(member);await db.flush();row=GroupPassMember(pass_guest_id=g.id,guest_id=member.id,slot=slot);db.add(row);rows.append(row)
                for rule in (await db.scalars(select(GuestSessionAccess).where(GuestSessionAccess.guest_id==g.id))).all():db.add(GuestSessionAccess(event_id=e.id,guest_id=member.id,zone_id=rule.zone_id,decision=rule.decision))
                for tag in (await db.scalars(select(GuestTagLink).where(GuestTagLink.guest_id==g.id))).all():db.add(GuestTagLink(guest_id=member.id,tag_id=tag.tag_id))
                await db.flush()
            if z and member.id!=g.id:
                source=await db.scalar(select(GuestSessionAccess).where(GuestSessionAccess.guest_id==g.id,GuestSessionAccess.zone_id==z.id))
                target=await db.scalar(select(GuestSessionAccess).where(GuestSessionAccess.guest_id==member.id,GuestSessionAccess.zone_id==z.id))
                if target:target.decision=source.decision if source else 'review'
                elif source:db.add(GuestSessionAccess(event_id=e.id,guest_id=member.id,zone_id=z.id,decision=source.decision))
                await db.flush()
            from app.routers.scanner import scan_qr,scan_qr_zone
            from app.schemas import ScanZoneRequest
            if body.gate_id:
                from app.routers.classify import gate_scan
                from app.schemas import GateScanRequest
                result=await gate_scan(e.id,body.gate_id,GateScanRequest(qr_token=member.qr_token),local_tasks,inner,actor)
            elif z:result=await scan_qr_zone(member.qr_token,ScanZoneRequest(zone_id=z.id,direction='in'),local_tasks,inner,actor)
            else:result=await scan_qr(member.qr_token,local_tasks,None,inner,actor)
            if getattr(result,'denied',False) or result.status not in ('ok','admitted','allowed'):
                raise HTTPException(409,getattr(result,'deny_reason',None) or getattr(result,'message',None) or 'Group admission denied')
            admitted.append({'guest_id':member.id,'name':f'{member.first_name} {member.last_name}'.strip(),'table_name':getattr(result,'table_name',None),'seat_number':getattr(result,'seat_number',None)})
        await inner.close()
        result={'status':'group_admitted','group_name':f'{g.first_name} {g.last_name}'.strip(),'scope':z.name if z else 'Event entry','admitted_count':body.quantity,'used':len(used)+body.quantity,'admission_limit':c.admission_limit,'remaining':c.admission_limit-len(used)-body.quantity,'members':admitted,'message':f'{body.quantity} group attendee(s) checked in.'}
        db.add(GroupPassRedemption(request_id=request_id,pass_guest_id=g.id,scope=scope,actor_id=actor.id,result=result));await db.commit()
        tasks.tasks.extend(local_tasks.tasks)
        return result
    except Exception:
        await inner.close();await db.rollback();raise
    finally:claim_active.reset(token)
