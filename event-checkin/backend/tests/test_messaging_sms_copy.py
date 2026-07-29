import re
from datetime import datetime

import pytest

from services import messaging
from services.shortlinks import resolve_short_url


def _capture_sms(monkeypatch):
    sent = []

    monkeypatch.setattr(messaging, "_channel_ready", lambda channel, phone: True)

    async def fake_send(phone, body):
        sent.append((phone, body))

    monkeypatch.setattr(messaging, "_send_sms", fake_send)
    return sent


@pytest.mark.asyncio
async def test_invite_sms_is_branded_has_opt_out_and_shortens_the_url(monkeypatch):
    sent = _capture_sms(monkeypatch)

    await messaging.send_invite_sms(
        phone="+15551234567",
        first_name="Amara",
        event_name="Johnson Wedding",
        ticket_url="https://festio.events/scan/abc123",
        event_date=datetime(2026, 8, 12, 18, 0),
    )

    assert len(sent) == 1
    phone, body = sent[0]
    assert phone == "+15551234567"
    assert body.startswith("Festio: Hi Amara! Johnson Wedding, Aug 12, 2026. Ticket: ")
    assert body.endswith("Reply HELP for help, STOP to opt out. Message and data rates may apply.")
    # The original long ticket_url must not appear verbatim — it should have
    # been swapped for a short /api/s/{code} redirect (see services/shortlinks.py),
    # which is what keeps this template's length in check.
    assert "festio.events/scan/abc123" not in body
    m = re.search(r"https://festio\.events/api/s/(\w+)", body)
    assert m, body
    assert await resolve_short_url(m.group(1)) == "https://festio.events/scan/abc123"


@pytest.mark.asyncio
async def test_manual_invite_sms_is_branded_has_opt_out_and_shortens_the_url(monkeypatch):
    sent = _capture_sms(monkeypatch)

    await messaging.send_manual_invite_sms(
        phone="+15551234567",
        name="Amara",
        event_name="Johnson Wedding",
        invite_url="https://festio.events/r/xyz789",
    )

    assert len(sent) == 1
    phone, body = sent[0]
    assert phone == "+15551234567"
    assert body.startswith("Festio: Hi Amara! Johnson Wedding. RSVP: ")
    assert body.endswith("Reply HELP for help, STOP to opt out. Message and data rates may apply.")
    assert "festio.events/r/xyz789" not in body
    m = re.search(r"https://festio\.events/api/s/(\w+)", body)
    assert m, body
    assert await resolve_short_url(m.group(1)) == "https://festio.events/r/xyz789"


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
        "Festio: Welcome Amara! Checked in: Johnson Wedding. "
        "Table: VIP-2 seat 4. Reply HELP for help, STOP to opt out. Message and data rates may apply.",
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
        "Festio: Your seat changed to Table 2, Seat 6. Reply HELP for help, STOP to opt out. "
        "Message and data rates may apply.",
    )]
