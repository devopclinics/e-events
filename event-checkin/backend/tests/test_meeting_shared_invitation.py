from datetime import datetime, timedelta
from unittest.mock import AsyncMock
from urllib.parse import urlparse
import jwt
import pytest
from sqlalchemy import select, func
from app.models import MeetingDelivery, MeetingAttendee
from app.config import settings
from conftest import _Session
from test_meetings import create, publish, setup_meetings

pytestmark = pytest.mark.asyncio


async def test_reusable_invitation_is_template_only_without_recipient_or_sending(ctx):
    m = await create(ctx)
    result = await ctx.client.post(f'/api/meetings/{m["id"]}/share-link')
    assert result.status_code == 200
    token = result.json()['url'].rsplit('/', 1)[1]
    response = await ctx.client.get('/api/meeting-responses/shared/' + token)
    assert response.status_code == 200
    data = response.json()
    assert 'JOIN ONLINE' in data['html'] and m['draft']['video_url'] in data['html']
    assert 'Alex' not in data['html'] and 'alex@example.com' not in response.text
    assert 'attendees' not in data['meeting'] and 'reminder_minutes' not in data['meeting']
    assert response.headers['cache-control'] == 'no-store'
    assert (await ctx.client.post('/api/meeting-responses/' + token, json={'response':'accepted'})).status_code == 410
    async with _Session() as db:
        assert await db.scalar(select(func.count(MeetingDelivery.id))) == 0
        assert await db.scalar(select(func.count(MeetingAttendee.id))) == 0


async def test_shared_links_require_owner_and_expire_after_edit_or_cancellation(ctx):
    m = await create(ctx)
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.post(f'/api/meetings/{m["id"]}/share-link')).status_code == 404
    ctx.login(ctx.ids['user_a'])
    token = (await ctx.client.post(f'/api/meetings/{m["id"]}/share-link')).json()['url'].rsplit('/',1)[1]
    update = await ctx.client.put(f'/api/meetings/{m["id"]}', json={**m['draft'],'title':'Changed title','revision':m['revision']})
    assert update.status_code == 200, update.text
    assert (await ctx.client.get('/api/meeting-responses/shared/'+token)).status_code == 410
    renewed = (await ctx.client.post(f'/api/meetings/{m["id"]}/share-link')).json()['url'].rsplit('/',1)[1]
    assert (await ctx.client.get('/api/meeting-responses/shared/'+renewed)).status_code == 200
    cancelled = await ctx.client.post(f'/api/meetings/{m["id"]}/cancel',json={'revision':update.json()['revision']})
    assert cancelled.status_code == 200, cancelled.text
    assert (await ctx.client.get('/api/meeting-responses/shared/'+renewed)).status_code == 410


async def test_personal_link_uses_email_template_and_rejects_wrong_scope(ctx):
    m = await publish(ctx, await create(ctx))
    a = m['attendees'][0]
    token = (await ctx.client.get(f'/api/meetings/{m["id"]}/attendees/{a["id"]}/link')).json()['url'].rsplit('/',1)[1]
    response = await ctx.client.get('/api/meeting-responses/'+token)
    assert response.status_code == 200
    assert 'Hello '+a['name'] in response.json()['html']
    assert '#meeting-reply' in response.json()['html']
    assert 'JOIN ONLINE' in response.json()['html']
    assert (await ctx.client.get('/api/meeting-responses/shared/'+token)).status_code == 410
    assert (await ctx.client.get('/api/meeting-responses/shared/not-a-token')).status_code == 410
