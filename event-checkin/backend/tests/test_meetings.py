from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import jwt
import pytest
from sqlalchemy import select

from app.config import settings
from app.models import Meeting, MeetingAttendee, MeetingDelivery, Organization
from app.services.meeting_service import MeetingInput, utc_time, response_token, calendar_bytes
from app.services.meeting_outbox import deliver, tick
from conftest import _Session

pytestmark = pytest.mark.asyncio


def draft(**changes):
    return {"title": "Project catch-up", "agenda": "Review progress", "start": "2026-10-28T10:00",
        "end": "2026-10-28T10:30", "timezone": "America/Chicago", "location_type": "online",
        "video_url": "https://example.com/meeting", "attendees": [{"name": "Alex", "email": "alex@example.com"},
        {"name": "Jamie", "email": "jamie@example.com"}], **changes}


@pytest.fixture(autouse=True)
def setup_meetings(monkeypatch):
    monkeypatch.setattr(settings, "meetings_sending_enabled", True)
    monkeypatch.setattr(settings, "meetings_signing_key", "test-only-meeting-key-never-use-outside-tests")
    monkeypatch.setattr(settings, "smtp_host", "mock-smtp.invalid")


async def create(ctx, **changes):
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/meetings", json=draft(**changes))
    assert r.status_code == 201, r.text
    return r.json()


async def publish(ctx, m):
    r = await ctx.client.post(f'/api/meetings/{m["id"]}/send', json={"revision": m["revision"]})
    assert r.status_code == 200, r.text
    return r.json()


async def test_draft_preview_never_queue_and_default_gate(ctx, monkeypatch):
    monkeypatch.setattr(settings, "meetings_sending_enabled", False)
    m = await create(ctx)
    p = await ctx.client.get(f'/api/meetings/{m["id"]}/preview')
    assert len(p.json()["recipients"]) == 2
    assert p.json()["subject"] == "You're invited: Project catch-up"
    r = await ctx.client.post(f'/api/meetings/{m["id"]}/send', json={"revision": 1})
    assert r.status_code == 503
    async with _Session() as db:
        assert not (await db.scalars(select(MeetingDelivery))).all()


async def test_tenant_and_organizer_isolation(ctx):
    m = await create(ctx)
    ctx.login(ctx.ids["user_b"])
    assert (await ctx.client.get('/api/meetings')).json() == []
    for method, suffix, body in [('GET', '', None), ('GET', '/preview', None), ('POST', '/send', {"revision": 1}),
        ('POST', '/cancel', {"revision": 1}), ('PUT', '', {**draft(), "revision": 1})]:
        r = await ctx.client.request(method, f'/api/meetings/{m["id"]}{suffix}', json=body)
        assert r.status_code == 404


async def test_send_duplicate_click_and_recipient_privacy(ctx):
    m = await publish(ctx, await create(ctx))
    again = await publish(ctx, m)
    assert m["sequence"] == again["sequence"] == 0
    assert len(again["deliveries"]) == 2
    async with _Session() as db:
        meeting = await db.get(Meeting, m['id'])
        attendees = (await db.scalars(select(MeetingAttendee))).all()
        token = response_token(meeting, attendees[0])
        ics = calendar_bytes(meeting, meeting.published, attendees[0], "REQUEST", 0).decode()
        assert attendees[1].email not in ics
        assert ics.count('ATTENDEE;') == 1
    p = await ctx.client.get('/api/meeting-responses/' + token)
    assert p.status_code == 200
    assert 'attendees' not in p.json()['meeting']
    assert 'email' not in p.json()
    assert p.headers['cache-control'] == 'no-store'
    # GET is non-mutating even if scanners append query parameters.
    await ctx.client.get('/api/meeting-responses/' + token + '?response=accepted')
    assert (await ctx.client.get('/api/meeting-responses/' + token)).json()['response'] == 'pending'
    for _ in range(2):
        r = await ctx.client.post('/api/meeting-responses/' + token, json={'response': 'accepted'})
        assert r.json()['response'] == 'accepted'


async def test_reschedule_uid_sequence_add_remove_cancel_and_stale_links(ctx):
    m = await publish(ctx, await create(ctx))
    async with _Session() as db:
        meeting = await db.get(Meeting, m['id'])
        alex = await db.scalar(select(MeetingAttendee).where(MeetingAttendee.email == 'alex@example.com'))
        token = response_token(meeting, alex)
        original = calendar_bytes(meeting, meeting.published, alex, 'REQUEST', 0).decode()
    data = draft(start='2026-10-29T10:00', end='2026-10-29T11:00', attendees=[{'name':'Jamie','email':'jamie@example.com'}, {'name':'New','email':'new@example.com'}])
    r = await ctx.client.put(f'/api/meetings/{m["id"]}', json={**data, 'revision': 1})
    assert r.status_code == 200
    # Unsaved publication changes do not invalidate the currently published invitation.
    assert (await ctx.client.get('/api/meeting-responses/' + token)).status_code == 200
    p = (await ctx.client.get(f'/api/meetings/{m["id"]}/preview')).json()
    assert p['cancellations'] == ['alex@example.com']
    m = await publish(ctx, r.json())
    assert m['sequence'] == 1
    assert (await ctx.client.post('/api/meeting-responses/' + token, json={'response':'maybe'})).status_code == 410
    current = [d for d in m['deliveries'] if d['sequence'] == 1]
    assert sorted(d['method'] for d in current) == ['CANCEL', 'REQUEST', 'REQUEST']
    async with _Session() as db:
        meeting = await db.get(Meeting, m['id'])
        jamie = await db.scalar(select(MeetingAttendee).where(MeetingAttendee.email == 'jamie@example.com'))
        token = response_token(meeting, jamie)
        updated = calendar_bytes(meeting, meeting.published, jamie, 'REQUEST', 1).decode()
        assert next(l for l in original.splitlines() if l.startswith('UID:')) == next(l for l in updated.splitlines() if l.startswith('UID:'))
        assert 'SEQUENCE:1' in updated
    r = await ctx.client.post(f'/api/meetings/{m["id"]}/cancel', json={'revision': m['revision']})
    assert r.status_code == 200
    cancelled = r.json()
    assert cancelled['sequence'] == 2
    assert all(d['method'] == 'CANCEL' for d in cancelled['deliveries'] if d['sequence'] == 2)
    assert (await ctx.client.get('/api/meeting-responses/' + token)).status_code == 410
    duplicate = await ctx.client.post(f'/api/meetings/{m["id"]}/cancel', json={'revision': m['revision']})
    assert duplicate.status_code == 200 and duplicate.json()['sequence'] == 2
    assert (await ctx.client.put(f'/api/meetings/{m["id"]}', json={**data, 'revision': cancelled['revision']})).status_code == 409
    async with _Session() as db:
        meeting = await db.get(Meeting, m['id'])
        assert 'METHOD:CANCEL' in calendar_bytes(meeting, meeting.published, jamie, 'CANCEL', 2).decode()


