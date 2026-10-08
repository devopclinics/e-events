"""Independent event forms. Public access uses the existing personal GuestHub token."""
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth import require_event_admin
from ..database import get_db
from ..models import Event, Guest, User, Zone, TicketType, ExperienceStep, ExperienceWorkflow, EventForm, EventFormRevision, EventFormSubmission, EventConsentAuthority
from ..services import event_forms as service
from .experience import _guest_by_token, _assert_experience_plan

router = APIRouter()


class Question(BaseModel):
    model_config = ConfigDict(extra='forbid')
    key: str = Field(pattern=r'^[a-z][a-z0-9_]{0,39}$')
    label: str = Field(min_length=1, max_length=300)
    type: Literal['text', 'textarea', 'select', 'checkbox'] = 'text'
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=30)


class Definition(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=20000)
    kind: Literal['consent', 'information'] = 'consent'
    required: bool = True
    timing: Literal['before_arrival', 'after_admission'] = 'before_arrival'
    signer_policy: Literal['adult_or_guardian', 'guardian'] = 'adult_or_guardian'
    audience_kind: Literal['everyone', 'adults', 'juniors'] = 'everyone'
    conditions: dict = Field(default_factory=dict)
    zone_id: str | None = None
    step_id: str | None = None
    questions: list[Question] = Field(default_factory=list, max_length=30)
    @model_validator(mode='after')
    def validate_fields(self):
        if not self.title.strip() or not self.body.strip():
            raise ValueError('Title and wording cannot be blank')
        allowed={'age_groups_include','age_groups_exclude','guest_tags_include','guest_tags_all','guest_tags_exclude','ticket_type_id'}
        if set(self.conditions)-allowed:
            raise ValueError('Unsupported form audience condition')
        if any(not isinstance(v,list) or any(not isinstance(x,str) or not x.strip() for x in v) for v in self.conditions.values()):
            raise ValueError('Audience conditions must be lists of non-empty strings')
        if len({q.key for q in self.questions}) != len(self.questions):
            raise ValueError('Question keys must be unique')
        if any(q.type=='select' and (not q.options or any(not x.strip() or len(x)>300 for x in q.options) or len(set(q.options)) != len(q.options)) for q in self.questions):
            raise ValueError('Select questions need options')
        return self


class SaveForm(Definition):
    expected_version: int | None = None


class SubmitForm(BaseModel):
    model_config = ConfigDict(extra='forbid')
    guest_id: str
    revision_id: str
    signer_name: str = Field(min_length=2, max_length=255)
    accepted: bool = False
    guardian_attestation: bool = False
    answers: dict = Field(default_factory=dict)


class Authority(BaseModel):
    guest_id: str
    signer_guest_id: str
    relationship: Literal['parent', 'legal_guardian']
    active: bool = True
    verified: bool


async def event_for(event_id, db):
    event = await db.get(Event,event_id)
    if not event or not event.experience_enabled:
        raise HTTPException(404,'Forms are not enabled for this event')
    return event


async def scoped_form(event_id, form_id, db, lock=False):
    query=select(EventForm).where(EventForm.id==form_id,EventForm.event_id==event_id)
    row=await db.scalar(query.with_for_update() if lock else query)
    if not row: raise HTTPException(404,'Form not found')
    return row


async def validate_links(event_id, definition, db):
    if definition.zone_id:
        zone=await db.get(Zone,definition.zone_id)
        if not zone or zone.event_id!=event_id: raise HTTPException(422,'Choose a zone from this event')
    if definition.step_id:
        step=await db.get(ExperienceStep,definition.step_id)
        workflow=await db.get(ExperienceWorkflow,step.workflow_id) if step else None
        if not workflow or workflow.event_id!=event_id or step.type!='session_attendance': raise HTTPException(422,'Choose a session-attendance step from this event')


def pack(form, revision):
    return {'id':form.id,'version':revision.version,'revision_id':revision.id,'published_version':form.published_version,'archived':form.archived,**revision.definition}


@router.get('/{event_id}/forms')
async def list_forms(event_id:str,db:AsyncSession=Depends(get_db),user:User=Depends(require_event_admin)):
    await event_for(event_id,db)
    rows=(await db.execute(select(EventForm,EventFormRevision).join(EventFormRevision,(EventFormRevision.form_id==EventForm.id)&(EventFormRevision.version==EventForm.version)).where(EventForm.event_id==event_id).order_by(EventForm.created_at))).all()
    return [pack(f,r) for f,r in rows]


