from types import SimpleNamespace as NS
from unittest.mock import AsyncMock
import pytest
from app.services.reminder_session_access import reminder_session_context
from app.services.reminder_send import _send_to_guest

def fixture(dinner):
    event=NS(id='e',blocked_messaging_channels=[],setup_preferences={'reminder_session_access':{'conference_zone_id':'c','dinner_zone_id':'d','conference_time':'10:00 AM','dinner_time':'4:00 PM','timezone_label':'Lagos time (WAT)'}})
    guest=NS(id='g',rsvp_status='confirmed')
    db=NS(get=AsyncMock(return_value=NS(event_id='e',is_active=True)),scalar=AsyncMock(side_effect=[NS(decision='allow'),NS(decision=dinner) if dinner else None]))
    return event,guest,db

@pytest.mark.asyncio
@pytest.mark.parametrize('decision,label,has_dinner',[('allow','Conference + Dinner',True),('block','Conference Only',False)])
async def test_current_access_controls_content(monkeypatch,decision,label,has_dinner):
    monkeypatch.setattr('app.services.reminder_session_access.session_decision',AsyncMock(return_value=(True,None)))
    ctx=await reminder_session_context(*fixture(decision))
    assert ctx['session_access_label']==label
    assert ('Gala Dinner' in ctx['session_access_schedule'])==has_dinner
    assert '10:00 AM' in ctx['session_access_description']

@pytest.mark.asyncio
@pytest.mark.parametrize('decision',['review',None])
async def test_unresolved_access_stops_email(monkeypatch,decision):
    monkeypatch.setattr('app.services.reminder_session_access.session_decision',AsyncMock(return_value=(True,None)))
    sender=AsyncMock();monkeypatch.setattr('app.services.reminder_send.send_simple_email',sender)
    e,g,db=fixture(decision)
    with pytest.raises(ValueError,match='unresolved'):
        await _send_to_guest(e,NS(email_body='{{session_access_label}}'),g,db)
    sender.assert_not_called()

@pytest.mark.asyncio
async def test_group_restriction_wins(monkeypatch):
    monkeypatch.setattr('app.services.reminder_session_access.session_decision',AsyncMock(side_effect=[(True,None),(False,'Group blocked')]))
    with pytest.raises(ValueError,match='unresolved'):
        await reminder_session_context(*fixture('allow'))

@pytest.mark.parametrize('choice,label,has_dinner',[('conference_dinner','Conference + Dinner',True),('conference_only','Conference Only',False)])
def test_preview_context_uses_selected_sample_without_guest_changes(choice,label,has_dinner):
    from app.routers.reminders import _preview_context
    from services.templates import render
    e,_,_=fixture('allow')
    body='Hello {{first_name}}: {{session_access_label}} {{session_access_schedule}}'
    ctx=_preview_context(e,choice,body,'{{session_access_label}}')
    rendered=render(body,ctx)
    assert 'Hello Ada' in rendered and label in rendered
    assert ('Gala Dinner' in rendered)==has_dinner
    assert ('4:00 PM' in rendered)==has_dinner
    assert '{{' not in rendered

def test_plain_reminder_preview_does_not_require_session_configuration():
    from app.routers.reminders import _preview_context
    assert _preview_context(NS(setup_preferences={}), 'conference_dinner', 'Hello {{first_name}}')['first_name']=='Ada'
