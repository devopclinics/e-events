"""Guest-facing Experience surface (Guest Hub journey view).

Covers the token-authenticated /experience/me endpoints that let a guest see
their own journey and self-serve the consent step from the Hub.
"""
import pytest
from sqlalchemy import select

from conftest import _Session
from app.models import (
    ConsentForm,
    ConsentSignature,
    Event,
    GuestExperienceProgress,
    ExperienceStep,
    ExperienceWorkflow,
    Guest,
)

TOKEN = "guest-token-abc"


async def _setup(ctx, *, experience=True, with_consent=True):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.experience_enabled = experience
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        guest.invite_token = TOKEN
        guest.rsvp_status = "confirmed"
        wf = ExperienceWorkflow(event_id=ev.id, name="Flow", status="published", is_default=True, version=1)
        s.add(wf)
        await s.flush()
        s.add(ExperienceStep(workflow_id=wf.id, key="welcome", type="custom", title="Welcome", sort_order=10, required=False))
        if with_consent:
            s.add(ExperienceStep(workflow_id=wf.id, key="consent", type="consent", title="Sign the release", sort_order=20, required=True))
        form_id = None
        if with_consent:
            form = ConsentForm(event_id=ev.id, title="Media release", body="I agree to be photographed.", is_active=True, require_signature=True, version=1)
            s.add(form)
            await s.flush()
            form_id = form.id
        await s.commit()
        return guest.id, form_id


@pytest.mark.asyncio
async def test_journey_lists_steps_and_pending_consent(ctx):
    await _setup(ctx)
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/experience/me?token={TOKEN}")
    assert r.status_code == 200
    body = r.json()
    assert body["experience_enabled"] is True
    assert body["guest"]["name"] == "G One"
    types = {s["type"]: s for s in body["steps"]}
    assert set(types) == {"custom", "consent"}
    assert types["consent"]["status"] == "available"
    assert types["consent"]["self_service"] is True
    assert types["consent"]["actionable"] is True
    assert types["custom"]["self_service"] is False
    # consent shows up as an outstanding next step
    assert any(s["type"] == "consent" for s in body["next_steps"])
    assert body["consent"]["required"] is True
    assert body["consent"]["signed"] is False
    assert body["consent"]["form"]["title"] == "Media release"
    assert body["total_count"] == 2


