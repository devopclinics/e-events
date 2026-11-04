import pytest
from sqlalchemy import select,func
from app.models import Organization,Event
from app.config import settings
from app import entitlements
from app.organization_entitlements import activate_pass
from conftest import _Session

@pytest.mark.asyncio
async def test_precreation_access_is_read_only_and_matches_new_event_policy(ctx,monkeypatch):
    monkeypatch.setattr(settings,'organization_entitlements_v2',True)
    monkeypatch.setattr(entitlements,'_org_entitlement_cache',{})
    monkeypatch.setattr(entitlements,'_org_addon_override_cache',{})
    ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        org=await db.get(Organization,ctx.ids['org_a']);activate_pass(org,'tier300');org.currency='NGN';org.region='NG';org.addon_overrides={'addon_seating':True};await db.commit()
        before=await db.scalar(select(func.count()).select_from(Event))
    response=await ctx.client.get('/api/events/creation-limits')
    assert response.status_code==200,response.text
    data=response.json();assert data['currency']=='NGN' and data['region']=='NG'
    assert data['has_active_pass'] and 'addon_seating' in data['available_addons']
    assert isinstance(data['addon_prices'],list) and isinstance(data['pass_prices'],list)
    async with _Session() as db:
        assert before==await db.scalar(select(func.count()).select_from(Event))

@pytest.mark.asyncio
async def test_unpaid_organizer_sees_requirement_and_published_prices(ctx,monkeypatch):
    monkeypatch.setattr(settings,'organization_entitlements_v2',True)
    monkeypatch.setattr(entitlements,'_org_entitlement_cache',{})
    monkeypatch.setattr(entitlements,'_org_addon_override_cache',{})
    ctx.login(ctx.ids['user_a'])
    response=await ctx.client.get('/api/events/creation-limits')
    assert response.status_code==200,response.text
    data=response.json();assert not data['has_active_pass']
    assert 'addon_seating' not in data['available_addons']
