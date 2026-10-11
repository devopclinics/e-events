import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.catalog import build_catalog, get_template, template_quality_issues

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'storage_path', str(tmp_path))
    monkeypatch.setattr(settings, 'template_packs_path', str(tmp_path / 'packs'))
    monkeypatch.setattr(settings, 'internal_token', 'format-test')
    with TestClient(app) as c:
        c.headers['X-Internal-Token'] = 'format-test'
        yield c

@pytest.mark.parametrize('format_id', ['editorial', 'spotlight', 'invitation', 'briefing', 'festival', 'infographic', 'tiles', 'circular', 'hexagonal', 'modern-unique'])
def test_format_selection_is_private_until_published_and_restorable(client, format_id):
    path = '/api/v1/design/events/format-test'
    baseline = client.get(path + '/public-theme').json()
    payload = {'selected_template_id': format_id, 'theme_config': {'colors': {'accent': '#123456'}},
               'page_config': {'experience': {'rsvpLayout': 'welcome', 'guestHubLayout': 'app'}, 'details': {'showVenue': False}},
               'wording_config': {'eventTitle': 'A real event title'}}
    draft = client.put(path, json=payload)
    assert draft.status_code == 200
    assert client.get(path + '/public-theme').json()['template_id'] == baseline['template_id']
    assert client.post(path + '/publish', json={'expected_revision': draft.json()['revision']}).status_code == 200
    live = client.get(path + '/public-theme').json()
    assert live['template_id'] == format_id and live['layout']['rsvpFormat'] == format_id
    assert live['colors']['accent'] == '#123456'
    assert live['page_config'] == payload['page_config'] and live['wording'] == payload['wording_config']
    new = client.put(path, json={'selected_template_id': 'modern', 'expected_revision': client.get(path).json()['revision']})
    assert new.status_code == 200
    assert client.get(path + '/public-theme').json()['layout']['rsvpFormat'] == format_id
    restored = client.post(path + '/restore', json={'version': 1, 'expected_revision': new.json()['revision']})
    assert restored.status_code == 200 and restored.json()['selected_template_id'] == format_id


def test_catalog_additions_preserve_original_ids_and_supported_surfaces():
    catalog = build_catalog()
    assert len(catalog) == 16
    assert [t['id'] for t in catalog[:6]] == ['flyer-led', 'signature', 'modern', 'celebration', 'formal', 'pilgrimage']
    assert get_template('general-modern-minimal')['id'] == 'modern'
    assert get_template('general-modern-luxury')['id'] == 'signature'
    for template in catalog:
        assert template_quality_issues(template) == []
    assert len({t['layout']['eventPage'] for t in catalog[6:11]}) == 5
