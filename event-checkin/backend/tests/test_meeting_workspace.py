from datetime import datetime,timedelta
from types import SimpleNamespace
import jwt
import pytest
from sqlalchemy import select,func
from app.models import Meeting,MeetingAttendee,MeetingDelivery,Membership,Contact
from app.config import settings
from app.services.meeting_followups import release_followups
from app.services.meeting_outbox import deliver,freeze_payload
from app.services.meeting_service import response_token
from conftest import _Session
from test_meetings import create,draft,publish,setup_meetings
pytestmark=pytest.mark.asyncio

async def test_overview_is_paginated_private_and_lightweight(ctx):
    first=await create(ctx,title='Planning Alpha')
    await create(ctx,title='Planning Beta')
    await publish(ctx,first)
    result=(await ctx.client.get('/api/meetings/overview?limit=1')).json()
    assert len(result['items'])==1 and result['total']==2 and result['totals']['meetings']==2
    assert 'attendees' not in result['items'][0] and 'deliveries' not in result['items'][0]
    assert 'agenda' not in result['items'][0]['draft']
    assert (await ctx.client.get('/api/meetings/overview?q=alpha')).json()['total']==1
    assert (await ctx.client.get('/api/meetings/overview?limit=200')).status_code==422
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get('/api/meetings/overview')).json()['total']==0
    assert (await ctx.client.get('/api/meetings/overview?org_id='+ctx.ids['org_a'])).status_code==403

async def test_archive_restore_delete_and_published_retention(ctx):
    m=await create(ctx)
    assert (await ctx.client.post(f'/api/meetings/{m["id"]}/archive',json={'revision':1,'archived':True})).status_code==200
    assert (await ctx.client.get('/api/meetings/overview')).json()['total']==0
    assert (await ctx.client.get('/api/meetings/overview?view=archived')).json()['total']==1
    assert (await ctx.client.put(f'/api/meetings/{m["id"]}',json={**draft(),'revision':1})).status_code==409
    await ctx.client.post(f'/api/meetings/{m["id"]}/archive',json={'revision':1,'archived':False})
    assert (await ctx.client.delete(f'/api/meetings/{m["id"]}?revision=1')).json()['deleted']
    m=await publish(ctx,await create(ctx))
    assert (await ctx.client.delete(f'/api/meetings/{m["id"]}?revision=1')).status_code==409
    token=await token_for(m['id'])
    await ctx.client.post(f'/api/meetings/{m["id"]}/archive',json={'revision':1,'archived':True})
    assert (await ctx.client.post('/api/meeting-responses/'+token,json={'response':'accepted'})).status_code==200

async def test_past_drafts_rejected(ctx):
    ctx.login(ctx.ids['user_a'])
    assert (await ctx.client.post('/api/meetings',json=draft(start='2020-01-01T10:00',end='2020-01-01T11:00'))).status_code==422
    m=await create(ctx)
    assert (await ctx.client.put(f'/api/meetings/{m["id"]}',json={**draft(start='2020-01-01T10:00',end='2020-01-01T11:00'),'revision':1})).status_code==422

async def test_explicit_org_selection_and_opt_in_comanagement(ctx):
    m=await create(ctx)
    async with _Session() as db:
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=ctx.ids['user_b'].id,role='admin'))
        await db.commit()
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get(f'/api/meetings/{m["id"]}')).status_code==404
    result=await ctx.client.post('/api/meetings?org_id='+ctx.ids['org_a'],json=draft(title='Shared',shared_with_org_admins=True))
    assert result.status_code==201,result.text
    shared=result.json()
    ctx.login(ctx.ids['user_a'])
    assert (await ctx.client.get(f'/api/meetings/{shared["id"]}')).status_code==200
    assert (await ctx.client.put(f'/api/meetings/{shared["id"]}',json={**draft(title='Changed',shared_with_org_admins=False),'revision':1})).status_code==403
    assert (await ctx.client.put(f'/api/meetings/{shared["id"]}',json={**draft(title='Changed',shared_with_org_admins=True),'revision':1})).status_code==200

