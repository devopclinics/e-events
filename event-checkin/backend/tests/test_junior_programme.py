from datetime import date, datetime, timedelta, timezone
import uuid
import pytest
from sqlalchemy import select, func
from conftest import _Session
from app.models import Event, Guest, User, Membership, EventUser, EmailDeliveryEvent
from app.junior_models import JuniorChild, JuniorConfig, JuniorContact, JuniorMovement, JuniorNotification
from app.services import junior_outbox


async def setup(ctx):
    ctx.login(ctx.ids['user_a'])
    root=f"/api/events/{ctx.ids['event_a']}/junior"
    response=await ctx.client.put(root+'/config',json={'enabled':True,'classrooms':['Group A','Group B']})
    assert response.status_code==200,response.text
    return root


async def child(ctx, root, guardian=True, name='Amina Yusuf'):
    body={'name':name,'age_group':'5–6','classroom':'Group A'}
    if guardian:body['guardian']={'name':'Maryam Yusuf','relationship':'parent','email':'maryam@example.com',
        'phone':'+12025550146','sms_consent':True,'adult_verified':True,'pickup_authorized':True}
    response=await ctx.client.post(root+'/children',json=body)
    assert response.status_code==201,response.text
    return response.json()


async def act(ctx,root,c,action,expected=200,**kwargs):
    response=await ctx.client.post(root+f"/children/{c['id']}/actions",json={'request_id':str(uuid.uuid4()),'version':c['version'],'action':action,**kwargs})
    assert response.status_code==expected,response.text
    return response.json()


async def drop(ctx,root,c,**kw):
    return await act(ctx,root,c,'dropoff',adult_name='Maryam Yusuf',relationship='parent',identity_checked=True,allergy=False,accommodation=False,**kw)


@pytest.mark.asyncio
async def test_disabled_default_and_shared_guest_roster(ctx):
    ctx.login(ctx.ids['user_a']);root=f"/api/events/{ctx.ids['event_a']}/junior"
    cfg=await ctx.client.get(root+'/config');assert cfg.json()['enabled'] is False
    assert (await ctx.client.get(root+'/children')).status_code==409
    root=await setup(ctx)
    async with _Session() as db:
        before=await db.scalar(select(func.count(Guest.id)))
    c=await child(ctx,root)
    assert c['location']=='not_arrived'
    async with _Session() as db:
        assert await db.scalar(select(func.count(Guest.id)))==before+2
        assert (await db.get(Event,ctx.ids['event_a'])).junior_program_enabled is True
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get(root+'/children')).status_code==404


@pytest.mark.asyncio
async def test_screening_both_referrals_and_restricted_notes(ctx):
    root=await setup(ctx);c=await child(ctx,root)
    c=await act(ctx,root,c,'dropoff',adult_name='Parent',relationship='parent',identity_checked=True,allergy=True,accommodation=True)
    assert c['location']=='support_desk'
    await act(ctx,root,c,'classroom',expected=409)
    await act(ctx,root,c,'clear_allergy',expected=400,notes='Allergy details',wristband_assigned=False)
    c=await act(ctx,root,c,'clear_allergy',notes='SECRET allergy detail',wristband_assigned=True)
    await act(ctx,root,c,'classroom',expected=409)
    c=await act(ctx,root,c,'clear_accommodation',notes='SECRET accommodation detail',wristband_assigned=True)
    c=await act(ctx,root,c,'classroom');assert c['location']=='classroom'
    notices=(await ctx.client.get(root+'/notifications')).json()
    assert not any('SECRET' in n['body'] for n in notices)
    assert all(n['status']=='paused' for n in notices)


