from datetime import datetime

import pytest
from sqlalchemy import select

from app.models import EventCertificate, ExperienceStep, ExperienceWorkflow, Guest, GuestExperienceProgress
from conftest import _Session


@pytest.mark.asyncio
async def test_certificate_eligibility_issue_and_public_verification(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]
    templates = await ctx.client.get(f"/api/events/{event_id}/certificate-templates")
    assert templates.status_code == 200
    template = templates.json()[0]

    async with _Session() as db:
        guest = await db.scalar(select(Guest).where(Guest.event_id == event_id))
        guest.admitted = True
        workflow = ExperienceWorkflow(event_id=event_id, name="Programme", status="published", version=1)
        db.add(workflow); await db.flush()
        step = ExperienceStep(workflow_id=workflow.id, key="session-one", type="session_attendance", title="Opening session")
        db.add(step); await db.flush()
        db.add(GuestExperienceProgress(event_id=event_id, workflow_id=workflow.id, step_id=step.id,
            guest_id=guest.id, status="completed", completed_at=datetime.utcnow()))
        await db.commit(); guest_id = guest.id

    candidates = await ctx.client.get(f"/api/events/{event_id}/certificate-candidates?template_id={template['id']}")
    assert candidates.status_code == 200
    candidate = next(row for row in candidates.json() if row["guest_id"] == guest_id)
    assert candidate["eligible"] is True
    assert candidate["sessions_attended"] == 1

    issued = await ctx.client.post(f"/api/events/{event_id}/certificates/issue", json={
        "template_id": template["id"], "guest_ids": [guest_id], "eligible_only": True, "send_email": False,
    })
    assert issued.status_code == 200
    assert issued.json()["issued"] == 1
    certificate = issued.json()["certificates"][0]
    token = certificate["verification_url"].rsplit("/", 1)[-1]

    verification = await ctx.client.get(f"/api/certificates/{token}")
    assert verification.status_code == 200
    assert verification.json()["valid"] is True
    assert verification.json()["snapshot"]["participant_name"] == "G One"

    duplicate = await ctx.client.post(f"/api/events/{event_id}/certificates/issue", json={
        "template_id": template["id"], "guest_ids": [guest_id], "eligible_only": True,
    })
    assert duplicate.status_code == 200
    assert duplicate.json()["issued"] == 0
    async with _Session() as db:
        assert len((await db.execute(select(EventCertificate))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_presenter_material_link_is_session_scoped_and_requires_event_access(ctx):
    event_id = ctx.ids["event_a"]
    async with _Session() as db:
        workflow = ExperienceWorkflow(event_id=event_id, name="Programme", status="published", version=1)
        db.add(workflow); await db.flush()
        step = ExperienceStep(workflow_id=workflow.id, key="keynote", type="session_attendance", title="Keynote")
        db.add(step); await db.commit(); step_id = step.id

    ctx.login(ctx.ids["user_a"])
    bad = await ctx.client.post(f"/api/events/{event_id}/presenter-materials/link", json={
        "title": "Unsafe", "url": "javascript:alert(1)", "session_step_id": step_id,
    })
    assert bad.status_code == 400

    created = await ctx.client.post(f"/api/events/{event_id}/presenter-materials/link", json={
        "title": "Keynote deck", "url": "https://docs.google.com/presentation/d/example", "session_step_id": step_id,
        "kind": "slides", "visibility": "production",
    })
    assert created.status_code == 201
    assert created.json()["session_title"] == "Keynote"
    assert created.json()["status"] == "draft"

    approved = await ctx.client.patch(f"/api/events/{event_id}/presenter-materials/{created.json()['id']}", json={"status": "approved"})
    assert approved.status_code == 200
    assert approved.json()["approved_at"] is not None

    ctx.login(ctx.ids["user_b"])
    hidden = await ctx.client.get(f"/api/events/{event_id}/presenter-materials")
    assert hidden.status_code == 404
