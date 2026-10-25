from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import jwt
import pytest
from sqlalchemy import select

from app.config import settings
from app.models import Meeting, MeetingAttendee, MeetingDelivery
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
        raise ValueError('Mock provider rejected recipient')
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
    monkeypatch.setattr('app.services.meeting_outbox.httpx.AsyncClient', MockClient)
    async with _Session() as db:
        row = await db.get(MeetingDelivery, m['deliveries'][0]['id'])
        meeting = await db.get(Meeting, m['id'])
        a = await db.get(MeetingAttendee, row.attendee_id)
        await transport(row, meeting, a)
        await transport(row, meeting, a)
        other = 'jamie@example.com' if a.email == 'alex@example.com' else 'alex@example.com'
        payload = requests[0]['json']
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
