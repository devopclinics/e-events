import pytest
from sqlalchemy import select

from conftest import _Session
from app.models import Event, ExperienceStep, ExperienceWorkflow, FeedbackSubmission, Guest
from app.routers import events as events_router


async def _published_experience(ctx):
    async with _Session() as session:
        event = await session.get(Event, ctx.ids["event_a"])
        event.experience_enabled = True
        event.is_paid = True
        event.paid_channels = True
        event.plan_tier = "tier300"
        workflow = ExperienceWorkflow(
            event_id=event.id,
            name="Guest journey",
            status="published",
            version=1,
            is_default=True,
        )
        session.add(workflow)
        await session.flush()
        feedback = ExperienceStep(
            workflow_id=workflow.id,
            key="event_feedback",
            type="feedback",
            title="Event feedback",
            enabled=True,
            config={"questions": [{"id": "overall", "type": "rating", "prompt": "Overall?"}]},
        )
        stage = ExperienceStep(
            workflow_id=workflow.id,
            key="next_steps",
            type="custom",
            title="Next steps",
            enabled=True,
        )
        session.add_all([feedback, stage])
        await session.commit()
        return feedback.id, stage.id


@pytest.mark.asyncio
async def test_feedback_one_person_send_adds_personal_link_and_subject(ctx, monkeypatch):
    feedback_id, _ = await _published_experience(ctx)
    sent = []

    async def fake_send_simple_email(*args, **kwargs):
        sent.append((args, kwargs))

    monkeypatch.setattr(events_router, "send_simple_email", fake_send_simple_email)
    async with _Session() as session:
        guest = (await session.scalars(select(Guest).where(Guest.event_id == ctx.ids["event_a"]))).first()
        guest_id = guest.id

    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/broadcast",
        json={
            "message": "Please share your feedback.",
            "subject": "Your opinion matters",
            "message_type": "feedback",
            "experience_step_id": feedback_id,
            "target": "none",
            "guest_ids": [guest_id],
            "channels": ["email"],
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["queued"] == 1
    assert len(sent) == 1
    args, _ = sent[0]
    assert args[1] == "Your opinion matters"
    assert "?focus=feedback#guest-hub" in args[2]
    async with _Session() as session:
        guest = await session.get(Guest, guest_id)
        assert guest.invite_token
        assert f"/r/{guest.invite_token}?focus=feedback#guest-hub" in args[2]


@pytest.mark.asyncio
async def test_feedback_audience_excludes_guests_who_already_responded(ctx, monkeypatch):
    feedback_id, _ = await _published_experience(ctx)
    sent_to = []

    async def fake_send_simple_email(*args, **kwargs):
        sent_to.append(args[0])

    monkeypatch.setattr(events_router, "send_simple_email", fake_send_simple_email)
    async with _Session() as session:
        workflow = (await session.scalars(select(ExperienceWorkflow).where(
            ExperienceWorkflow.event_id == ctx.ids["event_a"],
            ExperienceWorkflow.status == "published",
        ))).first()
        responded = (await session.scalars(select(Guest).where(Guest.event_id == ctx.ids["event_a"]))).first()
        pending = Guest(event_id=ctx.ids["event_a"], first_name="Still", last_name="Waiting", email="waiting@example.com")
        session.add(pending)
        await session.flush()
        session.add(FeedbackSubmission(
            event_id=ctx.ids["event_a"],
            workflow_id=workflow.id,
            step_id=feedback_id,
            guest_id=responded.id,
            answers={"overall": 5},
            question_snapshot=[],
        ))
        await session.commit()

    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/broadcast",
        json={
            "message": "Please share your feedback.",
            "message_type": "feedback",
            "experience_step_id": feedback_id,
            "target": "feedback_nonresponders",
            "channels": ["email"],
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["queued"] == 1
    assert sent_to == ["waiting@example.com"]


@pytest.mark.asyncio
async def test_experience_stage_must_be_live_and_contextual_recipients_must_be_guests(ctx):
    feedback_id, stage_id = await _published_experience(ctx)
    async with _Session() as session:
        guest = (await session.scalars(select(Guest).where(Guest.event_id == ctx.ids["event_a"]))).first()
        guest_id = guest.id

    ctx.login(ctx.ids["user_a"])
    wrong_type = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/broadcast",
        json={
            "message": "Open the form.",
            "message_type": "feedback",
            "experience_step_id": stage_id,
            "target": "none",
            "guest_ids": [guest_id],
            "channels": ["email"],
        },
    )
    assert wrong_type.status_code == 400

    external = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/broadcast",
        json={
            "message": "Open the form.",
            "message_type": "feedback",
            "experience_step_id": feedback_id,
            "target": "none",
            "extra_recipients": [{"name": "External", "email": "external@example.com"}],
            "channels": ["email"],
        },
    )
    assert external.status_code == 400
