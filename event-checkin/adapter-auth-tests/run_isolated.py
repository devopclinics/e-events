#!/usr/bin/env python3
"""Run one existing adapter suite without ambient credentials or networking.

Usage: python event-checkin/adapter-auth-tests/run_isolated.py SERVICE
Dependencies: selected service requirements.txt + pytest pytest-asyncio aiosqlite
and httpx. No service lifespan or real provider is started by this runner.
"""
import argparse
import os
from pathlib import Path
import socket
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('service', choices=('dashboard', 'support', 'messaging', 'setup'))
    args = parser.parse_args()
    # Drop all ambient service credentials and configuration, including lowercase
    # overrides. Every configured value below is synthetic and local-only.
    os.environ.clear()
    os.environ.update({
        'PATH': os.defpath,
        'PYTHONDONTWRITEBYTECODE': '1',
        'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1',
        'DATABASE_URL': 'sqlite+aiosqlite://',
        'REDIS_URL': 'redis://127.0.0.1:1/0',
        'DASHBOARD_DB_HOST': 'dashboard-db.invalid',
        'DASHBOARD_DB_PORT': '5432',
        'DASHBOARD_DB_NAME': 'synthetic_dashboard',
        'DASHBOARD_DB_USER': 'dashboard_ro',
        'DASHBOARD_RO_DB_PASSWORD': 'synthetic-password-only',
    })
    sys.dont_write_bytecode = True
    def deny_network(*unused_args, **unused_kwargs):
        raise AssertionError('Existing adapter tests may not access the network')
    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.create_connection = deny_network
    socket.getaddrinfo = deny_network
    from pydantic_settings.sources import DotEnvSettingsSource
    DotEnvSettingsSource._read_env_files = lambda self: {}
    import sqlalchemy.ext.asyncio as sqlalchemy_asyncio
    original_engine = sqlalchemy_asyncio.create_async_engine
    import pytest
    service_path = ROOT / f'{args.service}-service'
    sys.path.insert(0, str(service_path))
    with tempfile.TemporaryDirectory(prefix='festio-adapter-suite-') as working:
        os.chdir(working)
        if args.service == 'dashboard':
            # Actual Dashboard production config remains PostgreSQL-only. Its
            # import-time engine uses a throwaway SQLite file in this runner.
            # Existing test-owned SQLite engines are left entirely unchanged.
            def offline_engine(url, **kwargs):
                if getattr(url, 'drivername', '').startswith('postgresql'):
                    url = 'sqlite+aiosqlite:///' + str(Path(working) / 'dashboard.sqlite')
                return original_engine(url, **kwargs)
            sqlalchemy_asyncio.create_async_engine = offline_engine
        return pytest.main([
            '-q', '-p', 'pytest_asyncio.plugin', '-p', 'no:cacheprovider',
            '-o', 'asyncio_mode=auto', str(service_path / 'tests'),
        ])


if __name__ == '__main__':
    raise SystemExit(main())
