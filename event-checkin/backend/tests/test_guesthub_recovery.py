"""Public recovery never discloses credentials and never sends SMS/WhatsApp."""
from unittest.mock import AsyncMock

import pytest
from datetime import datetime

from conftest import _Session
from app import database, ratelimit
from app.config import settings
from app.models import Event, Guest
from app.services import guesthub_recovery as recovery


@pytest.fixture
def mail(monkeypatch):
    monkeypatch.setattr(database, 'AsyncSessionLocal', _Session)
    monkeypatch.setattr(settings, 'public_base_url', 'https://festio.example.org')
    monkeypatch.setattr(ratelimit, '_REDIS_URL', '')
    sender = AsyncMock()
    monkeypatch.setattr(recovery, 'send_simple_email', sender)
    return sender


async def add(ctx, **values):
    async with _Session() as db:
        guest = Guest(event_id=ctx.ids['event_a'], first_name='Amina', last_name='Idris', email='amina@example.org')
        for key, value in values.items():
            setattr(guest, key, value)
        db.add(guest)
        await db.commit()
        return guest.id


async def request(ctx, **data):
    return await ctx.client.post(f'/api/invite/{ctx.ids["event_a"]}/recover', json=data)


@pytest.mark.asyncio
async def test_email_only_saved_address_event_scope_and_private_response(ctx, mail):
    guest_id = await add(ctx, email=' AMINA@example.org ', invite_token='existing-personal-token', rsvp_status='pending')
    async with _Session() as db:
        other = Event(org_id=ctx.ids['org_b'], name='Other event', couples_name='Other', event_date=datetime(2026, 12, 1), checkin_base_url='https://festio.example.org')
        db.add(other)
        await db.flush()
        db.add(Guest(event_id=other.id, first_name='Amina', last_name='Idris', email='amina@example.org', invite_token='other-event-secret'))
        await db.commit()
    result = await request(ctx, email=' amina@example.org ')
    assert result.status_code == 202, result.text
    assert result.json() == {'message': recovery.RECOVERY_MESSAGE}
    assert result.headers['cache-control'] == 'no-store'
    assert 'token' not in result.text and 'Amina' not in result.text
    mail.assert_awaited_once()
    sent = mail.call_args.kwargs
    assert sent['to_email'] == 'AMINA@example.org'
    assert 'https://festio.example.org/r/existing-personal-token' in sent['html_body']
    assert 'other-event-secret' not in sent['html_body']
    assert sent['message_kind'] == 'guesthub_recovery'
    assert 'guest_id' not in sent  # operational recovery must not consume broadcast credits
    async with _Session() as db:
        guest = await db.get(Guest, guest_id)
        assert guest.rsvp_status == 'pending' and not guest.admitted
        assert guest.invite_token == 'existing-personal-token'


@pytest.mark.asyncio
@pytest.mark.parametrize('data', [
    {'email': 'unknown@example.org'},
    {'email': 'amina@example.org', 'first_name': 'Different'},
    {'email': 'attacker@example.org', 'first_name': 'Amina', 'last_name': 'Idris'},
])
async def test_unknown_email_or_wrong_name_has_identical_confirmation(ctx, mail, data):
    await add(ctx)
    result = await request(ctx, **data)
    assert result.status_code == 202 and result.json() == {'message': recovery.RECOVERY_MESSAGE}
    mail.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('data', [
    {'first_name': 'Amina', 'last_name': 'Idris'},
    {'email': 'not-an-email'},
    {'email': 'amina@example.org', 'phone': '+15555555555'},
    {'email': 'amina@example.org', 'send_to': 'attacker@example.org'},
    {'email': 'amina@example.org', 'redirect_url': 'https://attacker.example.org'},
])
async def test_no_name_only_phone_or_alternate_destination(ctx, mail, data):
    assert (await request(ctx, **data)).status_code == 422
    mail.assert_not_awaited()