async def test_directory_never_crosses_org_boundary(ctx):
    await create(ctx)
    async with _Session() as db:
        db.add_all([Contact(org_id=ctx.ids['org_a'],first_name='Allowed',email='allowed@example.com'),Contact(org_id=ctx.ids['org_b'],first_name='Secret',email='secret@example.com')]);await db.commit()
    assert (await ctx.client.get('/api/meetings/directory?q=secret')).json()==[]
    result=(await ctx.client.get('/api/meetings/directory?q=allowed')).json()
    assert result==[{'name':'Allowed','email':'allowed@example.com'}]

async def token_for(mid):
    async with _Session() as db:
        m=await db.get(Meeting,mid)
        a=await db.scalar(select(MeetingAttendee).where(MeetingAttendee.meeting_id==mid).order_by(MeetingAttendee.name))
        return response_token(m,a)

async def test_calendar_reply_export_links_and_error_headers(ctx):
    m=await publish(ctx,await create(ctx,attendees=[{'name':'=2+2','email':'alex@example.com'}]))
    calendar=(await ctx.client.get(f'/api/meetings/{m["id"]}/calendar')).json()
    assert 'BEGIN:VCALENDAR' in calendar['content'] and f'meeting-{m["id"]}@festio.events' in calendar['content']
    exported=(await ctx.client.get(f'/api/meetings/{m["id"]}/responses.csv')).json()
    assert "'=2+2" in exported['content']
    aid=m['attendees'][0]['id']
    link=(await ctx.client.get(f'/api/meetings/{m["id"]}/attendees/{aid}/link')).json()['url']
    token=link.rsplit('/',1)[1]
    assert (await ctx.client.get('/api/meeting-responses/'+token)).status_code==200
    for method,path,body in [('GET','/api/meeting-responses/bad',None),('POST','/api/meeting-responses/bad',{'response':'unknown'})]:
        response=await ctx.client.request(method,path,json=body)
        assert response.headers['referrer-policy']=='no-referrer'
        assert response.headers['x-robots-tag']=='noindex, nofollow' and response.headers['cache-control']=='no-store'
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get(f'/api/meetings/{m["id"]}/attendees/{aid}/link')).status_code==404

async def test_nudge_is_idempotent_and_respects_response_before_delivery(ctx):
    m=await publish(ctx,await create(ctx))
    await accept_initial(m)
    body={'revision':m['revision'],'key':'test-nudge-0001'}
    url=f'/api/meetings/{m["id"]}/nudge'
    assert (await ctx.client.post(url,json=body)).json()['queued']==2
    assert (await ctx.client.post(url,json=body)).json()['queued']==0
    assert (await ctx.client.post(url,json={**body,'key':'test-nudge-0002'})).status_code==409
    calls=[]
    async def sender(*args):calls.append(True);return 'mock-provider-id'
    async with _Session() as db:
        a=await db.get(MeetingAttendee,m['attendees'][0]['id']);a.response='accepted';await db.commit()
        row=await db.scalar(select(MeetingDelivery).where(MeetingDelivery.meeting_id==m['id'],MeetingDelivery.attendee_id==a.id,MeetingDelivery.purpose=='nudge:test-nudge-0001'))
        delivery_id=row.id
    await deliver(delivery_id,_Session,sender)
    assert not calls
    async with _Session() as db:assert (await db.get(MeetingDelivery,delivery_id)).status=='blocked'

async def test_individual_resend_does_not_reset_responses(ctx):
    m=await publish(ctx,await create(ctx))
    await accept_initial(m)
    async with _Session() as db:
        a=await db.get(MeetingAttendee,m['attendees'][0]['id']);a.response='accepted';await db.commit()
    endpoint=f'/api/meetings/{m["id"]}/attendees/{m["attendees"][0]["id"]}/resend'
    response=await ctx.client.post(endpoint,json={'revision':m['revision'],'key':'single-resend-0001'})
    assert response.status_code==200,response.text
    assert response.json()['attendees'][0]['response']=='accepted'
    await ctx.client.post(endpoint,json={'revision':m['revision'],'key':'single-resend-0001'})
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(MeetingDelivery).where(MeetingDelivery.purpose=='resend:single-resend-0001'))==1

