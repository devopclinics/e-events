from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db
from app.config import settings

def test_direct_unlisted_event_has_details_and_disabled_sales_are_closed():
    cfg=SimpleNamespace(enabled=True,public_listing=False,currency='USD')
    session=SimpleNamespace(get=AsyncMock(return_value=cfg))
    async def override_db():yield session
    previous=settings.service_enabled;settings.service_enabled=True;app.dependency_overrides[get_db]=override_db
    upstream=SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'events':[{'id':'event','name':'Unlisted event'}]})
    client=SimpleNamespace(post=AsyncMock(return_value=upstream))
    context=AsyncMock();context.__aenter__.return_value=client
    try:
        with patch('app.main.httpx.AsyncClient',return_value=context):
            response=TestClient(app).get('/api/ticketing/public/events/event')
            assert response.status_code==200,response.text
            assert response.json()['name']=='Unlisted event' and response.json()['currency']=='USD'
            cfg.enabled=False
            assert TestClient(app).get('/api/ticketing/public/events/event').status_code==404
            assert client.post.await_count==1
    finally:
        settings.service_enabled=previous;app.dependency_overrides.clear()


def test_payment_mode_and_provider_readiness_follow_environment(monkeypatch):
    from app.main import public_status, provider_ready
    for environment, prefix, opposite in [('staging','sk_test_','sk_live_'),('production','sk_live_','sk_test_')]:
        monkeypatch.setattr(settings,'environment',environment)
        assert public_status()['test_mode'] is (environment=='staging')
        monkeypatch.setattr(settings,'stripe_secret_key',prefix+'synthetic')
        monkeypatch.setattr(settings,'paystack_secret_key',opposite+'synthetic')
        assert provider_ready('stripe') is True
        assert provider_ready('paystack') is False


def test_existing_ticket_currency_cannot_be_relabelled():
    import asyncio
    from fastapi import HTTPException
    from app.auth import Identity
    from app.main import put_config
    from app.schemas import EventConfigIn
    cfg=SimpleNamespace(currency='NGN')
    db=SimpleNamespace(get=AsyncMock(return_value=cfg),scalar=AsyncMock(return_value=1),commit=AsyncMock())
    identity=Identity('owner','event','org','owner',currency='USD')
    try:
        asyncio.run(put_config('event',EventConfigIn(enabled=False,currency='USD',provider='stripe'),identity,db))
        assert False,'Currency change must be rejected when products exist'
    except HTTPException as exc:
        assert exc.status_code==409
    assert cfg.currency=='NGN'
    db.commit.assert_not_awaited()