@router.post('/{event_id}/forms',status_code=201)
async def create_form(event_id:str,data:Definition,db:AsyncSession=Depends(get_db),user:User=Depends(require_event_admin)):
    event=await event_for(event_id,db);_assert_experience_plan(event)
    await validate_links(event_id,data,db)
    form=EventForm(event_id=event_id);db.add(form);await db.flush()
    revision=EventFormRevision(form_id=form.id,version=1,definition=data.model_dump(),created_by=user.id);db.add(revision);await db.commit()
    return pack(form,revision)


@router.put('/{event_id}/forms/{form_id}')
async def revise_form(event_id:str,form_id:str,data:SaveForm,db:AsyncSession=Depends(get_db),user:User=Depends(require_event_admin)):
    await event_for(event_id,db);form=await scoped_form(event_id,form_id,db,True)
    if data.expected_version!=form.version:raise HTTPException(409,'The form changed. Reload before saving.')
    await validate_links(event_id,data,db)
    form.version+=1
    revision=EventFormRevision(form_id=form.id,version=form.version,definition=data.model_dump(exclude={'expected_version'}),created_by=user.id)
    db.add(revision);await db.commit();return pack(form,revision)


@router.post('/{event_id}/forms/{form_id}/publish')
async def publish_form(event_id:str,form_id:str,version:int=Query(...),db:AsyncSession=Depends(get_db),user:User=Depends(require_event_admin)):
    await event_for(event_id,db);form=await scoped_form(event_id,form_id,db,True)
    if version!=form.version:raise HTTPException(409,'Review the latest version before publishing.')
    revision=await db.scalar(select(EventFormRevision).where(EventFormRevision.form_id==form.id,EventFormRevision.version==version))
    await validate_links(event_id,Definition(**revision.definition),db)
    form.published_version=version;form.archived=False;await db.commit();return pack(form,revision)


@router.delete('/{event_id}/forms/{form_id}')
async def archive_form(event_id:str,form_id:str,db:AsyncSession=Depends(get_db),user:User=Depends(require_event_admin)):
    form=await scoped_form(event_id,form_id,db,True);form.archived=True;await db.commit();return {'archived':True}


@router.get('/{event_id}/form-people')
async def form_people(event_id:str,q:str='',db:AsyncSession=Depends(get_db),user:User=Depends(require_event_admin)):
    event=await event_for(event_id,db)
    query=select(Guest).where(Guest.event_id==event_id)
    if q.strip():query=query.where((Guest.first_name+' '+Guest.last_name).ilike('%'+q.strip()[:100]+'%'))
    rows=(await db.scalars(query.order_by(Guest.first_name,Guest.last_name).limit(100))).all()
    return [{'id':g.id,'name':f'{g.first_name} {g.last_name}','is_junior':service.is_junior(event,g)} for g in rows]


@router.get('/{event_id}/consent-authorities')
async def list_authorities(event_id:str,db:AsyncSession=Depends(get_db),user:User=Depends(require_event_admin)):
    return (await db.scalars(select(EventConsentAuthority).where(EventConsentAuthority.event_id==event_id))).all()


@router.put('/{event_id}/consent-authorities')
async def grant_authority(event_id:str,data:Authority,db:AsyncSession=Depends(get_db),user:User=Depends(require_event_admin)):
    event=await event_for(event_id,db)
    people=[await db.get(Guest,i) for i in [data.guest_id,data.signer_guest_id]]
    if any(not p or p.event_id!=event_id for p in people) or data.guest_id==data.signer_guest_id:raise HTTPException(422,'Choose two different attendees from this event')
    if not data.verified or service.is_junior(event,people[1]):raise HTTPException(422,'Verify an adult parent or legal guardian before granting consent authority')
    # Serialize updates for this child, including grant/revoke against submissions.
    await db.scalar(select(Guest).where(Guest.id==data.guest_id).with_for_update())
    row=await db.scalar(select(EventConsentAuthority).where(EventConsentAuthority.event_id==event_id,EventConsentAuthority.guest_id==data.guest_id,EventConsentAuthority.signer_guest_id==data.signer_guest_id))
    if not row:row=EventConsentAuthority(event_id=event_id,guest_id=data.guest_id,signer_guest_id=data.signer_guest_id);db.add(row)
    row.relationship=data.relationship;row.active=data.active;row.approved_by=user.id;row.updated_at=datetime.utcnow()
    await db.commit();return row


