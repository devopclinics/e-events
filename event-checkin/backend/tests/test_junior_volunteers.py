from datetime import datetime,timedelta,timezone
import uuid
import pytest
from sqlalchemy import select,func
from conftest import _Session
from app.models import Event,EventUser,User,Membership,EmailDeliveryEvent,Guest,WhatsAppTemplateSubmission
from app.junior_models import JuniorConfig,JuniorVolunteerShift as Shift,JuniorVolunteerNotice as Notice
from app.services import junior_volunteers as service
from test_junior_programme import setup

async def prepare(ctx,channels=None,**changes):
    root=await setup(ctx)
    async with _Session() as db:
        u=User(name='Desk volunteer',email='staff@example.com',role='official');db.add(u);await db.flush()
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=u.id,role='member'))
        eu=EventUser(event_id=ctx.ids['event_a'],user_id=u.id,event_role='staff',access_level='edit');db.add(eu);await db.flush()
        cfg=await db.get(JuniorConfig,ctx.ids['event_a']);cfg.staff={u.id:'scanner'}
        event=await db.get(Event,ctx.ids['event_a']);event.is_paid=True;event.paid_channels=True;event.message_credits=100
        await db.commit()
    starts=datetime.now(timezone.utc)+timedelta(hours=2)
    body={'request_id':str(uuid.uuid4()),'event_user_id':eu.id,'station':'Reception','starts_at':starts.isoformat(),'ends_at':(starts+timedelta(hours=1)).isoformat(),'channels':channels or ['email'],'enabled':True,**changes}
    r=await ctx.client.post(root+'/volunteers',json=body);assert r.status_code==201,r.text
    return root,u,eu,r.json(),body

@pytest.mark.asyncio
async def test_custom_times_frequency_channels_and_idempotent_creation(ctx):
    root,u,eu,s,body=await prepare(ctx,['email','sms'],minutes_before=[30,15],repeat_every_minutes=17,repeat_from_minutes=53)
    repeat=await ctx.client.post(root+'/volunteers',json=body);assert repeat.json()['id']==s['id']
    data=(await ctx.client.get(root+'/volunteers')).json();assert data['sending_enabled'] is False
    assert data['channels']==['email','sms','whatsapp','mms']
    assert data['members'][0]['name']=='Desk volunteer'
    shift=data['shifts'][0];assert len(shift['notices'])==12
    assert shift['blockers'] and not any('guest' in b.lower() for b in shift['blockers'])
    async with _Session() as db:
        assert await db.scalar(select(func.count(Shift.id)))==1
        assert await db.scalar(select(func.count(Guest.id)))==1
        assert not (await db.get(JuniorConfig,ctx.ids['event_a'])).notifications_enabled

@pytest.mark.asyncio
async def test_relative_exact_times_are_deduplicated_and_timezone_aware(ctx):
    root,u,eu,s,body=await prepare(ctx)
    start=datetime.fromisoformat(body['starts_at'])
    body.update(version=s['version'],exact_times=[(start-timedelta(minutes=30)).isoformat(),(start-timedelta(minutes=45)).astimezone(timezone(timedelta(hours=3))).isoformat()])
    r=await ctx.client.put(root+'/volunteers/'+s['id'],json=body);assert r.status_code==200,r.text
    data=(await ctx.client.get(root+'/volunteers')).json();notices=data['shifts'][0]['notices']
    active=[n for n in notices if n['status']=='scheduled'];assert len(active)==3
    assert sum(n['status']=='cancelled' for n in notices)==2
    assert all(n['due_at'].endswith('+00:00') for n in notices)

@pytest.mark.asyncio
@pytest.mark.parametrize('changes',[{'minutes_before':[0]},{'minutes_before':[-15]},{'repeat_every_minutes':1,'repeat_from_minutes':60},{'channels':['voice']},{'starts_at':'2026-11-24T10:00:00'},{'phone':'837941707'},{'media_url':'http://localhost/a.png'}])
async def test_invalid_or_unsupported_schedule_rejected(ctx,changes):
    root,u,eu,s,body=await prepare(ctx)
    body.update(request_id=str(uuid.uuid4()),**changes)
    r=await ctx.client.post(root+'/volunteers',json=body);assert r.status_code==422,r.text

