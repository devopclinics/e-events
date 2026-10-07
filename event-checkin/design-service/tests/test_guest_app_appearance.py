import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'storage_path', str(tmp_path))
    monkeypatch.setattr(settings, 'template_packs_path', str(tmp_path / 'packs'))
    monkeypatch.setattr(settings, 'internal_token', 'isolated-test-token')
    with TestClient(app) as c:
        c.headers['x-internal-token'] = 'isolated-test-token'
        yield c

@pytest.mark.parametrize('theme', ['event', 'light', 'dark', 'gold', 'ocean'])
def test_theme_requires_publication_and_preserves_other_design_settings(client, theme):
    path = '/api/v1/design/events/appearance-test'
    theme_config = {'guestAppTheme': theme, 'colors': {'primary': '#124b3c'}, 'passOptions': {'showHubButton': True}}
    assert client.put(path, json={'theme_config': theme_config, 'wording_config': {'footerNote': 'Original wording'}}).status_code == 200
    assert client.get(path + '/public-theme').json()['guest_app_theme'] == 'event'
    assert client.post(path + '/publish').status_code == 200
    live = client.get(path + '/public-theme').json()
    assert live['guest_app_theme'] == theme
    assert live['colors']['primary'] == '#124b3c'
    assert live['wording']['footerNote'] == 'Original wording'
    assert live['pass_options']['showHubButton'] is True
    assert client.put(path, json={'theme_config': {**theme_config, 'guestAppTheme': 'light'}}).status_code == 200
    assert client.get(path + '/public-theme').json()['guest_app_theme'] == theme

@pytest.mark.parametrize('value', ['invalid', None, {}, []])
def test_invalid_theme_rejected_without_saving(client, value):
    assert client.put('/api/v1/design/events/invalid-test', json={'theme_config': {'guestAppTheme': value}}).status_code == 422

def test_legacy_theme_has_safe_default(client):
    assert client.get('/api/v1/design/events/legacy-test/public-theme').json()['guest_app_theme'] == 'event'

def test_appearance_save_still_requires_internal_auth(client):
    client.headers.pop('x-internal-token')
    assert client.put('/api/v1/design/events/auth-test', json={'theme_config': {'guestAppTheme': 'dark'}}).status_code in [401,403]