@router.get('/{event_id}/forms/me')
async def my_forms(event_id:str,response:Response,token:str=Query(...),db:AsyncSession=Depends(get_db)):
    response.headers['Cache-Control']='no-store, private'
    viewer=await _guest_by_token(event_id,token,db);event=await event_for(event_id,db)
    people,grants=await service.subjects(event,viewer,db);forms=await service.published(event_id,db)
    revisions=[r.id for _,r in forms]
    submissions=(await db.scalars(select(EventFormSubmission).where(EventFormSubmission.guest_id.in_([g.id for g in people]),EventFormSubmission.revision_id.in_(revisions)))).all()
    done={(s.guest_id,s.revision_id):s for s in submissions};items=[]
    for guest in people:
        context=await service.context_for(guest,db)
        for form,rev in forms:
            if not await service.applies(rev.definition,event,guest,db,context):continue
            record=done.get((guest.id,rev.id));reason=service.signing_reason(rev.definition,event,guest,viewer,grants)
            items.append({**pack(form,rev),'guest_id':guest.id,'guest_name':f'{guest.first_name} {guest.last_name}','on_behalf':guest.id!=viewer.id,'status':'complete' if record else 'pending','can_submit':not reason and not record,'reason':reason if not record else None,'receipt_id':record.id if record else None,'signed_at':record.signed_at if record else None})
    return {'viewer_id':viewer.id,'forms':items}


@router.post('/{event_id}/forms/{form_id}/submit',status_code=201)
async def submit_form(event_id:str,form_id:str,data:SubmitForm,request:Request,token:str=Query(...),db:AsyncSession=Depends(get_db)):
    viewer=await _guest_by_token(event_id,token,db);event=await event_for(event_id,db)
    form=await scoped_form(event_id,form_id,db,True)
    rev=await db.scalar(select(EventFormRevision).where(EventFormRevision.form_id==form_id,EventFormRevision.version==form.published_version))
    if form.archived or not rev or rev.id!=data.revision_id:raise HTTPException(409,'This form changed or closed. Reload and review the current version.')
    guest=await db.scalar(select(Guest).where(Guest.id==data.guest_id,Guest.event_id==event_id).with_for_update())
    if not guest:raise HTTPException(404,'Attendee not found')
    people,grants=await service.subjects(event,viewer,db)
    if guest.id not in {p.id for p in people}:raise HTTPException(403,'Consent-signing permission is required')
    if not await service.applies(rev.definition,event,guest,db):raise HTTPException(403,'This form does not apply to this attendee')
    existing=await db.scalar(select(EventFormSubmission).where(EventFormSubmission.revision_id==rev.id,EventFormSubmission.guest_id==guest.id))
    if existing:return {'receipt_id':existing.id,'status':'complete'}
    reason=service.signing_reason(rev.definition,event,guest,viewer,grants)
    if reason:raise HTTPException(403,reason)
    if guest.id!=viewer.id and not data.guardian_attestation:raise HTTPException(422,'Confirm that you are signing as the authorized parent or legal guardian')
    if not data.accepted or not data.signer_name.strip():raise HTTPException(422,'Read and acknowledge the form before submitting')
    fields={q['key']:q for q in rev.definition['questions']}
    if set(data.answers)-set(fields):raise HTTPException(422,'Unknown form field')
    for key,q in fields.items():
        value=data.answers.get(key)
        if q['required'] and (value is None or value is False or isinstance(value,str) and not value.strip()):raise HTTPException(422,f"Complete {q['label']}")
        if value is None:continue
        if q['type']=='checkbox':
            if not isinstance(value,bool):raise HTTPException(422,'Invalid checkbox answer')
        elif not isinstance(value,str) or len(value)>4000:raise HTTPException(422,'Invalid answer')
        elif q['type']=='select' and value not in q['options']:raise HTTPException(422,'Choose a listed answer')
    submission=EventFormSubmission(revision_id=rev.id,guest_id=guest.id,signer_guest_id=viewer.id,signer_name=data.signer_name.strip(),relationship=grants[guest.id].relationship if guest.id!=viewer.id else 'self',answers=data.answers,accepted=True,signature_text=data.signer_name.strip() if rev.definition['kind']=='consent' else None,ip_address=request.client.host if request.client else None,user_agent=request.headers.get('user-agent','')[:500])
    db.add(submission);await db.commit();return {'receipt_id':submission.id,'status':'complete'}


