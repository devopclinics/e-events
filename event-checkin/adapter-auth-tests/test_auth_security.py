"""Real adapter imports/models/auth and actual app ASGI boundary regressions.

No selected-AST substitute: conftest imports each complete service module with
synthetic configuration, excludes dotenv, and blocks sockets/DNS. Firebase is
stubbed; SQL queries execute against each service's actual SQLite schema.
"""
import inspect

import pytest
from fastapi import HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event as sqlalchemy_event, select

MISSING = object()
UNVERIFIED = (MISSING, False, None, 'true', 1, [], {})

def token(email='admin@example.test', uid='incoming', proof=True):
    decoded = {'uid': uid, 'email': email}
    if proof is not MISSING:
        decoded['email_verified'] = proof
    return decoded

def req():
    return Request({'type': 'http', 'method': 'GET', 'headers': [], 'path': '/'})

async def add_user(service, db, **kwargs):
    user = service.models.User(id='u', email='admin@example.test', firebase_uid=None,
                is_active=True, is_platform_superadmin=False)
    for name, value in kwargs.items():
        setattr(user, name, value)
    if hasattr(service.models.User, 'name'):
        user.name = 'Isolated user'
    db.add(user)
    await db.commit()
    return user

async def resolve(service, db, decoded, request=None):
    service.ns['firebase_auth'].verify_id_token = lambda unused: decoded
    args = {'db': db, 'creds': HTTPAuthorizationCredentials(scheme='Bearer', credentials='synthetic-only')}
    if 'request' in inspect.signature(service.ns['current_user']).parameters:
        args['request'] = request or req()
    return await service.ns['current_user'](**args)

async def check_access(service, db, user, request=None):
    if service.name == 'dashboard':
        return await service.ns['require_dashboard_access']('event', user, db, request)
    if service.name in ('messaging', 'setup'):
        return await service.ns['require_event_admin']('event', user, db, request)
    return await service.ns['metrics'](user)

@pytest.mark.asyncio
@pytest.mark.parametrize('proof', UNVERIFIED)
async def test_unverified_email_cannot_resolve_unlinked_user(service, db, proof):
    user = await add_user(service, db)
    with pytest.raises(HTTPException) as denied:
        await resolve(service, db, token(proof=proof))
    assert denied.value.status_code == 403
    await db.refresh(user)
    assert user.firebase_uid is None
    assert user.is_platform_superadmin is False

@pytest.mark.asyncio
@pytest.mark.parametrize('proof', UNVERIFIED)
async def test_exact_uid_unverified_preserves_session_without_promotion(service, db, proof):
    user = await add_user(service, db, firebase_uid='incoming')
    request = req()
    result = await resolve(service, db, token(proof=proof), request)
    assert result.id == user.id
    assert user.is_platform_superadmin is False
    with pytest.raises(HTTPException):
        await check_access(service, db, user, request)

@pytest.mark.asyncio
@pytest.mark.parametrize('stored_uid', ['someone-else', ''])
async def test_verified_email_never_overrides_existing_different_uid(service, db, stored_uid):
    user = await add_user(service, db, firebase_uid=stored_uid)
    with pytest.raises(HTTPException) as denied:
        await resolve(service, db, token())
    assert denied.value.status_code == 409
    await db.refresh(user)
    assert user.firebase_uid == stored_uid
    assert user.is_platform_superadmin is False

@pytest.mark.asyncio
async def test_verified_case_insensitive_fallback_keeps_resolution_only(service, db):
    user = await add_user(service, db, email='Admin@Example.Test')
    request = req()
    assert (await resolve(service, db, token(email='ADMIN@EXAMPLE.TEST'), request)).id == user.id
    await check_access(service, db, user, request)
    await db.refresh(user)
    assert user.firebase_uid is None  # Main backend remains responsible for linking.
    assert user.is_platform_superadmin is (service.name != 'dashboard')

@pytest.mark.asyncio
async def test_ambiguous_email_fallback_fails_closed(service, db):
    await add_user(service, db)
    await add_user(service, db, id='other', email='Admin@Example.Test')
    with pytest.raises(HTTPException) as denied:
        await resolve(service, db, token())
    assert denied.value.status_code == 409
    assert not any((await db.scalars(select(service.models.User.is_platform_superadmin))).all())

