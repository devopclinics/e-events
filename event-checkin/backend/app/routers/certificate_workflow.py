"""Saved design decisions and explicit signatory permission for event certificates."""
import base64
import copy
import hashlib
import io
import json
import math
import secrets
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from PIL import Image, ImageDraw
from sqlalchemy import select
from app.auth import require_event_admin
from app.database import get_db
from app.models import CertificateWorkflowLink as Link, Event, EventCertificateTemplate as Template
from app.ratelimit import rate_limit

async def private_response(response: Response):
    response.headers.update({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'})

router = APIRouter(dependencies=[Depends(private_response)])

public_router = APIRouter(dependencies=[Depends(private_response), Depends(rate_limit(limit=90, window=60, scope='certificate_workflow_read', key='client_ip'))])

CATALOG = [
    {'key':'royal','name':'Royal Purple','layout':'royal','primary_color':'#3c074a','accent_color':'#e98000'},
    {'key':'heritage','name':'Heritage Gold','layout':'heritage','primary_color':'#163e32','accent_color':'#9c772f'},
    {'key':'midnight','name':'Midnight Copper','layout':'midnight','primary_color':'#122538','accent_color':'#dcad7e'},
    {'key':'ivory','name':'Ivory Signature','layout':'ivory','primary_color':'#4d304a','accent_color':'#a26778'},
]


def event_context(event):
    from app.timeutil import to_event_local
    local=to_event_local(event.event_date,event.timezone) if event.event_date else None
    return {'event_name':event.name,'event_date_local':local.isoformat() if local else '', 'event_venue':event.venue_name or ''}


def digest(template,event):
    return hashlib.sha256(json.dumps({'name':template.name,'design':template.design or {},'event':event_context(event)},sort_keys=True,separators=(',',':')).encode()).hexdigest()


def stamp(row, action, actor):
    row.audit = [*(row.audit or []), {'action':action,'actor':actor,'at':datetime.utcnow().isoformat()}]


def url(kind, token):
    from .live_content import _absolute_public_url
    return _absolute_public_url(f'/certificate-{kind}/{token}')


def describe(row):
    return dict(id=row.id,kind=row.kind,template_id=row.template_id,slot=row.slot,status=row.status,
                expires_at=row.expires_at,created_at=row.created_at,snapshot=row.snapshot,
                submission=row.submission or {},audit=row.audit or [])


async def event(event_id, db):
    row=await db.get(Event,event_id)
    if not row:raise HTTPException(404,'Event not found')
    return row


async def template(event_id, template_id, db):
    row=await db.get(Template,template_id)
    if not row or row.event_id!=event_id:raise HTTPException(404,'Certificate template not found')
    return row


async def resolve(kind, token, db, lock=False):
    if len(token)>100:raise HTTPException(404,'Link not found')
    q=select(Link).where(Link.kind==kind,Link.token_hash==hashlib.sha256(token.encode()).hexdigest())
    if lock:q=q.with_for_update()
    row=await db.scalar(q)
    if not row:raise HTTPException(404,'Link not found')
    if row.status=='revoked' or row.expires_at<=datetime.utcnow():raise HTTPException(410,'This link has expired or been revoked. Ask the organiser for a new link.')
    return row


def clean_design(design):
    # Public proofs never expose previously uploaded or collected signatures.
    return {k:copy.deepcopy(v) for k,v in (design or {}).items() if k in {
        'title','subtitle','body','layout','kind','primary_color','accent_color','logo_url','background_url','orientation'}}


def proof(row, option):
    from .live_content import _certificate_html
    return _certificate_html(SimpleNamespace(snapshot={'participant_name':'Participant Name','event_name':row.snapshot['event_name'],
        'design':option['design'],'event_date_local':row.snapshot.get('event_date_local',''),'event_venue':row.snapshot.get('event_venue','')},certificate_number='DESIGN PREVIEW',verification_token='preview'), preview=True)


class ReviewCreate(BaseModel):
    template_ids: list[str] = Field(min_length=1,max_length=8)
    expires_days: int = Field(default=14,ge=1,le=30)

class ReviewChoice(BaseModel):
    template_id: str
    reviewer_name: str = Field(min_length=2,max_length=140)
    note: str = Field(default='',max_length=500)

class SignRequest(BaseModel):
    slot: int = Field(ge=1,le=2)
    label: str = Field(min_length=2,max_length=120)
    expected_email: str = Field(default='',max_length=254)
    expires_days: int = Field(default=7,ge=1,le=30)

class SignSubmission(BaseModel):
    name: str = Field(min_length=2,max_length=140)
    title: str = Field(min_length=2,max_length=120)
    email: str = Field(default='',max_length=254)
    consent: Literal[True]
    strokes: list[list[tuple[float,float]]] = Field(min_length=1,max_length=100)


def signature_png(strokes):
    count=sum(map(len,strokes))
    if count<3 or count>5000:raise HTTPException(422,'Draw your signature before submitting (maximum 5,000 points).')
    length=0
    for line in strokes:
        for x,y in line:
            if not math.isfinite(x) or not math.isfinite(y) or not 0<=x<=1000 or not 0<=y<=300:
                raise HTTPException(422,'Signature coordinates are outside the drawing area')
        length+=sum(math.hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(line,line[1:]))
    if length<30:raise HTTPException(422,'Please draw a complete signature.')
    image=Image.new('RGBA',(1000,300),(255,255,255,0));draw=ImageDraw.Draw(image)
    for line in strokes:
        if len(line)>1:draw.line(line,fill=(35,25,45,255),width=4,joint='curve')
    buffer=io.BytesIO();image.save(buffer,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()


@router.get('/{event_id}/certificate-workflow')
async def workflow(event_id:str,db=Depends(get_db),user=Depends(require_event_admin)):
    ev=await event(event_id,db)
    rows=(await db.scalars(select(Link).where(Link.event_id==event_id).order_by(Link.created_at.desc()).limit(100))).all()
    templates=(await db.scalars(select(Template).where(Template.event_id==event_id))).all()
    hashes={t.id:digest(t,ev) for t in templates}
    def current(row):
        if row.kind=='sign': return row.snapshot.get('design_digest')==hashes.get(row.template_id)
        choice=(row.submission or {}).get('template_id')
        return not choice or any(o['template_id']==choice and o['design_digest']==hashes.get(choice) for o in row.snapshot['options'])
    return {'links':[{**describe(r),'current_design':current(r)} for r in rows], 'presets':CATALOG}


@router.post('/{event_id}/certificate-presets/{key}',status_code=201)
async def add_preset(event_id:str,key:str,db=Depends(get_db),user=Depends(require_event_admin)):
    from .live_content import _template_out
    await event(event_id,db)
    p=next((p for p in CATALOG if p['key']==key),None)
    if not p:raise HTTPException(404,'Certificate style not found')
    # Idempotent preset installation; saving later does not reset edited wording.
    await db.scalar(select(Event).where(Event.id==event_id).with_for_update())
    row=await db.scalar(select(Template).where(Template.event_id==event_id,Template.key=='studio-'+key))
    if not row:
        row=Template(event_id=event_id,key='studio-'+key,name=p['name'],design={k:v for k,v in p.items() if k not in ('key','name')},
            eligibility={'minimum_sessions':1,'require_event_checkin':True},created_by_user_id=user.id)
        row.design={**row.design,'title':'Certificate of Participation','subtitle':'This certificate is presented to','body':'In recognition of participation in this event','signature_name':'Authorised Signatory','orientation':'landscape'}
        db.add(row);await db.commit();await db.refresh(row)
    return _template_out(row)


@router.post('/{event_id}/certificate-reviews',status_code=201)
async def create_review(event_id:str,body:ReviewCreate,db=Depends(get_db),user=Depends(require_event_admin)):
    ev=await event(event_id,db);options=[]
    for tid in dict.fromkeys(body.template_ids):
        t=await template(event_id,tid,db)
        options.append({'template_id':t.id,'name':t.name,'design':clean_design(t.design),'design_digest':digest(t,ev)})
    token=secrets.token_urlsafe(32)
    row=Link(event_id=event_id,kind='review',token_hash=hashlib.sha256(token.encode()).hexdigest(),expires_at=datetime.utcnow()+timedelta(days=body.expires_days),
        created_by=user.id,snapshot={**event_context(ev),'options':options})
    stamp(row,'created',user.id);db.add(row);await db.commit();await db.refresh(row)
    return {**describe(row),'url':url('review',token)}


@router.post('/{event_id}/certificate-templates/{template_id}/signature-requests',status_code=201)
async def create_signature(event_id:str,template_id:str,body:SignRequest,db=Depends(get_db),user=Depends(require_event_admin)):
    await db.scalar(select(Event).where(Event.id==event_id).with_for_update());ev=await event(event_id,db);t=await template(event_id,template_id,db)
    previous=(await db.scalars(select(Link).where(Link.event_id==event_id,Link.template_id==template_id,Link.kind=='sign',Link.slot==body.slot))).all()
    for old in previous:
        if old.status!='revoked':old.status='revoked';stamp(old,'replaced',user.id)
    token=secrets.token_urlsafe(32)
    row=Link(event_id=event_id,template_id=template_id,kind='sign',slot=body.slot,token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=datetime.utcnow()+timedelta(days=body.expires_days),created_by=user.id,
        snapshot={**event_context(ev),'template_name':t.name,'design':clean_design(t.design),'design_digest':digest(t,ev),
                  'label':body.label.strip(),'expected_email':body.expected_email.strip().lower()})
    stamp(row,'created',user.id);db.add(row);await db.commit();await db.refresh(row)
    return {**describe(row),'url':url('sign',token)}


@router.post('/{event_id}/certificate-workflow/{link_id}/{action}')
async def decision(event_id:str,link_id:str,action:Literal['approve','revoke'],db=Depends(get_db),user=Depends(require_event_admin)):
    await db.scalar(select(Event).where(Event.id==event_id).with_for_update())
    row=await db.scalar(select(Link).where(Link.id==link_id,Link.event_id==event_id).with_for_update())
    if not row:raise HTTPException(404,'Request not found')
    if action=='approve':
        t=await template(event_id,row.template_id,db)
        if row.kind!='sign' or row.status!='submitted' or row.snapshot['design_digest']!=digest(t,await event(event_id,db)):
            raise HTTPException(409,'Only a submitted signature for the current saved design can be approved.')
        row.status='approved'
    else:row.status='revoked'
    stamp(row,action,user.id);await db.commit()
    return describe(row)


@public_router.get('/reviews/{token}')
async def public_review(token:str,db=Depends(get_db)):
    r=await resolve('review',token,db)
    return {'event_name':r.snapshot['event_name'],'status':r.status,'options':[{'template_id':o['template_id'],'name':o['name']} for o in r.snapshot['options']],
            'choice':(r.submission or {}).get('template_id'),'expires_at':r.expires_at}


@public_router.get('/reviews/{token}/preview/{template_id}',response_class=HTMLResponse)
async def review_preview(token:str,template_id:str,db=Depends(get_db)):
    r=await resolve('review',token,db);o=next((o for o in r.snapshot['options'] if o['template_id']==template_id),None)
    if not o:raise HTTPException(404,'Design not in this review')
    return HTMLResponse(proof(r,o),headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex',
        'Content-Security-Policy':"default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; frame-ancestors 'self'"})


@public_router.post('/reviews/{token}',dependencies=[Depends(rate_limit(limit=15,window=60,scope='certificate_review_write',key='client_ip'))])
async def select_review(token:str,body:ReviewChoice,db=Depends(get_db)):
    r=await resolve('review',token,db,True)
    if body.template_id not in [o['template_id'] for o in r.snapshot['options']]:raise HTTPException(422,'Select one of the shared designs')
    if not body.reviewer_name.strip():raise HTTPException(422,'Enter your name')
    submission={'template_id':body.template_id,'reviewer_name':body.reviewer_name.strip(),'note':body.note.strip()}
    if r.status=='selected':
        if r.submission==submission:return {'status':'selected','template_id':body.template_id}
        raise HTTPException(409,'A choice has already been recorded. Ask the organiser for a new review link to change it.')
    r.submission=submission;r.status='selected';stamp(r,'selected','link-holder');await db.commit()
    return {'status':'selected','template_id':body.template_id}


@public_router.get('/signatures/{token}')
async def public_sign(token:str,db=Depends(get_db)):
    r=await resolve('sign',token,db)
    return {'event_name':r.snapshot['event_name'],'template_name':r.snapshot['template_name'],'label':r.snapshot['label'],
            'status':r.status,'email_required':bool(r.snapshot.get('expected_email')),'expires_at':r.expires_at}


@public_router.get('/signatures/{token}/preview',response_class=HTMLResponse)
async def signature_preview(token:str,db=Depends(get_db)):
    r=await resolve('sign',token,db)
    return HTMLResponse(proof(r,{'design':r.snapshot['design']}),headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex',
        'Content-Security-Policy':"default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; frame-ancestors 'self'"})


@public_router.post('/signatures/{token}',dependencies=[Depends(rate_limit(limit=10,window=60,scope='certificate_signature_write',key='client_ip'))])
async def submit_signature(token:str,body:SignSubmission,db=Depends(get_db)):
    r=await resolve('sign',token,db,True)
    if r.status!='pending':raise HTTPException(409,'This request has already been signed. Ask the organiser for a replacement link to make changes.')
    t=await template(r.event_id,r.template_id,db)
    if digest(t,await event(r.event_id,db))!=r.snapshot['design_digest']:raise HTTPException(409,'The design changed. Ask the organiser for a new signature request.')
    expected=r.snapshot.get('expected_email')
    if expected and body.email.strip().lower()!=expected:raise HTTPException(422,'Use the email address specified by the organiser.')
    if not body.name.strip() or not body.title.strip():raise HTTPException(422,'Enter your name and title')
    r.submission={'name':body.name.strip(),'title':body.title.strip(),'email':body.email.strip().lower(),
        'signature_png':signature_png(body.strokes),'consent':True,'consent_text':'I authorise use of my name, title and drawn signature on certificates issued for this event and this saved design.',
        'design_digest':r.snapshot['design_digest'],'signed_at':datetime.utcnow().isoformat(),'identity_method':'private-link-possession'}
    r.status='submitted';stamp(r,'submitted','link-holder');await db.commit()
    return {'status':'submitted','message':'Signature submitted for organiser approval. No certificates have been issued.'}


async def approved_signatories(template,db,strict=True):
    rows=(await db.scalars(select(Link).where(Link.template_id==template.id,Link.kind=='sign').order_by(Link.created_at.desc()))).all()
    latest={}
    for r in rows:latest.setdefault(r.slot,r)
    result=[]
    for slot,r in sorted(latest.items()):
        valid=r.status=='approved' and r.snapshot.get('design_digest')==digest(template,await event(template.event_id,db))
        if not valid:
            if strict:raise HTTPException(409,'Collect and approve every requested signature for the current saved certificate design before issuing.')
            return None
        s=r.submission
        result.append({'name':s['name'],'title':s['title'],'signature_png':s['signature_png'],'request_id':r.id,'signed_at':s['signed_at']})
    return result
