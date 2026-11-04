"""Festio-management-only WhatsApp support. Never scoped by event membership."""
import json
from datetime import datetime,timedelta,timezone
from uuid import UUID
from fastapi import APIRouter,Depends,HTTPException,Request,Response,Query
from pydantic import BaseModel,Field
from sqlalchemy import select,func,or_,exists
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import require_superadmin
from app.config import settings
from app.database import get_db
from app.models import SupportConversation as Conversation,SupportMessage as Message,SupportRead,Guest,Event,User,SupportAutomationState
from app.ratelimit import rate_limit
from app.services import support_whatsapp as service
from services.outbound_safety import recipient_allowed

router=APIRouter()

def enabled():
    if not settings.support_whatsapp_enabled:raise HTTPException(503,'WhatsApp support is not enabled')


def message_out(m):
    return {k:getattr(m,k) for k in ['id','direction','body','kind','status','occurred_at','received_at','error','sent_by','request_id']}


def unread_for(user):
    read=select(SupportRead.read_at).where(SupportRead.conversation_id==Conversation.id,SupportRead.user_id==user.id).correlate(Conversation).scalar_subquery()
    return exists(select(Message.id).where(Message.conversation_id==Conversation.id,Message.direction=='incoming',or_(read.is_(None),Message.received_at>read)))


