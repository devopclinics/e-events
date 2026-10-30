from unittest.mock import AsyncMock
from email.mime.multipart import MIMEMultipart
import pytest
from app.routers import events
from app.config import settings
from services import email_service


@pytest.mark.asyncio
async def test_invitation_email_and_resend_keep_roles_and_scope(ctx, monkeypatch):
    send = AsyncMock(return_value=True)
    monkeypatch.setattr(events, 'send_simple_email', send)
    ctx.login(ctx.ids['user_a'])
    response = await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/org-members", json={'email': 'new-team@example.com', 'role': 'admin'})
    assert response.status_code == 201 and response.json()['invite_email_status'] == 'accepted'
    send.assert_awaited_once()
    args, kwargs = send.call_args
    assert args[0] == 'new-team@example.com'
    assert '/login?next=' in args[2] and 'create one using that same email' in args[2]
    assert kwargs == {'message_kind': 'team_invitation'}
    uid = response.json()['user']['id']
    resend = await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/org-members/{uid}/invitation")
    assert resend.status_code == 200 and resend.json()['invite_email_status'] == 'accepted'
    members = (await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/org-members")).json()
    assert next(m['role'] for m in members if m['user']['id'] == uid) == 'admin'
    before = send.await_count
    denied = await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/org-members/{ctx.ids['user_b']}/invitation")
    assert denied.status_code == 404
    ctx.login(ctx.ids['user_b'])
    denied_event = await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/org-members/{uid}/invitation")
    assert denied_event.status_code in (403, 404)
    assert send.await_count == before


@pytest.mark.asyncio
async def test_failure_preserves_added_teammate(ctx, monkeypatch):
    monkeypatch.setattr(events, 'send_simple_email', AsyncMock(return_value=False))
    ctx.login(ctx.ids['user_a'])
    response = await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/org-members", json={'email': 'retry-team@example.com', 'role': 'staff'})
    assert response.status_code == 201 and response.json()['invite_email_status'] == 'failed'
    members = (await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/org-members")).json()
    assert any(m['user']['email'] == 'retry-team@example.com' for m in members)


@pytest.mark.asyncio
@pytest.mark.parametrize('provider', ['resend', 'bird', 'smtp', 'none', 'blocked'])
@pytest.mark.parametrize('fails', [False, True])
async def test_email_acceptance_is_not_false_success(monkeypatch, provider, fails):
    monkeypatch.setattr(email_service, '_record_email_delivery', AsyncMock())
    monkeypatch.setattr(email_service, '_charge_email_credit', AsyncMock(return_value=True))
    monkeypatch.setattr(email_service, 'recipient_allowed', lambda *a: provider != 'blocked')
    if provider in ('resend', 'bird'):
        if provider == 'resend':
            monkeypatch.setattr(settings, 'resend_api_key', 'offline')
            method = '_send_via_resend'
        else:
            for field in ['bird_email_api_base', 'bird_workspace_id', 'bird_access_key']:
                monkeypatch.setattr(settings, field, 'offline')
            method = '_send_via_bird'
        monkeypatch.setattr(email_service, method, AsyncMock(side_effect=RuntimeError('offline failure') if fails else None, return_value={'id': 'offline-id'}))
    if provider == 'smtp':
        monkeypatch.setattr(settings, 'smtp_host', 'offline')
        class SMTP:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def send_message(self, msg):
                if fails: raise RuntimeError('offline failure')
        monkeypatch.setattr(settings, 'smtp_user', '')
        monkeypatch.setattr(email_service.aiosmtplib, 'SMTP', SMTP)
    msg = MIMEMultipart(); msg['To'] = 'team@example.test'
    assert await email_service._send(msg) is (provider not in ('none', 'blocked') and not fails)