@router.get('/{event_id}/form-receipts/{receipt_id}')
async def receipt(event_id:str,receipt_id:str,response:Response,token:str=Query(...),db:AsyncSession=Depends(get_db)):
    response.headers['Cache-Control']='no-store, private'
    viewer=await _guest_by_token(event_id,token,db)
    row=await db.get(EventFormSubmission,receipt_id)
    if not row:raise HTTPException(404,'Receipt not found')
    revision=await db.get(EventFormRevision,row.revision_id);form=await scoped_form(event_id,revision.form_id,db)
    if viewer.id not in (row.guest_id,row.signer_guest_id):raise HTTPException(403,'This receipt belongs to another attendee')
    guest=await db.get(Guest,row.guest_id)
    return {'id':row.id,'form':pack(form,revision),'guest_name':f'{guest.first_name} {guest.last_name}','signer_name':row.signer_name,'relationship':row.relationship,'answers':row.answers,'signature_text':row.signature_text,'accepted':row.accepted,'signed_at':row.signed_at}


@router.get('/{event_id}/form-records')
async def records(event_id:str,history:bool=False,db:AsyncSession=Depends(get_db),user:User=Depends(require_event_admin)):
    event=await event_for(event_id,db);forms=await service.published(event_id,db)
    guests=(await db.scalars(select(Guest).where(Guest.event_id==event_id).order_by(Guest.first_name))).all()
    submissions=(await db.scalars(select(EventFormSubmission).join(EventFormRevision).join(EventForm).where(EventForm.event_id==event_id))).all()
    if history:
        names={g.id:f'{g.first_name} {g.last_name}' for g in guests}
        revisions={r.id:r for r in (await db.scalars(select(EventFormRevision).join(EventForm).where(EventForm.event_id==event_id))).all()}
        return [{'form_id':revisions[s.revision_id].form_id,'title':revisions[s.revision_id].definition['title'],'version':revisions[s.revision_id].version,'guest_id':s.guest_id,'guest_name':names.get(s.guest_id,'Attendee'),'status':'complete','signer_name':s.signer_name,'signed_at':s.signed_at,'answers':s.answers,'receipt_id':s.id} for s in submissions]
    done={(s.guest_id,s.revision_id):s for s in submissions};result=[]
    for guest in guests:
        context=await service.context_for(guest,db)
        for form,rev in forms:
            if await service.applies(rev.definition,event,guest,db,context):
                record=done.get((guest.id,rev.id))
                result.append({'form_id':form.id,'title':rev.definition['title'],'version':rev.version,'guest_id':guest.id,'guest_name':f'{guest.first_name} {guest.last_name}','status':'complete' if record else 'pending','signer_name':record.signer_name if record else None,'signed_at':record.signed_at if record else None,'answers':record.answers if record else None,'receipt_id':record.id if record else None})
    return result


@router.get('/{event_id}/form-options')
async def form_options(event_id:str,db:AsyncSession=Depends(get_db),user:User=Depends(require_event_admin)):
    await event_for(event_id,db)
    zones=(await db.scalars(select(Zone).where(Zone.event_id==event_id))).all()
    tickets=(await db.scalars(select(TicketType).where(TicketType.event_id==event_id))).all()
    sessions=(await db.scalars(select(ExperienceStep).join(ExperienceWorkflow).where(ExperienceWorkflow.event_id==event_id,ExperienceStep.type=='session_attendance',ExperienceStep.enabled.is_(True),ExperienceWorkflow.status=='published'))).all()
    return {'zones':[{'id':r.id,'name':r.name} for r in zones],'tickets':[{'id':r.id,'name':r.name} for r in tickets],'sessions':[{'id':r.id,'title':r.title} for r in sessions]}
