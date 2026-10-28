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

def test_default_envelope_needs_no_custom_design_and_is_opt_in():
    put({'envelope_config': {'enabled': True, 'use_default': True}})
    stored = get_event_design('event-envelope').envelope_config
    assert stored.enabled and stored.appearance is None
    public = public_theme('event-envelope').envelope_config
    assert public.appearance.style == 'wax'
    assert public.appearance.palette == 'ivory'
    assert public.appearance.initials == '✧'
    put({'envelope_config': {'enabled': False}})
    assert not public_theme('event-envelope').envelope_config.enabled


def test_selecting_default_preserves_saved_custom_appearance():
    put({'envelope_config': {'appearance': {'style': 'pocket', 'palette': 'navy', 'initials': 'AB'}, 'enabled': True}})
    put({'envelope_config': {'use_default': True}})
    assert public_theme('event-envelope').envelope_config.appearance.palette == 'ivory'
    assert get_event_design('event-envelope').envelope_config.appearance.palette == 'navy'
    put({'envelope_config': {'use_default': False}})
    assert public_theme('event-envelope').envelope_config.appearance.initials == 'AB'

def test_wording_and_seal_visibility_round_trip_without_changing_activation():
    put({'envelope_config': {'appearance': {'initials': 'MA', 'show_initials': False, 'wording': {'intro_label': 'A personal invitation', 'headline': 'Faith lights the way\nTogether we build tomorrow', 'inscription': 'For our community', 'card_title': 'Our next chapter', 'skip_label': 'View event', 'show_card_message': False}}}})
    put({'envelope_config': {'enabled': True}})
    public = public_theme('event-envelope').envelope_config
    assert public.appearance.initials == 'MA' and not public.appearance.show_initials
    assert public.appearance.wording.headline == 'Faith lights the way\nTogether we build tomorrow'
    assert public.appearance.wording.skip_label == 'View event'
    assert not public.appearance.wording.show_card_message
    assert public.enabled
    put({'envelope_config': {'use_default': True}})
    assert public_theme('event-envelope').envelope_config.appearance.wording.headline == ''
    assert get_event_design('event-envelope').envelope_config.appearance.wording.card_title == 'Our next chapter'


def test_wording_validation_and_legacy_appearance_defaults():
    from app.schemas import EnvelopeWording
    assert EnvelopeAppearance.model_validate({'style': 'wax'}).wording == EnvelopeWording()
    with pytest.raises(ValidationError):
        EnvelopeWording.model_validate({'headline': 'x' * 121})
    with pytest.raises(ValidationError):
        EnvelopeWording.model_validate({'unknown_field': 'unsupported'})
    assert EnvelopeWording.model_validate({'intro_label': '  You are invited  '}).intro_label == 'You are invited'