async def test_stale_revision_rejected(ctx):
    m = await create(ctx)
    path = f'/api/meetings/{m["id"]}'
    assert (await ctx.client.put(path, json={**draft(title='Updated'), 'revision':1})).status_code == 200
    assert (await ctx.client.post(path+'/send', json={'revision':1})).status_code == 409
    assert (await ctx.client.put(path, json={**draft(), 'revision':1})).status_code == 409


async def test_expired_invalid_and_wrong_scope_links(ctx):
    for token in ['bad-token', jwt.encode({'scope':'other','mid':'x','aid':'x','seq':0,'exp':datetime.now(timezone.utc)+timedelta(days=1)}, settings.meetings_signing_key, algorithm='HS256'),
                  jwt.encode({'scope':'meeting-response','mid':'x','aid':'x','seq':0,'exp':datetime.now(timezone.utc)-timedelta(days=1)}, settings.meetings_signing_key, algorithm='HS256')]:
        assert (await ctx.client.get('/api/meeting-responses/'+token)).status_code == 410
        assert (await ctx.client.post('/api/meeting-responses/'+token, json={'response':'declined'})).status_code == 410


async def test_delivery_failure_retry_duplicate_and_cancel_suppression(ctx):
    m = await publish(ctx, await create(ctx))
    calls = []
    async def failure(row, meeting, attendee):
        calls.append(row.id)
        from app.services.meeting_channels import DefiniteRejection
        raise DefiniteRejection('Mock provider rejected recipient')
    async def success(row, meeting, attendee):
        calls.append(row.id)
        return 'mock-provider-id'
    d = m['deliveries'][0]
    await deliver(d['id'], _Session, failure)
    state = (await ctx.client.get(f'/api/meetings/{m["id"]}')).json()
    assert state['deliveries'][0]['status'] == 'failed'
    retry = f'/api/meetings/{m["id"]}/deliveries/{d["id"]}/retry'
    assert (await ctx.client.post(retry)).status_code == 200
    await deliver(d['id'], _Session, success)
    await deliver(d['id'], _Session, success)
    assert calls == [d['id'], d['id']]
    await ctx.client.post(f'/api/meetings/{m["id"]}/cancel', json={'revision':m['revision']})
    await deliver(m['deliveries'][1]['id'], _Session, success)
    assert len(calls) == 2
    assert (await ctx.client.post(retry)).status_code == 409


async def test_unknown_delivery_outcome_is_not_retried(ctx):
    m = await publish(ctx, await create(ctx))
    async def timeout(*args):
        raise TimeoutError()
    d = m['deliveries'][0]
    await deliver(d['id'], _Session, timeout)
    r = await ctx.client.post(f'/api/meetings/{m["id"]}/deliveries/{d["id"]}/retry')
    assert r.status_code == 409
    assert 'unknown' in r.json()['detail']


@pytest.mark.parametrize('start,end,zone', [('2026-03-08T02:30','2026-03-08T03:30','America/Chicago'), ('2026-11-01T01:15','2026-11-01T02:30','America/Chicago'), ('2026-10-28T11:00','2026-10-28T10:00','UTC'), ('2026-10-28T10:00','2026-10-28T11:00','Invalid/Zone')])
async def test_invalid_dst_and_order(ctx, start, end, zone):
    ctx.login(ctx.ids['user_a'])
    r = await ctx.client.post('/api/meetings', json=draft(start=start,end=end,timezone=zone))
    assert r.status_code == 422


async def test_explicit_dst_fold_and_utc():
    first = utc_time('2026-11-01T01:30','America/Chicago',0)
    second = utc_time('2026-11-01T01:30','America/Chicago',1)
    assert (second-first).total_seconds() == 3600
    assert utc_time('2026-10-28T10:00','America/Chicago',None).hour == 15


async def test_input_security_and_duplicates(ctx):
    ctx.login(ctx.ids['user_a'])
    for change in [{'video_url':'javascript:alert(1)'}, {'title':'Bad\r\nInjected: yes'}, {'attendees':[{'name':'Alex','email':'alex@example.com'}, {'name':'Again','email':'ALEX@example.com'}]}]:
        assert (await ctx.client.post('/api/meetings', json=draft(**change))).status_code == 422


