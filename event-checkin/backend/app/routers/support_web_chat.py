"""Customer website conversations; opaque bearer access, management-only replies."""
import hashlib,secrets,httpx,re,logging
from datetime import datetime,timedelta
from uuid import UUID,uuid4
from fastapi import APIRouter,Depends,HTTPException,Header,Response
from pydantic import BaseModel,Field,ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import require_superadmin
from app.database import get_db
from app.config import settings
from app.models import SupportWebChat,User
from app.ratelimit import rate_limit
from app.services.support_automation import config
from app.services.support_answers import answer
router=APIRouter()

def now():return datetime.utcnow()
def message(body,role,request_id=None):return dict(id=str(uuid4()),body=body,role=role,at=now().isoformat()+'Z',request_id=request_id)
def public(row):return dict(reference='WEB-'+row.id.replace('-','')[:12].upper(),availability='Messages are saved for Festio management. This is not a live-agent guarantee; response hours and a response time have not been published.',messages=[{k:v for k,v in m.items() if k!='actor'} for m in row.messages],mode=row.mode,expires_at=row.expires_at)
async def owned(db,authorization,lock=False):
    if not authorization or not authorization.startswith('Bearer ') or len(authorization)>100:raise HTTPException(401,'Open a new chat to continue.')
    query=select(SupportWebChat).where(SupportWebChat.token_hash==hashlib.sha256(authorization[7:].encode()).hexdigest())
    if lock:query=query.with_for_update()
    row=await db.scalar(query)
    if not row or row.expires_at<=now():raise HTTPException(401,'This chat has expired. Start a new conversation.')
    return row

class Start(BaseModel):
    model_config=ConfigDict(extra='forbid')
    page:str=Field(default='general',pattern='^(general|organiser|event)$')
    site_slug:str|None=Field(default=None,pattern=r'^[a-zA-Z0-9_-]{1,100}$')

async def published_profile(slug):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response=await client.get(settings.public_site_service_url.rstrip('/')+'/site/'+slug+'/support-facts')
        if response.status_code==404:raise HTTPException(404,'This event website is not published.')
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError,ValueError):
        logging.getLogger(__name__).warning('Published support facts unavailable')
        raise HTTPException(503,'Published event information is temporarily unavailable. Please try again.')

@router.post('/session',dependencies=[Depends(rate_limit(limit=10,window=3600,scope='web-chat-create'))])
async def create(response:Response,data:Start|None=None,db:AsyncSession=Depends(get_db)):
    response.headers['Cache-Control']='no-store'
    data=data or Start()
    if data.site_slug:await published_profile(data.site_slug)
    greeting='I can help you create an event, invite guests, set up seating or understand Festio’s tools.' if data.page=='organiser' else 'I can help with Festio or your event.'
    if data.site_slug:greeting='Ask about this event’s published time, venue, registration or programme.'
    token=secrets.token_urlsafe(32)
    row=SupportWebChat(token_hash=hashlib.sha256(token.encode()).hexdigest(),expires_at=now()+timedelta(days=7),context={'_site_slug':data.site_slug,'_page':data.page},messages=[message('Hi! I’m Festio’s automated helper. '+greeting+' Choose Talk to the team when you need personal help. Please keep personal pass links and payment details out of this chat.','bot')])
    db.add(row);await db.commit()
    return dict(token=token,**public(row))

@router.get('/session',dependencies=[Depends(rate_limit(limit=60,window=60,scope='web-chat-read'))])
async def read(response:Response,authorization:str|None=Header(default=None),db:AsyncSession=Depends(get_db)):
    response.headers['Cache-Control']='no-store'
    return public(await owned(db,authorization))

class Send(BaseModel):
    model_config=ConfigDict(extra='forbid')
    body:str=Field(min_length=1,max_length=1000)
    request_id:UUID

