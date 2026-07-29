"""Tests for xwireless.net Nigeria (+234) SMS overlay in services.messaging."""
import pytest
import httpx

from services import messaging


# ── _is_nigeria_number ────────────────────────────────────────────────────────

@pytest.mark.parametrize("phone,expected", [
    ("+2348012345678", True),    # E.164 with leading +
    ("2348012345678", True),     # bare international, 13 digits
    ("+234 803 123 4567", True), # with spaces
    ("+234-802-0001111", True),  # with hyphens
    ("+15550001234", False),     # US number
    ("+447911123456", False),    # UK number
    ("+448001234567", False),    # UK number starting 44
    ("", False),                 # empty string
    (None, False),               # None guard
])
def test_is_nigeria_number(phone, expected):
    assert messaging._is_nigeria_number(phone) == expected


# ── _brand_sms_ng vs _brand_sms ──────────────────────────────────────────────

def test_brand_sms_ng_no_us_footer():
    result = messaging._brand_sms_ng("Your event starts soon")
    assert "Festio:" in result
    assert "STOP" not in result
    assert "HELP" not in result
    assert "data rates" not in result.lower()


def test_brand_sms_ng_adds_prefix():
    result = messaging._brand_sms_ng("Welcome!")
    assert result.startswith("Festio:")


def test_brand_sms_ng_strips_emoji():
    result = messaging._brand_sms_ng("Party 🎉 time")
    assert "🎉" not in result
    assert "Party" in result


# ── _send_sms routes Nigeria numbers through xwireless ───────────────────────

@pytest.mark.asyncio
async def test_nigeria_number_routed_to_xwireless(monkeypatch):
    monkeypatch.setattr(messaging.settings, "xwireless_api_key", "test-api-key")
    monkeypatch.setattr(messaging.settings, "xwireless_client_id", "test-client-id")
    monkeypatch.setattr(messaging.settings, "xwireless_sender_id", "FESTIO")
    monkeypatch.setattr(messaging.settings, "xwireless_base_url", "https://secure.xwireless.net")
    monkeypatch.setattr(messaging.settings, "messaging_provider", "twilio")  # should be bypassed

    captured = {}

    async def fake_xwireless(phone, body):
        captured["phone"] = phone
        captured["body"] = body
        return {"provider": "xwireless", "status": "queued"}

    monkeypatch.setattr(messaging, "_send_sms_xwireless", fake_xwireless)
    await messaging._send_sms("+2348012345678", "Hello Lagos")

    assert captured["phone"] == "+2348012345678"
    assert captured["body"] == "Hello Lagos"


@pytest.mark.asyncio
async def test_non_nigeria_number_not_routed_to_xwireless(monkeypatch):
    monkeypatch.setattr(messaging.settings, "xwireless_api_key", "test-api-key")
    monkeypatch.setattr(messaging.settings, "xwireless_client_id", "test-client-id")
    monkeypatch.setattr(messaging.settings, "messaging_provider", "")  # no-op provider

    xwireless_called = []

    async def fake_xwireless(phone, body):
        xwireless_called.append(phone)

    monkeypatch.setattr(messaging, "_send_sms_xwireless", fake_xwireless)
    result = await messaging._send_sms("+15550001234", "Hello US")

    assert xwireless_called == [], "US number must not call xwireless"
    assert result is None  # no-op provider returns None


@pytest.mark.asyncio
async def test_xwireless_disabled_when_no_key(monkeypatch):
    """Without API key, Nigeria numbers fall through to the standard provider."""
    monkeypatch.setattr(messaging.settings, "xwireless_api_key", "")
    monkeypatch.setattr(messaging.settings, "xwireless_client_id", "")
    monkeypatch.setattr(messaging.settings, "messaging_provider", "")

    xwireless_called = []

    async def fake_xwireless(phone, body):
        xwireless_called.append(phone)

    monkeypatch.setattr(messaging, "_send_sms_xwireless", fake_xwireless)
    result = await messaging._send_sms("+2348012345678", "Hello Lagos")

    assert xwireless_called == [], "xwireless must not fire when api_key is blank"
    assert result is None


# ── _send_sms_xwireless HTTP payload ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_xwireless_request_payload(monkeypatch):
    monkeypatch.setattr(messaging.settings, "xwireless_api_key", "my-key")
    monkeypatch.setattr(messaging.settings, "xwireless_client_id", "my-client")
    monkeypatch.setattr(messaging.settings, "xwireless_sender_id", "TESTIO")
    monkeypatch.setattr(messaging.settings, "xwireless_base_url", "https://secure.xwireless.net")

    requests = []
    real_client = httpx.AsyncClient

    async def handler(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={"errorCode": 0, "errorDescription": "Success", "data": "MSG001"},
        )

    monkeypatch.setattr(
        messaging.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler)),
    )

    result = await messaging._send_sms_xwireless("+2348012345678", "Festio: Welcome!")

    assert len(requests) == 1
    assert str(requests[0].url) == "https://secure.xwireless.net/api/v2/SendSMS"
    body = requests[0]
    import json
    payload = json.loads(body.content)
    assert payload["apiKey"] == "my-key"
    assert payload["clientId"] == "my-client"
    assert payload["senderId"] == "TESTIO"
    assert payload["mobileNumbers"] == "2348012345678"   # leading + stripped
    assert payload["message"] == "Festio: Welcome!"
    assert result["status"] == "queued"
    assert result["provider"] == "xwireless"


@pytest.mark.asyncio
async def test_xwireless_error_response(monkeypatch):
    monkeypatch.setattr(messaging.settings, "xwireless_api_key", "my-key")
    monkeypatch.setattr(messaging.settings, "xwireless_client_id", "my-client")
    monkeypatch.setattr(messaging.settings, "xwireless_sender_id", "FESTIO")
    monkeypatch.setattr(messaging.settings, "xwireless_base_url", "https://secure.xwireless.net")

    real_client = httpx.AsyncClient

    async def handler(request):
        return httpx.Response(
            200,
            json={"errorCode": 1001, "errorDescription": "Invalid sender", "data": None},
        )

    monkeypatch.setattr(
        messaging.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler)),
    )

    result = await messaging._send_sms_xwireless("+2348012345678", "Hello")

    assert result["status"] == "failed"
    assert result["provider"] == "xwireless"
    assert "Invalid sender" in result.get("error", "")