async def test_calendar_utf8_folding_and_injection_regression():
    from services.email_service import _build_ics_bytes
    raw = _build_ics_bytes(event_name='☀'*80+'\r\nINJECT', start=datetime(2026,1,1), end=None,
        venue_text='Room, A; B', uid='safe@festio.events', organizer_email='Festio <host@example.com>',
        attendee_name='Alex; "Team"', attendee_email='alex@example.com')
    assert all(len(line) <= 75 for line in raw.split(b'\r\n'))
    text = raw.decode().replace('\r\n ', '')
    assert 'METHOD:REQUEST' in text and 'DTEND:20260101T030000Z' in text
    assert '\r\nINJECT' not in text and 'LOCATION:Room\\, A\\; B' in text


async def test_transport_uses_one_recipient_scoped_link_and_idempotency(ctx, monkeypatch):
    import httpx
    from app.services.meeting_outbox import transport
    m = await publish(ctx, await create(ctx))
    requests = []
    class MockClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            requests.append(kwargs)
            return httpx.Response(200, json={'id':'mock-provider'}, request=httpx.Request('POST', url))
    monkeypatch.setattr(settings, 'resend_api_key', 'mock-only')
    monkeypatch.setattr(settings, 'meetings_email_transport', 'resend_attachment')
    monkeypatch.setattr('app.services.meeting_outbox.httpx.AsyncClient', MockClient)
    async with _Session() as db:
        row = await db.get(MeetingDelivery, m['deliveries'][0]['id'])
        meeting = await db.get(Meeting, m['id'])
        a = await db.get(MeetingAttendee, row.attendee_id)
        await transport(row, meeting, a)
        await transport(row, meeting, a)
        other = 'jamie@example.com' if a.email == 'alex@example.com' else 'alex@example.com'
        import json
        payload = json.loads(requests[0]['content'])
        assert requests[0]['content'] == requests[1]['content']
        assert payload['to'] == [a.email]
        assert other not in str(payload)
        assert '/meeting-response/' in payload['html']
        assert payload['attachments'][0]['filename'] == 'meeting.ics'
        assert requests[0]['headers']['Idempotency-Key'] == requests[1]['headers']['Idempotency-Key']


async def test_signed_receipts_are_versioned_monotonic_and_unsigned_cannot_change(ctx, monkeypatch):
    import base64, hashlib, hmac, json, time
    m = await publish(ctx, await create(ctx))
    d = m['deliveries'][0]
    async def success(*args): return 'mock-provider'
    await deliver(d['id'], _Session, success)
    secret_bytes = b'test-only-svix-key'
    monkeypatch.setattr(settings, 'resend_webhook_secret', 'whsec_'+base64.b64encode(secret_bytes).decode())
    async def receipt(status, created, signed=True):
        event = {'type':'email.'+status,'created_at':created,'data':{'email_id':'mock-provider','tags':[{'name':'meeting_delivery_id','value':d['id']}]}}
        payload=json.dumps(event).encode()
        stamp=str(int(time.time()))
        signature=base64.b64encode(hmac.new(secret_bytes,b'.'.join([b'mock',stamp.encode(),payload]),hashlib.sha256).digest()).decode()
        return await ctx.client.post('/api/webhooks/resend',content=payload,headers={'content-type':'application/json','svix-id':'mock','svix-timestamp':stamp,'svix-signature':'v1,'+signature if signed else 'v1,bad'})
    assert (await receipt('bounced','2026-10-28T16:01:00Z')).status_code == 200
    assert (await receipt('delivered','2026-10-28T16:00:00Z')).status_code == 200
    assert (await receipt('delivered','2026-10-28T16:02:00Z',False)).status_code == 400
    state=(await ctx.client.get(f'/api/meetings/{m["id"]}')).json()
    assert state['deliveries'][0]['delivery_status'] == 'bounced'
    assert state['sequence'] == 0


async def test_suspended_tenant_links_and_membership_revocation(ctx):
    from app.models import Organization, Membership
    m=await publish(ctx,await create(ctx))
    async with _Session() as db:
        meeting=await db.get(Meeting,m['id'])
        attendee=await db.scalar(select(MeetingAttendee).where(MeetingAttendee.meeting_id==m['id']))
        token=response_token(meeting,attendee)
        org=await db.get(Organization,ctx.ids['org_a'])
        org.is_active=False
        await db.commit()
    assert (await ctx.client.get('/api/meetings')).status_code==403
    assert (await ctx.client.get('/api/meeting-responses/'+token)).status_code==410


async def test_interrupted_claim_is_held_and_disabled_worker_does_nothing(ctx,monkeypatch):
    m=await publish(ctx,await create(ctx))
    async with _Session() as db:
        row=await db.get(MeetingDelivery,m['deliveries'][0]['id'])
        row.status='sending'
        row.attempted_at=datetime.utcnow()-timedelta(minutes=10)
        await db.commit()
    monkeypatch.setattr(settings,'meetings_sending_enabled',False)
    await tick(_Session)
    async with _Session() as db:
        assert (await db.get(MeetingDelivery,m['deliveries'][0]['id'])).status=='sending'
        # Remove other queued work so tick only reconciles the interrupted claim.
        other=await db.get(MeetingDelivery,m['deliveries'][1]['id'])
        other.status='superseded'
        await db.commit()
    monkeypatch.setattr(settings,'meetings_sending_enabled',True)
    await tick(_Session)
    async with _Session() as db:
        assert (await db.get(MeetingDelivery,m['deliveries'][0]['id'])).status=='uncertain'


