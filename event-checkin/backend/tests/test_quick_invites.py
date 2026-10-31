import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
import pytest
from sqlalchemy import select, func
from app.main import app
from app.models import Organization, User, Membership, Event, Guest, QuickInviteRecipient
from app.routers.quick_invites import verified_sender
from app.services.quick_invite_outbox import tick
from conftest import _Session

pytestmark = pytest.mark.asyncio


async def fresh(ctx, monkeypatch):
    import app.routers.events as events
    import app.services.marketing_client as marketing
    monkeypatch.setattr(events, '_notify_operators_new_event', AsyncMock())
    monkeypatch.setattr(marketing, 'ingest_marketing_lead', AsyncMock())
    monkeypatch.setattr(marketing, 'capture_event_outcome', AsyncMock())
    async with _Session() as db:
        org = Organization(name='Invitation account', slug='invite-'+uuid.uuid4().hex)
        user = User(name='Organizer', email=uuid.uuid4().hex+'@example.com', role='official')
        db.add_all([org, user]); await db.flush()
        db.add(Membership(org_id=org.id, user_id=user.id, role='owner')); await db.commit()
    ctx.login(user)
    return user


def draft(**kwargs):
    return {'name': 'Dinner & good company', 'event_date': (datetime.now(timezone.utc)+timedelta(days=7)).isoformat(), 'timezone': 'America/Chicago',
            'message': 'Join us <friends>', 'style': 'arch', 'colour': 'lavender', 'request_id': str(uuid.uuid4()), **kwargs}


async def create(ctx, monkeypatch):
    await fresh(ctx, monkeypatch)
    body = draft()
    result = await ctx.client.post('/api/quick-invites', json=body)
    assert result.status_code == 201, result.text
    return result.json(), body


async def test_publish_is_free_idempotent_and_creates_no_guests(ctx, monkeypatch):
    workspace, body = await create(ctx, monkeypatch)
    retry = await ctx.client.post('/api/quick-invites', json=body)
    assert retry.status_code == 201 and retry.json()['id'] == workspace['id']
    async with _Session() as db:
        event = await db.get(Event, workspace['id'])
        assert event.status == 'active' and event.rsvp_enabled
        assert not event.notify_sms and not event.notify_whatsapp and not event.is_paid
        assert await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id == event.id)) == 0
    # The simplified flow must not grant additional free event slots.
    assert (await ctx.client.post('/api/quick-invites', json=draft())).status_code == 402


async def test_guest_replies_and_private_edits_share_canonical_guest(ctx, monkeypatch):
    workspace, _ = await create(ctx, monkeypatch)
    token = workspace['url'].rsplit('/', 1)[1]
    before = await ctx.client.get('/api/quick-invites/public/'+token)
    assert before.status_code == 200 and before.json()['recipient'] is None
    assert before.headers['cache-control'] == 'no-store'
    body = {'name': 'Ada Guest', 'response': 'maybe', 'request_id': str(uuid.uuid4())}
    first = await ctx.client.post('/api/quick-invites/public/'+token+'/reply', json=body)
    assert first.status_code == 200, first.text
    same = await ctx.client.post('/api/quick-invites/public/'+token+'/reply', json=body)
    assert same.json()['reply_token'] == first.json()['reply_token']
    reply_token = first.json()['reply_token']
    changed = await ctx.client.post('/api/quick-invites/public/'+token+'/reply', json={**body, 'request_id': str(uuid.uuid4()), 'reply_token': reply_token, 'response': 'going'})
    assert changed.json()['response'] == 'going'
    async with _Session() as db:
        people = (await db.scalars(select(Guest).where(Guest.event_id == workspace['id']))).all()
        assert len(people) == 1 and people[0].rsvp_status == 'confirmed'
    private = await ctx.client.get('/api/quick-invites/public/'+token+'?reply='+reply_token)
    assert private.json()['recipient']['name'] == 'Ada Guest'
    assert 'Ada Guest' not in (await ctx.client.get('/api/quick-invites/public/'+token)).text
    assert (await ctx.client.post('/api/quick-invites/public/'+token+'/reply', json={**body, 'reply_token': 'bad'})).status_code == 404
    assert 'Ada Guest' not in (await ctx.client.get('/api/og/i/'+token)).text


