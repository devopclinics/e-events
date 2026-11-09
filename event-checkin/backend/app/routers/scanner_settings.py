"""Event-admin controls for focused scanner actions and session bindings."""
import hashlib
import json
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from sqlalchemy import select
from app.auth import require_event_admin
from app.database import get_db
from app.models import Event,Zone,ExperienceWorkflow,ExperienceStep
router=APIRouter()

class ScannerPresentation(BaseModel):
    focused: bool = True
    admission_step_ids: list[str] = Field(default_factory=list,max_length=100)
    zone_step_ids: dict[str,list[str]] = Field(default_factory=dict)
    attendance_step_ids: dict[str,str] = Field(default_factory=dict)
    revision: str = Field(min_length=64,max_length=64)

def revision(event):
    prefs=event.setup_preferences or {}
    return hashlib.sha256(json.dumps([prefs.get('scanner_presentation',{}),prefs.get('session_attendance_steps',{})],sort_keys=True).encode()).hexdigest()

async def state(event_id,db):
    event=await db.get(Event,event_id)
    if not event:raise HTTPException(404,'Event not found')
    zones=(await db.scalars(select(Zone).where(Zone.event_id==event_id,Zone.is_active.is_(True)).order_by(Zone.sort_order,Zone.name))).all()
    steps=(await db.scalars(select(ExperienceStep).join(ExperienceWorkflow).where(ExperienceWorkflow.event_id==event_id,ExperienceWorkflow.status=='published',ExperienceStep.enabled.is_(True)).order_by(ExperienceStep.sort_order))).all()
    return event,zones,steps

def output(event,zones,steps):
    prefs=event.setup_preferences or {}
    return {'focused':bool((prefs.get('scanner_presentation') or {}).get('focused',False)),
        'admission_step_ids':(prefs.get('scanner_presentation') or {}).get('admission_step_ids',[]),
        'zone_step_ids':(prefs.get('scanner_presentation') or {}).get('zone_step_ids',{}),
        'attendance_step_ids':prefs.get('session_attendance_steps',{}),'revision':revision(event),
        'zones':[{'id':z.id,'name':z.name} for z in zones],
        'steps':[{'id':s.id,'title':s.title,'type':s.type,'required':s.required,'blocks_checkin':s.blocks_checkin} for s in steps]}

@router.get('/{event_id}/scanner-presentation')
async def get_presentation(event_id:str,db=Depends(get_db),user=Depends(require_event_admin)):
    return output(*(await state(event_id,db)))

@router.put('/{event_id}/scanner-presentation')
async def save_presentation(event_id:str,body:ScannerPresentation,db=Depends(get_db),user=Depends(require_event_admin)):
    await db.scalar(select(Event).where(Event.id==event_id).with_for_update())
    event,zones,steps=await state(event_id,db)
    if body.revision!=revision(event):raise HTTPException(409,'Scanner settings changed. Reload them before saving.')
    zone_ids={z.id for z in zones};by_id={s.id:s for s in steps}
    if (set(body.zone_step_ids)|set(body.attendance_step_ids))-zone_ids:raise HTTPException(422,'Choose active zones from this event')
    if len(body.zone_step_ids)>100 or len(body.attendance_step_ids)>100:raise HTTPException(422,'Too many zones')
    for ids in [body.admission_step_ids,*body.zone_step_ids.values()]:
        if len(ids)>100 or any(s not in by_id or by_id[s].type=='session_attendance' for s in ids):
            raise HTTPException(422,'Additional actions must be non-session steps from the published event workflow')
    bindings={k:v for k,v in body.attendance_step_ids.items() if v}
    if len(set(bindings.values()))!=len(bindings):raise HTTPException(422,'A session can be assigned to only one zone')
    if any(s not in by_id or by_id[s].type!='session_attendance' for s in bindings.values()):raise HTTPException(422,'Choose a published session attendance step from this event')
    event.setup_preferences={**(event.setup_preferences or {}),'scanner_presentation':{'focused':body.focused,'admission_step_ids':list(dict.fromkeys(body.admission_step_ids)),'zone_step_ids':{k:list(dict.fromkeys(v)) for k,v in body.zone_step_ids.items()}},'session_attendance_steps':bindings}
    await db.commit();await db.refresh(event)
    return output(event,zones,steps)
