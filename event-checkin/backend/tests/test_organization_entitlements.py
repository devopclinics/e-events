from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.organization_entitlements import (
    FREE_EMAIL_CREDIT_UNITS,
    activate_pass,
    assert_can_create_event,
    guest_cap,
    pass_is_active,
)


def org(**overrides):
    values = {
        "event_pass_status": "free", "event_pass_tier": None,
        "event_pass_expires_at": None, "event_pass_guest_cap": None,
        "event_pass_started_at": None, "addon_promo_expires_at": None,
        "free_event_used": False, "message_credit_units": FREE_EMAIL_CREDIT_UNITS,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_free_org_gets_exactly_one_event():
    account = org()
    assert_can_create_event(account, 0)
    account.free_event_used = True
    with pytest.raises(HTTPException) as exc:
        assert_can_create_event(account, 1)
    assert exc.value.status_code == 402


def test_active_pass_allows_unlimited_events_at_tier_cap():
    account = org()
    activate_pass(account, "tier150", now=datetime(2026, 1, 1))
    assert pass_is_active(account, datetime(2026, 6, 1))
    assert guest_cap(account, datetime(2026, 6, 1)) == 150
    assert_can_create_event(account, 999)


def test_expired_pass_does_not_unlock_creation():
    account = org(
        event_pass_status="active", event_pass_tier="tier50",
        event_pass_expires_at=datetime.utcnow() - timedelta(seconds=1),
        event_pass_guest_cap=50, free_event_used=True,
    )
    assert not pass_is_active(account)
    with pytest.raises(HTTPException):
        assert_can_create_event(account, 1)


def test_pass_and_addon_promo_have_distinct_durations():
    start = datetime(2026, 1, 1)
    account = org()
    activate_pass(account, "tier50", now=start)
    assert account.event_pass_expires_at == start + timedelta(days=365)
    assert account.addon_promo_expires_at == start + timedelta(days=183)


def test_stabilization_flag_allows_more_events_without_granting_paid_features(monkeypatch):
    from app.config import settings
    from app.models import Event
    from app.organization_entitlements import snapshot_new_event
    monkeypatch.setattr(settings, 'unlimited_event_creation', True)
    account = org(free_event_used=True)
    assert_can_create_event(account, 10000)
    event = Event(name='Another free event')
    snapshot_new_event(event, account)
    assert event.is_paid is False and event.plan_tier == 'free'
    assert event.paid_channels is False and event.guest_cap == 25
    assert account.message_credit_units == FREE_EMAIL_CREDIT_UNITS
    monkeypatch.setattr(settings, 'unlimited_event_creation', False)
    with pytest.raises(HTTPException):
        assert_can_create_event(account, 10000)