async def test_tenant_isolation_and_verified_email_gate(ctx, monkeypatch):
    workspace, body = await create(ctx, monkeypatch)
    assert (await ctx.client.post('/api/quick-invites/manage/'+workspace['id']+'/send',json={'recipients':[{'email':'ada@example.com'}],'confirm':True})).status_code == 403
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get('/api/quick-invites/manage/'+workspace['id'])).status_code == 404
    assert (await ctx.client.put('/api/quick-invites/manage/'+workspace['id'],json=body)).status_code == 404
    assert (await ctx.client.get('/api/quick-invites')).json() == []


async def test_email_queue_does_not_create_guests_and_does_not_spend_credits(ctx, monkeypatch):
    workspace, _ = await create(ctx, monkeypatch)
    app.dependency_overrides[verified_sender] = lambda: None
    send = AsyncMock(return_value=True)
    monkeypatch.setattr('app.services.quick_invite_outbox.send_simple_email', send)
    payload = {'recipients':[{'email':'Ada@example.com','name':'Ada'},{'email':'ada@example.com'}], 'confirm': True}
    result = await ctx.client.post('/api/quick-invites/manage/'+workspace['id']+'/send', json=payload)
    assert result.json() == {'queued':1,'skipped':0}, result.text
    again = await ctx.client.post('/api/quick-invites/manage/'+workspace['id']+'/send', json=payload)
    assert again.json()['queued'] == 0
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id == workspace['id'])) == 0
    assert await tick(_Session)
    assert not await tick(_Session)
    assert send.await_count == 1
    arguments = send.await_args.kwargs
    assert 'guest_id' not in arguments and arguments['message_kind'] == 'quick_invitation'
    assert '/i/' in arguments['html_body'] and '?reply=' in arguments['html_body'] and 'Join us &lt;friends&gt;' in arguments['html_body']
    listing = (await ctx.client.get('/api/quick-invites/manage/'+workspace['id'])).json()
    assert listing['recipients'][0]['send_status'] == 'sent'
    assert 'token' not in listing['recipients'][0]


async def test_uncertain_outcome_is_not_automatically_retried(ctx, monkeypatch):
    workspace, _ = await create(ctx, monkeypatch)
    app.dependency_overrides[verified_sender] = lambda: None
    monkeypatch.setattr('app.services.quick_invite_outbox.send_simple_email', AsyncMock(side_effect=TimeoutError()))
    payload = {'recipients':[{'email':'ada@example.com'}], 'confirm':True}
    await ctx.client.post('/api/quick-invites/manage/'+workspace['id']+'/send',json=payload)
    await tick(_Session)
    result = await ctx.client.post('/api/quick-invites/manage/'+workspace['id']+'/send',json=payload)
    assert result.json()['queued'] == 0
    listing = (await ctx.client.get('/api/quick-invites/manage/'+workspace['id'])).json()
    assert listing['recipients'][0]['send_status'] == 'uncertain'


@pytest.mark.parametrize('field,value', [('timezone','Not/AZone'),('cover','http://example.com/a.jpg'),('name','Bad\nHeader')])
async def test_invalid_drafts_create_nothing(ctx, monkeypatch, field, value):
    await fresh(ctx, monkeypatch)
    assert (await ctx.client.post('/api/quick-invites',json=draft(**{field:value}))).status_code == 422


async def test_edit_and_close_preserve_event_identity_and_reject_new_replies(ctx, monkeypatch):
    workspace, body = await create(ctx, monkeypatch)
    changed = await ctx.client.put('/api/quick-invites/manage/'+workspace['id'], json={**body,'name':'An evening together','colour':'rose','envelope':True})
    assert changed.status_code == 200, changed.text
    assert changed.json()['id'] == workspace['id']
    token = workspace['url'].rsplit('/',1)[1]
    assert (await ctx.client.get('/api/quick-invites/public/'+token)).json()['invitation']['envelope']
    async with _Session() as db:
        event = await db.get(Event,workspace['id']);event.cancelled=True;await db.commit()
    assert (await ctx.client.get('/api/quick-invites/public/'+token)).status_code == 410
    assert (await ctx.client.post('/api/quick-invites/public/'+token+'/reply',json={'name':'Ada','response':'going','request_id':str(uuid.uuid4())})).status_code == 410