async def test_delivered_removal_not_repeated_and_pending_removal_is_previewed(ctx):
    m=await publish(ctx,await create(ctx))
    async def success(*args): return 'mock-provider'
    only_jamie=[{'name':'Jamie','email':'jamie@example.com'}]
    edit=await ctx.client.put(f'/api/meetings/{m["id"]}',json={**draft(attendees=only_jamie),'revision':m['revision']})
    m=await publish(ctx,edit.json())
    removal=next(d for d in m['deliveries'] if d['sequence']==1 and d['method']=='CANCEL')
    # Pending removal appears in every subsequent preview until handled.
    p=(await ctx.client.get(f'/api/meetings/{m["id"]}/preview')).json()
    assert p['cancellations']==['alex@example.com']
    await deliver(removal['id'],_Session,success)
    edit=await ctx.client.put(f'/api/meetings/{m["id"]}',json={**draft(title='Next version',attendees=only_jamie),'revision':m['revision']})
    p=(await ctx.client.get(f'/api/meetings/{m["id"]}/preview')).json()
    assert p['cancellations']==[]
    m=await publish(ctx,edit.json())
    assert [d['method'] for d in m['deliveries'] if d['sequence']==2]==['REQUEST']


def mobile_attendee(channels=None, **changes):
    return {'name':'Alex','email':'alex@example.com','phone':'+14155550123',
        'channels':channels or ['email','sms','whatsapp'],'sms_consent':True,'whatsapp_consent':True,**changes}


async def paid_org(ctx,monkeypatch):
    from app.models import Organization, WhatsAppTemplateSubmission
    monkeypatch.setattr(settings,'meetings_paid_sending_enabled',True)
    monkeypatch.setattr(settings,'organization_entitlements_v2',True)
    monkeypatch.setattr(settings,'whatsapp_provider','bird')
    monkeypatch.setattr('services.messaging._channel_ready',lambda channel,phone:True)
    async with _Session() as db:
        org=await db.get(Organization,ctx.ids['org_a'])
        org.event_pass_status='active';org.event_pass_tier='tier50';org.event_pass_expires_at=datetime(2099,1,1)
        org.message_credit_units=1000
        template=WhatsAppTemplateSubmission(org_id=org.id,name='Meeting notification',platform_name='meeting_test',
            category='UTILITY',body='Hi {{firstName}}, {{eventName}}: {{message}} {{ticketLink}}',
            variables=['firstName','eventName','message','ticketLink'],status='approved',bird_project_id='mock-project')
        db.add(template);await db.commit()
        return template.id


async def publish_paid(ctx,m,cancel=False):
    base=f'/api/meetings/{m["id"]}'
    preview=(await ctx.client.get(base+'/preview'+('?cancel=true' if cancel else ''))).json()
    r=await ctx.client.post(base+('/cancel' if cancel else '/send'),json={'revision':m['revision'],
        'confirm_paid_channels':True,'quoted_credit_units':preview['credit_units']})
    assert r.status_code==200,r.text
    return r.json()


@pytest.mark.parametrize('attendee',[
    mobile_attendee(['sms'],phone='4155550123'),mobile_attendee(['sms'],phone='+0123456789'),
    mobile_attendee(['sms'],sms_consent=False),mobile_attendee(['whatsapp'],whatsapp_consent=False),
    mobile_attendee(['email'],email=None),mobile_attendee(['sms','sms']),mobile_attendee(['fax'])])
async def test_phone_and_channel_validation(ctx,attendee):
    ctx.login(ctx.ids['user_a'])
    assert (await ctx.client.post('/api/meetings',json=draft(attendees=[attendee]))).status_code==422


async def test_phone_only_individual_channels_and_paid_confirmation(ctx,monkeypatch):
    await paid_org(ctx,monkeypatch)
    m=await create(ctx,attendees=[mobile_attendee(['sms'],email=None,phone='+1 (415) 555-0123')])
    assert m['draft']['attendees'][0]['phone']=='+14155550123'
    p=(await ctx.client.get(f'/api/meetings/{m["id"]}/preview')).json()
    assert p['channel_recipients'][0]['channel']=='sms'
    assert p['channel_recipients'][0]['recipient']=='+14155550123'
    assert 'Project catch-up' in p['channel_recipients'][0]['message']
    assert p['credit_units']>0
    assert (await ctx.client.post(f'/api/meetings/{m["id"]}/send',json={'revision':1})).status_code==422
    assert (await ctx.client.post(f'/api/meetings/{m["id"]}/send',json={'revision':1,'confirm_paid_channels':True,'quoted_credit_units':0})).status_code==409
    m=await publish_paid(ctx,m)
    assert len(m['deliveries'])==1 and m['deliveries'][0]['channel']=='sms'


async def test_disabled_paid_channel_and_missing_template_do_not_charge(ctx,monkeypatch):
    from app.models import Organization
    m=await create(ctx,attendees=[mobile_attendee(['sms'])])
    m=await publish_paid(ctx,m)
    await deliver(m['deliveries'][0]['id'],_Session,lambda *args:None)
    async with _Session() as db:
        row=await db.get(MeetingDelivery,m['deliveries'][0]['id'])
        assert row.status=='setup_required' and row.charged_at is None
        assert (await db.get(Organization,ctx.ids['org_a'])).message_credit_units==100
    await paid_org(ctx,monkeypatch)
    m=await create(ctx,attendees=[mobile_attendee(['whatsapp'])])
    m=await publish_paid(ctx,m)
    await deliver(m['deliveries'][0]['id'],_Session,lambda *args:None)
    async with _Session() as db:
        row=await db.get(MeetingDelivery,m['deliveries'][0]['id'])
        assert row.status=='setup_required' and 'approved' in row.error and row.charged_at is None


