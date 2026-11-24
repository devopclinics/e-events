"""Event-scoped staff shifts; canonical identity stays in Team. No guest fan-out."""
from datetime import datetime,timedelta,timezone
from html import escape
from zoneinfo import ZoneInfo
from sqlalchemy import select
from ..database import AsyncSessionLocal
from ..models import Event,EventUser,User,Membership,EmailDeliveryEvent,MessageCreditLedger
from ..junior_models import JuniorConfig,JuniorVolunteerShift as Shift,JuniorVolunteerNotice as Notice
from ..entitlements import reserve_message_credit,last_credit_ledger_id,can_use_paid_channels
from ..config import settings
from .public_event_policy import event_communications_blocked
from services import messaging
from services.email_service import send_simple_email
from services.outbound_safety import recipient_allowed


def utc(value):
    if not value.tzinfo or value.utcoffset() is None:raise ValueError('Include a timezone for each shift and reminder time')
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def reminder_times(starts,plan):
    offsets=set(plan['minutes_before'])
    if plan.get('repeat_every_minutes'):
        offsets.update(range(plan['repeat_from_minutes'],0,-plan['repeat_every_minutes']))
    values={starts-timedelta(minutes=x) for x in offsets}
    values.update(utc(datetime.fromisoformat(x.replace('Z','+00:00'))) for x in plan.get('exact_times',[]))
    if not values or len(values)>20:raise ValueError('Choose between 1 and 20 distinct reminder times per shift')
    if any(t>=starts for t in values):raise ValueError('Every reminder must be before the shift starts')
    return sorted(values)


async def team_member(event,shift,db):
    eu=await db.get(EventUser,shift.event_user_id)
    user=await db.get(User,eu.user_id) if eu and eu.event_id==event.id else None
    cfg=await db.get(JuniorConfig,event.id)
    if not user or not user.is_active or not cfg:return None
    if not user.is_platform_superadmin and not await db.scalar(select(Membership.id).where(Membership.org_id==event.org_id,Membership.user_id==user.id)):return None
    if not (eu.event_role=='manager' and not eu.guest_service_scoped) and eu.user_id not in (cfg.staff or {}):return None
    return user


async def whatsapp_template(event,plan,db):
    from ..models import WhatsAppTemplateSubmission
    ref=plan.get('whatsapp_template_ref') or ''
    project,_,version=ref.partition(':')
    row=await db.scalar(select(WhatsAppTemplateSubmission).where(WhatsAppTemplateSubmission.bird_project_id==project,
        WhatsAppTemplateSubmission.bird_channel_template_id==version,WhatsAppTemplateSubmission.status=='approved',
        (WhatsAppTemplateSubmission.org_id==event.org_id)|WhatsAppTemplateSubmission.is_shared.is_(True)))
    return row


async def channel_blocker(event,shift,user,channel,db,*,providers=True):
    plan=shift.plan
    if channel in (event.blocked_messaging_channels or []):return 'Channel blocked by the platform'
    recipient=user.email if channel=='email' else plan.get('phone')
    if not recipient:return 'Volunteer '+('email' if channel=='email' else 'international phone number')+' is missing'
    if not recipient_allowed(channel,recipient):return 'Recipient blocked by outbound policy'
    if channel!='email' and channel not in plan.get('consents',[]):return 'Volunteer '+channel.upper()+' permission is not recorded'
    if channel!='email' and not can_use_paid_channels(event):return 'Paid messaging is not available for this event'
    if providers:
        if channel=='email' and not (settings.resend_api_key or settings.smtp_host or (settings.bird_email_api_base and settings.bird_access_key and settings.bird_workspace_id)):return 'Email provider setup required'
        if channel=='mms':
            ready=bool(settings.clicksend_username and settings.clicksend_api_key) or messaging._channel_ready('sms',recipient)
            if not ready:return 'MMS provider setup required'
        elif channel!='email' and not messaging._channel_ready(channel,recipient):return channel.upper()+' provider setup required'
    if channel=='whatsapp':
        template=await whatsapp_template(event,plan,db)
        if not template:return 'Choose an approved WhatsApp template from this organization'
        if any(not (plan.get('whatsapp_template_vars') or {}).get(k) for k in template.variables):return 'Fill every WhatsApp template variable'
        if providers and messaging._wa_provider()!='bird':return 'Configured custom WhatsApp templates require Bird'
    if channel=='mms' and not plan.get('media_url'):return 'MMS needs a public HTTPS image URL'
    return None


def message(event,shift,user):
    local=shift.starts_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(event.timezone or 'UTC'))
    return f'{event.name} / Junior Platform volunteer reminder: {user.name}, your shift at {shift.station} starts {local:%b %d, %I:%M %p %Z}. Arrive ready for the handover. If delayed, contact your lead; keep child handoffs safe and queues moving.'


async def transport(row,shift):
    if row.channel=='email':
        return {'accepted':bool(await send_simple_email(row.recipient,'Your Junior Platform volunteer shift',f'<p>{escape(row.body)}</p>',event_id=row.event_id,message_kind='jp-volunteer:'+row.id))}
    context=messaging._event_context.set(row.event_id)
    try:
        if row.channel=='sms':result=await messaging.send_custom_sms(phone=row.recipient,body=row.body)
        elif row.channel=='mms':result=await messaging.send_mms(phone=row.recipient,body=row.body,media_url=shift.plan['media_url'])
        else:
            values=shift.plan.get('whatsapp_template_vars') or {}
            keys=shift._whatsapp_keys
            rendered=[]
            for key in keys:
                value=values[key]
                for name,text in shift._context.items():value=value.replace('{{'+name+'}}',text)
                rendered.append(value)
            result=await messaging.send_custom_template_whatsapp(phone=row.recipient,template_ref=shift.plan['whatsapp_template_ref'],params=rendered,var_keys=keys)
    finally:messaging._event_context.reset(context)
    result=result if isinstance(result,dict) else {}
    return {'accepted':bool(result.get('provider_message_id')) and str(result.get('status','')).lower() not in ('failed','undelivered','error','rejected'),
        'provider_id':result.get('provider_message_id'),'provider':result.get('provider')}


