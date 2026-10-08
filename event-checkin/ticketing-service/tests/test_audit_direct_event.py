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