@pytest.mark.asyncio
async def test_journey_exposes_guest_activity_details(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.experience_enabled = True
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        guest.invite_token = TOKEN
        wf = ExperienceWorkflow(event_id=ev.id, name="Flow", status="published", is_default=True, version=1)
        s.add(wf)
        await s.flush()
        step = ExperienceStep(
            workflow_id=wf.id,
            key="opening_keynote",
            type="session_attendance",
            title="Opening Keynote",
            sort_order=10,
            required=True,
            config={
                "session": {
                    "topic": "Opening Keynote",
                    "date": "2026-07-28",
                    "start_time": "09:00",
                    "end_time": "09:45",
                    "room": "Main Hall",
                    "speaker": "Event Host",
                    "checkin_window_minutes": 60,
                },
                "messages": {
                    "guest": "Show your Festio Pass at the Main Hall entrance.",
                    "complete": "Opening Keynote attendance recorded.",
                },
            },
        )
        s.add(step)
        await s.flush()
        s.add(GuestExperienceProgress(
            event_id=ev.id,
            workflow_id=wf.id,
            step_id=step.id,
            guest_id=guest.id,
            status="completed",
            progress_metadata={
                "session_checked_in_at": "2026-07-28T14:01:00",
                "session": {"topic": "Opening Keynote", "room": "Main Hall"},
                "internal_note": "do not expose",
            },
        ))
        await s.commit()

    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/experience/me?token={TOKEN}")
    assert r.status_code == 200
    session = r.json()["steps"][0]
    assert session["guest_message"] == "Show your Festio Pass at the Main Hall entrance."
    assert session["completion_message"] == "Opening Keynote attendance recorded."
    assert session["session"]["topic"] == "Opening Keynote"
    assert session["session"]["room"] == "Main Hall"
    assert session["metadata"]["session_checked_in_at"] == "2026-07-28T14:01:00"
    assert session["metadata"]["session"]["topic"] == "Opening Keynote"
    assert "internal_note" not in session["metadata"]


@pytest.mark.asyncio
async def test_sign_consent_completes_step(ctx):
    await _setup(ctx)
    ev = ctx.ids["event_a"]
    r = await ctx.client.post(
        f"/api/events/{ev}/experience/me/consent/sign?token={TOKEN}",
        json={"signer_name": "Grace One", "signature_text": "Grace One"},
    )
    assert r.status_code == 201
    assert r.json()["signer_name"] == "Grace One"

    # A signature row exists
    async with _Session() as s:
        sigs = (await s.execute(select(ConsentSignature).where(ConsentSignature.event_id == ev))).scalars().all()
        assert len(sigs) == 1

    # Journey now reflects a signed + completed consent step
    j = (await ctx.client.get(f"/api/events/{ev}/experience/me?token={TOKEN}")).json()
    assert j["consent"]["signed"] is True
    consent = next(s for s in j["steps"] if s["type"] == "consent")
    assert consent["status"] == "completed"
    assert consent["actionable"] is False
    assert all(s["type"] != "consent" for s in j["next_steps"])
    assert j["completed_count"] >= 1


@pytest.mark.asyncio
async def test_consent_shown_done_even_when_step_blocked(ctx):
    """A guest can sign consent from the Hub before check-in. The workflow may
    still hold the consent step blocked behind check-in, but the guest's own view
    should present consent as done once signed."""
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.experience_enabled = True
        ev.is_paid = True
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        guest.invite_token = TOKEN
        guest.admitted = False
        wf = ExperienceWorkflow(event_id=ev.id, name="Flow", status="published", is_default=True, version=1)
        s.add(wf)
        await s.flush()
        s.add(ExperienceStep(workflow_id=wf.id, key="check_in", type="check_in", title="Check in", sort_order=10, required=True))
        # consent depends on check_in -> starts "blocked" for a not-yet-admitted guest
        s.add(ExperienceStep(
            workflow_id=wf.id, key="consent", type="consent", title="Consent",
            sort_order=20, required=True, config={"depends_on": ["check_in"]},
        ))
        s.add(ConsentForm(event_id=ev.id, title="Release", body="ok", is_active=True, require_signature=True, version=1))
        await s.commit()

    ev_id = ctx.ids["event_a"]
    before = (await ctx.client.get(f"/api/events/{ev_id}/experience/me?token={TOKEN}")).json()
    consent_before = next(s for s in before["steps"] if s["type"] == "consent")
    assert consent_before["status"] == "blocked"

    r = await ctx.client.post(
        f"/api/events/{ev_id}/experience/me/consent/sign?token={TOKEN}",
        json={"signer_name": "G One", "signature_text": "G One"},
    )
    assert r.status_code == 201

    after = (await ctx.client.get(f"/api/events/{ev_id}/experience/me?token={TOKEN}")).json()
    consent_after = next(s for s in after["steps"] if s["type"] == "consent")
    assert consent_after["status"] == "completed"
    assert after["consent"]["signed"] is True


@pytest.mark.asyncio
async def test_sign_consent_is_idempotent(ctx):
    await _setup(ctx)
    ev = ctx.ids["event_a"]
    url = f"/api/events/{ev}/experience/me/consent/sign?token={TOKEN}"
    first = await ctx.client.post(url, json={"signer_name": "Grace One", "signature_text": "Grace One"})
    second = await ctx.client.post(url, json={"signer_name": "Grace One", "signature_text": "Grace One"})
    assert first.status_code == 201
    assert second.status_code in (200, 201)
    assert first.json()["id"] == second.json()["id"]
    async with _Session() as s:
        sigs = (await s.execute(select(ConsentSignature).where(ConsentSignature.event_id == ev))).scalars().all()
        assert len(sigs) == 1


@pytest.mark.asyncio
async def test_invalid_token_is_rejected(ctx):
    await _setup(ctx)
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/experience/me?token=nope")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_disabled_experience_returns_flag_false(ctx):
    await _setup(ctx, experience=False)
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/experience/me?token={TOKEN}")
    assert r.status_code == 200
    body = r.json()
    assert body["experience_enabled"] is False
    assert body["steps"] == []
    # guest is still resolved and consent (event-level) still surfaced
    assert body["guest"]["name"] == "G One"


@pytest.mark.asyncio
async def test_sign_consent_blocked_when_experience_disabled(ctx):
    await _setup(ctx, experience=False)
    r = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/experience/me/consent/sign?token={TOKEN}",
        json={"signer_name": "Grace One", "signature_text": "Grace One"},
    )
    assert r.status_code == 404