@pytest.mark.asyncio
async def test_missing_guardian_blocks_release_and_sibling_age(ctx):
    root=await setup(ctx);c=await child(ctx,root,guardian=False)
    await act(ctx,root,c,'dropoff',expected=400,adult_name='Sibling',relationship='adult_sibling',identity_checked=True)
    c=await drop(ctx,root,c)
    await act(ctx,root,c,'release',expected=409,identity_checked=True)
    r=await ctx.client.post(root+f"/children/{c['id']}/contacts",json={'name':'Sibling','relationship':'adult_sibling','pickup_authorized':True})
    assert r.status_code==400
    r=await ctx.client.post(root+f"/children/{c['id']}/contacts",json={'name':'Sibling','relationship':'adult_sibling','pickup_authorized':True,'adult_verified':True})
    contact=r.json()['id'];c=(await ctx.client.get(root+f"/children/{c['id']}")).json()
    await act(ctx,root,c,'release',expected=400,contact_id=contact)
    c=await act(ctx,root,c,'release',contact_id=contact,identity_checked=True)
    assert c['location']=='released'


@pytest.mark.asyncio
async def test_duplicate_retry_stale_version_and_temporary_return(ctx):
    root=await setup(ctx);c=await child(ctx,root)
    request={'request_id':str(uuid.uuid4()),'version':c['version'],'action':'dropoff','adult_name':'Parent','relationship':'parent','identity_checked':True,'allergy':False,'accommodation':False}
    a=await ctx.client.post(root+f"/children/{c['id']}/actions",json=request)
    b=await ctx.client.post(root+f"/children/{c['id']}/actions",json=request)
    assert a.json()['version']==b.json()['version']
    await act(ctx,root,c,'classroom',expected=409)
    c=await act(ctx,root,a.json(),'classroom')
    await act(ctx,root,c,'other',expected=400,adult_name='Adult')
    c=await act(ctx,root,c,'clinic',adult_name='Clinic volunteer')
    await act(ctx,root,c,'release',expected=409,identity_checked=True)
    c=await act(ctx,root,c,'return');assert c['location']=='reception'
    c=await act(ctx,root,c,'classroom');assert c['location']=='classroom'
    async with _Session() as db:
        assert await db.scalar(select(func.count(JuniorMovement.id)).where(JuniorMovement.child_id==c['id'],JuniorMovement.action=='dropoff'))==1


@pytest.mark.asyncio
async def test_outing_headcount_cannot_close_with_missing_child(ctx):
    root=await setup(ctx);c=await child(ctx,root);c=await drop(ctx,root,c);c=await act(ctx,root,c,'classroom')
    r=await ctx.client.post(root+'/outings',json={'name':'Museum','outing_date':datetime.now(timezone.utc).date().isoformat(),'child_ids':[c['id']],'permission_verified':False});assert r.status_code==400
    r=await ctx.client.post(root+'/outings',json={'name':'Museum','outing_date':datetime.now(timezone.utc).date().isoformat(),'child_ids':[c['id']],'permission_verified':True});assert r.status_code==201,r.text
    outing=r.json()['id'];c=await act(ctx,root,c,'outing_depart',outing_id=outing)
    assert (await ctx.client.post(root+f'/outings/{outing}/close')).status_code==409
    roster=(await ctx.client.get(root+'/outings')).json()[0]
    assert roster['expected']==roster['departed']==1 and len(roster['outstanding'])==1
    await act(ctx,root,c,'release',expected=409,identity_checked=True)
    c=await act(ctx,root,c,'outing_return',outing_id=outing);assert c['location']=='reception'
    assert (await ctx.client.post(root+f'/outings/{outing}/close')).status_code==200
    roster=(await ctx.client.get(root+'/outings')).json()[0];assert roster['returned']==1 and not roster['outstanding']


