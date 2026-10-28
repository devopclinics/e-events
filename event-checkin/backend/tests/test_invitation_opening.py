import httpx
import pytest
from app.routers import design_proxy
from app.models import Event
from conftest import _Session


@pytest.fixture
def upstream(monkeypatch):
    calls = []
    class Client:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, **kwargs):
            calls.append(('GET', kwargs))
            return httpx.Response(200, json={'envelope_config': {'enabled': False}, 'wording_config': {'private_draft': 'hidden'}})
        async def put(self, url, **kwargs):
            calls.append(('PUT', kwargs))
            return httpx.Response(200, json={'envelope_config': kwargs['json']['envelope_config']})
    monkeypatch.setattr(design_proxy.httpx, 'AsyncClient', Client)
    return calls


@pytest.mark.asyncio
async def test_unpaid_event_admin_can_enable_default_without_studio(ctx, upstream):
    async with _Session() as db:
        event = await db.get(Event, ctx.ids['event_a'])
        event.is_paid = False
        await db.commit()
    ctx.login(ctx.ids['user_a'])
    path = f"/api/events/{ctx.ids['event_a']}/invitation-opening"
    read = await ctx.client.get(path)
    assert read.status_code == 200
    assert 'wording_config' not in read.json()
    saved = await ctx.client.put(path, json={'enabled': True, 'frequency': 'once', 'use_default': True})
    assert saved.status_code == 200
    assert saved.json()['envelope_config']['enabled'] is True
    assert upstream[-1][1]['json'] == {'envelope_config': {'enabled': True, 'frequency': 'once', 'use_default': True}}
    # Customization still requires paid Studio access.
    assert (await ctx.client.put(f"/api/events/{ctx.ids['event_a']}/design", json={'theme_config': {}})).status_code == 402


@pytest.mark.asyncio
async def test_other_org_cannot_read_or_change_opening(ctx, upstream):
    ctx.login(ctx.ids['user_b'])
    path = f"/api/events/{ctx.ids['event_a']}/invitation-opening"
    assert (await ctx.client.get(path)).status_code in (403, 404)
    assert (await ctx.client.put(path, json={'enabled': True})).status_code in (403, 404)
    assert not upstream


@pytest.mark.asyncio
async def test_opening_endpoint_cannot_write_design_fields(ctx, upstream):
    ctx.login(ctx.ids['user_a'])
    path = f"/api/events/{ctx.ids['event_a']}/invitation-opening"
    for field in ['appearance', 'theme_config', 'wording_config', 'asset_config']:
        response = await ctx.client.put(path, json={'enabled': True, field: {}})
        assert response.status_code == 422
    assert not upstream
