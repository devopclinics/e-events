"""Canonical Team identities, event duties, durable email and physical handovers."""
import hashlib,json,uuid
from datetime import datetime,timedelta,timezone
from html import escape
from urllib.parse import quote
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from ..database import AsyncSessionLocal
from ..models import Event,User,EventUser,Membership,EmailDeliveryEvent,MessageCreditLedger
from ..junior_models import JuniorConfig,JuniorAudit,JuniorChild,JuniorVolunteerProfile as Profile,JuniorVolunteerMessage as Message,JuniorVolunteerShift as Shift
from ..config import settings
from .junior_practice import is_practice
from .junior_days import view,day
from .public_event_policy import event_communications_blocked
from services.email_service import send_simple_email
from services.outbound_safety import recipient_allowed


def app_url(event):return settings.frontend_url.rstrip('/')+'/juniors/?event='+quote(event.id,safe='')


def operation_id(event_id,kind,key):return str(uuid.uuid5(uuid.NAMESPACE_URL,'juniors:'+event_id+':'+kind+':'+key))


async def prior(db,event,actor,kind,body):
    identity=operation_id(event.id,kind,body.request_id)
    fingerprint=hashlib.sha256(json.dumps(body.model_dump(mode='json'),sort_keys=True).encode()).hexdigest()
    audit=await db.get(JuniorAudit,identity)
    if audit:
        from fastapi import HTTPException
        if audit.detail['fingerprint']!=fingerprint:raise HTTPException(409,'This request ID was used for different data')
        return identity,fingerprint,audit.detail['result']
    return identity,fingerprint,None


def finish(db,event,actor,kind,identity,fingerprint,result):
    db.add(JuniorAudit(id=identity,event_id=event.id,actor_id=actor.id,action=kind,detail={'fingerprint':fingerprint,'result':result}))


async def provision(db,event,name,email,phone,role,classrooms,cfg):
    # Savepoints handle concurrent invitations in different events without a partial batch.
    from sqlalchemy import func
    from fastapi import HTTPException
    matches=(await db.scalars(select(User).where(func.lower(User.email)==email))).all()
    if len(matches)>1:raise HTTPException(409,'Multiple accounts use this email. Ask an administrator to resolve them.')
    user=matches[0] if matches else None
    if not user:
        try:
            async with db.begin_nested():
                user=User(name=name,email=email,role='official');db.add(user);await db.flush()
        except IntegrityError:
            user=await db.scalar(select(User).where(User.email==email))
            if not user:raise
    if not user.is_active:raise HTTPException(409,'This account is suspended. Contact an administrator.')
    membership=await db.scalar(select(Membership).where(Membership.org_id==event.org_id,Membership.user_id==user.id))
    if not membership:
        try:
            async with db.begin_nested():db.add(Membership(org_id=event.org_id,user_id=user.id,role='staff'));await db.flush()
        except IntegrityError:
            if not await db.scalar(select(Membership.id).where(Membership.org_id==event.org_id,Membership.user_id==user.id)):raise
    eu=await db.scalar(select(EventUser).where(EventUser.event_id==event.id,EventUser.user_id==user.id))
    if not eu:
        try:
            async with db.begin_nested():
                eu=EventUser(event_id=event.id,user_id=user.id,event_role='staff',access_level='edit',feature_permissions={});db.add(eu);await db.flush()
        except IntegrityError:
            eu=await db.scalar(select(EventUser).where(EventUser.event_id==event.id,EventUser.user_id==user.id))
            if not eu:raise
    active=(await db.scalars(select(Shift).where(Shift.event_id==event.id,Shift.event_user_id==eu.id,Shift.checked_in_at.is_not(None),Shift.checked_out_at.is_(None)))).all()
    if active and ((cfg.staff or {}).get(user.id,role)!=role or any(s.plan.get('classroom') and s.plan['classroom'] not in classrooms for s in active)):raise HTTPException(409,'Complete the active shift handover before changing its role or removing its classroom')
    profile=await db.get(Profile,eu.id)
    if not profile:profile=Profile(event_user_id=eu.id,event_id=event.id,name=name,phone=phone,classrooms=classrooms);db.add(profile)
    else:profile.name=name;profile.phone=phone;profile.classrooms=classrooms;profile.version+=1;profile.updated_at=datetime.utcnow()
    cfg.staff={**(cfg.staff or {}),user.id:role}
    await db.flush()
    return eu,user,profile


async def queue(db,event,eu,user,kind,key,actor,body=None,subject=None):
    existing=await db.scalar(select(Message).where(Message.event_id==event.id,Message.request_key==key))
    if existing:return existing
    profile=await db.get(Profile,eu.id);cfg=await db.get(JuniorConfig,event.id)
    if body is None:
        rooms=', '.join(profile.classrooms or []) if profile else ''
        role=(cfg.staff or {}).get(user.id,'supervisor' if eu.event_role=='manager' else 'volunteer')
        body=f'Hello {profile.name if profile else user.name},\nYou have been assigned to {event.name} in Festio Juniors.\nRole: {role}. Classes: {rooms or "See your shift assignment"}.\nOpen Festio Juniors and sign in with {user.email}. If you do not yet have an account, create one using this same email and verify it. This is staff access, not a guest registration.'
    paused=is_practice(event)
    row=Message(event_id=event.id,event_user_id=eu.id,user_id=user.id,request_key=key,kind=kind,recipient=user.email,subject=subject or ('Your Festio Juniors staff access' if kind=='invite' else 'Your Festio Juniors assignment'),body=body,status='paused' if paused else 'queued',error='Practice events never send staff email' if paused else None,created_by=actor.id)
    db.add(row);await db.flush();return row


