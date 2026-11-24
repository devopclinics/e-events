from datetime import datetime,timedelta,timezone
import uuid
import pytest
from sqlalchemy import select,func
from conftest import _Session
from test_junior_programme import setup,child,drop,act
from app.models import Event,User,EventUser,Membership,Guest,EmailDeliveryEvent
from app.junior_models import JuniorConfig,JuniorVolunteerProfile as Profile,JuniorVolunteerMessage as Message,JuniorVolunteerShift as Shift,JuniorVolunteerHandover as Handover
from app.services import junior_team as service

def key():return str(uuid.uuid4())
def person(email='one@example.com',**kw):return {'name':'One volunteer','email':email,'phone':'+12025550146','role':'scanner','classrooms':['Group A'],**kw}
async def add(ctx,root,rows=None,**kw):
    body={'request_id':key(),'rows':rows or [person()],**kw};r=await ctx.client.post(root+'/team/bulk',json=body);assert r.status_code==201,r.text;return r.json(),body
async def shifts(ctx,root,ids,**kw):
    now=datetime.now(timezone.utc);body={'request_id':key(),'event_user_ids':ids,'station':'Group A desk','classroom':'Group A','starts_at':(now-timedelta(minutes=5)).isoformat(),'ends_at':(now+timedelta(hours=1)).isoformat(),'channels':['email'],'enabled':True,**kw};r=await ctx.client.post(root+'/team/shifts/bulk',json=body);assert r.status_code==201,r.text;return r.json()['shifts'],body
async def users(ids):
    async with _Session() as db:return [await db.get(User,(await db.get(EventUser,id)).user_id) for id in ids]

@pytest.mark.asyncio
async def test_canonical_bulk_identity_scope_idempotency_no_guest_fanout(ctx):
    root=await setup(ctx)
    async with _Session() as db:
        count=await db.scalar(select(func.count(Guest.id)));u=await db.get(User,ctx.ids['user_a'].id);email=u.email;name=u.name
    result,body=await add(ctx,root,[person(email),person('two@example.com')]);assert len(result['event_user_ids'])==2
    assert (await ctx.client.post(root+'/team/bulk',json=body)).json()==result
    body['rows'][0]['name']='changed';assert (await ctx.client.post(root+'/team/bulk',json=body)).status_code==409
    async with _Session() as db:
        assert (await db.get(User,ctx.ids['user_a'].id)).name==name
        assert await db.scalar(select(func.count(Guest.id)))==count
        assert await db.scalar(select(func.count(Message.id)))==2
        eu=await db.get(EventUser,result['event_user_ids'][1]);assert eu.feature_permissions=={}
        assert (await db.get(Profile,eu.id)).classrooms==['Group A']
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.get(root+'/team')).status_code==404

@pytest.mark.asyncio
async def test_bulk_validation_and_atomic_rollback(ctx):
    root=await setup(ctx)
    result,body=await add(ctx,root)
    body.update(request_id=key(),rows=[person('fresh@example.com'),person('bad@example.com',classrooms=['Missing'])]);assert (await ctx.client.post(root+'/team/bulk',json=body)).status_code==400
    async with _Session() as db:assert not await db.scalar(select(User).where(User.email=='fresh@example.com'))
    body.update(rows=[person(),person()]);assert (await ctx.client.post(root+'/team/bulk',json=body)).status_code==422
    body.update(rows=[person(phone='837941707')]);assert (await ctx.client.post(root+'/team/bulk',json=body)).status_code==422
    a,shiftbody=await shifts(ctx,root,result['event_user_ids'])
    shiftbody.update(request_id=key(),event_user_ids=[*result['event_user_ids'],'foreign']);assert (await ctx.client.post(root+'/team/shifts/bulk',json=shiftbody)).status_code==404
    async with _Session() as db:assert await db.scalar(select(func.count(Shift.id)))==1

@pytest.mark.asyncio
async def test_staff_signin_personal_shifts_and_admin_only_provision(ctx):
    root=await setup(ctx);result,body=await add(ctx,root,[person(role='supervisor'),person('other@example.com')]);assigned,_=await shifts(ctx,root,result['event_user_ids']);ids=await users(result['event_user_ids'])
    ctx.login(ids[0]);assert (await ctx.client.get(root+'/team')).status_code==200
    assert (await ctx.client.post(root+'/team/bulk',json={**body,'request_id':key()})).status_code==403
    assert (await ctx.client.post(root+'/team/assign',json={'request_id':key(),'event_user_ids':result['event_user_ids'],'classrooms':[]})).status_code==403
    ctx.login(ids[1]);mine=(await ctx.client.get(root+'/team/mine')).json();assert len(mine['shifts'])==1
    assert (await ctx.client.get(root+'/team/dashboard')).status_code==403
    assert (await ctx.client.post(root+f"/team/shifts/{assigned[0]['id']}/checkin",json={'version':1,'physically_present':True})).status_code==403
    async with _Session() as db:
        eu=await db.get(EventUser,result['event_user_ids'][1]);eu.access_level='view';await db.commit()
    assert (await ctx.client.get(root+'/team/mine')).status_code==200
    assert (await ctx.client.post(root+f"/team/shifts/{assigned[1]['id']}/checkin",json={'version':1,'physically_present':True})).status_code==403

