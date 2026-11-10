from types import SimpleNamespace as NS
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from app.routers import reminders
from app.schemas import ReminderTestSendRequest

@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setattr(reminders,'_reminder_event',AsyncMock(return_value=NS(id='event',name='Test',setup_preferences={})))
    monkeypatch.setattr(reminders,'_get_reminder',AsyncMock(return_value=NS(whatsapp_template_ref='saved:version',whatsapp_template_vars={'firstName':'{{first_name}}'})))
    monkeypatch.setattr(reminders,'recipient_allowed',lambda *a: True)
    email=AsyncMock(return_value=True);wa=AsyncMock(return_value={'status':'accepted','provider_message_id':'msg-1'})
    monkeypatch.setattr(reminders,'send_simple_email',email)
    monkeypatch.setattr(reminders.messaging,'send_custom_template_whatsapp',wa)
    monkeypatch.setattr(reminders.messaging,'send_custom_whatsapp',AsyncMock(return_value=None))
    return email,wa

async def send(**kwargs):
    return await reminders.test_send_reminder('event','draft',ReminderTestSendRequest(**kwargs),None,None)

@pytest.mark.asyncio
async def test_email_rejection_is_not_success(setup):
    setup[0].return_value=False
    with pytest.raises(HTTPException) as error:await send(channel='email',to='events@festio.events',body='Hello')
    assert error.value.status_code==502

@pytest.mark.asyncio
@pytest.mark.parametrize('result',[None,{'status':'failed'},{'status':'queued'}])
async def test_whatsapp_no_acceptance_is_not_success(setup,result):
    setup[1].return_value=result
    with pytest.raises(HTTPException) as error:await send(channel='whatsapp',to='+18327941707')
    assert error.value.status_code==502

@pytest.mark.asyncio
async def test_selected_template_and_reference(setup):
    result=await send(channel='whatsapp',to='+18327941707',whatsapp_template_ref='selected:version',whatsapp_template_vars={'firstName':'{{first_name}}'})
    assert result['status']=='accepted' and result['provider_message_id']=='msg-1'
    assert setup[1].call_args.kwargs['template_ref']=='selected:version'
    assert setup[1].call_args.kwargs['params']==['Ada']

@pytest.mark.asyncio
async def test_explicitly_disabled_template_does_not_send_saved_template(setup):
    with pytest.raises(HTTPException) as error:await send(channel='whatsapp',to='+18327941707',whatsapp_template_ref=None,body='')
    assert error.value.status_code==422
    setup[1].assert_not_called()

@pytest.mark.asyncio
async def test_invalid_destination_never_calls_provider(setup):
    with pytest.raises(HTTPException) as error:await send(channel='email',to='events@festio.events +18327941707',body='Hello')
    assert error.value.status_code==422
    setup[0].assert_not_called()

@pytest.mark.asyncio
async def test_email_acceptance_has_delivery_context(setup):
    result=await send(channel='email',to='events@festio.events',body='Hello')
    assert result['status']=='accepted'
    assert setup[0].call_args.kwargs['event_id']=='event'
