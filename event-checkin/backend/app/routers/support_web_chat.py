"""Customer website conversations; opaque bearer access, management-only replies."""
import hashlib,secrets
from datetime import datetime,timedelta
from uuid import UUID,uuid4
from fastapi import APIRouter,Depends,HTTPException,Header,Response
from pydantic import BaseModel,Field,ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import require_superadmin
from app.database import get_db
from app.models import SupportWebChat,User
from app.ratelimit import rate_limit
from app.services.support_automation import config
from app.services.support_answers import answer
router=APIRouter()

def now():return datetime.utcnow()
def message(body,role,request_id=None):return dict(id=str(uuid4()),body=body,role=role,at=now().isoformat()+'Z',request_id=request_id)
def public(row):return dict(messages=[{k:v for k,v in m.items() if k!='actor'} for m in row.messages],mode=row.mode,expires_at=row.expires_at)
async def owned(db,authorization,lock=False):
    if not authorization or not authorization.startswith('Bearer ') or len(authorization)>100:raise HTTPException(401,'Open a new chat to continue.')
    query=select(SupportWebChat).where(SupportWebChat.token_hash==hashlib.sha256(authorization[7:].encode()).hexdigest())
    if lock:query=query.with_for_update()
    row=await db.scalar(query)
    if not row or row.expires_at<=now():raise HTTPException(401,'This chat has expired. Start a new conversation.')
    return row

@router.post('/session',dependencies=[Depends(rate_limit(limit=10,window=3600,scope='web-chat-create'))])
async def create(response:Response,db:AsyncSession=Depends(get_db)):
    response.headers['Cache-Control']='no-store'
    token=secrets.token_urlsafe(32)
    row=SupportWebChat(token_hash=hashlib.sha256(token.encode()).hexdigest(),expires_at=now()+timedelta(days=7),messages=[message('Hi! I’m Festio’s automated helper. Ask about an event, or choose Talk to the team. Please keep personal pass links and payment details out of this chat.','bot')])
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
            body,context,mode=answer(cfg,row.context,text)
            row.context=context;row.mode=mode
        else:body='I’m passing your message to the Festio team. Replies will appear here when someone is available.';row.mode='human'
        if row.mode=='human':body='I’ve passed your message to the Festio team. Replies will appear here when someone is available. You can also continue in WhatsApp.'
        messages.append(message(body,'bot'))
    row.messages=messages;row.updated_at=now();await db.commit();return public(row)

@router.get('/management')
async def inbox(db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    rows=(await db.scalars(select(SupportWebChat).where(SupportWebChat.expires_at>now(),SupportWebChat.updated_at.is_not(None)).order_by(SupportWebChat.updated_at.desc()).limit(100))).all()
    rows=[r for r in rows if any(m['role']=='customer' for m in r.messages)]
    return {'items':[dict(id=r.id,mode=r.mode,updated_at=r.updated_at,unread=any(m['role']=='customer' and (not r.read_at or m['at']>r.read_at.isoformat()+'Z') for m in r.messages),preview=next((m['body'][:100] for m in reversed(r.messages) if m['role']=='customer'),'')) for r in rows]}

@router.get('/management/{ident}')
async def thread(ident:str,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    row=await db.get(SupportWebChat,ident)
    if not row or row.expires_at<=now():raise HTTPException(404,'Chat not found.')
    row.read_at=now();await db.commit();return dict(id=row.id,**public(row))

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