@pytest.mark.asyncio
async def test_names_refine_shared_email_and_missing_token_is_created(ctx, mail):
    wanted = await add(ctx)
    other = await add(ctx, first_name='Sara', invite_token='child-secret')
    result = await request(ctx, email='amina@example.org', first_name=' amina ', last_name=' IDRIS ')
    assert result.status_code == 202
    body = mail.call_args.kwargs['html_body']
    assert 'Amina Idris' in body and 'child-secret' not in body
    async with _Session() as db:
        guest = await db.get(Guest, wanted)
        assert guest.invite_token and f'/r/{guest.invite_token}' in body
        assert (await db.get(Guest, other)).invite_token == 'child-secret'


@pytest.mark.asyncio
async def test_email_without_names_sends_matching_links_in_one_message(ctx, mail):
    await add(ctx, invite_token='one')
    await add(ctx, first_name='Sara', invite_token='two')
    await request(ctx, email='amina@example.org')
    mail.assert_awaited_once()
    body = mail.call_args.kwargs['html_body']
    assert '/r/one' in body and '/r/two' in body


@pytest.mark.asyncio
async def test_child_email_never_receives_parent_credential(ctx, mail):
    parent_id = await add(ctx, invite_token='parent-secret')
    await add(ctx, email='child@example.org', first_name='Sara', invite_token='child-secret', rsvp_submitter_guest_id=parent_id)
    await request(ctx, email='child@example.org')
    body = mail.call_args.kwargs['html_body']
    assert '/r/child-secret' in body and 'parent-secret' not in body


@pytest.mark.asyncio
async def test_repeat_requests_throttled_without_disclosing_match(ctx, mail):
    await add(ctx)
    for data in [{'email':'amina@example.org'}, {'email':'AMINA@example.org', 'first_name':'Amina'}]:
        result = await request(ctx, **data)
        assert result.status_code == 202 and result.json()['message'] == recovery.RECOVERY_MESSAGE
    mail.assert_awaited_once()
    for _ in range(18):
        assert (await request(ctx, email='unknown@example.org')).status_code == 202
    assert (await request(ctx, email='another@example.org')).status_code == 429


@pytest.mark.asyncio
async def test_recipient_hourly_limit_cannot_be_bypassed_by_waiting_a_minute(ctx, mail, monkeypatch):
    await add(ctx)
    for i in range(6):
        monkeypatch.setattr(recovery.time, 'time', lambda i=i: 7200 + i * 61)
        assert (await request(ctx, email='amina@example.org')).status_code == 202
    assert mail.await_count == 5


@pytest.mark.asyncio
async def test_limiter_failure_is_closed(ctx, mail, monkeypatch):
    monkeypatch.setattr(ratelimit, '_REDIS_URL', 'redis://test')
    monkeypatch.setattr(ratelimit, '_get_redis', AsyncMock(side_effect=RuntimeError('unavailable')))
    assert (await request(ctx, email='amina@example.org')).status_code == 503
    mail.assert_not_awaited()


@pytest.mark.asyncio
async def test_ended_event_has_no_recovery(ctx, mail):
    async with _Session() as db:
        event = await db.get(Event, ctx.ids['event_a'])
        event.status = 'ended'
        await db.commit()
    assert (await request(ctx, email='amina@example.org')).status_code == 410
    mail.assert_not_awaited()


@pytest.mark.asyncio
async def test_mail_failure_does_not_expose_registration(ctx, mail):
    await add(ctx)
    mail.side_effect = RuntimeError('provider unavailable')
    result = await request(ctx, email='amina@example.org')
    assert result.status_code == 202 and result.json()['message'] == recovery.RECOVERY_MESSAGE


@pytest.mark.asyncio
async def test_email_escapes_guest_and_event_markup(ctx, mail):
    await add(ctx, first_name='<img src=x>', last_name='& Idris')
    await request(ctx, email='amina@example.org')
    body = mail.call_args.kwargs['html_body']
    assert '<img src=x>' not in body and '&lt;img src=x&gt;' in body and '&amp; Idris' in body

@pytest.mark.asyncio
async def test_recovery_preserves_only_allowlisted_destination(ctx, mail):
    await add(ctx, invite_token='guest-link')
    response=await request(ctx,email='amina@example.org',destination='festiome')
    assert response.status_code==202
    assert '/r/guest-link?destination=festiome' in mail.call_args.kwargs['html_body']
    assert (await request(ctx,email='amina@example.org',destination='https://evil.example')).status_code==422
