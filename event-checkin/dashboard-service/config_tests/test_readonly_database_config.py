"""Import real Dashboard settings/engine wiring with synthetic, isolated config.

Run explicitly: python -m pytest config_tests -q
These tests do not load the service's SQLite/ASGI conftest, contact a database,
read dotenv files, or inherit the invoking shell's configuration.
"""
from __future__ import annotations

import importlib
import importlib.util
import os
from pathlib import Path
import socket
import sys
import uuid

import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy.engine import URL
import sqlalchemy.ext.asyncio


APP_PATH = Path(__file__).resolve().parents[1] / "app"
PASSWORD = "  synthetic-only:@/?#%[]\\+=é\nend  "
SYNTHETIC = {
    "DASHBOARD_DB_HOST": "dashboard-db.invalid",
    "DASHBOARD_DB_PORT": "5544",
    "DASHBOARD_DB_NAME": "synthetic_dashboard",
    "DASHBOARD_DB_USER": "dashboard_ro",
    "DASHBOARD_RO_DB_PASSWORD": PASSWORD,
}
PRIVILEGED_URL = "postgresql+asyncpg://synthetic_admin:never-use-this@backend.invalid:5432/backend"


@pytest.fixture
def sandbox(monkeypatch, tmp_path):
    # Clear all settings, not just known ones: real credentials must not enter a
    # Settings instance, even if the developer/CI shell has an unrelated env key.
    monkeypatch.setattr(os, "environ", dict(SYNTHETIC))
    monkeypatch.chdir(tmp_path)

    def deny_network(*args, **kwargs):
        pytest.fail("Configuration tests must never open a network connection")

    monkeypatch.setattr(socket.socket, "connect", deny_network)
    monkeypatch.setattr(socket.socket, "connect_ex", deny_network)
    monkeypatch.setattr(socket, "create_connection", deny_network)
    monkeypatch.setattr(socket, "getaddrinfo", deny_network)

    engine_calls = []
    session_calls = []
    engine = object()
    sessions = object()

    def create_engine(url, **kwargs):
        engine_calls.append((url, kwargs))
        return engine

    def create_sessions(*args, **kwargs):
        session_calls.append((args, kwargs))
        return sessions

    monkeypatch.setattr(sqlalchemy.ext.asyncio, "create_async_engine", create_engine)
    monkeypatch.setattr(sqlalchemy.ext.asyncio, "async_sessionmaker", create_sessions)

    # A unique real package prevents previous app imports/settings from masking
    # startup failures. Relative imports still execute the unchanged service files.
    package_name = "dashboard_config_test_" + uuid.uuid4().hex
    spec = importlib.util.spec_from_file_location(
        package_name, APP_PATH / "__init__.py", submodule_search_locations=[str(APP_PATH)]
    )
    package = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, package_name, package)
    spec.loader.exec_module(package)

    class Imports:
        def config(self):
            return importlib.import_module(package_name + ".config")

        def database(self):
            return importlib.import_module(package_name + ".database")

    imported = Imports()
    imported.engine_calls = engine_calls
    imported.session_calls = session_calls
    imported.engine = engine
    imported.sessions = sessions
    yield imported
    for name in tuple(sys.modules):
        if name.startswith(package_name + "."):
            sys.modules.pop(name, None)


def assert_safe_startup_failure(sandbox, field):
    with pytest.raises(ValidationError) as caught:
        sandbox.database()
    diagnostic = str(caught.value) + repr(caught.value)
    assert field.lower() in diagnostic
    assert PASSWORD not in diagnostic
    assert PRIVILEGED_URL not in diagnostic
    assert "input_value" not in diagnostic
    assert sandbox.engine_calls == []
    assert sandbox.session_calls == []


@pytest.mark.parametrize("field", SYNTHETIC)
def test_missing_required_setting_fails_before_engine(sandbox, monkeypatch, field):
    monkeypatch.delenv(field)
    assert_safe_startup_failure(sandbox, field)