async def test_opt_in_reminders_queue_once_and_keep_calendar_identity(ctx):
    m=await publish(ctx,await create(ctx,reminder_minutes=[60],nudge_hours_before=24))
    async def accepted(*args):return 'mock-provider-id'
    for row in m['deliveries']:await deliver(row['id'],_Session,accepted)
    async with _Session() as db:
        model=await db.get(Meeting,m['id']);model.next_followup_at=datetime.utcnow()-timedelta(seconds=1)
        model.followup_schedule=[{**entry,'due_at':(datetime.utcnow()-timedelta(seconds=1)).isoformat()} if entry['purpose']=='reminder:60' else entry for entry in model.followup_schedule]
        await db.commit()
    await release_followups(_Session);await release_followups(_Session)
    async with _Session() as db:
        rows=(await db.scalars(select(MeetingDelivery).where(MeetingDelivery.meeting_id==m['id'],MeetingDelivery.purpose!='invitation'))).all()
        assert len(rows)==2 and {r.purpose for r in rows}=={'reminder:60'}
        row=rows[0];model=await db.get(Meeting,m['id']);a=await db.get(MeetingAttendee,row.attendee_id)
        freeze_payload(row,model,a)
        assert row.wire_payload and row.sequence==m['sequence'] and row.credit_units==0
        assert 'Reminder:' in row.wire_payload['mime'] or 'Please reply:' in row.wire_payload['mime']

async def test_reminder_opt_out_blocks_queued_followup(ctx):
    m=await publish(ctx,await create(ctx))
    aid=m['attendees'][0]['id'];token=await token_for(m['id'])
    response=await ctx.client.post('/api/meeting-responses/preferences/'+token,json={'channel':'reminders'})
    assert response.status_code==200,response.text
    # The named recipient in token_for sorts Alex first.
    async with _Session() as db:
        a=await db.get(MeetingAttendee,aid);assert a.reminders_stopped
    assert (await ctx.client.post(f'/api/meetings/{m["id"]}/attendees/{aid}/resend',json={'revision':1,'key':'stopped-resend-001'})).status_code==422

async def test_pending_schedule_must_be_cancelled_before_archive_or_delete(ctx):
    m=await create(ctx,start='2030-06-20T10:00',end='2030-06-20T11:00')
    await ctx.client.post(f'/api/meetings/{m["id"]}/send',json={'revision':1,'send_at':'2030-06-19T10:00'})
    assert (await ctx.client.post(f'/api/meetings/{m["id"]}/archive',json={'revision':1,'archived':True})).status_code==409
    assert (await ctx.client.delete(f'/api/meetings/{m["id"]}?revision=1')).status_code==409

async def accept_initial(m):
    async def sender(*args):return 'mock-provider-id'
    for row in m['deliveries']:await deliver(row['id'],_Session,sender)

async def test_manual_followup_cannot_bypass_uncertain_delivery(ctx):
    m=await publish(ctx,await create(ctx))
    url=f'/api/meetings/{m["id"]}/attendees/{m["attendees"][0]["id"]}/resend'
    assert (await ctx.client.post(url,json={'revision':1,'key':'pending-resend-001'})).status_code==409
    async with _Session() as db:
        row=await db.get(MeetingDelivery,m['deliveries'][0]['id']);row.status='uncertain';await db.commit()
    assert (await ctx.client.post(url,json={'revision':1,'key':'uncertain-resend-001'})).status_code==409