async def test_channel_lifecycle_repeat_retry_and_wallet_idempotency(ctx,monkeypatch):
    from app.models import Organization
    template=await paid_org(ctx,monkeypatch)
    m=await publish_paid(ctx,await create(ctx,attendees=[mobile_attendee()],whatsapp_template_id=template))
    again=await publish_paid(ctx,m)
    assert len(again['deliveries'])==3
    calls=[]
    async def success(row,meeting,attendee):calls.append((row.id,row.channel));return 'mock-'+row.id
    for d in m['deliveries']:
        await deliver(d['id'],_Session,success);await deliver(d['id'],_Session,success)
    assert len(calls)==3
    async with _Session() as db:
        expected=1000-sum(d['credit_units'] for d in m['deliveries'])
        assert (await db.get(Organization,ctx.ids['org_a'])).message_credit_units==expected
        wa=await db.get(MeetingDelivery,next(d['id'] for d in m['deliveries'] if d['channel']=='whatsapp'))
        assert wa.wire_payload['template_ref']=='mock-project'
    changed={**m['draft'],'start':'2026-10-29T10:00','end':'2026-10-29T11:00','revision':m['revision']}
    m=(await ctx.client.put(f'/api/meetings/{m["id"]}',json=changed)).json()
    m=await publish_paid(ctx,m)
    assert sorted(d['channel'] for d in m['deliveries'] if d['sequence']==1)==['email','sms','whatsapp']
    m=await publish_paid(ctx,m,cancel=True)
    assert all(d['method']=='CANCEL' for d in m['deliveries'] if d['sequence']==2)


async def test_safe_setup_retry_and_phone_transport_reuses_services(ctx,monkeypatch):
    await paid_org(ctx,monkeypatch)
    monkeypatch.setattr('services.messaging._channel_ready',lambda *args:False)
    m=await publish_paid(ctx,await create(ctx,attendees=[mobile_attendee(['sms'])]))
    d=m['deliveries'][0]
    await deliver(d['id'],_Session)
    assert (await ctx.client.get(f'/api/meetings/{m["id"]}')).json()['deliveries'][0]['status']=='setup_required'
    monkeypatch.setattr('services.messaging._channel_ready',lambda *args:True)
    calls=[]
    async def sms(**kwargs):calls.append(kwargs);return {'provider':'mock','provider_message_id':'mock-id','status':'queued'}
    monkeypatch.setattr('services.messaging.send_custom_sms',sms)
    await ctx.client.post(f'/api/meetings/{m["id"]}/deliveries/{d["id"]}/retry')
    await deliver(d['id'],_Session);await deliver(d['id'],_Session)
    assert len(calls)==1 and calls[0]['phone']=='+14155550123'
    assert '/meeting-response/' in calls[0]['body'] and 'America/Chicago' in calls[0]['body']


async def test_optout_safe_get_duplicate_and_existing_consent(ctx,monkeypatch):
    from app.models import Guest, MeetingSuppression
    await paid_org(ctx,monkeypatch)
    m=await publish_paid(ctx,await create(ctx,attendees=[mobile_attendee(['sms'])]))
    async with _Session() as db:
        meeting=await db.get(Meeting,m['id']);a=await db.scalar(select(MeetingAttendee))
        token=response_token(meeting,a)
    url='/api/meeting-responses/preferences/'+token
    assert (await ctx.client.get(url)).json()['stopped']==[]
    async with _Session() as db:assert not (await db.scalars(select(MeetingSuppression))).all()
    for _ in range(2):assert (await ctx.client.post(url,json={'channel':'sms'})).status_code==200
    await deliver(m['deliveries'][0]['id'],_Session)
    async with _Session() as db:
        row=await db.get(MeetingDelivery,m['deliveries'][0]['id'])
        assert row.status=='blocked' and row.charged_at is None
        assert len((await db.scalars(select(MeetingSuppression))).all())==1
    assert (await ctx.client.post('/api/meeting-responses/preferences/invalid',json={'channel':'sms'})).status_code==410
    # A separate phone with an existing event consent withdrawal also blocks.
    async with _Session() as db:
        guest=await db.scalar(select(Guest));guest.phone='+14155550199';guest.sms_consent=False;await db.commit()
    other=await publish_paid(ctx,await create(ctx,attendees=[mobile_attendee(['sms'],phone='+14155550199')]))
    await deliver(other['deliveries'][0]['id'],_Session)
    assert (await ctx.client.get(f'/api/meetings/{other["id"]}')).json()['deliveries'][0]['status']=='blocked'


async def test_smtp_preserves_request_update_cancel_mime_and_frozen_bytes(ctx,monkeypatch):
    from app.services.meeting_outbox import transport, freeze_payload
    from email.parser import BytesParser
    from email import policy
    sent=[]
    class SMTP:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def sendmail(self,from_addr,to,raw):sent.append((to,raw))
    monkeypatch.setattr('app.services.meeting_outbox.aiosmtplib.SMTP',SMTP)
    m=await publish(ctx,await create(ctx))
    async with _Session() as db:
        meeting=await db.get(Meeting,m['id']);a=await db.scalar(select(MeetingAttendee))
        row=await db.get(MeetingDelivery,m['deliveries'][0]['id'])
        freeze_payload(row,meeting,a)
        first=row.wire_payload.copy()
        await transport(row,meeting,a);await transport(row,meeting,a)
        assert sent[0][1]==sent[1][1] and row.wire_payload==first
        for method,sequence in [('REQUEST',1),('CANCEL',2)]:
            row=MeetingDelivery(id=f'mock-{method}',meeting_id=meeting.id,attendee_id=a.id,channel='email',recipient=a.email,
                method=method,sequence=sequence,payload=meeting.published,created_at=datetime(2026,10,25))
            freeze_payload(row,meeting,a);await transport(row,meeting,a)
    for index,(to,raw) in enumerate(sent):
        msg=BytesParser(policy=policy.default).parsebytes(raw)
        calendar=next(p for p in msg.walk() if p.get_content_type()=='text/calendar')
        method='CANCEL' if index==3 else 'REQUEST'
        assert calendar.get_param('method')==method
        content=calendar.get_payload(decode=True).decode()
        assert 'METHOD:'+method in content
        assert len(to)==1 and content.count('ATTENDEE;')==1
        if index>=2:assert f'SEQUENCE:{index-1}' in content


