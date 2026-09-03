from types import SimpleNamespace

import pytest

from app.main import communication_health


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _DeliveryDb:
    def __init__(self):
        self._results = iter([
            _Rows([
                ("sms-delivered", "sms", "reserve", "delivered", "sms-1", "invite"),
                ("sms-failed", "sms", "reserve", "invalid_recipient", None, "invite"),
                ("wa-accepted", "whatsapp", "reserve", "accepted", "wa-1", "invite"),
                ("wa-delivered", "whatsapp", "reserve", "delivered", "wa-2", "broadcast"),
            ]),
            _Rows([]),
        ])

    async def execute(self, _statement):
        return next(self._results)


@pytest.mark.asyncio
async def test_organization_reservations_are_reported_as_delivery_attempts():
    result = await communication_health(
        _DeliveryDb(),
        SimpleNamespace(id="event-a", message_credits=50),
    )

    assert result["sms"] == {"sent": 2, "delivered": 1, "failed": 1, "rate": 50}
    assert result["whatsapp"] == {"sent": 2, "delivered": 1, "failed": 0, "rate": 50}
    assert result["broadcast"]["whatsapp"] == {"sent": 1, "delivered": 1, "failed": 0, "rate": 100}