@pytest.mark.asyncio
async def test_handover_count_reconciliation_stale_snapshot_self_accept_and_checkout(ctx):
    root=await setup(ctx);c=await child(ctx,root);c=await drop(ctx,root,c);c=await act(ctx,root,c,'classroom')
    result,_=await add(ctx,root,[person(),person('two@example.com')]);assigned,_=await shifts(ctx,root,result['event_user_ids']);ids=await users(result['event_user_ids'])
    for uid,s in zip(ids,assigned):
        ctx.login(uid);r=await ctx.client.post(root+f"/team/shifts/{s['id']}/checkin",json={'version':1,'physically_present':True});assert r.status_code==200,r.text
    ctx.login(ids[0]);out=root+f"/team/shifts/{assigned[0]['id']}/checkout";assert (await ctx.client.post(out,json={'version':1,'physically_present':True})).status_code==409
    offer={'request_id':key(),'from_shift_id':assigned[0]['id'],'to_shift_id':assigned[1]['id'],'from_version':1,'to_version':1,'headcount':0,'counts_confirmed':True,'open_movements_reviewed':True}
    r=await ctx.client.post(root+'/team/handovers',json=offer);assert r.status_code==201,r.text;h=r.json();assert h['status']=='attention'
    accept={'version':h['version'],'headcount':1,'snapshot_token':h['current_snapshot']['token'],'counts_confirmed':True,'open_movements_reviewed':True};url=root+'/team/handovers/'+h['id']+'/accept'
    assert (await ctx.client.post(url,json=accept)).status_code==403
    ctx.login(ids[1]);assert (await ctx.client.post(url,json={**accept,'snapshot_token':'stale'})).status_code==409
    assert (await ctx.client.post(url,json={**accept,'headcount':0})).status_code==409
    r=await ctx.client.post(url,json=accept);assert r.status_code==200,r.text;assert r.json()['status']=='accepted'
    assert (await ctx.client.post(url,json=accept)).status_code==200
    ctx.login(ids[0]);assert (await ctx.client.post(out,json={'version':1,'physically_present':True})).status_code==200
    ctx.login(ctx.ids['user_a']);dash=(await ctx.client.get(root+'/team/dashboard')).json();assert dash['summary']['on_duty']==1 and dash['classes'][0]['volunteers_on_duty']==1
    assert (await ctx.client.get(root+'/children/'+c['id'])).json()['location']=='classroom'

@pytest.mark.asyncio
async def test_active_class_assignment_and_attendance_history_protected(ctx):
    root=await setup(ctx);result,_=await add(ctx,root);assigned,body=await shifts(ctx,root,result['event_user_ids']);uid=(await users(result['event_user_ids']))[0]
    ctx.login(uid);r=await ctx.client.post(root+f"/team/shifts/{assigned[0]['id']}/checkin",json={'version':1,'physically_present':True});assert r.status_code==200,r.text
    ctx.login(ctx.ids['user_a']);r=await ctx.client.post(root+'/team/assign',json={'request_id':key(),'event_user_ids':result['event_user_ids'],'classrooms':['Group B']});assert r.status_code==409,r.text
    r=await ctx.client.put(root+'/volunteers/'+assigned[0]['id'],json={**body,'event_user_id':result['event_user_ids'][0],'version':1});assert r.status_code==409,r.text
    second,_=await shifts(ctx,root,result['event_user_ids']);ctx.login(uid)
    assert (await ctx.client.post(root+f"/team/shifts/{second[0]['id']}/checkin",json={'version':1,'physically_present':True})).status_code==409

@pytest.mark.asyncio
async def test_practice_never_sends_even_if_queued_and_dashboard_reports(ctx):
    root=await setup(ctx)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.is_test=True;event.setup_preferences={'junior_practice_source':'source'};await db.commit()
    result,_=await add(ctx,root);assert result['messages'][0]['status']=='paused'
    async with _Session() as db:row=await db.get(Message,result['messages'][0]['id']);row.status='queued';await db.commit()
    calls=[]
    async def sender(*args):calls.append(1);return True
    await service.deliver(result['messages'][0]['id'],_Session,sender);assert calls==[]
    dash=(await ctx.client.get(root+'/team/dashboard')).json();assert dash['summary']['email_and_reminder_status']['paused']==1