@pytest.mark.asyncio
async def test_staff_roles_restrict_identity_medical_and_inventory(ctx):
    root=await setup(ctx);c=await child(ctx,root)
    async with _Session() as db:
        user=User(name='Scanner',email='scanner@example.com',role='official');db.add(user);await db.flush()
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=user.id,role='member'))
        db.add(EventUser(event_id=ctx.ids['event_a'],user_id=user.id,event_role='staff',access_level='edit'))
        config=await db.get(JuniorConfig,ctx.ids['event_a']);config.staff={user.id:'scanner'}
        record=await db.get(JuniorChild,c['id']);record.allergy_notes='private'
        await db.commit()
    ctx.login(user)
    r=await ctx.client.get(root+f"/children/{c['id']}");assert r.status_code==200
    assert 'allergy_notes' not in r.json() and 'email' not in r.json()['contacts'][0]
    assert (await ctx.client.post(root+'/children',json={'name':'New','age_group':'5','classroom':'Group A'})).status_code==403
    assert (await ctx.client.patch(root+f"/children/{c['id']}",json={'version':1,'name':'Changed','classroom':'Group A','reason':'Rename'})).status_code==403
    assert (await ctx.client.get(root+'/notifications')).status_code==403
    assert (await ctx.client.get(root+'/inventory')).status_code==403
    await act(ctx,root,c,'clear_allergy',expected=403,notes='test',wristband_assigned=True)
    async with _Session() as db:
        config=await db.get(JuniorConfig,ctx.ids['event_a']);config.staff={user.id:'inventory'};await db.commit()
    assert (await ctx.client.get(root+'/children')).status_code==403
    assert (await ctx.client.get(root+'/outings')).status_code==403


@pytest.mark.asyncio
async def test_batch_import_atomic_duplicates_and_no_convention_guest_writes(ctx):
    root=await setup(ctx)
    body={'children':[{'name':'Same Name','reference':'JP-1','age_group':'5','classroom':'Group A'},
                      {'name':'Other','reference':'JP-1','age_group':'5','classroom':'Group A'}]}
    assert (await ctx.client.post(root+'/import',json=body)).status_code==409
    assert (await ctx.client.get(root+'/children')).json()==[]
    body['children'][1]['reference']='JP-2'
    assert (await ctx.client.post(root+'/import',json=body)).status_code==201
    assert (await ctx.client.post(root+'/import',json=body)).status_code==409


@pytest.mark.asyncio
async def test_inventory_balance_duplicate_and_audit(ctx):
    root=await setup(ctx)
    item=(await ctx.client.post(root+'/inventory',json={'name':'Laptops','total':3})).json()['id']
    path=root+f'/inventory/{item}/actions';request={'request_id':str(uuid.uuid4()),'version':1,'action':'issue','quantity':2,'responsible':'Volunteer A'}
    assert (await ctx.client.post(path,json=request)).status_code==200
    assert (await ctx.client.post(path,json=request)).status_code==200
    request.update(request_id=str(uuid.uuid4()),version=2,quantity=2)
    assert (await ctx.client.post(path,json=request)).status_code==409
    request.update(action='damaged',quantity=1)
    assert (await ctx.client.post(path,json=request)).status_code==200
    item=(await ctx.client.get(root+'/inventory')).json()[0];assert (item['issued'],item['damaged'],item['total'])==(1,1,3)
    history=(await ctx.client.get(root+f"/inventory/{item['id']}/history")).json();assert len(history)==2


@pytest.mark.asyncio
async def test_readonly_permissions_and_removed_assignment(ctx):
    root=await setup(ctx)
    async with _Session() as db:
        user=User(name='Viewer',email='viewer@example.com',role='official');db.add(user);await db.flush()
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=user.id,role='member'))
        eu=EventUser(event_id=ctx.ids['event_a'],user_id=user.id,event_role='manager',access_level='view');db.add(eu)
        await db.commit()
    ctx.login(user)
    assert (await ctx.client.get(root+'/children')).status_code==200
    assert (await ctx.client.put(root+'/config',json={'enabled':True,'classrooms':['Group A']})).status_code==403
    async with _Session() as db:
        member=await db.get(EventUser,eu.id);member.event_role='staff';member.access_level='edit'
        config=await db.get(JuniorConfig,ctx.ids['event_a']);config.staff={user.id:'scanner'};await db.commit()
        await db.delete(member);await db.commit()
    assert (await ctx.client.get(root+'/children')).status_code==403