@pytest.mark.parametrize("field", SYNTHETIC)
@pytest.mark.parametrize("value", ["", " ", "\t\n"])
def test_blank_required_setting_fails_before_engine(sandbox, monkeypatch, field, value):
    monkeypatch.setenv(field, value)
    assert_safe_startup_failure(sandbox, field)


@pytest.mark.parametrize("value", ["0", "65536", "-1", "5432.0", "5e3", "text", "true", " 5432", "5432 ", "+5432", "٥٤٣٢"])
def test_invalid_port_fails_before_engine(sandbox, monkeypatch, value):
    monkeypatch.setenv("DASHBOARD_DB_PORT", value)
    assert_safe_startup_failure(sandbox, "DASHBOARD_DB_PORT")


@pytest.mark.parametrize("value", [True, False, 5432.0, None])
def test_noninteger_constructor_port_rejected(sandbox, value):
    config = sandbox.config()
    with pytest.raises(ValidationError):
        config.Settings(dashboard_db_port=value, _env_file=None)
    assert sandbox.engine_calls == []


@pytest.mark.parametrize("value", [
    "postgresql://db.invalid", "db.invalid:5432", "user@db.invalid",
    "db.invalid/path", "/var/run/postgresql", "db.invalid?option=x",
    " db.invalid", "db.invalid ", "db..invalid", "-db.invalid",
    "db-.invalid", "db.invalid\n", "[::1]", "999.999.999.999",
    "fe80::1%scope name", "fe80::1%scope\n", "fe80::1%scope@host",
])
def test_invalid_host_fails_before_engine(sandbox, monkeypatch, value):
    monkeypatch.setenv("DASHBOARD_DB_HOST", value)
    assert_safe_startup_failure(sandbox, "DASHBOARD_DB_HOST")


@pytest.mark.parametrize("field", ["DASHBOARD_DB_NAME", "DASHBOARD_DB_USER"])
@pytest.mark.parametrize("value", [" synthetic", "synthetic ", "synthetic\nrole", "synthetic\trole"])
def test_invalid_database_identifier_fails_before_engine(sandbox, monkeypatch, field, value):
    monkeypatch.setenv(field, value)
    assert_safe_startup_failure(sandbox, field)


def test_control_character_in_constructor_identifier_rejected(sandbox):
    config = sandbox.config()
    for field in ("dashboard_db_name", "dashboard_db_user"):
        with pytest.raises(ValidationError):
            config.Settings(**{field: "synthetic\x00role"}, _env_file=None)


@pytest.mark.parametrize("host", ["localhost", "db", "db.namespace.svc.cluster.local", "127.0.0.1", "::1", "2001:db8::1"])
def test_supported_hosts_preserved(sandbox, monkeypatch, host):
    monkeypatch.setenv("DASHBOARD_DB_HOST", host)
    sandbox.database()
    assert sandbox.engine_calls[0][0].host == host


@pytest.mark.parametrize("port", ["1", "65535"])
def test_port_boundaries_supported(sandbox, monkeypatch, port):
    monkeypatch.setenv("DASHBOARD_DB_PORT", port)
    sandbox.database()
    assert sandbox.engine_calls[0][0].port == int(port)