@pytest.mark.asyncio
async def test_staff_and_cross_tenant_cannot_manage_or_read_shift_contacts(ctx):
    root,u,eu,s,body=await prepare(ctx)
    ctx.login(u);assert (await ctx.client.get(root+'/volunteers')).status_code==403
    assert (await ctx.client.post(root+'/volunteers',json=body)).status_code==403
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.get(root+'/volunteers')).status_code==404

@pytest.mark.asyncio
async def test_edit_cancels_future_notices_and_stale_version_is_rejected(ctx):
    root,u,eu,s,body=await prepare(ctx)
    body.update(version=s['version'],enabled=False,minutes_before=[45])
    assert (await ctx.client.put(root+'/volunteers/'+s['id'],json=body)).status_code==200
    assert (await ctx.client.put(root+'/volunteers/'+s['id'],json=body)).status_code==409
    data=(await ctx.client.get(root+'/volunteers')).json()['shifts'][0]
    assert sum(n['status']=='cancelled' for n in data['notices'])==2
    assert sum(n['status']=='paused' for n in data['notices'])==1

@pytest.mark.asyncio
async def test_paused_expired_removed_team_and_no_consent_do_not_send(ctx):
    root,u,eu,s,body=await prepare(ctx,['email','sms'])
    async with _Session() as db:
        rows=(await db.scalars(select(Notice).order_by(Notice.due_at,Notice.channel))).all();ids=[r.id for r in rows];due=rows[0].due_at
    calls=[]
    async def send(row,shift):calls.append(row.id);return {'accepted':True}
    await service.deliver(ids[0],_Session,send,now=due+timedelta(seconds=1))
    async with _Session() as db:
        assert (await db.get(Notice,ids[0])).status=='paused'
        cfg=await db.get(JuniorConfig,ctx.ids['event_a']);cfg.volunteer_reminders_enabled=True;await db.commit()
    await service.deliver(ids[1],_Session,send,now=due+timedelta(minutes=6))
    async with _Session() as db:
        assert (await db.get(Notice,ids[1])).status=='expired'
        row=await db.get(Notice,ids[2]);next_due=row.due_at
        shift=await db.get(Shift,s['id']);shift.plan={**shift.plan,'phone':'+12025550146'};await db.commit()
    sms=next(r for r in rows if r.channel=='sms' and r.due_at==next_due)
    await service.deliver(sms.id,_Session,send,now=next_due)
    async with _Session() as db:
        assert (await db.get(Notice,sms.id)).status=='setup_required'
        cfg=await db.get(JuniorConfig,ctx.ids['event_a']);cfg.staff={};await db.commit()
    email=next(r for r in rows if r.channel=='email' and r.due_at==next_due)
    await service.deliver(email.id,_Session,send,now=next_due)
    async with _Session() as db:assert (await db.get(Notice,email.id)).status=='cancelled'
    assert not calls

@pytest.mark.asyncio
async def test_live_identity_once_only_acceptance_receipt_and_uncertain_send(ctx):
    root,u,eu,s,body=await prepare(ctx)
    async with _Session() as db:
        cfg=await db.get(JuniorConfig,ctx.ids['event_a']);cfg.volunteer_reminders_enabled=True
        user=await db.get(User,u.id);user.email='corrected@example.com'
        rows=(await db.scalars(select(Notice).order_by(Notice.due_at))).all();await db.commit()
    calls=[]
    async def send(row,shift):calls.append((row.id,row.recipient,row.body));return {'accepted':True,'provider_id':'provider-123'}
    await service.deliver(rows[0].id,_Session,send,now=rows[0].due_at)
    await service.deliver(rows[0].id,_Session,send,now=rows[0].due_at)
    assert len(calls)==1 and calls[0][1]=='corrected@example.com' and 'Reception' in calls[0][2]
    async with _Session() as db:
        await service.reconcile(db);assert (await db.get(Notice,rows[0].id)).status=='accepted'
        db.add(EmailDeliveryEvent(provider='resend',event_id=ctx.ids['event_a'],message_kind='jp-volunteer:'+rows[0].id,provider_email_id='provider-123',status='delivered',event_type='email.delivered'))
        await db.commit();await service.reconcile(db);assert (await db.get(Notice,rows[0].id)).status=='delivered'
    async def uncertain(row,shift):raise TimeoutError()
    await service.deliver(rows[1].id,_Session,uncertain,now=rows[1].due_at)
    await service.deliver(rows[1].id,_Session,send,now=rows[1].due_at)
    async with _Session() as db:assert (await db.get(Notice,rows[1].id)).status=='review_required'
    assert len(calls)==1