async def test_409_conflict_is_uncertain_and_resend_payload_survives_retry(ctx,monkeypatch):
    import httpx
    monkeypatch.setattr(settings,'meetings_email_transport','resend_attachment')
    monkeypatch.setattr(settings,'resend_api_key','mock-only')
    m=await publish(ctx,await create(ctx));d=m['deliveries'][0]
    bodies=[]
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,**kwargs):
            bodies.append(kwargs['content'])
            return httpx.Response(409,json={'name':'invalid_idempotent_request'},request=httpx.Request('POST',url))
    monkeypatch.setattr('app.services.meeting_outbox.httpx.AsyncClient',Client)
    await deliver(d['id'],_Session)
    async with _Session() as db:
        row=await db.get(MeetingDelivery,d['id'])
        assert row.status=='uncertain' and row.wire_payload is not None
    assert (await ctx.client.post(f'/api/meetings/{m["id"]}/deliveries/{d["id"]}/retry')).status_code==409


async def test_whatsapp_requires_eligible_approved_template_and_never_free_text(ctx,monkeypatch):
    from app.models import WhatsAppTemplateSubmission
    template=await paid_org(ctx,monkeypatch)
    m=await publish_paid(ctx,await create(ctx,attendees=[mobile_attendee(['whatsapp'])],whatsapp_template_id=template))
    calls=[]
    async def approved(**kwargs):calls.append(kwargs);return {'provider':'bird','provider_message_id':'mock-wa','status':'queued'}
    async def forbidden(**kwargs):raise AssertionError('Free-text fallback must never execute')
    monkeypatch.setattr('services.messaging.send_custom_template_whatsapp',approved)
    monkeypatch.setattr('services.messaging.send_custom_whatsapp',forbidden)
    monkeypatch.setattr('services.messaging._send_sms_as_whatsapp',forbidden)
    await deliver(m['deliveries'][0]['id'],_Session)
    assert len(calls)==1 and calls[0]['template_ref']=='mock-project'
    assert calls[0]['var_keys']==['firstName','eventName','message','ticketLink']
    assert '/meeting-response/' in calls[0]['params'][3]
    async with _Session() as db:
        row=await db.get(WhatsAppTemplateSubmission,template);row.status='rejected';await db.commit()
    m2=await publish_paid(ctx,await create(ctx,attendees=[mobile_attendee(['whatsapp'])],whatsapp_template_id=template))
    await deliver(m2['deliveries'][0]['id'],_Session)
    assert len(calls)==1
    assert (await ctx.client.get(f'/api/meetings/{m2["id"]}')).json()['deliveries'][0]['status']=='setup_required'


async def test_phone_change_and_channel_removal_notify_exact_previous_target(ctx,monkeypatch):
    await paid_org(ctx,monkeypatch)
    m=await publish_paid(ctx,await create(ctx,attendees=[mobile_attendee(['email','sms'])]))
    next_data={**m['draft'],'attendees':[mobile_attendee(['sms'],phone='+14155550199')],'revision':m['revision']}
    m=(await ctx.client.put(f'/api/meetings/{m["id"]}',json=next_data)).json()
    preview=(await ctx.client.get(f'/api/meetings/{m["id"]}/preview')).json()
    assert {(r['channel'],r['recipient'],r['method']) for r in preview['channel_recipients']}=={
        ('email','alex@example.com','CANCEL'),('sms','+14155550123','CANCEL'),('sms','+14155550199','REQUEST')}
    m=await publish_paid(ctx,m)
    assert len([d for d in m['deliveries'] if d['sequence']==1])==3


async def test_legacy_provider_failure_is_uncertain_and_charge_not_repeated(ctx,monkeypatch):
    from app.models import Organization
    await paid_org(ctx,monkeypatch)
    calls=[]
    async def ambiguous(**kwargs):calls.append(kwargs);return {'provider':'bird','status':'failed'}
    monkeypatch.setattr('services.messaging.send_custom_sms',ambiguous)
    m=await publish_paid(ctx,await create(ctx,attendees=[mobile_attendee(['sms'])]));d=m['deliveries'][0]
    await deliver(d['id'],_Session);await deliver(d['id'],_Session)
    assert len(calls)==1
    async with _Session() as db:
        row=await db.get(MeetingDelivery,d['id'])
        assert row.status=='uncertain' and row.charged_at and not row.charge_refunded
        assert (await db.get(Organization,ctx.ids['org_a'])).message_credit_units==1000-d['credit_units']
    assert (await ctx.client.post(f'/api/meetings/{m["id"]}/deliveries/{d["id"]}/retry')).status_code==409


async def test_cancelled_phone_preferences_work_but_cannot_accept(ctx,monkeypatch):
    from urllib.parse import urlparse
    await paid_org(ctx,monkeypatch)
    m=await publish_paid(ctx,await create(ctx,attendees=[mobile_attendee(['sms'])]))
    m=await publish_paid(ctx,m,cancel=True)
    row_id=next(d['id'] for d in m['deliveries'] if d['sequence']==1)
    async def success(*args):return 'mock-cancel'
    await deliver(row_id,_Session,success)
    async with _Session() as db:
        row=await db.get(MeetingDelivery,row_id)
        assert 'Cancelled:' in row.wire_payload['body']
        token=urlparse(row.wire_payload['params'][3]).path.rsplit('/',1)[1]
    assert (await ctx.client.get('/api/meeting-responses/preferences/'+token)).status_code==200
    assert (await ctx.client.post('/api/meeting-responses/'+token,json={'response':'accepted'})).status_code==410
    assert (await ctx.client.post('/api/meeting-responses/preferences/'+token,json={'channel':'sms'})).status_code==200