async def test_followup_cooldown_after_accepted_resend(ctx):
    m=await publish(ctx,await create(ctx))
    await accept_initial(m)
    endpoint=f'/api/meetings/{m["id"]}/attendees/{m["attendees"][0]["id"]}/resend'
    result=(await ctx.client.post(endpoint,json={'revision':1,'key':'cooldown-first-001'})).json()
    async def sender(*args):return 'mock-provider-id'
    row=next(d for d in result['deliveries'] if d['purpose']=='resend:cooldown-first-001')
    await deliver(row['id'],_Session,sender)
    assert (await ctx.client.post(endpoint,json={'revision':1,'key':'cooldown-second-001'})).status_code==429

async def test_overlapping_reminder_and_nudge_send_one_email_each(ctx):
    m=await publish(ctx,await create(ctx,reminder_minutes=[1440],nudge_hours_before=24))
    await accept_initial(m)
    async with _Session() as db:
        model=await db.get(Meeting,m['id']);a=await db.get(MeetingAttendee,m['attendees'][0]['id']);a.response='accepted'
        due=(datetime.utcnow()-timedelta(seconds=1)).isoformat()
        model.followup_schedule=[{**entry,'due_at':due} for entry in model.followup_schedule];model.next_followup_at=datetime.utcnow()-timedelta(seconds=1);await db.commit()
    await release_followups(_Session)
    async with _Session() as db:
        rows=(await db.scalars(select(MeetingDelivery).where(MeetingDelivery.meeting_id==m['id'],MeetingDelivery.purpose!='invitation'))).all()
        assert len(rows)==2 and {r.purpose for r in rows}=={'reminder:1440','nudge:24'}

async def test_bounced_initial_email_cannot_be_followed_up(ctx):
    m=await publish(ctx,await create(ctx));await accept_initial(m)
    async with _Session() as db:
        row=await db.get(MeetingDelivery,m['deliveries'][0]['id']);row.delivery_status='bounced';await db.commit()
    endpoint=f'/api/meetings/{m["id"]}/attendees/{m["attendees"][0]["id"]}/resend'
    assert (await ctx.client.post(endpoint,json={'revision':1,'key':'bounced-resend-0001'})).status_code==409

async def test_cancelled_never_published_draft_can_be_deleted(ctx):
    m=await create(ctx)
    response=await ctx.client.post(f'/api/meetings/{m["id"]}/cancel',json={'revision':1})
    assert response.status_code==200 and not response.json()['has_published_invitation']
    assert (await ctx.client.delete(f'/api/meetings/{m["id"]}?revision=2')).status_code==200

async def test_late_bounce_blocks_already_queued_resend(ctx):
    m=await publish(ctx,await create(ctx));await accept_initial(m)
    endpoint=f'/api/meetings/{m["id"]}/attendees/{m["attendees"][0]["id"]}/resend'
    result=(await ctx.client.post(endpoint,json={'revision':1,'key':'late-bounce-001'})).json()
    row=next(d for d in result['deliveries'] if d['purpose']=='resend:late-bounce-001')
    async with _Session() as db:
        original=await db.get(MeetingDelivery,m['deliveries'][0]['id']);original.delivery_status='bounced';await db.commit()
    calls=[]
    async def sender(*args):calls.append(True);return 'must-not-be-called'
    await deliver(row['id'],_Session,sender)
    assert not calls
    async with _Session() as db:assert (await db.get(MeetingDelivery,row['id'])).status=='blocked'

async def test_overview_and_compatibility_list_have_constant_query_counts(ctx):
    from sqlalchemy import event
    from conftest import _engine
    m=await create(ctx)
    async def count(url):
        statements=[]
        def record(conn,cursor,statement,parameters,context,executemany):
            if statement.lstrip().upper().startswith('SELECT'):statements.append(statement)
        event.listen(_engine.sync_engine,'before_cursor_execute',record)
        try:
            response=await ctx.client.get(url);assert response.status_code==200
            return len(statements),response.json()
        finally:event.remove(_engine.sync_engine,'before_cursor_execute',record)
    small,_=await count('/api/meetings/overview');legacy_small,_=await count('/api/meetings')
    async with _Session() as db:
        db.add_all([Meeting(org_id=ctx.ids['org_a'],organizer_id=ctx.ids['user_a'].id,organizer_email=ctx.ids['user_a'].email,draft=draft(title=f'Bulk {i}'),start_utc=datetime(2030,1,1),end_utc=datetime(2030,1,2)) for i in range(25)]);await db.commit()
    large,result=await count('/api/meetings/overview');legacy_large,_=await count('/api/meetings')
    assert large==small and legacy_large==legacy_small
    assert result['total']==26 and len(result['items'])==20