async def test_existing_email_requires_its_private_link(ctx, monkeypatch):
    workspace, _ = await create(ctx, monkeypatch)
    app.dependency_overrides[verified_sender] = lambda: None
    await ctx.client.post('/api/quick-invites/manage/'+workspace['id']+'/send',json={'recipients':[{'email':'ada@example.com','name':'Ada'}],'confirm':True})
    token = workspace['url'].rsplit('/',1)[1]
    attempt = await ctx.client.post('/api/quick-invites/public/'+token+'/reply',json={'name':'Impostor','email':'ada@example.com','response':'declined','request_id':str(uuid.uuid4())})
    assert attempt.status_code == 409
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id == workspace['id'])) == 0


async def test_guest_limit_is_not_bypassed_by_shared_replies(ctx, monkeypatch):
    workspace, _ = await create(ctx, monkeypatch)
    async with _Session() as db:
        event = await db.get(Event, workspace['id'])
        db.add_all([Guest(event_id=event.id, first_name='Existing',last_name=str(i)) for i in range(25)])
        await db.commit()
    token = workspace['url'].rsplit('/',1)[1]
    result = await ctx.client.post('/api/quick-invites/public/'+token+'/reply',json={'name':'Another Guest','response':'going','request_id':str(uuid.uuid4())})
    assert result.status_code == 409, result.text
    assert 'contact the organizer' in result.json()['detail']
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id == workspace['id'])) == 25


@pytest.mark.parametrize('setting,value,target', [('attendance_mode','ticketed','/tickets/e/'),('attendance_mode','hybrid','/tickets/e/'),('rsvp_capacity',10,'/rsvp/'),('rsvp_require_approval',True,'/rsvp/'),('rsvp_multi_invitee_enabled',True,'/rsvp/')])
async def test_grown_event_registration_cannot_be_bypassed(ctx, monkeypatch, setting, value, target):
    workspace, _ = await create(ctx, monkeypatch)
    async with _Session() as db:
        event = await db.get(Event, workspace['id']);setattr(event,setting,value);await db.commit()
    token=workspace['url'].rsplit('/',1)[1]
    page=await ctx.client.get('/api/quick-invites/public/'+token)
    assert target in page.json()['registration_url']
    reply=await ctx.client.post('/api/quick-invites/public/'+token+'/reply',json={'name':'Ada','response':'going','request_id':str(uuid.uuid4())})
    assert reply.status_code==409
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id==workspace['id']))==0


async def test_closed_invites_and_closed_rsvp_are_respected(ctx,monkeypatch):
    workspace,_=await create(ctx,monkeypatch);token=workspace['url'].rsplit('/',1)[1]
    async with _Session() as db:
        event=await db.get(Event,workspace['id']);event.invite_mode='closed';await db.commit()
    assert (await ctx.client.get('/api/quick-invites/public/'+token)).status_code==403
    assert (await ctx.client.post('/api/quick-invites/public/'+token+'/reply',json={'name':'Ada','response':'going','request_id':str(uuid.uuid4())})).status_code==403
    async with _Session() as db:
        event=await db.get(Event,workspace['id']);event.rsvp_enabled=False;await db.commit()
    assert (await ctx.client.get('/api/quick-invites/public/'+token)).status_code==410


async def test_full_workspace_responses_show_in_simple_dashboard(ctx,monkeypatch):
    workspace,_=await create(ctx,monkeypatch)
    async with _Session() as db:
        db.add(Guest(event_id=workspace['id'],first_name='Registered',last_name='Elsewhere',rsvp_status='confirmed'));await db.commit()
    page=await ctx.client.get('/api/quick-invites/manage/'+workspace['id'])
    assert len(page.json()['recipients'])==1 and page.json()['recipients'][0]['response']=='going'


@pytest.mark.parametrize('kind',['question','phone','email'])
async def test_required_information_uses_the_full_registration(ctx,monkeypatch,kind):
    from app.models import RSVPQuestion
    workspace,_=await create(ctx,monkeypatch)
    async with _Session() as db:
        event=await db.get(Event,workspace['id'])
        if kind=='question':db.add(RSVPQuestion(event_id=event.id,question='Required information',is_required=True))
        elif kind=='phone':event.rsvp_collect_phone=True;event.rsvp_phone_required=True
        else:event.rsvp_collect_email=True;event.rsvp_email_required=True
        await db.commit()
    token=workspace['url'].rsplit('/',1)[1]
    page=await ctx.client.get('/api/quick-invites/public/'+token)
    assert '/rsvp/' in page.json()['registration_url']
    assert (await ctx.client.post('/api/quick-invites/public/'+token+'/reply',json={'name':'Ada','response':'going','request_id':str(uuid.uuid4())})).status_code==409
