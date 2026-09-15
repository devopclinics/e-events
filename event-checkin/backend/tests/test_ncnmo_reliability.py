from datetime import timedelta

from app.routers.experience import _parse_session_datetime


def test_session_wall_clock_uses_event_timezone():
    session = {"date": "2026-12-25", "start_time": "09:00"}

    local = _parse_session_datetime(
        session,
        "start_time",
        "America/Indiana/Indianapolis",
    )

    assert local.hour == 9
    assert local.utcoffset() == -timedelta(hours=5)
