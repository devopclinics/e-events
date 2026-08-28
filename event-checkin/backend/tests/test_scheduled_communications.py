from datetime import datetime

from app.models import Event, ExperienceStep, ExperienceWorkflow, ScheduledCommunication
from app.services.scheduled_communications import compute_scheduled_for


def test_absolute_schedule_uses_event_timezone():
    event = Event(
        org_id="org", name="Test", couples_name="Test",
        event_date=datetime(2026, 9, 2, 15),
        timezone="America/Chicago", checkin_base_url="https://example.test",
    )
    # September is CDT (UTC-5).
    result = compute_scheduled_for(
        event,
        trigger_type="absolute",
        scheduled_at_local="2026-09-01T09:30",
    )
    assert result == datetime(2026, 9, 1, 14, 30)


def test_relative_schedule_uses_rsvp_deadline():
    event = Event(
        org_id="org", name="Test", couples_name="Test",
        event_date=datetime(2026, 9, 2, 15),
        rsvp_deadline=datetime(2026, 8, 31, 22),
        timezone="America/Chicago", checkin_base_url="https://example.test",
    )
    result = compute_scheduled_for(
        event,
        trigger_type="relative",
        anchor="rsvp_deadline",
        offset_minutes=-24 * 60,
    )
    assert result == datetime(2026, 8, 30, 22)


async def test_scheduler_crud_snapshot_and_tenant_boundary(ctx):
    ctx.login(ctx.ids["superadmin"])
    payload = {
        "name": "Initial invitation",
        "communication_type": "invitation",
        "trigger_type": "absolute",
        "scheduled_at_local": "2026-09-01T09:00",
        "channels": ["email"],
        "audience_type": "not_invited",
        "audience_mode": "frozen",
        "status": "scheduled",
    }
    created = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/communications/scheduled",
        json=payload,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["recipients_estimated"] == 1
    assert body["audience_mode"] == "frozen"
    communication_id = body["id"]

    paused = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/communications/scheduled/{communication_id}/pause"
    )
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"

    resumed = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/communications/scheduled/{communication_id}/resume"
    )
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "scheduled"

    ctx.login(ctx.ids["user_b"])
    hidden = await ctx.client.get(
        f"/api/events/{ctx.ids['event_a']}/communications/scheduled"
    )
    assert hidden.status_code == 404


async def test_outbox_claim_is_idempotent(ctx, monkeypatch):
    from conftest import _Session
    from app.services import scheduled_communication_outbox as outbox
    from app.services import scheduled_communication_send as sender

    async with _Session() as db:
        row = ScheduledCommunication(
            event_id=ctx.ids["event_a"],
            name="Due now",
            communication_type="event_reminder",
            trigger_type="absolute",
            scheduled_for_utc=datetime(2020, 1, 1),
            timezone="UTC",
            channels=["email"],
            audience_type="all",
            audience_mode="dynamic",
            subject="Test",
            email_body="Hello {{first_name}}",
            status="scheduled",
        )
        db.add(row)
        await db.commit()
        row_id = row.id

    async def fake_send(event, communication, db):
        return (1, 1, 0)

    monkeypatch.setattr(sender, "send_scheduled_communication", fake_send)
    # outbox imported the symbol directly, so patch its bound reference too.
    monkeypatch.setattr(outbox, "send_scheduled_communication", fake_send)
    assert await outbox.process_due() == 1
    assert await outbox.process_due() == 0

    async with _Session() as db:
        finished = await db.get(ScheduledCommunication, row_id)
        assert finished.status == "sent"
        assert finished.recipients_sent == 1


async def test_schedule_can_anchor_to_experience_program_session(ctx):
    from conftest import _Session

    ctx.login(ctx.ids["superadmin"])
    async with _Session() as db:
        workflow = ExperienceWorkflow(event_id=ctx.ids["event_a"], name="Program", status="published")
        db.add(workflow)
        await db.flush()
        step = ExperienceStep(
            workflow_id=workflow.id,
            key="opening",
            type="custom",
            title="Formal opening",
            starts_offset_seconds=3600,
            duration_seconds=1800,
            is_segment=True,
        )
        db.add(step)
        await db.commit()
        step_id = step.id

    scheduled = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/communications/scheduled",
        json={
            "name": "Opening begins soon",
            "communication_type": "session_reminder",
            "trigger_type": "relative",
            "anchor": "experience_step",
            "anchor_step_id": step_id,
            "offset_minutes": -15,
            "channels": ["email"],
            "audience_type": "confirmed",
            "audience_mode": "dynamic",
            "subject": "Opening begins soon",
            "email_body": "Hi {{first_name}}, the opening begins in 15 minutes.",
        },
    )
    assert scheduled.status_code == 201, scheduled.text
    assert scheduled.json()["anchor_step_id"] == step_id
    assert scheduled.json()["scheduled_for_utc"].startswith("2026-09-01T00:45:00")
