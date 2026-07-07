from datetime import datetime

import pytest

from services import messaging


def _capture_sms(monkeypatch):
    sent = []

    monkeypatch.setattr(messaging, "_channel_ready", lambda channel, phone: True)

    async def fake_send(phone, body):
        sent.append((phone, body))

    monkeypatch.setattr(messaging, "_send_sms", fake_send)
    return sent


@pytest.mark.asyncio
async def test_invite_sms_is_branded_and_has_opt_out(monkeypatch):
    sent = _capture_sms(monkeypatch)

    await messaging.send_invite_sms(
        phone="+15551234567",
        first_name="Amara",
        event_name="Johnson Wedding",
        ticket_url="https://festio.events/scan/abc123",
        event_date=datetime(2026, 8, 12, 18, 0),
    )

    assert sent == [(
        "+15551234567",
        "Festio: Hi Amara! You're invited to Johnson Wedding on Aug 12, 2026. "
        "Your ticket: https://festio.events/scan/abc123 Reply STOP to opt out.",
    )]


@pytest.mark.asyncio
async def test_admission_sms_names_event_and_has_opt_out(monkeypatch):
    sent = _capture_sms(monkeypatch)

    await messaging.send_admission_sms(
        phone="+15551234567",
        first_name="Amara",
        event_name="Johnson Wedding",
        admitted_at=None,
        table_name="VIP-2",
        seat_number="4",
    )

    assert sent == [(
        "+15551234567",
        "Festio: Welcome Amara! You're checked in to Johnson Wedding. "
        "Table: VIP-2 seat 4. Reply STOP to opt out.",
    )]


@pytest.mark.asyncio
async def test_custom_sms_adds_missing_brand_and_opt_out(monkeypatch):
    sent = _capture_sms(monkeypatch)

    await messaging.send_custom_sms(
        phone="+15551234567",
        body="Your seat changed to Table 2, Seat 6.",
    )

    assert sent == [(
        "+15551234567",
        "Festio: Your seat changed to Table 2, Seat 6. Reply STOP to opt out.",
    )]
