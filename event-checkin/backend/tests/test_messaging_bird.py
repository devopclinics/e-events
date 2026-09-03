import pytest

from app.routers.messaging import _bird_status_fields
from services import messaging


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("8327941707", "+18327941707"),
        ("1 (832) 794-1707", "+18327941707"),
        ("+44 7911 123456", "+447911123456"),
        ("0044 7911 123456", "+447911123456"),
        ("whatsapp:+1 832-794-1707", "+18327941707"),
        ("not-a-phone", None),
    ],
)
def test_normalize_whatsapp_phone(raw, expected):
    assert messaging._normalize_whatsapp_phone(raw) == expected


@pytest.mark.asyncio
async def test_bird_template_send_normalizes_recipient(monkeypatch):
    monkeypatch.setattr(messaging.settings, "bird_whatsapp_channel_id", "channel-id")
    captured = {}

    async def fake_post(channel_id, payload):
        captured.update(channel_id=channel_id, payload=payload)
        return {"provider": "bird", "status": "accepted"}

    monkeypatch.setattr(messaging, "_bird_post", fake_post)
    result = await messaging._bird_whatsapp_send(
        "(832) 794-1707", "project-id:1", ["Sam"], ["firstName"]
    )

    assert result["status"] == "accepted"
    assert captured["payload"]["receiver"]["contacts"][0]["identifierValue"] == "+18327941707"


@pytest.mark.asyncio
async def test_experience_invite_override_with_consent_uses_v7_variables(monkeypatch):
    monkeypatch.setattr(messaging, "_channel_ready", lambda channel, recipient: True)
    monkeypatch.setattr(messaging.settings, "whatsapp_invite_override_event_id", "event-id")
    monkeypatch.setattr(messaging.settings, "whatsapp_invite_override_template", "project-id:template-id")
    monkeypatch.setattr(
        messaging.settings,
        "whatsapp_invite_override_consent_link",
        "https://festio.events/api/s/mbfwaiver",
    )
    captured = {}

    async def fake_send(phone, template, params, var_keys):
        captured.update(phone=phone, template=template, params=params, var_keys=var_keys)
        return {"provider": "bird", "status": "accepted"}

    monkeypatch.setattr(messaging, "_bird_whatsapp_send", fake_send)
    await messaging.send_experience_invite_whatsapp(
        phone="+18327941707",
        first_name="Aminu",
        event_name="Masjid-ul Mumineen 2026 MBF Summit",
        ticket_url="https://festio.events/scan/pass-token",
        event_id="event-id",
        event_location="84 Wimberly Ln, Huntsville, TX 77320",
    )

    assert captured["template"] == "project-id:template-id"
    assert captured["var_keys"] == [
        "firstName", "eventName", "ticketUrl", "qrCodeUrl",
        "consentLink", "eventDate", "eventLocation",
    ]
    assert captured["params"][4] == "https://festio.events/api/s/mbfwaiver"


def test_bird_outbound_webhook_extracts_nested_delivery():
    status, message_id, error = _bird_status_fields({
        "service": "channels",
        "event": "whatsapp.outbound",
        "payload": {"id": "message-123", "status": "delivered"},
    })
    assert (status, message_id, error) == ("delivered", "message-123", None)


def test_bird_outbound_webhook_extracts_failure():
    status, message_id, error = _bird_status_fields({
        "payload": {
            "id": "message-456",
            "status": "delivery_failed",
            "reason": "unknown subscriber",
            "failure": {"code": 15005},
        }
    })
    assert (status, message_id, error) == ("delivery_failed", "message-456", "15005")