@router.post('/messages',dependencies=[Depends(rate_limit(limit=20,window=60,scope='web-chat-send'))])
async def send(data:Send,response:Response,authorization:str|None=Header(default=None),db:AsyncSession=Depends(get_db)):
    response.headers['Cache-Control']='no-store'
    text=data.body.strip()
    if not text:raise HTTPException(422,'Enter a message.')
    row=await owned(db,authorization,True)
    prior=next((m for m in row.messages if m.get('request_id')==str(data.request_id)),None)
    if prior:
        if prior['body']!=text:raise HTTPException(409,'This message reference was already used.')
        return public(row)
    if len(row.messages)>=200:raise HTTPException(409,'This conversation is full. Start a new chat.')
    messages=[*row.messages,message(text,'customer',str(data.request_id))]
    if row.mode=='auto':
        cfg,_=await config(db)
        if cfg.get('enabled'):
            personal=any(w in text.lower() for w in ['my pass','my qr','my seat','my table','my ticket','payment status','human','agent','refund','complaint','support','staff','talk to the team','seat number','registration status','resend','confirm me','confirm my'])
            meta={k:v for k,v in row.context.items() if k.startswith('_')}
            from app.services.support_product_knowledge import product_answer
            if meta.get('_site_slug') and not personal and not product_answer(text):
                profile=await published_profile(meta['_site_slug'])
                cfg={**cfg,'profiles':[profile]}
                answer_context={**row.context,'event':profile['id']}
            else:answer_context=row.context
            body,context,mode=answer(cfg,answer_context,text)
            if mode=='human' and not personal and not meta.get('_clarified'):
                body='Are you asking about using Festio, or about a particular event? Tell me what you want to do, or give the event name. For personal passes, seats or payments, choose Talk to the team.'
                mode='auto';meta['_clarified']=True
            row.context={**context,**meta};row.mode=mode
        else:body='I’m passing your message to the Festio team. Replies will appear here when someone is available.';row.mode='human'
        if row.mode=='human':body='Your conversation is saved in Festio’s private support queue. Replies will appear here when the team is available. No response time is currently promised. For passes, seats or payments, the team must verify your identity before sharing personal details. Your reference is WEB-'+row.id.replace('-','')[:12].upper()+'. You can also continue in WhatsApp.'
        messages.append(message(body,'bot'))
    row.messages=messages;row.updated_at=now();await db.commit();return public(row)

@router.get('/management')
async def inbox(db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    rows=(await db.scalars(select(SupportWebChat).where(SupportWebChat.expires_at>now(),SupportWebChat.updated_at.is_not(None)).order_by(SupportWebChat.updated_at.desc()).limit(100))).all()
    rows=[r for r in rows if any(m['role']=='customer' for m in r.messages)]
    return {'items':[dict(id=r.id,reference='WEB-'+r.id.replace('-','')[:12].upper(),mode=r.mode,updated_at=r.updated_at,unread=any(m['role']=='customer' and (not r.read_at or m['at']>r.read_at.isoformat()+'Z') for m in r.messages),preview=next((m['body'][:100] for m in reversed(r.messages) if m['role']=='customer'),'')) for r in rows]}

@router.get('/management/{ident}')
async def thread(ident:str,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    row=await db.get(SupportWebChat,ident)
    if not row or row.expires_at<=now():raise HTTPException(404,'Chat not found.')
    row.read_at=now();await db.commit();return dict(id=row.id,source={'page':row.context.get('_page','general'),'site_slug':row.context.get('_site_slug')},**public(row))

@router.post('/management/{ident}/reply')
async def reply(ident:str,data:Send,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    row=await db.scalar(select(SupportWebChat).where(SupportWebChat.id==ident).with_for_update())
    if not row or row.expires_at<=now():raise HTTPException(404,'Chat not found.')
    text=data.body.strip()
    if not text:raise HTTPException(422,'Enter a reply.')
    prior=next((m for m in row.messages if m.get('request_id')==str(data.request_id)),None)
    if prior:
        if prior.get('actor')!=user.id or prior['body']!=text:raise HTTPException(409,'This message reference was already used.')
        return public(row)
    if len(row.messages)>=200:raise HTTPException(409,'This conversation is full.')
    m=message(text,'team',str(data.request_id));m['actor']=user.id
    row.messages=[*row.messages,m];row.mode='human';row.updated_at=now();await db.commit();return public(row)