async def test_revoked_authorizer_cannot_send_queued_followup(ctx):
    m=await publish(ctx,await create(ctx));await accept_initial(m)
    endpoint=f'/api/meetings/{m["id"]}/attendees/{m["attendees"][0]["id"]}/resend'
    result=(await ctx.client.post(endpoint,json={'revision':1,'key':'revoke-authorizer-001'})).json()
    row=next(d for d in result['deliveries'] if d['purpose']=='resend:revoke-authorizer-001')
    async with _Session() as db:
        member=await db.scalar(select(Membership).where(Membership.user_id==ctx.ids['user_a'].id,Membership.org_id==ctx.ids['org_a']));member.role='official';await db.commit()
    calls=[]
    async def sender(*args):calls.append(True);return 'must-not-be-called'
    await deliver(row['id'],_Session,sender)
    assert not calls
    async with _Session() as db:assert (await db.get(MeetingDelivery,row['id'])).status=='blocked'

async def test_unsharing_blocks_previously_queued_comanager_followup(ctx):
    m=await publish(ctx,await create(ctx,shared_with_org_admins=True));await accept_initial(m)
    async with _Session() as db:
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=ctx.ids['user_b'].id,role='admin'));await db.commit()
    ctx.login(ctx.ids['user_b'])
    endpoint=f'/api/meetings/{m["id"]}/attendees/{m["attendees"][0]["id"]}/resend'
    result=(await ctx.client.post(endpoint,json={'revision':1,'key':'revoke-sharing-001'})).json()
    row=next(d for d in result['deliveries'] if d['purpose']=='resend:revoke-sharing-001')
    ctx.login(ctx.ids['user_a'])
    edited=await ctx.client.put(f'/api/meetings/{m["id"]}',json={**draft(shared_with_org_admins=False),'revision':1});assert edited.status_code==200
    calls=[]
    async def sender(*args):calls.append(True);return 'must-not-be-called'
    await deliver(row['id'],_Session,sender)
    assert not calls
    async with _Session() as db:assert (await db.get(MeetingDelivery,row['id'])).status=='blocked'

async def test_archiving_stops_due_and_queued_followups_and_restore_does_not_replay(ctx):
    m=await publish(ctx,await create(ctx,reminder_minutes=[60],nudge_hours_before=24))
    await accept_initial(m)
    from app.services.meeting_followups import queue_email
    async with _Session() as db:
        model=await db.get(Meeting,m['id']);a=await db.get(MeetingAttendee,m['attendees'][0]['id'])
        await queue_email(model,db,a,'nudge:archive-fixture')
        model.next_followup_at=datetime.utcnow()-timedelta(seconds=1)
        model.followup_schedule=[{**entry,'due_at':model.next_followup_at.isoformat()} for entry in model.followup_schedule]
        await db.commit()
    response=await ctx.client.post(f'/api/meetings/{m["id"]}/archive',json={'revision':1,'archived':True})
    assert response.status_code==200,response.text
    assert all(item['status']=='stopped' for item in response.json()['followup_schedule'])
    await release_followups(_Session)
    called=[]
    async def sender(*args):called.append(True);return 'never'
    async with _Session() as db:
        row=await db.scalar(select(MeetingDelivery).where(MeetingDelivery.meeting_id==m['id'],MeetingDelivery.purpose=='nudge:archive-fixture'))
        assert row.status=='blocked'
        did=row.id
        assert (await db.get(Meeting,m['id'])).next_followup_at is None
    await deliver(did,_Session,sender)
    await ctx.client.post(f'/api/meetings/{m["id"]}/archive',json={'revision':1,'archived':False})
    await release_followups(_Session)
    assert not called
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(MeetingDelivery).where(MeetingDelivery.meeting_id==m['id'],MeetingDelivery.purpose!='invitation'))==1