@router.get('/conversations',dependencies=[Depends(enabled)])
async def conversations(q:str=Query('',max_length=100),state:str='all',offset:int=Query(0,ge=0),db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    unread=unread_for(user)
    query=select(Conversation,unread.label('unread'))
    if q:query=query.where(or_(Conversation.phone.contains(q,autoescape=True),Conversation.name.ilike('%'+q.replace('%','').replace('_','')+'%')))
    if state=='unread':query=query.where(unread)
    elif state in ('open','resolved'):query=query.where(Conversation.status==state)
    rows=(await db.execute(query.order_by(Conversation.last_message_at.desc(),Conversation.id).offset(offset).limit(51))).all()
    count=await db.scalar(select(func.count()).select_from(Conversation).where(unread))
    items=[]
    for c,new in rows[:50]:
        latest=await db.scalar(select(Message).where(Message.conversation_id==c.id).order_by(Message.occurred_at.desc(),Message.id.desc()).limit(1))
        items.append(dict(id=c.id,name=c.name,phone=c.phone,status=c.status,last_message_at=c.last_message_at,unread=new,preview=(latest.body[:120] if latest else '')))
    return dict(items=items,unread_count=count,has_more=len(rows)>50,enabled=True)


@router.get('/conversations/{ident}',dependencies=[Depends(enabled)])
async def conversation(ident:str,before:datetime|None=None,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    c=await db.get(Conversation,ident)
    if not c:raise HTTPException(404,'Conversation not found')
    query=select(Message).where(Message.conversation_id==ident)
    if before:
        if before.tzinfo:before=before.astimezone(timezone.utc).replace(tzinfo=None)
        query=query.where(Message.received_at<before)
    rows=(await db.scalars(query.order_by(Message.received_at.desc(),Message.id.desc()).limit(101))).all()
    selected=rows[:100]
    # Context is advisory and management-only. Multiple matches are shown;
    # never assign a reply to an event or change a guest's RSVP automatically.
    numbers=[c.phone,c.phone.lstrip('+')]
    if c.phone.startswith('+234'):numbers.append('0'+c.phone[4:])
    normalized=Guest.phone
    for char in [' ','-','(',')']:normalized=func.replace(normalized,char,'')
    matches=(await db.execute(select(Guest,Event.name).join(Event,Event.id==Guest.event_id).where(normalized.in_(numbers)).limit(10))).all()
    automation=await db.get(SupportAutomationState,ident)
    return dict(automation_mode=automation.mode if automation else 'auto',id=c.id,name=c.name,phone=c.phone,status=c.status,messages=[message_out(m) for m in sorted(selected,key=lambda m:(m.occurred_at,m.id))],
                read_through=max((m.received_at for m in selected),default=None),older_before=selected[-1].received_at if len(rows)>100 else None,
                reply_until=c.last_incoming_at+timedelta(hours=24) if c.last_incoming_at else None,
                context=[dict(guest=g.first_name+' '+g.last_name,event=event,event_id=g.event_id) for g,event in matches])


class ReadBody(BaseModel):
    through:datetime|None=None
    unread:bool=False


@router.post('/conversations/{ident}/read',dependencies=[Depends(enabled)])
async def mark_read(ident:str,data:ReadBody,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    c=await db.scalar(select(Conversation).where(Conversation.id==ident).with_for_update())
    if not c:raise HTTPException(404,'Conversation not found')
    row=await db.get(SupportRead,(ident,user.id))
    through=data.through or datetime(1970,1,1)
    if through.tzinfo:through=through.astimezone(timezone.utc).replace(tzinfo=None)
    when=datetime(1970,1,1) if data.unread else min(through,datetime.utcnow())
    if row:row.read_at=when
    else:db.add(SupportRead(conversation_id=ident,user_id=user.id,read_at=when))
    await db.commit();return {'ok':True}


class StateBody(BaseModel):
    status:str=Field(pattern='^(open|resolved)$')


@router.patch('/conversations/{ident}',dependencies=[Depends(enabled)])
async def change_state(ident:str,data:StateBody,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    c=await db.get(Conversation,ident)
    if not c:raise HTTPException(404,'Conversation not found')
    c.status=data.status;await db.commit();return {'ok':True}


class ReplyBody(BaseModel):
    body:str=Field(min_length=1,max_length=4096)
    request_id:UUID


@router.post('/conversations/{ident}/reply',dependencies=[Depends(enabled),Depends(rate_limit(limit=30,window=60,scope='support-reply'))])
async def reply(ident:str,data:ReplyBody,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    text=data.body.strip()
    if not text:raise HTTPException(422,'Enter a reply')
    c=await db.scalar(select(Conversation).where(Conversation.id==ident).with_for_update())
    if not c:raise HTTPException(404,'Conversation not found')
    existing=await db.scalar(select(Message).where(Message.request_id==str(data.request_id)))
    if existing:
        if existing.conversation_id!=ident or existing.body!=text or existing.sent_by!=user.id:raise HTTPException(409,'This send reference was already used')
        return message_out(existing)
    if c.channel_id!=settings.bird_whatsapp_channel_id:raise HTTPException(409,'This conversation belongs to a different WhatsApp line')
    if not c.last_incoming_at or datetime.utcnow()>=c.last_incoming_at+timedelta(hours=24):
        raise HTTPException(409,'The 24-hour reply window has closed. Ask the customer to message again or use an approved WhatsApp template. No message was sent.')
    if not recipient_allowed('whatsapp',c.phone):raise HTTPException(403,'Sending to this number is blocked by the staging recipient guard')
    from app.services.support_automation import pause
    await pause(db,ident)
    number=c.phone
    m=Message(conversation_id=ident,request_id=str(data.request_id),direction='outgoing',body=text,kind='text',status='submitting',sent_by=user.id,occurred_at=datetime.utcnow())
    db.add(m);await db.commit() # Durable send intent before contacting the provider. Never retry automatically.
    try:
        response=await service.bird('POST',service.channel_path(),json={'receiver':{'contacts':[{'identifierKey':'phonenumber','identifierValue':number}]},'body':{'type':'text','text':{'text':text}},'reference':'festio-support:'+m.id})
        if response.status_code in (200,201,202):
            payload=response.json();m.provider_id=payload.get('id');m.status=payload.get('status') or 'accepted'
            if not m.provider_id:m.status='unknown';m.error='Bird accepted the request without a message reference. Verify in Bird before sending again.'
        elif response.status_code>=500:
            m.status='unknown';m.error='Bird returned a server error. Verify in Bird before sending again.'
        else:
            m.status='failed';m.error='Bird rejected this reply (HTTP '+str(response.status_code)+'). Check the WhatsApp channel and reply window.'
    except Exception:
        m.status='unknown';m.error='Delivery could not be confirmed. Refresh or check Bird before sending again.'
    c=await db.get(Conversation,ident);c.last_message_at=max(c.last_message_at,m.occurred_at);c.status='open'
    await db.commit();return message_out(m)


class SyncBody(BaseModel):
    page_token:str|None=Field(default=None,max_length=2048)


@router.post('/sync',dependencies=[Depends(enabled),Depends(rate_limit(limit=10,window=60,scope='support-sync'))])
async def sync(data:SyncBody,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    return await service.sync_history(db,data.page_token,pages=3)


@router.post('/bird',dependencies=[Depends(enabled),Depends(rate_limit(limit=300,window=60,scope='support-hook'))])
async def webhook(request:Request,db:AsyncSession=Depends(get_db)):
    raw=await request.body()
    if len(raw)>262144:raise HTTPException(413,'Payload too large')
    service.verify_signature(raw,request.headers)
    try:payload=json.loads(raw)
    except ValueError:raise HTTPException(400,'Invalid JSON')
    data=payload.get('payload') or payload.get('data') or payload
    # Do not trust a caller-supplied message body. Read canonical channel data
    # from Bird as a second check, so a forged event cannot inject support text.
    message=data.get('message') or data
    try:ident=str(UUID(message.get('id') or message.get('messageId')))
    except (ValueError,TypeError,AttributeError):raise HTTPException(400,'Missing message reference')
    response=await service.bird('GET',service.channel_path()+'/'+ident)
    if response.status_code!=200:raise HTTPException(502,'Could not verify Bird message')
    canonical=response.json()
    if settings.support_whatsapp_automation_scope=='staging' and canonical.get('direction')=='incoming':
        from app.services.support_automation import automation_recipient
        candidate=service.normalize(canonical)
        if not candidate or not automation_recipient(candidate['phone']):return Response(status_code=204)
    await service.ingest(db,canonical)
    from app.services.support_automation import enqueue
    await enqueue(db,ident)
    await db.commit()
    return Response(status_code=204)
