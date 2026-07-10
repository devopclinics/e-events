import pytest

from services import messaging


@pytest.mark.asyncio
async def test_signalhouse_sms_payload(monkeypatch):
    monkeypatch.setattr(messaging.settings, "messaging_provider", "signalhouse")
    monkeypatch.setattr(messaging.settings, "signalhouse_api_key", "secret")
    monkeypatch.setattr(messaging.settings, "signalhouse_from_number", "+15550001111")
    monkeypatch.setattr(messaging.settings, "signalhouse_status_callback_url", "https://example.test/status")
    captured = {}

    async def fake_request(path, **kwargs):
        captured.update(path=path, **kwargs)
        return {"provider": "signalhouse", "status": "queued"}

    monkeypatch.setattr(messaging, "_signalhouse_request", fake_request)
    await messaging.send_custom_sms(phone="+15550002222", body="Hello")

    assert captured["path"] == "/message/sms"
    assert captured["json"]["senderPhoneNumber"] == "+15550001111"
    assert captured["json"]["recipientPhoneNumber"] == ["+15550002222"]
    assert captured["json"]["statusCallbackUrl"] == "https://example.test/status"


@pytest.mark.asyncio
async def test_signalhouse_mms_payload(monkeypatch):
    monkeypatch.setattr(messaging.settings, "signalhouse_from_number", "+15550001111")
    monkeypatch.setattr(messaging.settings, "signalhouse_status_callback_url", "https://example.test/status")
    captured = {}

    async def fake_request(path, **kwargs):
        captured.update(path=path, **kwargs)
        return {"provider": "signalhouse", "status": "queued"}

    monkeypatch.setattr(messaging, "_signalhouse_request", fake_request)
    await messaging._signalhouse_mms("+15550002222", "Ticket", "https://example.test/card.png")

    assert captured["path"] == "/message/mms"
    assert captured["data"]["mediaUrls"] == '["https://example.test/card.png"]'


def test_signalhouse_response_normalization():
    result = messaging._signalhouse_result({"data": {"messages": [{"messageId": "abc", "status": "accepted"}]}})
    assert result == {"provider": "signalhouse", "provider_message_id": "abc", "status": "accepted"}