async def snapshot(db,event,classroom=None):
    q=select(JuniorChild).where(JuniorChild.event_id==event.id).execution_options(populate_existing=True)
    if classroom:q=q.where(JuniorChild.classroom==classroom)
    children=(await db.scalars(q.order_by(JuniorChild.id))).all();counts={};away=[];parts=[];unresolved=0
    for child in children:
        state=view(child,event);location=state['location'];counts[location]=counts.get(location,0)+1
        if location in ('clinic','other','outing'):away.append({'id':child.id,'name':child.name,'location':location})
        unresolved+=int(state['prior_day_unresolved']);parts.append([child.id,child.version,location,child.classroom,child.name])
    expected=counts.get('classroom',0) if classroom else sum(counts.get(k,0) for k in ('classroom','reception','support_desk'))
    token=hashlib.sha256(json.dumps([day(event),classroom,parts],sort_keys=True).encode()).hexdigest()
    return {'programme_date':day(event),'classroom':classroom,'scope':classroom or 'Overall programme','expected_count':expected,'locations':counts,'away':away,'prior_day_unresolved':unresolved,'token':token}


async def reconcile(db):
    rows=(await db.scalars(select(Message).where(Message.status.in_(['accepted','review_required'])))).all()
    for row in rows:
        latest=await db.scalar(select(EmailDeliveryEvent).where(EmailDeliveryEvent.event_id==row.event_id,EmailDeliveryEvent.message_kind=='jp-team:'+row.id).order_by(EmailDeliveryEvent.occurred_at.desc()).limit(1))
        if latest and latest.provider_email_id:
            row.provider_id=latest.provider_email_id
            if row.ledger_id:
                ledger=await db.get(MessageCreditLedger,row.ledger_id)
                if ledger and ledger.provider_message_id!=latest.provider_email_id:ledger.provider_message_id=latest.provider_email_id;ledger.status='queued'
        receipt=await db.scalar(select(EmailDeliveryEvent).where(EmailDeliveryEvent.event_id==row.event_id,EmailDeliveryEvent.message_kind=='jp-team:'+row.id,EmailDeliveryEvent.status.in_(['delivered','bounced','failed','complained'])).order_by(EmailDeliveryEvent.occurred_at.desc()).limit(1))
        if receipt:row.status='delivered' if receipt.status=='delivered' else 'failed';row.provider_id=receipt.provider_email_id;row.error=None if row.status=='delivered' else 'Provider reported '+receipt.status
    await db.commit()


async def transport(row,event):
    text='<br>'.join(escape(row.body).splitlines())
    return bool(await send_simple_email(row.recipient,row.subject,'<p>'+text+'</p><p><a href="'+escape(app_url(event),quote=True)+'">Open Festio Juniors</a></p>',event_id=event.id,message_kind='jp-team:'+row.id))


async def deliver(message_id,sessions=None,sender=None):
    sessions=sessions or AsyncSessionLocal;sender=sender or transport
    async with sessions() as db:
        initial=await db.get(Message,message_id)
        if not initial:return
        event=await db.scalar(select(Event).where(Event.id==initial.event_id).with_for_update())
        row=await db.scalar(select(Message).where(Message.id==message_id).with_for_update(skip_locked=True).execution_options(populate_existing=True))
        if not row or row.status!='queued':return
        eu=await db.get(EventUser,row.event_user_id) if row.event_user_id else None
        from .junior_volunteers import team_member
        user=await team_member(event,type('Assignment',(),{'event_user_id':eu.id})(),db) if event and eu else None
        reason=None;status='setup_required'
        if is_practice(event):reason='Practice events never send staff email';status='paused'
        elif not event or not event.junior_program_enabled or not user or user.id!=row.user_id:reason='Volunteer access was removed';status='cancelled'
        elif await event_communications_blocked(event,db):reason='Event communications are blocked'
        elif row.created_at<datetime.utcnow()-timedelta(days=2):reason='This staff update has expired; send a new current update';status='expired'
        elif not recipient_allowed('email',user.email):reason='Recipient blocked by outbound policy'
        if reason:row.status=status;row.error=reason;await db.commit();return
        # Custom staff broadcasts use the existing email credit ledger. Access and duty
        # notifications follow the existing transactional Team invitation policy.
        if row.kind=='message':
            from ..entitlements import reserve_message_credit,last_credit_ledger_id
            if not await reserve_message_credit(event,'email',db=db,reason='jp_staff_message',provider_message_id='jp-team:'+row.id):row.status='setup_required';row.error='Email message credits required';await db.commit();return
            row.ledger_id=last_credit_ledger_id(event)
        row.recipient=user.email;row.status='sending';row.attempted_at=datetime.utcnow();await db.commit()
    try:accepted=await sender(row,event);status='accepted' if accepted else 'review_required'
    except Exception:status='review_required'
    async with sessions() as db:
        row=await db.get(Message,message_id);row.status=status;row.error=None if status=='accepted' else 'Provider outcome uncertain; review delivery before sending again';await db.commit()


async def tick():
    async with AsyncSessionLocal() as db:
        # A crash after submitting an email cannot safely be retried automatically.
        stale=(await db.scalars(select(Message).where(Message.status=='sending',Message.attempted_at<datetime.utcnow()-timedelta(minutes=10)))).all()
        for row in stale:row.status='review_required';row.error='Interrupted send; review provider delivery before sending again'
        await db.commit();await reconcile(db)
        ids=(await db.scalars(select(Message.id).where(Message.status=='queued').order_by(Message.created_at).limit(10))).all()
    for identity in ids:await deliver(identity)