@pytest.mark.asyncio
async def test_enabling_sending_is_separate_and_checks_provider_readiness(ctx):
    root,u,eu,s,body=await prepare(ctx)
    r=await ctx.client.put(root+'/volunteers/sending/state',json={'enabled':True});assert r.status_code==409 and 'provider' in r.json()['detail'].lower()
    async with _Session() as db:
        cfg=await db.get(JuniorConfig,ctx.ids['event_a']);assert not cfg.volunteer_reminders_enabled and not cfg.notifications_enabled

@pytest.mark.asyncio
@pytest.mark.parametrize('channel',['email','sms','whatsapp','mms'])
async def test_selected_channels_use_existing_transports_and_require_receipts(ctx,monkeypatch,channel):
    root,u,eu,s,body=await prepare(ctx,[channel],phone='+12025550146',consents=['sms','whatsapp','mms'],media_url='https://assets.example.com/shift.png',whatsapp_template_ref='project:version',whatsapp_template_vars={'body':'{{message}}'})
    from app.config import settings
    from services import messaging
    monkeypatch.setattr(settings,'resend_api_key','synthetic-test-provider-key')
    monkeypatch.setattr(messaging,'_channel_ready',lambda *args:True)
    monkeypatch.setattr(messaging,'_wa_provider',lambda:'bird')
    calls=[]
    async def email(recipient,*args,**kwargs):calls.append(('email',recipient));return True
    async def sms(**kwargs):calls.append(('sms',kwargs['phone']));return {'provider_message_id':'sms-1','status':'accepted','provider':'test'}
    async def whatsapp(**kwargs):
        assert 'Desk volunteer' in kwargs['params'][0] and 'Reception' in kwargs['params'][0]
        assert kwargs['var_keys']==['body'];calls.append(('whatsapp',kwargs['phone']));return {'provider_message_id':'wa-1','status':'accepted','provider':'test'}
    async def mms(**kwargs):
        assert kwargs['media_url']=='https://assets.example.com/shift.png';calls.append(('mms',kwargs['phone']));return {'provider_message_id':'mms-1','status':'accepted','provider':'test'}
    monkeypatch.setattr(service,'send_simple_email',email)
    monkeypatch.setattr(messaging,'send_custom_sms',sms)
    monkeypatch.setattr(messaging,'send_custom_template_whatsapp',whatsapp)
    monkeypatch.setattr(messaging,'send_mms',mms)
    async with _Session() as db:
        db.add(WhatsAppTemplateSubmission(org_id=ctx.ids['org_a'],name='Staff reminder',platform_name='staff-test',body='{{body}}',variables=['body'],status='approved',bird_project_id='project',bird_channel_template_id='version'))
        cfg=await db.get(JuniorConfig,ctx.ids['event_a']);cfg.volunteer_reminders_enabled=True
        row=await db.scalar(select(Notice).order_by(Notice.due_at).limit(1));await db.commit()
    await service.deliver(row.id,sessions=_Session,now=row.due_at)
    await service.deliver(row.id,sessions=_Session,now=row.due_at)
    async with _Session() as db:
        diagnostic=await db.get(Notice,row.id)
        assert len(calls)==1 and calls[0][0]==channel,(diagnostic.status,diagnostic.error)
    async with _Session() as db:assert (await db.get(Notice,row.id)).status=='accepted'