@pytest.mark.asyncio
async def test_notification_worker_acceptance_uncertainty_and_paused_history(ctx,monkeypatch):
    root=await setup(ctx);c=await child(ctx,root)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.notify_email=True;event.notify_sms=True;event.is_paid=True
        config=await db.get(JuniorConfig,event.id);config.notifications_enabled=True;await db.commit()
    c=await drop(ctx,root,c)
    async with _Session() as db:
        rows=(await db.scalars(select(JuniorNotification).where(JuniorNotification.status=='queued',JuniorNotification.channel=='email'))).all();assert len(rows)==1
        row_id=rows[0].id
        paused=(await db.scalars(select(JuniorNotification).where(JuniorNotification.status=='paused'))).all();assert len(paused)==2
    calls=[]
    async def sender(row):calls.append(row.id);return {'accepted':True}
    await junior_outbox.deliver(row_id,sessions=_Session,sender=sender)
    await junior_outbox.deliver(row_id,sessions=_Session,sender=sender)
    assert calls==[row_id]
    async with _Session() as db:
        row=await db.get(JuniorNotification,row_id);assert row.status=='accepted'
        # Provider acceptance alone never becomes Delivered.
        await junior_outbox.receipts(db);assert row.status=='accepted'
        db.add(EmailDeliveryEvent(provider='resend',event_id=ctx.ids['event_a'],message_kind='junior:'+row_id,
            provider_email_id='provider-123',event_type='email.delivered',status='delivered',occurred_at=datetime.utcnow()))
        await db.commit();await junior_outbox.receipts(db);assert row.status=='delivered'
    assert (await ctx.client.post(root+f'/notifications/{row_id}/retry')).status_code==409
    c=await act(ctx,root,c,'classroom')
    async with _Session() as db:
        row=await db.scalar(select(JuniorNotification).where(JuniorNotification.channel=='email',JuniorNotification.status=='queued'));uncertain=row.id
    async def timeout(row):raise TimeoutError('provider may have accepted')
    await junior_outbox.deliver(uncertain,sessions=_Session,sender=timeout)
    async with _Session() as db:assert (await db.get(JuniorNotification,uncertain)).status=='review_required'
    assert (await ctx.client.post(root+f'/notifications/{uncertain}/retry')).status_code==409


@pytest.mark.asyncio
async def test_notification_revocation_and_expiry_block_provider_call(ctx):
    root=await setup(ctx);c=await child(ctx,root)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.notify_email=True;event.notify_sms=True
        config=await db.get(JuniorConfig,event.id);config.notifications_enabled=True;await db.commit()
    c=await drop(ctx,root,c)
    async with _Session() as db:
        row=await db.scalar(select(JuniorNotification).where(JuniorNotification.channel=='email',JuniorNotification.status=='queued'));row.created_at=datetime.utcnow()-timedelta(days=2);row_id=row.id;await db.commit()
    async def forbidden(row):raise AssertionError('Provider must not be reached')
    await junior_outbox.deliver(row_id,sessions=_Session,sender=forbidden)
    async with _Session() as db:assert (await db.get(JuniorNotification,row_id)).status=='setup_required'
    assert (await ctx.client.post(root+f'/notifications/{row_id}/retry')).status_code==409