@pytest.mark.asyncio
@pytest.mark.parametrize('stored_email,token_email', [('ordinary@example.test','admin@example.test'), ('admin@example.test','ordinary@example.test')])
async def test_verified_uid_email_mismatch_does_not_create_email_privilege(service, db, stored_email, token_email):
    user = await add_user(service, db, email=stored_email, firebase_uid='incoming')
    request = req()
    assert (await resolve(service, db, token(email=token_email), request)).id == user.id
    assert user.is_platform_superadmin is False
    with pytest.raises(HTTPException):
        await check_access(service, db, user, request)

@pytest.mark.asyncio
@pytest.mark.parametrize('proof', UNVERIFIED)
async def test_existing_manually_granted_role_is_not_revoked(service, db, proof):
    user = await add_user(service, db, firebase_uid='incoming', is_platform_superadmin=True)
    request = req()
    assert (await resolve(service, db, token(email='changed@example.test', proof=proof), request)).id == user.id
    assert user.is_platform_superadmin is True
    await check_access(service, db, user, request)

@pytest.mark.asyncio
@pytest.mark.parametrize('firebase_uid,proof', [('incoming', True), ('incoming', False), (None, True)])
async def test_inactive_user_rejected_before_promotion(service, db, firebase_uid, proof):
    user = await add_user(service, db, firebase_uid=firebase_uid, is_active=False)
    with pytest.raises(HTTPException) as denied:
        await resolve(service, db, token(proof=proof))
    assert denied.value.status_code == 403
    await db.refresh(user)
    assert user.is_platform_superadmin is False

@pytest.mark.asyncio
@pytest.mark.parametrize('email', ['', 'unknown@example.test'])
async def test_missing_user_denied_without_provisioning(service, db, email):
    with pytest.raises(HTTPException) as denied:
        await resolve(service, db, token(email=email))
    assert denied.value.status_code == 403
    assert (await db.scalars(select(service.models.User))).all() == []

@pytest.mark.asyncio
async def test_invalid_token_is_401(service, db):
    def invalid(token):
        raise ValueError('invalid synthetic token')
    service.ns['firebase_auth'].verify_id_token = invalid
    args = {'db': db, 'creds': HTTPAuthorizationCredentials(scheme='Bearer', credentials='invalid')}
    if 'request' in inspect.signature(service.ns['current_user']).parameters:
        args['request'] = req()
    with pytest.raises(HTTPException) as denied:
        await service.ns['current_user'](**args)
    assert denied.value.status_code == 401

@pytest.mark.asyncio
async def test_missing_credentials_is_401(service, db):
    args = {'db': db, 'creds': None}
    if 'request' in inspect.signature(service.ns['current_user']).parameters:
        args['request'] = req()
    with pytest.raises(HTTPException) as denied:
        await service.ns['current_user'](**args)
    assert denied.value.status_code == 401

@pytest.mark.asyncio
async def test_dashboard_proof_does_not_survive_next_authentication(service, db):
    if service.name != 'dashboard':
        pytest.skip('Dashboard request-local privilege only')
    user = await add_user(service, db, firebase_uid='incoming')
    request = req()
    await resolve(service, db, token(), request)
    await check_access(service, db, user, request)
    await resolve(service, db, token(proof=False), request)
    with pytest.raises(HTTPException):
        await check_access(service, db, user, request)
    assert user.is_platform_superadmin is False

@pytest.mark.asyncio
@pytest.mark.parametrize('proof', [None, ('different-user','admin@example.test'), ('u','different@example.test')])
async def test_dashboard_missing_or_mismatched_request_proof_fails_closed(service, db, proof):
    if service.name != 'dashboard':
        pytest.skip('Dashboard secondary allowlist bypass only')
    user = await add_user(service, db, firebase_uid='incoming')
    request = req()
    request.state.verified_email_identity = proof
    with pytest.raises(HTTPException):
        await check_access(service, db, user, request)
    with pytest.raises(HTTPException):
        await check_access(service, db, user, None)