from contextlib import asynccontextmanager
async def test_email_change_must_not_cancel_the_unchanged_sms_destination(ctx,monkeypatch):
    await paid_org(ctx,monkeypatch)
    m=await publish_paid(ctx,await create(ctx,attendees=[mobile_attendee(['sms'])]))
    changed={**m['draft'],'attendees':[mobile_attendee(['sms'],email='new@example.com')],'revision':m['revision']}
    r=await ctx.client.put(f'/api/meetings/{m["id"]}',json=changed);assert r.status_code==200
    preview=(await ctx.client.get(f'/api/meetings/{m["id"]}/preview')).json()
    sms=[(r['method'],r['recipient']) for r in preview['channel_recipients'] if r['channel']=='sms']
    assert sms==[('REQUEST','+14155550123')],sms

async def test_cancel_between_claim_and_send_refunds_a_proven_unsent_reservation(ctx,monkeypatch):
    await paid_org(ctx,monkeypatch)
    m=await publish_paid(ctx,await create(ctx,attendees=[mobile_attendee(['sms'])]))
    called=[];opens=0
    @asynccontextmanager
    async def sessions():
        nonlocal opens
        opens+=1;stage=opens
        async with _Session() as db:yield db
        if stage==1:await publish_paid(ctx,m,cancel=True)
    async def sender(*args):called.append(True);return 'must-not-send'
    await deliver(m['deliveries'][0]['id'],sessions,sender)
    assert not called
    async with _Session() as db:
        row=await db.get(MeetingDelivery,m['deliveries'][0]['id']);org=await db.get(Organization,ctx.ids['org_a'])
        assert row.status=='superseded'
        assert org.message_credit_units==1000 and row.charge_refunded,{'balance':org.message_credit_units,'reserved':row.credit_units,'refunded':row.charge_refunded}


@pytest.mark.parametrize("url", ["meet.google.com/uxc-vqko-mih", "  meet.google.com/uxc-vqko-mih  ", "https://meet.google.com/uxc-vqko-mih"])
async def test_meeting_pasted_link_normalized_before_save(ctx, url):
    ctx.login(ctx.ids['user_a'])
    response = await ctx.client.post('/api/meetings', json=draft(video_url=url))
    assert response.status_code == 201
    assert response.json()['draft']['video_url'] == 'https://meet.google.com/uxc-vqko-mih'


@pytest.mark.parametrize("url", ["javascript:alert(1)", "not a link", "", "meet.google.com/bad link"])
async def test_invalid_meeting_link_still_rejected(ctx, url):
    ctx.login(ctx.ids['user_a'])
    assert (await ctx.client.post('/api/meetings', json=draft(video_url=url))).status_code == 422


async def schedule_fixture(ctx):
    m = await create(ctx, start='2030-06-20T10:00', end='2030-06-20T11:00')
    r = await ctx.client.post(f'/api/meetings/{m["id"]}/send', json={'revision':m['revision'],'send_at':'2030-06-19T09:00'})
    assert r.status_code == 200, r.text
    return r.json()


async def make_schedule_due(mid):
    async with _Session() as db:
        m = await db.get(Meeting,mid)
        m.send_at = datetime.utcnow() - timedelta(seconds=1)
        await db.commit()


async def test_scheduled_send_does_not_publish_early_and_releases_once(ctx):
    from app.services.meeting_outbox import release_scheduled
    m = await schedule_fixture(ctx)
    assert m['send_schedule']['status']=='pending'
    assert m['status']=='draft' and m['sequence']==-1 and not m['attendees'] and not m['deliveries']
    await release_scheduled(_Session)
    async with _Session() as db:assert not (await db.scalars(select(MeetingDelivery))).all()
    await make_schedule_due(m['id'])
    await release_scheduled(_Session)
    await release_scheduled(_Session)
    m=(await ctx.client.get(f'/api/meetings/{m["id"]}')).json()
    assert m['sequence']==0 and len(m['deliveries'])==2
    assert m['send_schedule']['status']=='queued'
    assert all(d['status']=='queued' for d in m['deliveries'])


async def test_schedule_cancel_and_edit_never_send(ctx):
    from app.services.meeting_outbox import release_scheduled
    m=await schedule_fixture(ctx)
    r=await ctx.client.request('DELETE',f'/api/meetings/{m["id"]}/schedule',json={'revision':m['revision']})
    assert r.status_code==200 and r.json()['send_schedule']['status']=='cancelled'
    assert r.json()['status']=='draft'
    await release_scheduled(_Session)
    async with _Session() as db:assert not (await db.scalars(select(MeetingDelivery))).all()
    m=await schedule_fixture(ctx)
    r=await ctx.client.put(f'/api/meetings/{m["id"]}',json={**m['draft'],'title':'Changed title','revision':m['revision']})
    assert r.status_code==200 and r.json()['send_schedule']['status']=='cancelled'


async def test_cancelling_unpublished_scheduled_meeting_sends_no_cancellations(ctx):
    m=await schedule_fixture(ctx)
    r=await ctx.client.post(f'/api/meetings/{m["id"]}/cancel',json={'revision':m['revision']})
    assert r.status_code==200
    assert r.json()['status']=='cancelled' and not r.json()['deliveries']
    assert r.json()['send_schedule']['status']=='cancelled'