@pytest.mark.asyncio
async def test_contact_edit_revocation_and_correction_history(ctx):
    root=await setup(ctx);c=await child(ctx,root)
    detail=(await ctx.client.get(root+f"/children/{c['id']}")).json()
    assert detail['badge_data_url'].startswith('data:image/png;base64,')
    contact=detail['contacts'][0]
    body={k:contact[k] for k in ['name','relationship','email','phone','sms_consent','adult_verified','pickup_authorized','notify']}
    body.update(version=c['version'],pickup_authorized=False)
    r=await ctx.client.put(root+f"/children/{c['id']}/contacts/{contact['id']}",json=body);assert r.status_code==200,r.text
    assert (await ctx.client.put(root+f"/children/{c['id']}/contacts/{contact['id']}",json=body)).status_code==409
    c=(await ctx.client.get(root+f"/children/{c['id']}")).json();c=await drop(ctx,root,c)
    await act(ctx,root,c,'release',expected=409,contact_id=contact['id'],identity_checked=True)
    r=await ctx.client.patch(root+f"/children/{c['id']}",json={'version':c['version'],'name':'Aminah Yusuf','classroom':'Group B','reason':'Corrected against JP roster'})
    assert r.status_code==200
    detail=(await ctx.client.get(root+f"/children/{c['id']}")).json()
    correction=next(h for h in detail['history'] if h['action']=='correction')
    assert correction['correction']['before']['name']=='Amina Yusuf'
    assert correction['correction']['after']['name']=='Aminah Yusuf'
    assert correction['actor_name']=='Alice'


@pytest.mark.asyncio
async def test_module_disable_preserves_data_and_other_event_default(ctx):
    root=await setup(ctx);c=await child(ctx,root)
    r=await ctx.client.put(root+'/config',json={'enabled':False,'classrooms':['Group A','Group B']});assert r.status_code==200
    assert (await ctx.client.get(root+'/children')).status_code==409
    async with _Session() as db:
        assert await db.get(JuniorChild,c['id']) is not None
        org=ctx.ids['org_a']
        future=Event(org_id=org,name='Future event',couples_name='Future',event_date=datetime.utcnow(),checkin_base_url='http://test')
        db.add(future);await db.commit();assert future.junior_program_enabled is False


@pytest.mark.asyncio
async def test_recipient_change_cannot_send_old_contact_snapshot(ctx):
    root=await setup(ctx);c=await child(ctx,root)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.notify_email=True;event.notify_sms=True
        config=await db.get(JuniorConfig,event.id);config.notifications_enabled=True;await db.commit()
    c=await drop(ctx,root,c)
    async with _Session() as db:
        row=await db.scalar(select(JuniorNotification).where(JuniorNotification.channel=='email',JuniorNotification.status=='queued'))
        row_id=row.id;contact=await db.get(JuniorContact,row.contact_id);guardian=await db.get(Guest,contact.guardian_guest_id);guardian.email='changed@example.com';await db.commit()
    called=[]
    async def sender(row):called.append(row.id);return {'accepted':True}
    await junior_outbox.deliver(row_id,sessions=_Session,sender=sender)
    assert not called
    async with _Session() as db:
        row=await db.get(JuniorNotification,row_id);assert row.status=='setup_required'
    r=await ctx.client.post(root+f'/notifications/{row_id}/retry');assert r.status_code==200
    async with _Session() as db:
        row=await db.get(JuniorNotification,row_id);assert row.recipient=='changed@example.com'


@pytest.mark.asyncio
async def test_junior_notices_do_not_enable_or_depend_on_convention_notices(ctx):
    root=await setup(ctx);c=await child(ctx,root)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.notify_email=False;event.notify_sms=False
        config=await db.get(JuniorConfig,event.id);config.notifications_enabled=True;await db.commit()
    c=await drop(ctx,root,c)
    async with _Session() as db:
        row=await db.scalar(select(JuniorNotification).where(JuniorNotification.channel=='email',JuniorNotification.status=='queued'));row_id=row.id
    async def sender(row):return {'accepted':True}
    await junior_outbox.deliver(row_id,sessions=_Session,sender=sender)
    async with _Session() as db:
        assert (await db.get(JuniorNotification,row_id)).status=='accepted'
        event=await db.get(Event,ctx.ids['event_a']);assert not event.notify_email and not event.notify_sms


