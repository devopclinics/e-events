"""Import real adapters without dotenv, ambient credentials, or network access."""
import asyncio
import importlib
import os
from pathlib import Path
import socket
import sys
import types
import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
import pytest_asyncio
from pydantic_settings.sources import DotEnvSettingsSource
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

ROOT = Path(__file__).resolve().parents[1]
ALL_SERVICES = ('dashboard', 'support', 'messaging', 'setup')
SELECTED = os.environ.get('FESTIO_ADAPTER_SERVICE')
if SELECTED and SELECTED not in ALL_SERVICES:
    raise ValueError('FESTIO_ADAPTER_SERVICE must name a supported adapter')
SERVICES = (SELECTED,) if SELECTED else ALL_SERVICES


def isolated_environment():
    return {
        'DATABASE_URL': 'sqlite+aiosqlite://',
        'REDIS_URL': 'redis://127.0.0.1:1/0',
        'SUPERADMIN_EMAILS': 'admin@example.test',
        'DASHBOARD_DB_HOST': 'dashboard-db.invalid',
        'DASHBOARD_DB_PORT': '5432',
        'DASHBOARD_DB_NAME': 'synthetic_dashboard',
        'DASHBOARD_DB_USER': 'dashboard_ro',
        'DASHBOARD_RO_DB_PASSWORD': 'synthetic-password-only',
    }


def import_adapter(name):
    """A unique real package avoids app.* collisions between the four adapters."""
    package_name = 'isolated_' + name + '_' + uuid.uuid4().hex
    package = types.ModuleType(package_name)
    package.__path__ = [str(ROOT / f'{name}-service' / 'app')]
    package.__package__ = package_name
    sys.modules[package_name] = package
    try:
        module = importlib.import_module(package_name + '.main')
        auth = importlib.import_module(package_name + '.auth') if name == 'dashboard' else module
        database = importlib.import_module(package_name + '.database') if name == 'dashboard' else module
        models = importlib.import_module(package_name + '.models') if name == 'dashboard' else module
        return SimpleNamespace(name=name, package=package_name, main=module, auth=auth,
                               database=database, models=models, ns=auth.__dict__)
    except BaseException:
        unload_adapter(package_name)
        raise


def unload_adapter(package):
    for key in tuple(sys.modules):
        if key == package or key.startswith(package + '.'):
            sys.modules.pop(key, None)


def forbidden_network(*args, **kwargs):
    raise AssertionError('Adapter security tests may not access the network')


@pytest.fixture(scope='module', params=SERVICES)
def service(request):
    name = request.param
    mp = pytest.MonkeyPatch()
    mp.setattr(socket.socket, 'connect', forbidden_network)
    mp.setattr(socket.socket, 'connect_ex', forbidden_network)
    mp.setattr(socket, 'create_connection', forbidden_network)
    mp.setattr(socket, 'getaddrinfo', forbidden_network)
    mp.setattr(DotEnvSettingsSource, '_read_env_files', lambda self: {})
    # Dashboard deliberately accepts only its explicit PostgreSQL fields. Replace
    # only its engine factory at import; actual models/functions/ASGI app load.
    def offline_engine(*args, **kwargs):
        return create_async_engine('sqlite+aiosqlite://')
    try:
        with patch.dict(os.environ, isolated_environment(), clear=True):
            if name == 'dashboard':
                with patch('sqlalchemy.ext.asyncio.create_async_engine', offline_engine):
                    adapter = import_adapter(name)
            else:
                adapter = import_adapter(name)
            mp.setattr(adapter.auth, '_ensure_firebase', lambda: None)
            mp.setattr(adapter.auth.firebase_auth, 'verify_id_token', forbidden_network)
            if name == 'support':
                async def metrics_stub():
                    return {'isolated': True}
                mp.setattr(adapter.main, '_metrics_snapshot', metrics_stub)
            yield adapter
    finally:
        if 'adapter' in locals():
            asyncio.run(adapter.database.engine.dispose())
            if hasattr(adapter.main, 'redis_client'):
                asyncio.run(adapter.main.redis_client.aclose())
            unload_adapter(adapter.package)
        mp.undo()


@pytest_asyncio.fixture
async def db(service):
    # Real service models, complete schema, fresh SQLite database for every test.
    engine = create_async_engine('sqlite+aiosqlite://')
    bases = [service.models.Base]
    if service.name == 'setup':
        bases.append(service.main.SetupBase)
    async with engine.begin() as connection:
        for base in bases:
            await connection.run_sync(base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        org_kwargs = {'id': 'org', 'is_active': True}
        if hasattr(service.models.Organization, 'name'):
            org_kwargs['name'] = 'Isolated org'
        session.add(service.models.Organization(**org_kwargs))
        if hasattr(service.models, 'Event'):
            session.add(service.models.Event(id='event', org_id='org', name='Isolated event',
                                            event_date=datetime(2026, 1, 1), timezone='UTC'))
        await session.commit()
        yield session
    await engine.dispose()