async def test_legacy_archived_meeting_cannot_release_or_send_followups(ctx):
    m=await publish(ctx,await create(ctx,reminder_minutes=[60]));await accept_initial(m)
    from app.services.meeting_followups import queue_email
    async with _Session() as db:
        model=await db.get(Meeting,m['id']);a=await db.get(MeetingAttendee,m['attendees'][0]['id'])
        await queue_email(model,db,a,'reminder:legacy-archive')
        model.archived=True;model.next_followup_at=datetime.utcnow()-timedelta(seconds=1)
        model.followup_schedule=[{**entry,'due_at':model.next_followup_at.isoformat()} for entry in model.followup_schedule]
        await db.commit()
        did=await db.scalar(select(MeetingDelivery.id).where(MeetingDelivery.meeting_id==m['id'],MeetingDelivery.purpose=='reminder:legacy-archive'))
    await release_followups(_Session)
    async def sender(*args):raise AssertionError('Archived follow-up must never contact provider')
    await deliver(did,_Session,sender)
    async with _Session() as db:
        assert (await db.get(MeetingDelivery,did)).status=='blocked'
        assert await db.scalar(select(func.count()).select_from(MeetingDelivery).where(MeetingDelivery.meeting_id==m['id'],MeetingDelivery.purpose!='invitation'))==1

async def test_restoring_legacy_archive_does_not_release_missed_reminders(ctx):
    m=await publish(ctx,await create(ctx,reminder_minutes=[60]));await accept_initial(m)
    async with _Session() as db:
        model=await db.get(Meeting,m['id']);model.archived=True;model.next_followup_at=datetime.utcnow()-timedelta(seconds=1)
        model.followup_schedule=[{**entry,'due_at':model.next_followup_at.isoformat()} for entry in model.followup_schedule]
        await db.commit()
    restored=await ctx.client.post(f'/api/meetings/{m["id"]}/archive',json={'revision':1,'archived':False})
    assert restored.status_code==200
    assert all(item['status']=='stopped' for item in restored.json()['followup_schedule'])
    await release_followups(_Session)
    async with _Session() as db:
        assert not await db.scalar(select(MeetingDelivery.id).where(MeetingDelivery.meeting_id==m['id'],MeetingDelivery.purpose!='invitation'))

async def test_everyone_replied_nudge_message_and_nullable_draft_sequence(ctx):
    m=await create(ctx)
    assert m['sequence'] is None
    overview=(await ctx.client.get('/api/meetings/overview')).json()
    assert overview['items'][0]['sequence'] is None
    m=await publish(ctx,m);await accept_initial(m)
    async with _Session() as db:
        for a in (await db.scalars(select(MeetingAttendee).where(MeetingAttendee.meeting_id==m['id']))).all():a.response='accepted'
        await db.commit()
    response=await ctx.client.post(f'/api/meetings/{m["id"]}/nudge',json={'revision':1,'key':'all-replied-fixture'})
    assert response.status_code==422 and 'Everyone has replied' in response.json()['detail']

async def test_smtp_history_is_explicitly_untracked_and_bounces_surface_in_overview(ctx):
    m=await publish(ctx,await create(ctx))
    async def smtp(*args):return 'smtp:fixture'
    for delivery in m['deliveries']:await deliver(delivery['id'],_Session,smtp)
    result=(await ctx.client.get('/api/meetings/'+m['id'])).json()
    assert all(row['receipt_tracking']=='unavailable' for row in result['deliveries'])
    async with _Session() as db:
        row=await db.get(MeetingDelivery,m['deliveries'][0]['id']);row.delivery_status='bounced';await db.commit()
    report=(await ctx.client.get('/api/meetings/overview')).json()
    assert report['items'][0]['delivery_counts']['bounced']==1
