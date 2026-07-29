"""Public API v2: Experience (workflows/steps/consent/feedback). Mirrors
test_experience.py's own lifecycle assertions but through the X-API-Key
surface: org-scoping 404s, the tier300 ("experience_enabled") 402 gate
applied consistently to every write (the internal router has a known
inconsistency here — some transitions skip the check — which this public
surface deliberately does not replicate), and read-write scope enforcement."""
import pytest
from sqlalchemy import select

from app.models import (
    ConsentForm, ConsentSignature, Event, ExperienceStep, ExperienceWorkflow,
    Guest, Organization, WebhookDelivery,
)
from app.routers import experience as experience_router
from conftest import _Session


async def _mint_key(ctx, owner) -> str:
    ctx.login(owner)
    created = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "Test key"})
    return created.json()["key"]


async def _mint_read_write_key(ctx, owner, org_id) -> str:
    async with _Session() as s:
        org = await s.get(Organization, org_id)
        org.subscription_status = "active"
        await s.commit()
    ctx.login(owner)
    created = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "RW key", "scope": "read_write"})
    assert created.status_code == 201, created.text
    return created.json()["key"]


async def _mark_tier300(event_id: str):
    async with _Session() as s:
        event = await s.get(Event, event_id)
        event.is_paid = True
        event.plan_tier = "tier300"
        await s.commit()


async def _mark_tier50(event_id: str):
    async with _Session() as s:
        event = await s.get(Event, event_id)
        event.is_paid = True
        event.plan_tier = "tier50"
        await s.commit()