@pytest.mark.asyncio
@pytest.mark.parametrize('role,event_role,can_view', [('owner',None,False), ('admin',None,False), ('staff','manager',False), ('staff','staff',True)])
async def test_dashboard_existing_org_and_event_grants_remain(service, db, role, event_role, can_view):
    if service.name != 'dashboard':
        pytest.skip('Dashboard role regression')
    user = await add_user(service, db, firebase_uid='incoming')
    db.add(service.models.Membership(id='member', user_id=user.id, org_id='org', role=role))
    if event_role:
        db.add(service.models.EventUser(id='grant', user_id=user.id, event_id='event', event_role=event_role, can_view_dashboard=can_view))
    await db.commit()
    request = req()
    await resolve(service, db, token(proof=False), request)
    assert (await check_access(service, db, user, request)).id == 'event'


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['verified', 'unverified', 'verified_fallback', 'unverified_fallback', 'conflicting_uid', 'manual_role', 'uid_email_mismatch'])
async def test_real_app_asgi_authorization(service, db, mode):
    stored_uid = 'other-uid' if mode == 'conflicting_uid' else 'incoming'
    if mode in ('verified_fallback', 'unverified_fallback'):
        stored_uid = None
    user = await add_user(service, db, firebase_uid=stored_uid,
                          is_platform_superadmin=mode == 'manual_role')
    decoded = token(proof=mode not in ('unverified', 'unverified_fallback', 'manual_role'))
    if mode == 'uid_email_mismatch':
        decoded['email'] = 'changed@example.test'
    service.auth.firebase_auth.verify_id_token = lambda unused: decoded
    async def offline_db():
        yield db
    service.main.app.dependency_overrides[service.database.get_db] = offline_db
    paths = {
        'dashboard': '/api/results/events/event/analytics/attendance',
        'support': '/api/support/metrics',
        'messaging': '/api/messaging/admin/events/event/announcements',
        'setup': '/api/setup/progress?event_id=event',
    }
    try:
        async with AsyncClient(transport=ASGITransport(app=service.main.app), base_url='http://isolated') as client:
            response = await client.get(paths[service.name], headers={'Authorization': 'Bearer synthetic-only'})
            if mode in ('verified', 'verified_fallback', 'manual_role'):
                assert response.status_code == 200, response.text
            elif mode == 'conflicting_uid':
                assert response.status_code == 409, response.text
            else:
                assert response.status_code in (403, 404), response.text
        assert user.firebase_uid == stored_uid
        if service.name == 'dashboard':
            assert user.is_platform_superadmin is (mode == 'manual_role')
    finally:
        service.main.app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_dashboard_real_requests_do_not_reuse_verified_allowlist_proof(service, db, monkeypatch):
    if service.name != 'dashboard':
        pytest.skip('Dashboard Request provenance only')
    user = await add_user(service, db, firebase_uid='incoming')
    decoded = token()
    service.auth.firebase_auth.verify_id_token = lambda unused: decoded
    async def offline_db():
        yield db
    service.main.app.dependency_overrides[service.database.get_db] = offline_db
    # A successful dashboard request must remain SELECT-only, even with verified
    # allowlist access. Refuse flush/commit after the fixture data is seeded.
    async def forbidden_write(*args, **kwargs):
        raise AssertionError('Dashboard authentication attempted a database write')
    monkeypatch.setattr(db, 'commit', forbidden_write)
    monkeypatch.setattr(db, 'flush', forbidden_write)
    def forbidden_autoflush(*args, **kwargs):
        raise AssertionError('Dashboard authentication attempted ORM autoflush')
    sqlalchemy_event.listen(db.sync_session, 'before_flush', forbidden_autoflush)
    try:
        async with AsyncClient(transport=ASGITransport(app=service.main.app), base_url='http://isolated') as client:
            path = '/api/results/events/event/analytics/attendance'
            headers = {'Authorization': 'Bearer synthetic-only'}
            verified = await client.get(path, headers=headers)
            assert verified.status_code == 200, verified.text
            decoded = token(proof=False)
            unverified = await client.get(path, headers=headers)
            assert unverified.status_code == 404, unverified.text
        assert user.is_platform_superadmin is False
    finally:
        service.main.app.dependency_overrides.clear()
        sqlalchemy_event.remove(db.sync_session, 'before_flush', forbidden_autoflush)