@pytest.mark.asyncio
async def test_email_once_current_identity_receipt_and_uncertain_outcome(ctx):
    root=await setup(ctx);result,_=await add(ctx,root);mid=result['messages'][0]['id'];uid=(await users(result['event_user_ids']))[0]
    async with _Session() as db:u=await db.get(User,uid.id);u.email='corrected@example.com';await db.commit()
    calls=[]
    async def sender(row,event):calls.append(row.recipient);return True
    await service.deliver(mid,_Session,sender);await service.deliver(mid,_Session,sender);assert calls==['corrected@example.com']
    async with _Session() as db:
        assert (await db.get(Message,mid)).status=='accepted'
        db.add(EmailDeliveryEvent(provider='resend',event_id=ctx.ids['event_a'],message_kind='jp-team:'+mid,provider_email_id='receipt1',status='delivered',event_type='email.delivered'));await db.commit();await service.reconcile(db);assert (await db.get(Message,mid)).status=='delivered'
    result,_=await add(ctx,root,[person('uncertain@example.com')]);mid=result['messages'][0]['id']
    async def uncertain(*args):raise RuntimeError('network outcome unknown')
    await service.deliver(mid,_Session,uncertain);await service.deliver(mid,_Session,sender)
    async with _Session() as db:assert (await db.get(Message,mid)).status=='review_required'
    assert len(calls)==1

@pytest.mark.asyncio
async def test_custom_broadcast_credits_once_and_provider_receipt_link(ctx):
    root=await setup(ctx);result,_=await add(ctx,root,notify_email=False)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.is_paid=True;event.paid_channels=True;event.message_credits=100;event.emails_sent=100;await db.commit()
    body={'request_id':key(),'event_user_ids':result['event_user_ids'],'subject':'Shift briefing','body':'Please review your station.'}
    r=await ctx.client.post(root+'/team/message',json=body);assert r.status_code==200,r.text;mid=r.json()['messages'][0]['id']
    assert (await ctx.client.post(root+'/team/message',json=body)).json()==r.json()
    calls=[]
    async def sender(*args):calls.append(1);return True
    await service.deliver(mid,_Session,sender);await service.deliver(mid,_Session,sender)
    from app.models import MessageCreditLedger
    async with _Session() as db:
        row=await db.get(Message,mid);assert row.status=='accepted' and row.ledger_id
        assert await db.scalar(select(func.count(MessageCreditLedger.id)).where(MessageCreditLedger.id==row.ledger_id))==1
        db.add(EmailDeliveryEvent(provider='resend',event_id=ctx.ids['event_a'],message_kind='jp-team:'+mid,provider_email_id='real-provider-id',status='delivered',event_type='email.delivered'));await db.commit();await service.reconcile(db)
        ledger=await db.get(MessageCreditLedger,row.ledger_id);assert ledger.provider_message_id=='real-provider-id'
    assert len(calls)==1

@pytest.mark.asyncio
async def test_away_child_still_requires_classroom_handover(ctx):
    root=await setup(ctx);c=await child(ctx,root);c=await drop(ctx,root,c);c=await act(ctx,root,c,'classroom');c=await act(ctx,root,c,'clinic',adult_name='Clinic volunteer')
    result,_=await add(ctx,root);assigned,_=await shifts(ctx,root,result['event_user_ids']);ctx.login((await users(result['event_user_ids']))[0]);s=assigned[0]
    assert (await ctx.client.post(root+f"/team/shifts/{s['id']}/checkin",json={'version':1,'physically_present':True})).status_code==200
    mine=(await ctx.client.get(root+'/team/mine')).json();assert mine['shifts'][0]['snapshot']['away'][0]['name']==c['name']
    assert (await ctx.client.post(root+f"/team/shifts/{s['id']}/checkout",json={'version':1,'physically_present':True})).status_code==409

@pytest.mark.asyncio
async def test_bulk_shift_phone_uses_current_canonical_profile(ctx):
    from app.services.junior_volunteers import volunteer_phone
    root=await setup(ctx);result,_=await add(ctx,root);assigned,_=await shifts(ctx,root,result['event_user_ids'])
    async with _Session() as db:
        shift=await db.get(Shift,assigned[0]['id']);assert await volunteer_phone(shift,db)=='+12025550146'
        profile=await db.get(Profile,result['event_user_ids'][0]);profile.phone='+12025550147';await db.commit();assert await volunteer_phone(shift,db)=='+12025550147'
