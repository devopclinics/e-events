import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from app.config import settings
from app.schemas import EventDesignIn, EnvelopeAppearance
from app.routers.design import put_event_design, get_event_design, public_theme
from app.store import save_design, load_design, publish_design

@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'storage_path', str(tmp_path))

def put(payload):
    return put_event_design('event-envelope', EventDesignIn.model_validate(payload), x_org_id='org-1')

def test_opt_in_and_missing_design():
    assert public_theme('event-envelope').envelope_config.enabled is False
    with pytest.raises(HTTPException) as error:
        put({'envelope_config': {'enabled': True}})
    assert error.value.status_code == 400
    assert load_design('event-envelope') is None

def test_partial_saves_preserve_design_and_publication():
    save_design('event-envelope', {'theme_config': {'colors': {'accent': '#123456'}}, 'wording_config': {'heroTitle': 'Published title'}})
    publish_design('event-envelope')
    put({'wording_config': {'heroTitle': 'Unpublished draft'}})
    put({'envelope_config': {'appearance': {'style': 'pocket', 'palette': 'emerald', 'initials': 'MA'}}})
    put({'envelope_config': {'enabled': True, 'frequency': 'always'}})
    public = public_theme('event-envelope')
    assert public.envelope_config.enabled is True
    assert public.envelope_config.appearance.style == 'pocket'
    assert public.wording['heroTitle'] == 'Published title'
    assert public.colors['accent'] == '#123456'
    stored = load_design('event-envelope')
    assert stored['wording_config']['heroTitle'] == 'Unpublished draft'
    assert stored['published_version'] == 1
    put({'theme_config': {'colors': {'accent': '#abcdef'}}})
    publish_design('event-envelope')
    assert public_theme('event-envelope').envelope_config.enabled is True
    put({'envelope_config': {'enabled': False}})
    assert get_event_design('event-envelope').envelope_config.appearance.initials == 'MA'
    assert public_theme('event-envelope').envelope_config.enabled is False

@pytest.mark.parametrize('patch', [{'style': 'invalid'}, {'palette': 'invalid'}, {'paper': 'url(javascript:alert(1))'}, {'seal': 'invalid'}, {'initials': 'TOOLONG'}, {'initials': ''}, {'unknown': True}])
def test_validation(patch):
    with pytest.raises(ValidationError):
        EnvelopeAppearance.model_validate(patch)

def test_frequency_validation():
    with pytest.raises(ValidationError):
        EventDesignIn.model_validate({'envelope_config': {'frequency': 'sometimes'}})