def test_engine_uses_explicit_readonly_components_and_exact_password(sandbox, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", PRIVILEGED_URL)
    database = sandbox.database()
    config = sandbox.config()
    assert len(sandbox.engine_calls) == 1
    url, options = sandbox.engine_calls[0]
    assert isinstance(url, URL)
    assert url.drivername == "postgresql+asyncpg"
    assert url.host == SYNTHETIC["DASHBOARD_DB_HOST"]
    assert url.port == int(SYNTHETIC["DASHBOARD_DB_PORT"])
    assert url.database == SYNTHETIC["DASHBOARD_DB_NAME"]
    assert url.username == SYNTHETIC["DASHBOARD_DB_USER"]
    assert url.password == PASSWORD
    assert not url.query
    assert isinstance(config.settings.dashboard_ro_db_password, SecretStr)
    assert config.settings.dashboard_ro_db_password.get_secret_value() == PASSWORD
    assert PASSWORD not in str(config.settings)
    assert PASSWORD not in repr(config.settings)
    assert PASSWORD not in str(url)
    assert PASSWORD not in repr(url)
    assert not hasattr(config.settings, "database_url")
    assert options == {
        "echo": False, "pool_pre_ping": True, "pool_recycle": 1800,
        "pool_size": 10, "max_overflow": 5,
    }
    assert sandbox.session_calls == [((sandbox.engine,), {"expire_on_commit": False})]
    assert database.engine is sandbox.engine
    assert database.AsyncSessionLocal is sandbox.sessions


@pytest.mark.parametrize("field", SYNTHETIC)
def test_privileged_database_url_cannot_fill_missing_setting(sandbox, monkeypatch, field):
    monkeypatch.setenv("DATABASE_URL", PRIVILEGED_URL)
    monkeypatch.delenv(field)
    assert_safe_startup_failure(sandbox, field)


@pytest.mark.parametrize("url_key", ["DATABASE_URL", "database_url", "Database_Url"])
def test_database_url_alone_cannot_start_service(sandbox, monkeypatch, url_key):
    for field in SYNTHETIC:
        monkeypatch.delenv(field)
    monkeypatch.setenv(url_key, PRIVILEGED_URL)
    assert_safe_startup_failure(sandbox, "DASHBOARD_RO_DB_PASSWORD")


@pytest.mark.parametrize("key_case", [str.lower, str.swapcase, str.title])
def test_environment_names_are_case_insensitive(sandbox, monkeypatch, key_case):
    for field, value in SYNTHETIC.items():
        monkeypatch.delenv(field)
        monkeypatch.setenv(key_case(field), value)
    sandbox.database()
    assert sandbox.engine_calls[0][0].password == PASSWORD
    assert sandbox.engine_calls[0][0].username == SYNTHETIC["DASHBOARD_DB_USER"]


def test_dotenv_does_not_supply_missing_settings(sandbox, monkeypatch, tmp_path):
    dotenv = {**SYNTHETIC, "DASHBOARD_RO_DB_PASSWORD": "synthetic-dotenv-only"}
    (tmp_path / ".env").write_text("\n".join(f"{key}={value}" for key, value in dotenv.items()))
    for field in SYNTHETIC:
        monkeypatch.delenv(field)
    assert_safe_startup_failure(sandbox, "DASHBOARD_RO_DB_PASSWORD")


def test_inherited_environment_not_used_and_dotenv_cannot_override(sandbox, tmp_path):
    assert set(os.environ) - {"PYTEST_CURRENT_TEST"} == set(SYNTHETIC)
    (tmp_path / ".env").write_text("DASHBOARD_RO_DB_PASSWORD=synthetic-dotenv-only\nDATABASE_URL=" + PRIVILEGED_URL)
    sandbox.database()
    assert sandbox.engine_calls[0][0].password == PASSWORD



def test_all_connection_fields_required_and_dotenv_disabled(sandbox):
    config = sandbox.config()
    assert config.Settings.model_config["env_file"] is None
    assert config.Settings.model_config["hide_input_in_errors"] is True
    assert config.Settings.model_config["case_sensitive"] is False
    for field in SYNTHETIC:
        assert config.Settings.model_fields[field.lower()].is_required()
    assert "database_url" not in config.Settings.model_fields


@pytest.mark.parametrize("value", ["postgres", "synthetic_admin", "synthetic_dashboard_ro", "DASHBOARD_RO", "dashboard_ro "])
def test_other_database_roles_fail_closed(sandbox, monkeypatch, value):
    monkeypatch.setenv("DASHBOARD_DB_USER", value)
    assert_safe_startup_failure(sandbox, "DASHBOARD_DB_USER")
