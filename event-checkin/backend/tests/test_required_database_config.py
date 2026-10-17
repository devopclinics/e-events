"""Database configuration fails closed; offline tooling never needs credentials."""
import json
from pathlib import Path
import subprocess
import sys

from pydantic import ValidationError
import pytest

from app.config import Settings, settings


BACKEND = Path(__file__).resolve().parents[1]
OFFLINE_URL = "postgresql+asyncpg://localhost/festio_tests"
OFFLINE_PASSWORD = "offline-test-placeholder"


@pytest.fixture
def clean_settings_environment(monkeypatch):
    # Never inspect or read deployment dotenv files or inherited credentials.
    for field in Settings.model_fields:
        monkeypatch.delenv(field, raising=False)
        monkeypatch.delenv(field.upper(), raising=False)


def _run_isolated(code, tmp_path, extra_env=None):
    env = {
        "PYTHONPATH": str(BACKEND),
        "PYTHONDONTWRITEBYTECODE": "1",
        "UPLOADS_DIR": str(tmp_path / "uploads"),
    }
    env.update(extra_env or {})
    return subprocess.run(
        [sys.executable, "-c", code], cwd=tmp_path, env=env,
        text=True, capture_output=True, timeout=60,
    )


def test_runtime_credentials_have_no_defaults():
    assert Settings.model_fields["database_url"].is_required()
    assert Settings.model_fields["dashboard_ro_db_password"].is_required()
    assert Settings.model_fields["meta_whatsapp_webhook_verify_token"].default == ""


def test_pytest_uses_explicit_offline_credentials():
    assert settings.database_url == OFFLINE_URL
    assert settings.dashboard_ro_db_password == OFFLINE_PASSWORD


@pytest.mark.parametrize("field", ["database_url", "dashboard_ro_db_password"])
@pytest.mark.parametrize("value", [None, "", " \t\n"])
def test_missing_and_blank_database_configuration_fails_closed(
    clean_settings_environment, field, value,
):
    supplied = {
        "database_url": OFFLINE_URL,
        "dashboard_ro_db_password": OFFLINE_PASSWORD,
    }
    if value is None:
        supplied.pop(field)
    else:
        supplied[field] = value
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, **supplied)
    assert field in str(error.value)
    assert OFFLINE_URL not in str(error.value)
    assert OFFLINE_PASSWORD not in str(error.value)


def test_configured_environment_values_are_preserved_exactly(
    clean_settings_environment, monkeypatch,
):
    # Synthetic values test whitespace preservation, not usable credentials.
    url = " postgresql+asyncpg://offline-marker@localhost/festio_tests "
    password = " synthetic password with spaces \t"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("DASHBOARD_RO_DB_PASSWORD", password)
    configured = Settings(_env_file=None)
    assert type(configured.database_url) is str
    assert type(configured.dashboard_ro_db_password) is str
    assert configured.database_url == url
    assert configured.dashboard_ro_db_password == password
    assert configured.meta_whatsapp_webhook_verify_token == ""
    assert url not in repr(configured)
    assert password not in repr(configured)
    assert url not in str(configured)
    assert password not in str(configured)


def test_displayed_errors_do_not_leak_valid_credentials(
    clean_settings_environment,
):
    supplied = {
        "database_url": "postgresql+asyncpg://display-marker@localhost/festio_tests",
        "dashboard_ro_db_password": "synthetic-display-marker",
        "smtp_port": "not-a-number",
    }
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, **supplied)
    for value in supplied.values():
        assert value not in str(error.value)
        assert value not in repr(error.value)
    # Pydantic's structured errors()/json() intentionally remain outside this
    # display-redaction guarantee and must never be logged with credentials.


@pytest.mark.parametrize("missing", ["DATABASE_URL", "DASHBOARD_RO_DB_PASSWORD"])
@pytest.mark.parametrize("value", [None, "", " \t\n"])
def test_complete_module_fails_before_engine_creation(tmp_path, missing, value):
    code = '''
from pydantic import ValidationError
import sqlalchemy.ext.asyncio

def forbid_engine(*args, **kwargs):
    raise AssertionError("engine creation must not occur")

sqlalchemy.ext.asyncio.create_async_engine = forbid_engine
try:
    import app.database
except ValidationError as exc:
    assert "input_value" not in str(exc)
    print("configuration rejected before database initialization")
else:
    raise AssertionError("missing configuration was accepted")
'''
    env = {"DATABASE_URL": OFFLINE_URL, "DASHBOARD_RO_DB_PASSWORD": OFFLINE_PASSWORD}
    if value is None:
        env.pop(missing)
    else:
        env[missing] = value
    result = _run_isolated(code, tmp_path, env)
    assert result.returncode == 0, result.stderr
    assert "configuration rejected before database initialization" in result.stdout


def test_complete_module_accepts_explicit_environment_without_db_work(tmp_path):
    code = '''
import socket

def forbid_connection(*args, **kwargs):
    raise AssertionError("database/network work is forbidden")

socket.socket.connect = forbid_connection
socket.socket.connect_ex = forbid_connection
from app.config import settings
assert settings.database_url == "postgresql+asyncpg://localhost/festio_tests"
assert settings.dashboard_ro_db_password == "offline-test-placeholder"
assert settings.meta_whatsapp_webhook_verify_token == ""
print("configuration imported without network access")
'''
    result = _run_isolated(code, tmp_path, {
        "DATABASE_URL": OFFLINE_URL, "DASHBOARD_RO_DB_PASSWORD": OFFLINE_PASSWORD,
    })
    assert result.returncode == 0, result.stderr
    assert "configuration imported without network access" in result.stdout


def test_offline_openapi_ignores_dotenv_and_never_connects(tmp_path):
    # This file is synthetic. Offline export must not import its settings.
    (tmp_path / ".env").write_text(
        "DATABASE_URL=invalid-dotenv-url\nDASHBOARD_RO_DB_PASSWORD=\nSMTP_PORT=invalid\n"
    )
    script = BACKEND / "scripts" / "export_openapi.py"
    code = f'''
import runpy
import socket
import sys

def forbid_connection(*args, **kwargs):
    raise AssertionError("database/network work is forbidden")

socket.socket.connect = forbid_connection
socket.socket.connect_ex = forbid_connection
sys.argv = [{str(script)!r}, "--offline"]
runpy.run_path({str(script)!r}, run_name="__main__")
from app.config import settings
assert settings.database_url == {OFFLINE_URL!r}
assert settings.dashboard_ro_db_password == {OFFLINE_PASSWORD!r}
'''
    result = _run_isolated(code, tmp_path, {
        "DATABASE_URL": "invalid-inherited-url",
        "DASHBOARD_RO_DB_PASSWORD": "",
        "database_url": "invalid-inherited-lowercase-url",
        "dashboard_ro_db_password": "",
    })
    assert result.returncode == 0, result.stderr
    spec = json.loads(result.stdout)
    assert "openapi" in spec
    assert "/api/health" in spec["paths"] or "/health" in spec["paths"]


def test_live_openapi_does_not_install_offline_defaults(tmp_path):
    script = BACKEND / "scripts" / "export_openapi.py"
    code = f'''
import runpy
import sys
from pydantic import ValidationError
sys.argv = [{str(script)!r}]
try:
    runpy.run_path({str(script)!r}, run_name="__main__")
except ValidationError:
    print("live export requires runtime credentials")
else:
    raise AssertionError("live export silently installed offline defaults")
'''
    result = _run_isolated(code, tmp_path)
    assert result.returncode == 0, result.stderr
    assert "live export requires runtime credentials" in result.stdout