@pytest.mark.asyncio
async def test_names_only_intake_cannot_enter_classroom_or_release(ctx):
    root=await setup(ctx)
    r=await ctx.client.post(root+'/import',json={'children':[{'name':'Name Only'}]});assert r.status_code==201,r.text
    c=r.json()[0];assert c['classroom']=='' and c['age_group']=='Pending confirmation'
    c=await drop(ctx,root,c)
    await act(ctx,root,c,'classroom',expected=409)
    await act(ctx,root,c,'release',expected=409,identity_checked=True)
    r=await ctx.client.patch(root+f"/children/{c['id']}",json={'version':c['version'],'name':'Correct Name','classroom':'','reason':'Corrected real name at intake'})
    assert r.status_code==200,r.text


@pytest.mark.asyncio
async def test_existing_guest_juniors_and_guardians_are_linked_without_duplicates(ctx):
    root=await setup(ctx)
    async with _Session() as db:
        minor=Guest(event_id=ctx.ids['event_a'],first_name='Existing',last_name='Child',is_junior=True)
        adult=Guest(event_id=ctx.ids['event_a'],first_name='Existing',last_name='Parent',email='parent@example.com',sms_consent=False)
        db.add_all([minor,adult]);await db.flush()
        event=await db.get(Event,ctx.ids['event_a']);event.guardian_authorizations={minor.id:[{'guardian_guest_id':adult.id,'relationship':'parent','source':'admin'}]}
        await db.commit();before=await db.scalar(select(func.count(Guest.id)))
    roster=(await ctx.client.get(root+'/children')).json();assert len(roster)==1 and roster[0]['guest_id']==minor.id
    detail=(await ctx.client.get(root+f"/children/{minor.id}")).json()
    assert detail['contacts'][0]['guardian_guest_id']==adult.id
    assert detail['contacts'][0]['pickup_authorized'] is True
    assert detail['contacts'][0]['adult_verified'] is False
    # Every view reuses the same identities and does not assume a guardian's age/consent.
    await ctx.client.get(root+'/children')
    async with _Session() as db:assert await db.scalar(select(func.count(Guest.id)))==before
    resolved=await ctx.client.post(root+'/resolve',json={'token':f'https://festio.events/scan/{minor.qr_token}'})
    assert resolved.status_code==200 and resolved.json()['child_id']==minor.id
    assert (await ctx.client.post(root+'/resolve',json={'token':adult.qr_token})).status_code==409


