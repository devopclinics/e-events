"""Real module imports must validate DATABASE_URL before engine construction."""
import asyncio
from contextlib import contextmanager
import os
import socket
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from pydantic_settings.sources import DotEnvSettingsSource
from sqlalchemy.ext.asyncio import create_async_engine

from conftest import SERVICES, forbidden_network, import_adapter, isolated_environment, unload_adapter

CONFIG_SERVICES = tuple(name for name in SERVICES if name != 'dashboard')
MISSING = object()
SYNTHETIC_URL = 'postgresql+asyncpg://synthetic-user:synthetic-password-only@database.invalid/synthetic'


@contextmanager
def loaded_adapter(name, database_url):
    env = isolated_environment()
    env.pop('DATABASE_URL')
    if database_url is not MISSING:
        env['DATABASE_URL'] = database_url
    calls = []
    engines = []
    def offline_engine(url, **kwargs):
        calls.append(url)
        engine = create_async_engine('sqlite+aiosqlite://')
        engines.append(engine)
        return engine
    adapter = None
    try:
        with patch.dict(os.environ, env, clear=True), \
             patch.object(DotEnvSettingsSource, '_read_env_files', lambda self: {}), \
             patch.object(socket.socket, 'connect', forbidden_network), \
             patch.object(socket.socket, 'connect_ex', forbidden_network), \
             patch.object(socket, 'create_connection', forbidden_network), \
             patch.object(socket, 'getaddrinfo', forbidden_network), \
             patch('sqlalchemy.ext.asyncio.create_async_engine', offline_engine):
            try:
                adapter = import_adapter(name)
            except ValidationError:
                assert calls == [], 'Settings must fail before creating any engine'
                raise
            yield adapter, calls
    finally:
        for engine in engines:
            asyncio.run(engine.dispose())
        if adapter is not None:
            if hasattr(adapter.main, 'redis_client'):
                asyncio.run(adapter.main.redis_client.aclose())
            unload_adapter(adapter.package)


@pytest.mark.parametrize('service_name', CONFIG_SERVICES)
@pytest.mark.parametrize('value', [MISSING, '', ' \t\n'])
def test_missing_or_blank_database_url_fails_before_engine(service_name, value):
    with pytest.raises(ValidationError) as error:
        with loaded_adapter(service_name, value):
            pytest.fail('Missing/blank DATABASE_URL was accepted')
    assert 'database_url' in str(error.value)
    assert 'input_value=' not in str(error.value)


@pytest.mark.parametrize('service_name', CONFIG_SERVICES)
@pytest.mark.parametrize('value', [SYNTHETIC_URL, '  ' + SYNTHETIC_URL + '  '])
def test_explicit_database_url_is_preserved_exactly_and_hidden(service_name, value):
    with loaded_adapter(service_name, value) as (adapter, engine_urls):
        settings = adapter.main.settings
        assert settings.database_url == value
        assert type(settings.database_url) is str
        assert engine_urls == [value]
        assert type(settings).model_fields['database_url'].is_required()
        assert 'synthetic-password-only' not in repr(settings)
        assert value not in repr(settings)


@pytest.mark.parametrize('service_name', CONFIG_SERVICES)
def test_wrong_type_validation_does_not_echo_supplied_input(service_name):
    marker = 'SYNTHETIC_SECRET_SHOULD_NOT_BE_ECHOED'
    with loaded_adapter(service_name, SYNTHETIC_URL) as (adapter, _):
        with pytest.raises(ValidationError) as error:
            adapter.main.Settings(_env_file=None, database_url=[marker])
        assert marker not in str(error.value)
        assert marker not in repr(error.value)
        assert 'input_value=' not in str(error.value)
