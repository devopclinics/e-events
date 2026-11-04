"""Durable, at-most-once support auto-replies, exclusively for fresh verified webhooks."""
import logging
from datetime import datetime,timedelta
from uuid import uuid5,NAMESPACE_URL
from sqlalchemy import select,func
from sqlalchemy.exc import IntegrityError
from app.models import SupportAutomationConfig as Config,SupportAutomationState as State,SupportAutomationJob as Job,SupportConversation as Conversation,SupportMessage as Message
from app.config import settings
from app.services import support_whatsapp as transport
from app.services.support_answers import defaults,answer
from services.outbound_safety import recipient_allowed
log=logging.getLogger(__name__)

def automation_recipient(number):
    tests={transport.phone(p) for p in settings.support_whatsapp_test_phones.split(',') if p.strip()}
    scope=settings.support_whatsapp_automation_scope
    if scope=='staging':return number in tests
    if scope=='production':return number not in tests
    return False

async def config(db):
    row=await db.get(Config,'main')
    return (row.payload if row else defaults()),(row.version if row else 0)

async def pause(db,conversation_id):
    row=await db.get(State,conversation_id)
    if not row:
        row=State(conversation_id=conversation_id,mode='human',context={});db.add(row)
    row.mode='human';row.updated_at=datetime.utcnow()

async def enqueue(db,provider_id):
    cfg,_=await config(db)
    if not cfg['enabled']:return
    message=await db.scalar(select(Message).where(Message.provider_id==provider_id,Message.direction=='incoming'))
    saved=await db.get(Config,'main')
    if saved and message and message.occurred_at<saved.updated_at:return
    if message:
        conversation=await db.get(Conversation,message.conversation_id)
        if not automation_recipient(conversation.phone):return
    if not message or message.occurred_at<datetime.utcnow()-timedelta(minutes=5) or message.occurred_at>datetime.utcnow()+timedelta(minutes=1):return
    if await db.get(Job,message.id):return
    try:
        async with db.begin_nested():db.add(Job(message_id=message.id));await db.flush()
    except IntegrityError:pass

async def process_one(db):
    job=await db.scalar(select(Job).where(Job.status=='pending').order_by(Job.created_at).with_for_update(skip_locked=True).limit(1))
    if not job:return False
    incoming=await db.get(Message,job.message_id)
    thread=await db.scalar(select(Conversation).where(Conversation.id==incoming.conversation_id).with_for_update())
    cfg,_=await config(db);state=await db.get(State,thread.id)
    now=datetime.utcnow()
    resume_after=(state.context or {}).get('_resume_after') if state else None
    if resume_after and incoming.occurred_at<=datetime.fromisoformat(resume_after):
        job.status='skipped';await db.commit();return True
    recent=await db.scalar(select(func.count()).select_from(Message).where(Message.conversation_id==thread.id,Message.sent_by=='automation',Message.occurred_at>now-timedelta(minutes=1)))
    hourly=await db.scalar(select(func.count()).select_from(Message).where(Message.conversation_id==thread.id,Message.sent_by=='automation',Message.occurred_at>now-timedelta(hours=1)))
    if (not settings.support_whatsapp_enabled or not cfg['enabled'] or state and state.mode=='human' or
        thread.channel_id!=settings.bird_whatsapp_channel_id or not automation_recipient(thread.phone) or not recipient_allowed('whatsapp',thread.phone) or
        incoming.occurred_at<now-timedelta(minutes=5) or not thread.last_incoming_at or
        thread.last_incoming_at<now-timedelta(hours=24)):
        job.status='skipped';await db.commit();return True
    if not state:
        state=State(conversation_id=thread.id,mode='auto',context={});db.add(state)
    body,context,mode=answer(cfg,state.context,incoming.body)
    if resume_after:context['_resume_after']=resume_after
    if recent>=3 or hourly>=20:
        if mode=='human':state.mode='human';state.context=context
        job.status='rate-limited';await db.commit();return True
    request=str(uuid5(NAMESPACE_URL,'festio-auto:'+incoming.id))
    existing=await db.scalar(select(Message).where(Message.request_id==request))
    if existing:
        job.status='duplicate';await db.commit();return True
    outgoing=Message(conversation_id=thread.id,direction='outgoing',body=body,kind='automation',status='submitting',sent_by='automation',request_id=request,occurred_at=now)
    db.add(outgoing);state.context=context;state.mode=mode;state.updated_at=now;job.status='submitting'
    number=thread.phone
    await db.commit()  # No automatic retry after the provider request can have started.
    try:
        response=await transport.bird('POST',transport.channel_path(),json={'receiver':{'contacts':[{'identifierKey':'phonenumber','identifierValue':number}]},'body':{'type':'text','text':{'text':body}},'reference':'festio-support:'+outgoing.id})
        if response.status_code in (200,201,202):
            data=response.json();outgoing.provider_id=data.get('id');outgoing.status=str(data.get('status') or 'accepted')[:40] if outgoing.provider_id else 'unknown'
        else:
            outgoing.status='unknown' if response.status_code>=500 else 'failed';outgoing.error='Automatic reply provider response: HTTP '+str(response.status_code)
    except Exception:
        outgoing.status='unknown';outgoing.error='Provider acceptance is unknown. Check Bird before sending again.'
    job.status=outgoing.status
    thread=await db.get(Conversation,incoming.conversation_id);thread.last_message_at=max(thread.last_message_at,now)
    await db.commit();return True