@pytest.mark.asyncio
async def test_shared_name_edits_update_both_views_and_preserve_admission(ctx):
    root=await setup(ctx);c=await child(ctx,root)
    assert c['guest_id']
    response=await ctx.client.patch(f"/api/events/{ctx.ids['event_a']}/guests/{c['guest_id']}",json={'first_name':'Aminah'})
    assert response.status_code==200
    c=(await ctx.client.get(root+f"/children/{c['id']}")).json();assert c['name']=='Aminah Yusuf'
    response=await ctx.client.patch(root+f"/children/{c['id']}",json={'version':c['version'],'name':'Aminah Corrected','classroom':'Group A','reason':'Real name confirmed'})
    assert response.status_code==200,response.text
    guests=(await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")).json()
    linked=next(g for g in guests if g['id']==c['guest_id'])
    assert linked['first_name']=='Aminah' and linked['last_name']=='Corrected'
    assert linked['admitted'] is False and linked['invite_sent_at'] is None
    assert linked['junior_platform_status']=='not_arrived'
    guardian=next(g for g in guests if g['first_name']=='Maryam')
    assert guardian['junior_guardian_for']==['Aminah Corrected']


@pytest.mark.asyncio
async def test_existing_guardian_selection_and_main_guest_list_revocation(ctx):
    root=await setup(ctx);c=await child(ctx,root,guardian=False)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.is_paid=True;event.venue_access_enabled=True;await db.commit()
    response=await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/guests",json={'first_name':'Actual','last_name':'Parent','email':'actual@example.com'})
    guardian=response.json();before=len((await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")).json())
    response=await ctx.client.post(root+f"/children/{c['id']}/contacts",json={'guardian_guest_id':guardian['id'],'name':'Actual Parent','relationship':'parent','adult_verified':True,'pickup_authorized':True,'notify':False})
    assert response.status_code==201,response.text
    contact=response.json()['id']
    assert len((await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")).json())==before
    c=(await ctx.client.get(root+f"/children/{c['id']}")).json();c=await drop(ctx,root,c)
    # Revocation through the established guardian API must take effect in JP immediately.
    r=await ctx.client.put(f"/api/events/{ctx.ids['event_a']}/access/guardian-authorizations",json={'enabled':True,'authorizations':[]})
    assert r.status_code==200,r.text
    await act(ctx,root,c,'release',expected=409,contact_id=contact,identity_checked=True)


@pytest.mark.asyncio
async def test_active_child_and_guardian_cannot_be_deleted_from_guest_list(ctx):
    root=await setup(ctx);c=await child(ctx,root);detail=(await ctx.client.get(root+f"/children/{c['id']}")).json()
    guardian=detail['contacts'][0]['guardian_guest_id'];c=await drop(ctx,root,c)
    for gid in [c['guest_id'],guardian]:
        response=await ctx.client.delete(f"/api/events/{ctx.ids['event_a']}/guests/{gid}")
        assert response.status_code==409,response.text


@pytest.mark.asyncio
async def test_foreign_event_guest_cannot_be_linked_and_same_name_requires_review(ctx):
    root=await setup(ctx)
    async with _Session() as db:
        other=Event(org_id=ctx.ids['org_a'],name='Other',couples_name='Other',event_date=datetime.utcnow(),checkin_base_url='http://test');db.add(other);await db.flush()
        guest=Guest(event_id=other.id,first_name='Foreign',last_name='Child',is_junior=True);db.add(guest);await db.commit()
    r=await ctx.client.post(root+'/children',json={'guest_id':guest.id,'name':'Foreign Child'});assert r.status_code==404
    await child(ctx,root,guardian=False,name='Existing Name')
    r=await ctx.client.post(root+'/children',json={'name':'Existing Name'});assert r.status_code==409


@pytest.mark.asyncio
async def test_stale_guardian_edit_cannot_overwrite_guest_list_changes(ctx):
    root=await setup(ctx);c=await child(ctx,root)
    detail=(await ctx.client.get(root+f"/children/{c['id']}")).json();contact=detail['contacts'][0]
    async with _Session() as db:
        guardian=await db.get(Guest,contact['guardian_guest_id']);guardian.email='new@example.com';guardian.updated_at=datetime.utcnow()+timedelta(seconds=1);await db.commit()
    body={k:contact[k] for k in ['name','relationship','email','phone','sms_consent','adult_verified','pickup_authorized','notify','guardian_guest_id','guardian_updated_at']};body['version']=c['version']
    r=await ctx.client.put(root+f"/children/{c['id']}/contacts/{contact['id']}",json=body);assert r.status_code==409,r.text


@pytest.mark.asyncio
async def test_guest_directory_permission_does_not_expose_jp_custody(ctx):
    root=await setup(ctx);c=await child(ctx,root);c=await drop(ctx,root,c)
    async with _Session() as db:
        viewer=User(name='Directory viewer',email='directory@example.com',role='official');db.add(viewer);await db.flush()
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=viewer.id,role='member'))
        db.add(EventUser(event_id=ctx.ids['event_a'],user_id=viewer.id,event_role='staff',can_view_guests=True))
        await db.commit()
    ctx.login(viewer)
    r=await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests");assert r.status_code==200,r.text
    assert all(g['junior_platform_status'] is None and g['junior_guardian_for']==[] for g in r.json())
    assert (await ctx.client.get(root+'/children')).status_code==403
