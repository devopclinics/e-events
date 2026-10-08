"""Exercise Firebase initialization, which unauthenticated health checks miss."""
import asyncio
import json
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from app import main as m


def test_signed_in_auth_initializes_json_credentials_once():
    async def run():
        user = m.User(id='u', name='Owner', email='owner@example.test', is_active=True)
        db = AsyncMock(); db.scalar.return_value = user
        app = object()
        with patch.object(m, '_firebase_app', None), patch.object(m.settings, 'firebase_credentials', json.dumps({'project_id':'demo'})), patch.object(m.credentials, 'Certificate', return_value='certificate') as certificate, patch.object(m.firebase_admin, 'initialize_app', return_value=app) as initialize, patch.object(m.firebase_auth, 'verify_id_token', return_value={'uid':'uid','email':'owner@example.test'}):
            creds = HTTPAuthorizationCredentials(scheme='Bearer', credentials='synthetic-token')
            assert await m.current_user(creds, db) is user
            assert await m.current_user(creds, db) is user
            certificate.assert_called_once_with({'project_id':'demo'})
            initialize.assert_called_once_with('certificate')
    asyncio.run(run())


def test_invalid_token_rejected_after_initialization():
    async def run():
        with patch.object(m, '_firebase_app', object()), patch.object(m.firebase_auth,'verify_id_token',side_effect=ValueError('invalid')):
            try:
                await m.current_user(HTTPAuthorizationCredentials(scheme='Bearer', credentials='invalid'), AsyncMock())
            except HTTPException as e:
                assert e.status_code == 401
            else:
                raise AssertionError('Invalid token was accepted')
    asyncio.run(run())