@pytest.mark.parametrize('when',['',' ','not a date','2020-01-01T10:00','2030-06-20T10:00','2030-06-20T10:30'])
async def test_schedule_rejects_missing_invalid_past_or_after_meeting_time(ctx,when):
    m=await create(ctx,start='2030-06-20T10:00',end='2030-06-20T11:00')
    r=await ctx.client.post(f'/api/meetings/{m["id"]}/send',json={'revision':m['revision'],'send_at':when})
    assert r.status_code==422,r.text
    async with _Session() as db:assert not (await db.scalars(select(MeetingDelivery))).all()


async def test_schedule_preserves_published_response_until_release(ctx):
    from app.services.meeting_outbox import release_scheduled
    m=await publish(ctx,await create(ctx,start='2030-06-20T10:00',end='2030-06-20T11:00'))
    async with _Session() as db:
        model=await db.get(Meeting,m['id']);a=await db.scalar(select(MeetingAttendee).where(MeetingAttendee.meeting_id==m['id']));token=response_token(model,a)
    m=(await ctx.client.put(f'/api/meetings/{m["id"]}',json={**m['draft'],'title':'Updated meeting','revision':m['revision']})).json()
    r=await ctx.client.post(f'/api/meetings/{m["id"]}/send',json={'revision':m['revision'],'send_at':'2030-06-19T09:00'})
    assert r.status_code==200 and r.json()['sequence']==0
    assert (await ctx.client.get('/api/meeting-responses/'+token)).status_code==200
    await make_schedule_due(m['id']);await release_scheduled(_Session)
    assert (await ctx.client.get('/api/meeting-responses/'+token)).status_code==410


async def test_due_schedule_rechecks_organizer_permission(ctx):
    from app.services.meeting_outbox import release_scheduled
    from app.models import Membership
    m=await schedule_fixture(ctx);await make_schedule_due(m['id'])
    async with _Session() as db:
        model=await db.get(Meeting,m['id'])
        member=await db.scalar(select(Membership).where(Membership.user_id==model.organizer_id,Membership.org_id==model.org_id));member.role='staff';await db.commit()
    await release_scheduled(_Session)
    async with _Session() as db:
        row=await db.get(Meeting,m['id']);assert row.send_schedule['status']=='blocked';assert row.send_at is None
        assert not (await db.scalars(select(MeetingDelivery))).all()


async def test_style_email_preview_and_delivery_are_coloured_and_escaped(ctx):
    for style,colour in [('aurora','#183e3a'),('cobalt','#202d68'),('terracotta','#663728')]:
        m=await create(ctx,invitation_style=style,title='<script>Title</script>')
        r=await ctx.client.get(f'/api/meetings/{m["id"]}/preview')
        assert colour in r.json()['html']
        assert '<script>' not in r.json()['html'] and '&lt;script&gt;' in r.json()['html']
        assert 'View invitation &amp; respond' in r.json()['html']
        assert 'href="https://example.com/meeting"' in r.json()['html'] and '>JOIN ONLINE</a>' in r.json()['html']


async def test_reviewing_unchanged_schedule_preserves_it_and_send_now_overrides_once(ctx):
    from app.services.meeting_outbox import release_scheduled
    m=await schedule_fixture(ctx)
    r=await ctx.client.put(f'/api/meetings/{m["id"]}',json={**m['draft'],'revision':m['revision']})
    assert r.status_code==200 and r.json()['send_schedule']['status']=='pending'
    assert r.json()['revision']==m['revision']
    m=await publish(ctx,r.json())
    assert m['send_schedule']['status']=='queued' and len(m['deliveries'])==2
    await release_scheduled(_Session)
    m=await publish(ctx,m)
    assert m['sequence']==0 and len(m['deliveries'])==2
    edited=await ctx.client.put(f'/api/meetings/{m["id"]}',json={**m['draft'],'title':'A new revision','revision':m['revision']})
    assert edited.json()['send_schedule']['status']=='queued'  # never describe a past send as cancelled


async def test_schedule_timezone_dst_and_access(ctx):
    m=await schedule_fixture(ctx)
    assert m['send_schedule']['send_at']=='2030-06-19T14:00:00+00:00'
    ctx.login(ctx.ids['user_b'])
    r=await ctx.client.request('DELETE',f'/api/meetings/{m["id"]}/schedule',json={'revision':m['revision']})
    assert r.status_code==404
    m=await create(ctx,start='2030-11-05T10:00',end='2030-11-05T11:00')
    body={'revision':m['revision'],'send_at':'2030-11-03T01:30'}
    r=await ctx.client.post(f'/api/meetings/{m["id"]}/send',json=body)
    assert r.status_code==422
    r=await ctx.client.post(f'/api/meetings/{m["id"]}/send',json={**body,'send_fold':1})
    assert r.status_code==200
    assert r.json()['send_schedule']['send_at']=='2030-11-03T07:30:00+00:00'


async def test_actual_mime_uses_selected_design_and_utf8(ctx):
    from app.services.meeting_outbox import freeze_payload
    from email import policy
    from email.parser import Parser
    m=await publish(ctx,await create(ctx,invitation_style='cobalt',agenda='Discuss ideas — agree next steps.'))
    async with _Session() as db:
        model=await db.get(Meeting,m['id']);row=await db.scalar(select(MeetingDelivery).where(MeetingDelivery.meeting_id==m['id']))
        a=await db.get(MeetingAttendee,row.attendee_id)
        freeze_payload(row,model,a)
        body=Parser(policy=policy.default).parsestr(row.wire_payload['mime']).get_body(preferencelist=('html',)).get_content()
        assert '#202d68' in body and 'Discuss ideas — agree next steps.' in body
        assert 'View invitation &amp; respond →' in body
        assert '/meeting-response/' in body and f'Hello {a.name},' in body
        assert '>JOIN ONLINE</a>' in body and 'href="https://example.com/meeting"' in body