async def deliver(notice_id,sessions=None,sender=None,now=None):
    sessions=sessions or AsyncSessionLocal;sender=sender or transport;now=now or datetime.utcnow()
    async with sessions() as db:
        initial=await db.get(Notice,notice_id)
        if not initial:return
        event=await db.scalar(select(Event).where(Event.id==initial.event_id).with_for_update())
        shift=await db.scalar(select(Shift).where(Shift.id==initial.shift_id).with_for_update())
        row=await db.scalar(select(Notice).where(Notice.id==notice_id).with_for_update(skip_locked=True).execution_options(populate_existing=True))
        if not row or row.status!='scheduled' or row.due_at>now:return
        cfg=await db.get(JuniorConfig,row.event_id)
        user=await team_member(event,shift,db) if event and shift else None
        reason=None;status='setup_required'
        from .junior_practice import is_practice
        if is_practice(event):
            reason='Practice events never send volunteer reminders';status='paused'
        elif not event or not cfg or not shift or not event.junior_program_enabled or not cfg.volunteer_reminders_enabled or not shift.enabled:
            reason='Volunteer reminders are paused';status='paused'
        elif row.generation!=shift.version:reason='Shift schedule changed';status='cancelled'
        elif now>=shift.starts_at or now-row.due_at>timedelta(minutes=5):reason='Reminder time passed; historical notices are not replayed';status='expired'
        elif not user:reason='Volunteer is no longer active on the Junior Platform team';status='cancelled'
        elif await event_communications_blocked(event,db):reason='Event communications are blocked'
        else:reason=await channel_blocker(event,shift,user,row.channel,db,providers=sender is transport)
        if reason:
            row.status=status;row.error=reason;await db.commit();return
        row.recipient=user.email if row.channel=='email' else shift.plan.get('phone')
        row.body=message(event,shift,user)
        if row.channel=='whatsapp':
            template=await whatsapp_template(event,shift.plan,db)
            shift._whatsapp_keys=list(template.variables)
            local=shift.starts_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(event.timezone or 'UTC'))
            shift._context={'message':row.body,'volunteer_name':user.name,'station':shift.station,'shift_start':local.strftime('%b %d, %I:%M %p %Z'),'event_name':event.name}
        if not await reserve_message_credit(event,row.channel,db=db,reason='jp_volunteer_reminder',provider_message_id='jp-volunteer:'+row.id):
            row.status='setup_required';row.error='Message credits required';await db.commit();return
        row.ledger_id=last_credit_ledger_id(event);row.status='sending';row.attempted_at=now;await db.commit()
    try:
        result=await sender(row,shift)
        status='accepted' if result.get('accepted') else 'review_required'
    except Exception:
        result={};status='review_required'
    async with sessions() as db:
        saved=await db.get(Notice,notice_id);saved.status=status;saved.provider_id=result.get('provider_id')
        saved.error=None if status=='accepted' else 'Provider outcome uncertain; reconcile before sending again'
        if saved.ledger_id and saved.provider_id:
            ledger=await db.get(MessageCreditLedger,saved.ledger_id)
            if ledger:ledger.provider=result.get('provider');ledger.provider_message_id=saved.provider_id;ledger.status='queued'
        await db.commit()


async def reconcile(db,now=None):
    now=now or datetime.utcnow()
    rows=(await db.scalars(select(Notice).where(Notice.status.in_(['accepted','sending'])).order_by(Notice.due_at.desc()).limit(200))).all()
    for row in rows:
        if row.status=='sending':
            if row.attempted_at and now-row.attempted_at>timedelta(minutes=5):row.status='review_required';row.error='Interrupted send; reconcile before resending'
            continue
        if row.channel=='email':
            receipt=await db.scalar(select(EmailDeliveryEvent).where(EmailDeliveryEvent.event_id==row.event_id,EmailDeliveryEvent.message_kind=='jp-volunteer:'+row.id).order_by(EmailDeliveryEvent.occurred_at.desc()).limit(1))
            if receipt and receipt.provider_email_id:row.provider_id=receipt.provider_email_id
            if receipt and receipt.status in ('delivered','bounced','failed','complained'):
                row.status='delivered' if receipt.status=='delivered' else 'failed'
                row.error=None if row.status=='delivered' else 'Provider reported '+receipt.status
        elif row.ledger_id:
            ledger=await db.get(MessageCreditLedger,row.ledger_id)
            if ledger and ledger.status=='delivered':row.status='delivered'
            elif ledger and ledger.status in ('failed','refunded','undelivered','rejected'):row.status='failed';row.error='Provider reported delivery failure'
    await db.commit()


async def tick():
    async with AsyncSessionLocal() as db:
        await reconcile(db)
        ids=(await db.scalars(select(Notice.id).where(Notice.status=='scheduled',Notice.due_at<=datetime.utcnow()).order_by(Notice.due_at).limit(10))).all()
    for row_id in ids:
        await deliver(row_id)
