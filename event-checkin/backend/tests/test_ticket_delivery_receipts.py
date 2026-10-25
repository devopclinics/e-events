from datetime import datetime,timedelta
from types import SimpleNamespace
from app.routers.ticketing_internal import _ticket_email_state


def event(status,provider_id='mail',signed=False,receipt=False,age=0):
    now=datetime.utcnow()+timedelta(seconds=age)
    return SimpleNamespace(recipient='buyer@example.invalid',status=status,provider_email_id=provider_id,
        provider_event_id='receipt' if receipt else None,created_at=now,occurred_at=now,
        payload={'_signature_verified':signed} if receipt else {'source':'send_attempt'})


def test_unsigned_receipt_cannot_claim_delivery():
    result=_ticket_email_state([event('sent'),event('delivered',receipt=True)],{'buyer@example.invalid'})
    assert result['status']=='sent'
    assert result['delivered_at'] is None


def test_signed_receipt_must_match_current_provider_message():
    result=_ticket_email_state([event('sent'),event('delivered',provider_id='old',signed=True,receipt=True)],{'buyer@example.invalid'})
    assert result['status']=='sent'


def test_every_expected_recipient_requires_a_verified_receipt():
    events=[event('sent'),event('delivered',signed=True,receipt=True)]
    assert _ticket_email_state(events,{'buyer@example.invalid'})['status']=='delivered'
    assert _ticket_email_state(events,{'buyer@example.invalid','other@example.invalid'})['status']=='unknown'


def test_old_send_does_not_confirm_a_new_queue_attempt():
    result=_ticket_email_state([event('sent',age=-60)],{'buyer@example.invalid'},datetime.utcnow())
    assert result['status']=='unknown'


def test_verified_bounce_is_visible():
    assert _ticket_email_state([event('sent'),event('bounced',signed=True,receipt=True)],{'buyer@example.invalid'})['status']=='bounced'
