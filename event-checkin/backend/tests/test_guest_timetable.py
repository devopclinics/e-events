from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.schemas import GuestProgramOut
from app.services import program


@pytest.mark.asyncio
async def test_imported_sessions_appear_in_timetable_without_becoming_automatic_segments(monkeypatch):
    event = SimpleNamespace(id='event', name='Demo', event_date=datetime(2026, 12, 24, 14), timezone='America/Indiana/Indianapolis', live_program_enabled=True)
    step = SimpleNamespace(id='session', key='session', title='Ask a Sheikh', description='Questions', enabled=True, type='session_attendance', is_segment=False, starts_offset_seconds=None, duration_seconds=None, sort_order=0, conditions={'age_groups_include': ['Adults']}, config={'session': {'date': '2026-12-25', 'start_time': '10:00', 'end_time': '11:00', 'room': 'Hall A', 'speaker': 'Demo speaker'}})
    workflow = SimpleNamespace(id='workflow', status='published', steps=[step])
    monkeypatch.setattr(program, '_feedback_windows', AsyncMock(return_value=[]))
    db = AsyncMock()
    result = await program.program_state(event, workflow, db, now=datetime(2026, 12, 25, 15, 30, tzinfo=timezone.utc))
    public = GuestProgramOut.model_validate(result)
    session = public.days[0].segments[0]
    assert public.days[0].date == '2026-12-25'
    assert session.starts_at.isoformat() == '2026-12-25T10:00:00-05:00'
    assert session.room == 'Hall A' and session.speaker == 'Demo speaker'
    assert session.age_groups == ['Adults'] and session.active
    assert program.segment_steps(workflow) == []
    db.commit.assert_not_called()
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_disabled_or_undated_sessions_are_not_shown(monkeypatch):
    event = SimpleNamespace(id='event', name='Demo', event_date=datetime(2026, 12, 24, 14), timezone='UTC', live_program_enabled=True)
    step = SimpleNamespace(id='session', key='session', title='Undated', description=None, enabled=True, type='session_attendance', is_segment=False, starts_offset_seconds=None, duration_seconds=None, sort_order=0, conditions={}, config={})
    workflow = SimpleNamespace(id='workflow', status='published', steps=[step])
    monkeypatch.setattr(program, '_feedback_windows', AsyncMock(return_value=[]))
    assert (await program.program_state(event, workflow, AsyncMock()))['days'] == []
    step.enabled = False
    step.config = {'session': {'date': '2026-12-25', 'start_time': '10:00', 'end_time': '11:00'}}
    assert (await program.program_state(event, workflow, AsyncMock()))['days'] == []