@pytest.mark.asyncio
async def test_experience_write_requires_tier300(ctx):
    ev = ctx.ids["event_a"]
    await _mark_tier50(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    r = await ctx.client.post(f"/api/public/v1/events/{ev}/experience/workflows", headers={"X-API-Key": key_a},
                               json={"name": "Onboarding"})
    assert r.status_code == 402
    assert r.headers.get("x-required-plan") == "tier300"


@pytest.mark.asyncio
async def test_read_only_key_403_on_experience_writes(ctx):
    ev = ctx.ids["event_a"]
    await _mark_tier300(ev)
    key_a = await _mint_key(ctx, ctx.ids["user_a"])
    ctx.login(None)
    r = await ctx.client.post(f"/api/public/v1/events/{ev}/experience/workflows", headers={"X-API-Key": key_a},
                               json={"name": "Onboarding"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_create_workflow_with_inline_steps(ctx):
    ev = ctx.ids["event_a"]
    await _mark_tier300(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    r = await ctx.client.post(f"/api/public/v1/events/{ev}/experience/workflows", headers={"X-API-Key": key_a}, json={
        "name": "Onboarding",
        "steps": [
            {"key": "rsvp_confirm", "type": "rsvp", "title": "Confirm RSVP"},
            {"key": "check_in", "type": "check_in", "title": "Check in"},
        ],
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "draft"
    assert len(body["steps"]) == 2
    assert {s["key"] for s in body["steps"]} == {"rsvp_confirm", "check_in"}


@pytest.mark.asyncio
async def test_duplicate_step_keys_rejected_at_create(ctx):
    ev = ctx.ids["event_a"]
    await _mark_tier300(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    r = await ctx.client.post(f"/api/public/v1/events/{ev}/experience/workflows", headers={"X-API-Key": key_a}, json={
        "name": "Bad",
        "steps": [
            {"key": "dup", "type": "custom", "title": "One"},
            {"key": "dup", "type": "custom", "title": "Two"},
        ],
    })
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_bulk_add_steps_and_duplicate_key_conflict(ctx):
    ev = ctx.ids["event_a"]
    await _mark_tier300(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    workflow = (await ctx.client.post(f"/api/public/v1/events/{ev}/experience/workflows",
                                       headers={"X-API-Key": key_a}, json={"name": "Agenda"})).json()
    wf_id = workflow["id"]

    bulk = await ctx.client.post(f"/api/public/v1/experience/workflows/{wf_id}/steps/bulk",
                                  headers={"X-API-Key": key_a}, json={"steps": [
                                      {"key": "welcome", "type": "custom", "title": "Welcome"},
                                      {"key": "keynote", "type": "custom", "title": "Keynote"},
                                  ]})
    assert bulk.status_code == 201, bulk.text
    assert len(bulk.json()) == 2

    conflict = await ctx.client.post(f"/api/public/v1/experience/workflows/{wf_id}/steps/bulk",
                                      headers={"X-API-Key": key_a},
                                      json={"steps": [{"key": "welcome", "type": "custom", "title": "Dup"}]})
    assert conflict.status_code == 409

    within_payload_dup = await ctx.client.post(
        f"/api/public/v1/experience/workflows/{wf_id}/steps/bulk", headers={"X-API-Key": key_a},
        json={"steps": [{"key": "x", "type": "custom", "title": "X1"}, {"key": "x", "type": "custom", "title": "X2"}]},
    )
    assert within_payload_dup.status_code == 422


@pytest.mark.asyncio
async def test_step_update_and_delete_scrubs_dependents(ctx):
    ev = ctx.ids["event_a"]
    await _mark_tier300(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    workflow = (await ctx.client.post(f"/api/public/v1/events/{ev}/experience/workflows",
                                       headers={"X-API-Key": key_a}, json={
        "name": "Deps",
        "steps": [
            {"key": "first", "type": "custom", "title": "First"},
            {"key": "second", "type": "custom", "title": "Second", "config": {"depends_on_keys": ["first"]}},
        ],
    })).json()
    steps_by_key = {s["key"]: s for s in workflow["steps"]}
    first_id, second_id = steps_by_key["first"]["id"], steps_by_key["second"]["id"]

    upd = await ctx.client.patch(f"/api/public/v1/experience/steps/{second_id}", headers={"X-API-Key": key_a},
                                  json={"title": "Second (renamed)"})
    assert upd.status_code == 200
    assert upd.json()["title"] == "Second (renamed)"

    deleted = await ctx.client.delete(f"/api/public/v1/experience/steps/{first_id}", headers={"X-API-Key": key_a})
    assert deleted.status_code == 204

    async with _Session() as s:
        second = await s.get(ExperienceStep, second_id)
        assert (second.config or {}).get("depends_on_keys") in (None, [])
        assert await s.get(ExperienceStep, first_id) is None


@pytest.mark.asyncio
async def test_reorder_steps(ctx):
    ev = ctx.ids["event_a"]
    await _mark_tier300(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    workflow = (await ctx.client.post(f"/api/public/v1/events/{ev}/experience/workflows",
                                       headers={"X-API-Key": key_a}, json={
        "name": "Order",
        "steps": [{"key": "a", "type": "custom", "title": "A"}, {"key": "b", "type": "custom", "title": "B"}],
    })).json()
    wf_id = workflow["id"]
    steps_by_key = {s["key"]: s["id"] for s in workflow["steps"]}

    reordered = await ctx.client.post(f"/api/public/v1/experience/workflows/{wf_id}/steps/reorder",
                                       headers={"X-API-Key": key_a},
                                       json={"step_ids": [steps_by_key["b"], steps_by_key["a"]]})
    assert reordered.status_code == 200
    ordered_keys = [s["key"] for s in sorted(reordered.json()["steps"], key=lambda s: s["sort_order"])]
    assert ordered_keys == ["b", "a"]


@pytest.mark.asyncio
async def test_workflow_lifecycle_publish_unpublish_archive_unarchive_delete(ctx):
    ev = ctx.ids["event_a"]
    await _mark_tier300(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    ctx.login(ctx.ids["user_a"])
    await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "https://example.com/hook", "event_types": ["experience.workflow_published"],
    })
    ctx.login(None)

    workflow = (await ctx.client.post(f"/api/public/v1/events/{ev}/experience/workflows",
                                       headers={"X-API-Key": key_a}, json={
        "name": "Lifecycle", "steps": [{"key": "a", "type": "custom", "title": "A"}],
    })).json()
    wf_id = workflow["id"]

    # Can't delete a workflow that's about to be published — publish first.
    published = await ctx.client.post(f"/api/public/v1/experience/workflows/{wf_id}/publish", headers={"X-API-Key": key_a})
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"

    blocked_delete = await ctx.client.delete(f"/api/public/v1/experience/workflows/{wf_id}", headers={"X-API-Key": key_a})
    assert blocked_delete.status_code == 409

    unpublished = await ctx.client.post(f"/api/public/v1/experience/workflows/{wf_id}/unpublish", headers={"X-API-Key": key_a})
    assert unpublished.status_code == 200
    assert unpublished.json()["status"] == "draft"

    archived = await ctx.client.post(f"/api/public/v1/experience/workflows/{wf_id}/archive", headers={"X-API-Key": key_a})
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    unarchived = await ctx.client.post(f"/api/public/v1/experience/workflows/{wf_id}/unarchive", headers={"X-API-Key": key_a})
    assert unarchived.status_code == 200
    assert unarchived.json()["status"] == "draft"

    deleted = await ctx.client.delete(f"/api/public/v1/experience/workflows/{wf_id}", headers={"X-API-Key": key_a})
    assert deleted.status_code == 204
    async with _Session() as s:
        assert await s.get(ExperienceWorkflow, wf_id) is None
        rows = (await s.execute(select(WebhookDelivery))).scalars().all()
        assert any(row.event_type == "experience.workflow_published" for row in rows)


@pytest.mark.asyncio
async def test_experience_from_other_org_404s(ctx):
    ev = ctx.ids["event_a"]
    await _mark_tier300(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    workflow = (await ctx.client.post(f"/api/public/v1/events/{ev}/experience/workflows",
                                       headers={"X-API-Key": key_a}, json={"name": "Private"})).json()

    key_b = await _mint_read_write_key(ctx, ctx.ids["user_b"], ctx.ids["org_b"])
    ctx.login(None)
    r = await ctx.client.get(f"/api/public/v1/experience/workflows/{workflow['id']}", headers={"X-API-Key": key_b})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_consent_form_crud_and_signatures_read(ctx):
    ev = ctx.ids["event_a"]
    await _mark_tier300(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)

    none_yet = await ctx.client.get(f"/api/public/v1/events/{ev}/experience/consent-form", headers={"X-API-Key": key_a})
    assert none_yet.status_code == 200
    assert none_yet.json() is None

    created = await ctx.client.put(f"/api/public/v1/events/{ev}/experience/consent-form", headers={"X-API-Key": key_a},
                                    json={"title": "Photo consent", "body": "I agree to be photographed."})
    assert created.status_code == 200
    form_id = created.json()["id"]
    assert created.json()["version"] == 1

    # A second save deactivates the first and bumps the version.
    resaved = await ctx.client.put(f"/api/public/v1/events/{ev}/experience/consent-form", headers={"X-API-Key": key_a},
                                    json={"title": "Photo consent v2", "body": "Updated body."})
    assert resaved.json()["version"] == 2

    async with _Session() as s:
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev))).scalars().first()
        s.add(ConsentSignature(event_id=ev, form_id=resaved.json()["id"], guest_id=guest.id,
                                signer_name="G One", signature_text="G One"))
        await s.commit()

    sigs = await ctx.client.get(f"/api/public/v1/events/{ev}/experience/consent-signatures", headers={"X-API-Key": key_a})
    assert sigs.status_code == 200
    assert len(sigs.json()) == 1
    assert sigs.json()[0]["signer_name"] == "G One"

    disabled = await ctx.client.delete(f"/api/public/v1/events/{ev}/experience/consent-form", headers={"X-API-Key": key_a})
    assert disabled.status_code == 200
    assert disabled.json()["disabled"] is True
    async with _Session() as s:
        form = await s.get(ConsentForm, resaved.json()["id"])
        assert form.is_active is False


@pytest.mark.asyncio
async def test_feedback_results_read(ctx):
    ev = ctx.ids["event_a"]
    await _mark_tier300(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    results = await ctx.client.get(f"/api/public/v1/events/{ev}/experience/feedback/results", headers={"X-API-Key": key_a})
    assert results.status_code == 200
    assert results.json() == {"forms": []}


@pytest.mark.asyncio
async def test_feedback_reminders_send(ctx, monkeypatch):
    ev = ctx.ids["event_a"]
    await _mark_tier300(ev)
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])

    sent = []
    async def fake_email(to_email, subject, html_body, event_id=None, *args, **kwargs):
        sent.append((to_email, subject))
    monkeypatch.setattr(experience_router, "send_simple_email", fake_email)

    async with _Session() as s:
        event = await s.get(Event, ev)
        event.notify_email = True
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev))).scalars().first()
        guest.email = "guest@example.com"
        await s.commit()

    ctx.login(None)
    workflow = (await ctx.client.post(f"/api/public/v1/events/{ev}/experience/workflows",
                                       headers={"X-API-Key": key_a}, json={
        "name": "Feedback", "steps": [{
            "key": "fb", "type": "feedback", "title": "Feedback",
            "config": {"feedback": {"questions": [{"id": "q1", "prompt": "How was it?", "type": "text"}]}},
        }],
    })).json()
    wf_id, step_id = workflow["id"], workflow["steps"][0]["id"]
    publish = await ctx.client.post(f"/api/public/v1/experience/workflows/{wf_id}/publish", headers={"X-API-Key": key_a})
    assert publish.status_code == 200, publish.text

    reminders = await ctx.client.post(
        f"/api/public/v1/events/{ev}/experience/feedback/{step_id}/reminders", headers={"X-API-Key": key_a},
        json={"channels": ["email"], "subject": "Please respond", "message": "We'd love your feedback."},
    )
    assert reminders.status_code == 200, reminders.text
    assert reminders.json()["queued"]["email"] >= 1
    assert len(sent) >= 1
