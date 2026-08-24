from datetime import datetime
from types import SimpleNamespace

from app.models import EngagementSyncOutbox
from app.services.engagement_sync_outbox import queue_workflow_sync


class _CollectingSession:
    def __init__(self):
        self.added = []

    def add(self, value):
        self.added.append(value)


def _step(step_id, step_type, *, is_segment=False, enabled=True, offset=0):
    return SimpleNamespace(
        id=step_id,
        key=f"key-{step_id}",
        type=step_type,
        is_segment=is_segment,
        enabled=enabled,
        title=f"Session {step_id}",
        description="A synchronized program session",
        starts_offset_seconds=offset,
        duration_seconds=3600,
        sort_order=offset,
        config={"session": {"room": "Hall A", "speaker": "Amina Yusuf", "capacity": 120}},
    )


def test_published_program_sessions_are_queued_in_the_callers_transaction():
    db = _CollectingSession()
    event = SimpleNamespace(
        id="event-a", org_id="org-a", name="Festio Summit",
        event_date=datetime(2026, 8, 24, 9, 0), timezone="America/Chicago",
    )
    workflow = SimpleNamespace(
        id="workflow-a", status="published",
        steps=[
            _step("segment-a", "custom", is_segment=True),
            _step("session-a", "session_attendance", offset=3600),
            _step("consent-a", "consent"),
        ],
    )

    assert queue_workflow_sync(db, event=event, workflow=workflow) == 2
    assert len(db.added) == 2
    assert all(isinstance(row, EngagementSyncOutbox) for row in db.added)
    session = next(row for row in db.added if row.source_id == "session-a")
    assert session.org_id == "org-a"
    assert session.event_id == "event-a"
    assert session.command == "experience.program_session.upsert"
    assert session.payload["source_workflow_id"] == "workflow-a"
    assert session.payload["room"] == "Hall A"
    assert session.payload["speaker"] == "Amina Yusuf"
    # Stored 09:00 UTC is 04:00 CDT; the one-hour program offset is 05:00,
    # never 10:00 from incorrectly treating the stored timestamp as local.
    assert session.payload["starts_at"] == "2026-08-24T05:00:00-05:00"
    assert session.payload["ends_at"] == "2026-08-24T06:00:00-05:00"
    assert session.payload["starts_at"].endswith("-05:00")
    assert session.payload["ends_at"].endswith("-05:00")


def test_disabled_session_is_retained_as_disabled_instead_of_deleted():
    db = _CollectingSession()
    event = SimpleNamespace(
        id="event-a", org_id="org-a", name="Festio Summit",
        event_date=datetime(2026, 8, 24, 9, 0), timezone="UTC",
    )
    workflow = SimpleNamespace(id="workflow-a", status="published", steps=[_step("session-a", "session_attendance", enabled=False)])

    queue_workflow_sync(db, event=event, workflow=workflow)

    assert len(db.added) == 1
    assert db.added[0].payload["status"] == "disabled"
    assert db.added[0].command == "experience.program_session.upsert"


def test_legacy_session_config_produces_a_timezone_aware_projector_schedule():
    db = _CollectingSession()
    event = SimpleNamespace(
        id="event-a", org_id="org-a", name="Festio Summit",
        event_date=datetime(2026, 8, 24, 9, 0), timezone="America/Chicago",
    )
    step = _step("session-a", "session_attendance")
    step.starts_offset_seconds = None
    step.duration_seconds = None
    step.config = {"sessions": [{
        "date": "2026-08-25", "start_time": "10:30", "end_time": "11:45",
        "room": "Breakout B", "speaker": "Maya Thompson",
    }]}
    workflow = SimpleNamespace(id="workflow-a", status="published", steps=[step])

    queue_workflow_sync(db, event=event, workflow=workflow)

    payload = db.added[0].payload
    assert payload["starts_at"] == "2026-08-25T10:30:00-05:00"
    assert payload["ends_at"] == "2026-08-25T11:45:00-05:00"
    assert payload["room"] == "Breakout B"
