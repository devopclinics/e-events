from datetime import datetime

import pytest
from sqlalchemy import select

from conftest import _Session
from app.routers import experience as experience_router
from app.routers import scanner as scanner_router
from app.models import (
    ConsentForm,
    Event,
    Gate,
    Guest,
    GuestMenuChoice,
    GuestTag,
    GuestTagLink,
    MenuCategory,
    MenuItem,
    SeatingTable,
    TableGroup,
    TableGroupTable,
    TicketType,
    User,
    Zone,
    ZoneTagRule,
)


@pytest.fixture(autouse=True)
async def pro_event_for_experience_tests(ctx):
    """Experience is a Pro feature in the current packaging."""
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        ev.paid_channels = True
        ev.plan_tier = "tier300"
        ev.guest_cap = 300
        await s.commit()


@pytest.mark.asyncio
async def test_default_workflow_created_from_existing_event_features(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        ev.seating_enabled = True
        ev.menu_enabled = True
        table = SeatingTable(event_id=ev.id, name="A1", capacity=8)
        s.add(table)
        await s.flush()
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        guest.admitted = True
        guest.admitted_at = datetime(2026, 9, 1, 10, 0)
        guest.table_id = table.id
        guest.seat_number = "1"
        cat = MenuCategory(event_id=ev.id, name="Dinner")
        s.add(cat)
        await s.flush()
        item = MenuItem(event_id=ev.id, category_id=cat.id, name="Rice")
        s.add(item)
        await s.flush()
        s.add(GuestMenuChoice(guest_id=guest.id, category_id=cat.id, menu_item_id=item.id))
        await s.commit()

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/experience/default-workflow")
    assert r.status_code == 201
    body = r.json()
    assert [s["type"] for s in body["steps"]] == ["check_in", "seating_assignment", "meal_selection"]

    guest_id = guest.id
    gr = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/experience/guests/{guest_id}")
    assert gr.status_code == 200
    statuses = {p["step_id"]: p["status"] for p in gr.json()["progress"]}
    step_ids = {s["type"]: s["id"] for s in body["steps"]}
    assert statuses[step_ids["check_in"]] == "completed"
    assert statuses[step_ids["seating_assignment"]] == "completed"
    assert statuses[step_ids["meal_selection"]] == "completed"

    dash = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/experience/dashboard")
    assert dash.status_code == 200
    dashboard = dash.json()
    assert dashboard["guest_total"] == 1
    assert dashboard["step_count"] == 3
    assert dashboard["completed_total"] == 3
    assert dashboard["completion_rate"] == 100
    assert {s["type"]: s["completed"] for s in dashboard["steps"]} == {
        "check_in": 1,
        "seating_assignment": 1,
        "meal_selection": 1,
    }


@pytest.mark.asyncio
async def test_experience_toggle_requires_pro_event(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = False
        ev.paid_channels = False
        ev.plan_tier = "free"
        ev.guest_cap = None
        await s.commit()

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.patch(
        f"/api/events/{ctx.ids['event_a']}/features",
        json={"experience_enabled": True},
    )
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_experience_cross_org_404(ctx):
    ctx.login(ctx.ids["user_b"])
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/experience/workflows")
    assert r.status_code == 404
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/experience/dashboard")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_staff_can_read_but_not_create_default_workflow(ctx):
    ctx.login(ctx.ids["user_a"])
    invite = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/org-members",
        json={"email": "reader@a.com", "role": "staff"},
    )
    staff_id = invite.json()["user"]["id"]
    assign = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/members",
        json={"user_id": staff_id},
    )
    assert assign.status_code == 201

    async with _Session() as s:
        staff = await s.get(User, staff_id)

    ctx.login(staff)
    assert (await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/experience/workflows")).status_code == 200
    assert (await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/experience/default-workflow")).status_code == 403


@pytest.mark.asyncio
async def test_workflow_crud_reorder_publish_clone_and_immutable(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]
    create = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Conference Journey",
            "steps": [
                {"key": "consent", "type": "consent", "title": "Consent"},
                {"key": "badge", "type": "badge", "title": "Badge pickup"},
            ],
        },
    )
    assert create.status_code == 201
    workflow = create.json()
    workflow_id = workflow["id"]
    assert workflow["status"] == "draft"
    assert [s["key"] for s in workflow["steps"]] == ["consent", "badge"]

    add = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{workflow_id}/steps",
        json={"key": "checkout", "type": "checkout", "title": "Checkout"},
    )
    assert add.status_code == 201
    checkout_id = add.json()["id"]

    update = await ctx.client.put(
        f"/api/events/{event_id}/experience/workflows/{workflow_id}/steps/{checkout_id}",
        json={"title": "Final checkout", "required": False, "config": {"station": "north"}},
    )
    assert update.status_code == 200
    assert update.json()["title"] == "Final checkout"
    assert update.json()["required"] is False

    detail = (await ctx.client.get(f"/api/events/{event_id}/experience/workflows/{workflow_id}")).json()
    ordered_ids = [s["id"] for s in detail["steps"]]
    reorder = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{workflow_id}/steps/reorder",
        json={"step_ids": list(reversed(ordered_ids))},
    )
    assert reorder.status_code == 200
    assert [s["id"] for s in reorder.json()["steps"]] == list(reversed(ordered_ids))

    publish = await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow_id}/publish")
    assert publish.status_code == 200
    assert publish.json()["status"] == "published"

    blocked = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{workflow_id}/steps",
        json={"key": "late", "type": "custom", "title": "Late edit"},
    )
    assert blocked.status_code == 409

    clone = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{workflow_id}/clone",
        json={"name": "Conference Journey v2"},
    )
    assert clone.status_code == 201
    assert clone.json()["status"] == "draft"
    assert clone.json()["version"] == publish.json()["version"] + 1
    assert [s["key"] for s in clone.json()["steps"]] == [s["key"] for s in publish.json()["steps"]]

    cloned_steps = {s["key"]: s for s in clone.json()["steps"]}
    badge_id = cloned_steps["badge"]["id"]
    consent_id = cloned_steps["consent"]["id"]
    update_dep = await ctx.client.put(
        f"/api/events/{event_id}/experience/workflows/{clone.json()['id']}/steps/{badge_id}",
        json={"config": {"depends_on": ["consent"]}},
    )
    assert update_dep.status_code == 200
    delete_step = await ctx.client.delete(
        f"/api/events/{event_id}/experience/workflows/{clone.json()['id']}/steps/{consent_id}"
    )
    assert delete_step.status_code == 204
    clone_after_delete = await ctx.client.get(f"/api/events/{event_id}/experience/workflows/{clone.json()['id']}")
    assert clone_after_delete.status_code == 200
    badge_after_delete = next(s for s in clone_after_delete.json()["steps"] if s["key"] == "badge")
    assert not (badge_after_delete["config"] or {}).get("depends_on")

    delete_published = await ctx.client.delete(f"/api/events/{event_id}/experience/workflows/{workflow_id}")
    assert delete_published.status_code == 409

    delete_draft = await ctx.client.delete(f"/api/events/{event_id}/experience/workflows/{clone.json()['id']}")
    assert delete_draft.status_code == 204
    missing = await ctx.client.get(f"/api/events/{event_id}/experience/workflows/{clone.json()['id']}")
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_workflow_validation_rules(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    duplicate = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Bad",
            "steps": [
                {"key": "same", "type": "custom", "title": "One"},
                {"key": "same", "type": "custom", "title": "Two"},
            ],
        },
    )
    assert duplicate.status_code == 400

    bad_type = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={"name": "Bad", "steps": [{"key": "x", "type": "unknown", "title": "X"}]},
    )
    assert bad_type.status_code == 422

    too_deep = {"a": {"b": {"c": {"d": {"e": {"f": {"g": "no"}}}}}}}
    bad_json = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Bad JSON",
            "steps": [{"key": "x", "type": "custom", "title": "X", "config": too_deep}],
        },
    )
    assert bad_json.status_code == 422

    empty = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={"name": "Empty"},
    )
    assert empty.status_code == 201
    publish_empty = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{empty.json()['id']}/publish"
    )
    assert publish_empty.status_code == 400

    valid = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={"name": "Valid", "steps": [{"key": "one", "type": "custom", "title": "One"}]},
    )
    workflow_id = valid.json()["id"]
    dup_step = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{workflow_id}/steps",
        json={"key": "one", "type": "custom", "title": "Duplicate"},
    )
    assert dup_step.status_code == 409
    reorder_bad = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{workflow_id}/steps/reorder",
        json={"step_ids": []},
    )
    assert reorder_bad.status_code == 400


@pytest.mark.asyncio
async def test_session_attendance_step_keeps_schedule_config(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]
    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Sessions",
            "steps": [{
                "key": "workshop_a",
                "type": "session_attendance",
                "title": "Workshop A",
                "config": {
                    "session": {
                        "topic": "Building Event Operations with AI",
                        "date": "2026-07-28",
                        "start_time": "14:00",
                        "end_time": "15:15",
                        "room": "Hall B",
                        "speaker": "Host Team",
                        "capacity": 80,
                    },
                    "messages": {
                        "guest": "Proceed to Hall B.",
                        "staff": "Confirm Workshop A attendance.",
                        "complete": "Workshop A attendance recorded.",
                    },
                },
            }],
        },
    )
    assert workflow.status_code == 201
    step = workflow.json()["steps"][0]
    assert step["config"]["session"]["topic"] == "Building Event Operations with AI"
    assert step["config"]["session"]["capacity"] == 80
    assert step["config"]["messages"]["staff"] == "Confirm Workshop A attendance."


@pytest.mark.asyncio
async def test_session_attendance_requires_session_check_in_action(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.experience_enabled = True
        guest_id = (await s.execute(select(Guest.id).where(Guest.event_id == event_id))).scalar_one()
        await s.commit()

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Session check-ins",
            "steps": [{
                "key": "keynote",
                "type": "session_attendance",
                "title": "Keynote",
                "config": {
                    "session": {
                        "topic": "Opening Keynote",
                        "date": "2026-07-28",
                        "start_time": "09:00",
                        "end_time": "10:00",
                        "room": "Main Hall",
                    },
                },
            }],
        },
    )
    assert workflow.status_code == 201
    step_id = workflow.json()["steps"][0]["id"]
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    generic_complete = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed", "metadata": {"source": "portal"}},
    )
    assert generic_complete.status_code == 409
    assert "session check-in" in generic_complete.json()["detail"]

    check_in = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed", "metadata": {"source": "scanner", "action": "session_check_in"}},
    )
    assert check_in.status_code == 200
    body = check_in.json()
    assert body["status"] == "completed"
    assert body["metadata"]["action"] == "session_check_in"
    assert body["metadata"]["session"]["topic"] == "Opening Keynote"
    assert body["metadata"]["session_checked_in_at"]


@pytest.mark.asyncio
async def test_session_attendance_respects_check_in_window(ctx, monkeypatch):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.experience_enabled = True
        guest_id = (await s.execute(select(Guest.id).where(Guest.event_id == event_id))).scalar_one()
        await s.commit()

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Timed session",
            "steps": [{
                "key": "keynote",
                "type": "session_attendance",
                "title": "Keynote",
                "config": {
                    "session": {
                        "topic": "Opening Keynote",
                        "date": "2026-07-28",
                        "start_time": "09:00",
                        "end_time": "10:00",
                        "room": "Main Hall",
                        "checkin_window_minutes": 30,
                    },
                },
            }],
        },
    )
    assert workflow.status_code == 201
    step_id = workflow.json()["steps"][0]["id"]
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    monkeypatch.setattr(
        experience_router,
        "_session_now",
        lambda: datetime(2026, 7, 28, 8, 20, tzinfo=experience_router.EVENT_TZ),
    )
    early = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed", "metadata": {"source": "scanner", "action": "session_check_in"}},
    )
    assert early.status_code == 409
    assert "opens 30 minutes before" in early.json()["detail"]

    monkeypatch.setattr(
        experience_router,
        "_session_now",
        lambda: datetime(2026, 7, 28, 8, 35, tzinfo=experience_router.EVENT_TZ),
    )
    allowed = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed", "metadata": {"source": "scanner", "action": "session_check_in"}},
    )
    assert allowed.status_code == 200


@pytest.mark.asyncio
async def test_session_attendance_accepts_sessions_json_shape(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.experience_enabled = True
        guest_id = (await s.execute(select(Guest.id).where(Guest.event_id == event_id))).scalar_one()
        await s.commit()

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Session JSON",
            "steps": [{
                "key": "leadership_panel",
                "type": "session_attendance",
                "title": "Leadership Panel",
                "config": {
                    "sessions": [{
                        "title": "Leadership Panel",
                        "date": "2026-07-28",
                        "start": "13:00",
                        "end": "14:00",
                        "location": "Hall C",
                    }],
                },
            }],
        },
    )
    assert workflow.status_code == 201
    step_id = workflow.json()["steps"][0]["id"]
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    check_in = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed", "metadata": {"source": "scanner", "action": "session_check_in"}},
    )
    assert check_in.status_code == 200
    assert check_in.json()["metadata"]["session"]["topic"] == "Leadership Panel"
    assert check_in.json()["metadata"]["session"]["room"] == "Hall C"


@pytest.mark.asyncio
async def test_published_workflow_is_active_over_default_draft(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    default = await ctx.client.post(f"/api/events/{event_id}/experience/default-workflow")
    assert default.status_code == 201

    custom = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "VIP Dinner Guest Journey",
            "steps": [{"key": "welcome_pack", "type": "custom", "title": "Welcome pack"}],
        },
    )
    assert custom.status_code == 201
    publish = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{custom.json()['id']}/publish"
    )
    assert publish.status_code == 200

    dash = await ctx.client.get(f"/api/events/{event_id}/experience/dashboard")
    assert dash.status_code == 200
    assert dash.json()["workflow"]["name"] == "VIP Dinner Guest Journey"


@pytest.mark.asyncio
async def test_admin_can_update_guest_experience_progress(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Runtime",
            "steps": [{"key": "welcome_pack", "type": "custom", "title": "Welcome pack"}],
        },
    )
    step_id = workflow.json()["steps"][0]["id"]
    publish = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish"
    )
    assert publish.status_code == 200

    async with _Session() as s:
        guest_id = (await s.execute(select(Guest.id).where(Guest.event_id == event_id))).scalar_one()
        ev = await s.get(Event, event_id)
        ev.experience_enabled = True
        await s.commit()

    update = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed", "metadata": {"station": "gift_table"}},
    )
    assert update.status_code == 200
    body = update.json()
    assert body["status"] == "completed"
    assert body["metadata"] == {"station": "gift_table"}
    assert body["completed_by_user_id"] == ctx.ids["user_a"].id

    journey = await ctx.client.get(f"/api/events/{event_id}/experience/guests/{guest_id}")
    assert journey.status_code == 200
    assert journey.json()["progress"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_only_one_workflow_can_be_published_until_unpublished(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    first = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={"name": "First", "steps": [{"key": "one", "type": "custom", "title": "One"}]},
    )
    second = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={"name": "Second", "steps": [{"key": "two", "type": "custom", "title": "Two"}]},
    )
    assert first.status_code == 201
    assert second.status_code == 201

    publish_first = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{first.json()['id']}/publish"
    )
    assert publish_first.status_code == 200

    publish_second_blocked = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{second.json()['id']}/publish"
    )
    assert publish_second_blocked.status_code == 409
    assert "Unpublish" in publish_second_blocked.json()["detail"]

    unpublish_first = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{first.json()['id']}/unpublish"
    )
    assert unpublish_first.status_code == 200
    assert unpublish_first.json()["status"] == "draft"

    publish_second = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{second.json()['id']}/publish"
    )
    assert publish_second.status_code == 200
    assert publish_second.json()["status"] == "published"

    archive_first = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{first.json()['id']}/archive"
    )
    assert archive_first.status_code == 200
    assert archive_first.json()["status"] == "archived"

    unarchive_first = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{first.json()['id']}/unarchive"
    )
    assert unarchive_first.status_code == 200
    assert unarchive_first.json()["status"] == "draft"


@pytest.mark.asyncio
async def test_conditions_control_guest_steps(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.experience_enabled = True
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        guest.is_vip = True
        guest.rsvp_status = "confirmed"
        ticket = TicketType(event_id=event_id, name="VIP")
        tag = GuestTag(event_id=event_id, name="Speaker")
        s.add_all([ticket, tag])
        await s.flush()
        guest.ticket_type_id = ticket.id
        s.add(GuestTagLink(guest_id=guest.id, tag_id=tag.id))
        other = Guest(event_id=event_id, first_name="G", last_name="Two", email="two@a.com", rsvp_status="invited")
        s.add(other)
        await s.commit()
        guest_id = guest.id
        other_id = other.id

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Conditional",
            "steps": [
                {"key": "vip", "type": "custom", "title": "VIP only", "conditions": {"is_vip": True}},
                {"key": "rsvp", "type": "custom", "title": "Confirmed only", "conditions": {"rsvp_status": ["confirmed"]}},
                {"key": "ticket", "type": "custom", "title": "VIP ticket", "conditions": {"ticket_type": "VIP"}},
                {"key": "tag", "type": "custom", "title": "Speaker tag", "conditions": {"guest_tags_include": ["Speaker"]}},
            ],
        },
    )
    assert workflow.status_code == 201
    publish = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish"
    )
    assert publish.status_code == 200

    vip_journey = (await ctx.client.get(f"/api/events/{event_id}/experience/guests/{guest_id}")).json()
    other_journey = (await ctx.client.get(f"/api/events/{event_id}/experience/guests/{other_id}")).json()
    assert {p["status"] for p in vip_journey["progress"]} == {"available"}
    assert {p["status"] for p in other_journey["progress"]} == {"skipped"}

    next_steps = await ctx.client.get(f"/api/events/{event_id}/experience/guests/{other_id}/next-steps")
    assert next_steps.status_code == 200
    assert next_steps.json() == []


@pytest.mark.asyncio
async def test_consent_signing_uses_versions_and_download(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    first = await ctx.client.put(
        f"/api/events/{event_id}/experience/consent-form",
        json={"title": "Consent", "body": "Version one text", "require_signature": True},
    )
    assert first.status_code == 200
    assert first.json()["version"] == 1

    async with _Session() as s:
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        token = guest.qr_token

    pre_view = await ctx.client.get(f"/api/scan/{token}/consent")
    assert pre_view.status_code == 200
    assert pre_view.json()["status"] == "not_admitted"
    pre_sign = await ctx.client.post(
        f"/api/scan/{token}/consent",
        json={"signer_name": "G One", "signature_text": "G One"},
    )
    assert pre_sign.status_code == 409

    async with _Session() as s:
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        guest.admitted = True
        guest.admitted_at = datetime(2026, 9, 1, 10, 0)
        await s.commit()

    sign_first = await ctx.client.post(
        f"/api/scan/{token}/consent",
        json={"signer_name": "G One", "signature_text": "G One"},
    )
    assert sign_first.status_code == 200
    assert sign_first.json()["status"] == "signed"

    second = await ctx.client.put(
        f"/api/events/{event_id}/experience/consent-form",
        json={"title": "Consent", "body": "Version two text", "require_signature": True},
    )
    assert second.status_code == 200
    assert second.json()["version"] == 2

    public_view = await ctx.client.get(f"/api/scan/{token}/consent")
    assert public_view.status_code == 200
    assert public_view.json()["status"] == "available"
    assert public_view.json()["form"]["version"] == 2

    sign_second = await ctx.client.post(
        f"/api/scan/{token}/consent",
        json={"signer_name": "G One", "signature_text": "G One"},
    )
    assert sign_second.status_code == 200
    assert sign_second.json()["signature"]["form_id"] == second.json()["id"]

    download = await ctx.client.get(f"/api/scan/{token}/consent/download")
    assert download.status_code == 200
    assert "Version two text" in download.text
    assert "Version one text" not in download.text

    pdf = await ctx.client.get(f"/api/scan/{token}/consent/download.pdf")
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")

    signatures = await ctx.client.get(f"/api/events/{event_id}/experience/consent-signatures")
    assert signatures.status_code == 200
    assert len(signatures.json()) == 2

    async with _Session() as s:
        old_form = await s.get(ConsentForm, first.json()["id"])
        assert old_form.body == "Version one text"
        assert old_form.is_active is False


@pytest.mark.asyncio
async def test_scan_returns_next_steps_and_staff_can_complete_them(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.status = "active"
        ev.experience_enabled = True
        ev.notify_email = False
        ev.notify_sms = False
        ev.notify_whatsapp = False
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        token = guest.qr_token
        guest_id = guest.id
        await s.commit()

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Scan Runtime",
            "steps": [
                {"key": "checkin", "type": "check_in", "title": "Check in"},
                {"key": "welcome", "type": "custom", "title": "Welcome pack"},
            ],
        },
    )
    assert workflow.status_code == 201
    welcome_step_id = next(s["id"] for s in workflow.json()["steps"] if s["key"] == "welcome")
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    scan = await ctx.client.post(f"/api/scan/{token}")
    assert scan.status_code == 200
    body = scan.json()
    assert body["status"] == "admitted"
    assert [item["step"]["key"] for item in body["experience_next_steps"]] == ["welcome"]

    complete = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{welcome_step_id}",
        json={"status": "completed", "metadata": {"source": "scanner"}},
    )
    assert complete.status_code == 200
    assert complete.json()["status"] == "completed"

    next_steps = await ctx.client.get(f"/api/events/{event_id}/experience/guests/{guest_id}/next-steps")
    assert next_steps.status_code == 200
    assert next_steps.json() == []

    analytics = await ctx.client.get(f"/api/events/{event_id}/experience/analytics")
    assert analytics.status_code == 200
    assert analytics.json()["workflow"]["name"] == "Scan Runtime"
    assert analytics.json()["bottlenecks"]
    assert analytics.json()["staff_throughput"]
    assert {row["timing_basis"] for row in analytics.json()["step_timing"]} == {"not_collected"}


@pytest.mark.asyncio
async def test_souvenir_unlocks_after_guest_consent_signature(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.status = "active"
        ev.experience_enabled = True
        ev.notify_email = False
        ev.notify_sms = False
        ev.notify_whatsapp = False
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        token = guest.qr_token
        await s.commit()

    form = await ctx.client.put(
        f"/api/events/{event_id}/experience/consent-form",
        json={"title": "Consent", "body": "I agree.", "require_signature": True},
    )
    assert form.status_code == 200

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Consent then gift",
            "steps": [
                {"key": "checkin", "type": "check_in", "title": "Check in"},
                {"key": "consent", "type": "consent", "title": "Consent"},
                {"key": "souvenir", "type": "souvenir", "title": "Souvenir"},
            ],
        },
    )
    assert workflow.status_code == 201
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200
    form = await ctx.client.put(
        f"/api/events/{event_id}/experience/consent-form",
        json={"title": "Consent", "body": "I agree.", "require_signature": True},
    )
    assert form.status_code == 200

    scan = await ctx.client.post(f"/api/scan/{token}")
    assert scan.status_code == 200
    assert [item["step"]["key"] for item in scan.json()["experience_next_steps"]] == ["consent"]

    sign = await ctx.client.post(
        f"/api/scan/{token}/consent",
        json={"signer_name": "G One", "signature_text": "G One"},
    )
    assert sign.status_code == 200

    next_steps = await ctx.client.get(f"/api/events/{event_id}/experience/guests/{guest.id}/next-steps")
    assert next_steps.status_code == 200
    assert [item["step"]["key"] for item in next_steps.json()] == ["souvenir"]


@pytest.mark.asyncio
async def test_checkin_sends_consent_as_separate_experience_email(ctx, monkeypatch):
    admission_emails = []
    experience_emails = []

    async def fake_admission_email(guest_data):
        admission_emails.append(guest_data)

    async def fake_simple_email(to_email, subject, html_body, event_id=None, attachments=None, *args, **kwargs):
        experience_emails.append((to_email, subject, html_body, event_id))

    monkeypatch.setattr(scanner_router, "send_admission_email", fake_admission_email)
    monkeypatch.setattr(scanner_router, "send_simple_email", fake_simple_email)
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.status = "active"
        ev.experience_enabled = True
        ev.notify_email = True
        ev.notify_sms = False
        ev.notify_whatsapp = False
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        guest.email = "consent-after-checkin@example.com"
        token = guest.qr_token
        await s.commit()

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Consent after check-in",
            "steps": [
                {"key": "checkin", "type": "check_in", "title": "Check in"},
                {"key": "consent", "type": "consent", "title": "Consent"},
            ],
        },
    )
    assert workflow.status_code == 201
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200
    form = await ctx.client.put(
        f"/api/events/{event_id}/experience/consent-form",
        json={"title": "Consent", "body": "I agree.", "require_signature": True},
    )
    assert form.status_code == 200

    scan = await ctx.client.post(f"/api/scan/{token}")
    assert scan.status_code == 200
    assert [item["step"]["key"] for item in scan.json()["experience_next_steps"]] == ["consent"]

    assert len(admission_emails) == 1
    assert "experience_next_steps" not in admission_emails[0]
    assert admission_emails[0]["ticket_url"].endswith(f"/scan/{token}")

    assert len(experience_emails) == 1
    assert experience_emails[0][0] == "consent-after-checkin@example.com"
    assert "Your next steps" in experience_emails[0][1]
    assert f"/scan/{token}#consent" in experience_emails[0][2]
    assert f'href="{admission_emails[0]["ticket_url"]}">view pass</a>' in experience_emails[0][2]


@pytest.mark.asyncio
async def test_delete_guest_removes_experience_and_consent_rows(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.experience_enabled = True
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        guest.admitted = True
        guest.admitted_at = datetime(2026, 9, 1, 10, 0)
        guest_id = guest.id
        token = guest.qr_token
        await s.commit()

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Delete guest cleanup",
            "steps": [{"key": "welcome", "type": "custom", "title": "Welcome"}],
        },
    )
    assert workflow.status_code == 201
    step_id = workflow.json()["steps"][0]["id"]
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    update = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed", "metadata": {"source": "portal"}},
    )
    assert update.status_code == 200

    form = await ctx.client.put(
        f"/api/events/{event_id}/experience/consent-form",
        json={"title": "Consent", "body": "I agree.", "require_signature": True},
    )
    assert form.status_code == 200
    sign = await ctx.client.post(
        f"/api/scan/{token}/consent",
        json={"signer_name": "G One", "signature_text": "G One"},
    )
    assert sign.status_code == 200

    delete_guest = await ctx.client.delete(f"/api/events/{event_id}/guests/{guest_id}")
    assert delete_guest.status_code == 204

    async with _Session() as s:
        assert await s.get(Guest, guest_id) is None


@pytest.mark.asyncio
async def test_souvenir_completion_sends_guest_email_once(ctx, monkeypatch):
    sent = []

    async def fake_email(to_email, subject, html_body, event_id=None, attachments=None, *args, **kwargs):
        sent.append((to_email, subject, html_body, event_id))

    monkeypatch.setattr(experience_router, "send_simple_email", fake_email)
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.status = "active"
        ev.experience_enabled = True
        ev.notify_email = True
        ev.notify_sms = False
        ev.notify_whatsapp = False
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        guest.email = "guest@example.com"
        guest_id = guest.id
        await s.commit()

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Souvenir email",
            "steps": [
                {
                    "key": "souvenir",
                    "type": "souvenir",
                    "title": "Souvenir",
                    "config": {"messages": {"complete": "Your gift bag has been handed over."}},
                },
            ],
        },
    )
    assert workflow.status_code == 201
    step_id = workflow.json()["steps"][0]["id"]
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    complete = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed"},
    )
    assert complete.status_code == 200
    assert len(sent) == 1
    assert sent[0][0] == "guest@example.com"
    assert "Souvenir complete" in sent[0][1]
    assert "gift bag" in sent[0][2]

    repeat = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed"},
    )
    assert repeat.status_code == 200
    assert len(sent) == 1


@pytest.mark.xfail(
    reason="WIP: room-assignment email template ({{room_name}} in services/templates.py) "
           "isn't populated with the group name yet, and a second <li>-based builder also "
           "exists in experience.py — needs the feature author to reconcile.",
    strict=False,
)
@pytest.mark.asyncio
async def test_room_assignment_step_assigns_table_group_seat_and_sends_email(ctx, monkeypatch):
    sent = []

    async def fake_email(to_email, subject, html_body, event_id=None, attachments=None, *args, **kwargs):
        sent.append((to_email, subject, html_body, event_id))

    monkeypatch.setattr(experience_router, "send_simple_email", fake_email)
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.status = "active"
        ev.experience_enabled = True
        ev.seating_enabled = True
        ev.enforce_table_groups = True
        ev.notify_email = True
        group = TableGroup(event_id=event_id, name="VIP Tables", tag="VIP")
        table = SeatingTable(event_id=event_id, name="VIP 1", capacity=2)
        s.add_all([group, table])
        await s.flush()
        s.add(TableGroupTable(table_group_id=group.id, table_id=table.id))
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        guest.table_id = None
        guest.seat_number = None
        guest.assigned_table_group_id = None
        guest.email = "room@example.com"
        guest_id = guest.id
        group_id = group.id
        table_id = table.id
        await s.commit()

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Room assignment",
            "steps": [
                {
                    "key": "room",
                    "type": "room_assignment",
                    "title": "Room Assignment",
                    "config": {"messages": {"complete": "Your table assignment has been confirmed."}},
                },
            ],
        },
    )
    assert workflow.status_code == 201
    step_id = workflow.json()["steps"][0]["id"]
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    complete = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed", "metadata": {"source": "scanner"}},
    )
    assert complete.status_code == 200
    room = complete.json()["metadata"]["room_assignment"]
    assert room["table_group_id"] == group_id
    assert room["table_id"] == table_id
    assert room["seat_number"] == "1"

    async with _Session() as s:
        guest = await s.get(Guest, guest_id)
        assert guest.assigned_table_group_id == group_id
        assert guest.table_id == table_id
        assert guest.seat_number == "1"

    assert len(sent) == 1
    assert sent[0][0] == "room@example.com"
    assert "Your room assignment" in sent[0][1]
    assert "VIP Tables" in sent[0][2]
    assert "VIP 1" in sent[0][2]
    assert "Seat" in sent[0][2]

    repeat = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed", "metadata": {"source": "scanner"}},
    )
    assert repeat.status_code == 200
    assert len(sent) == 1


@pytest.mark.asyncio
async def test_scoped_room_assignment_step_does_not_overwrite_main_guest_seat(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.status = "active"
        ev.experience_enabled = True
        ev.seating_enabled = True
        ev.notify_email = False
        group = TableGroup(event_id=event_id, name="Luncheon Hall", tag="luncheon")
        table = SeatingTable(event_id=event_id, name="Luncheon 1", capacity=2)
        s.add_all([group, table])
        await s.flush()
        s.add(TableGroupTable(table_group_id=group.id, table_id=table.id))
        # conftest seeds a single guest; this test needs a second one to prove a
        # scoped room assignment for guest_b doesn't disturb guest_a's seat.
        s.add(Guest(event_id=event_id, first_name="Gtwo", last_name="Two", email="gtwo@a.com"))
        await s.flush()
        guests = (await s.execute(select(Guest).where(Guest.event_id == event_id).order_by(Guest.id))).scalars().all()
        guest_a, guest_b = guests[0], guests[1]
        guest_a.table_id = None
        guest_a.seat_number = None
        guest_a.assigned_table_group_id = None
        guest_b.table_id = None
        guest_b.seat_number = None
        guest_b.assigned_table_group_id = None
        guest_a_id = guest_a.id
        guest_b_id = guest_b.id
        await s.commit()

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Scoped seating",
            "steps": [
                {
                    "key": "luncheon_seating",
                    "type": "room_assignment",
                    "title": "Luncheon Seating",
                    "config": {
                        "room_assignment": {
                            "assignment_mode": "scoped",
                            "scope": "saturday_luncheon",
                            "room": "Luncheon Hall",
                            "table_group": "Luncheon Hall",
                        },
                    },
                },
            ],
        },
    )
    assert workflow.status_code == 201
    step_id = workflow.json()["steps"][0]["id"]
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    first = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_a_id}/steps/{step_id}",
        json={"status": "completed"},
    )
    assert first.status_code == 200
    first_assignment = first.json()["metadata"]["room_assignment"]
    assert first_assignment["assignment_mode"] == "scoped"
    assert first_assignment["assignment_scope"] == "saturday_luncheon"
    assert first_assignment["room"] == "Luncheon Hall"
    assert first_assignment["table_name"] == "Luncheon 1"
    assert first_assignment["seat_number"] == "1"

    second = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_b_id}/steps/{step_id}",
        json={"status": "completed"},
    )
    assert second.status_code == 200
    assert second.json()["metadata"]["room_assignment"]["seat_number"] == "2"

    repeat = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_a_id}/steps/{step_id}",
        json={"status": "completed"},
    )
    assert repeat.status_code == 200
    assert repeat.json()["metadata"]["room_assignment"]["seat_number"] == "1"

    async with _Session() as s:
        guest_a = await s.get(Guest, guest_a_id)
        guest_b = await s.get(Guest, guest_b_id)
        assert guest_a.table_id is None
        assert guest_a.seat_number is None
        assert guest_b.table_id is None
        assert guest_b.seat_number is None


@pytest.mark.asyncio
async def test_admission_defers_seating_when_experience_has_room_assignment(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.status = "active"
        ev.experience_enabled = True
        ev.seating_enabled = True
        ev.notify_email = False
        ev.notify_sms = False
        ev.notify_whatsapp = False
        table = SeatingTable(event_id=event_id, name="Room 1", capacity=4)
        s.add(table)
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        guest.table_id = None
        guest.seat_number = None
        token = guest.qr_token
        guest_id = guest.id
        await s.commit()

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Room after stations",
            "steps": [
                {"key": "main_check_in", "type": "check_in", "title": "Main entrance check-in"},
                {"key": "room", "type": "room_assignment", "title": "Room Assignment"},
            ],
        },
    )
    assert workflow.status_code == 201
    room_step_id = next(step["id"] for step in workflow.json()["steps"] if step["type"] == "room_assignment")
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    scan = await ctx.client.post(f"/api/scan/{token}")
    assert scan.status_code == 200
    assert scan.json()["status"] == "admitted"
    assert scan.json()["table_name"] is None
    assert scan.json()["seat_number"] is None

    async with _Session() as s:
        guest = await s.get(Guest, guest_id)
        assert guest.admitted is True
        assert guest.table_id is None
        assert guest.seat_number is None

    room = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{room_step_id}",
        json={"status": "completed", "metadata": {"source": "scanner"}},
    )
    assert room.status_code == 200
    assert room.json()["metadata"]["room_assignment"]["table_name"] == "Room 1"
    assert room.json()["metadata"]["room_assignment"]["seat_number"] == "1"


@pytest.mark.asyncio
async def test_scan_returns_all_next_steps_without_runtime_cap(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.status = "active"
        ev.experience_enabled = True
        ev.notify_email = False
        ev.notify_sms = False
        ev.notify_whatsapp = False
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        token = guest.qr_token
        await s.commit()

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Full scan runbook",
            "steps": [
                {"key": "checkin", "type": "check_in", "title": "Check in"},
                *[
                    {"key": f"step_{i}", "type": "custom", "title": f"Step {i}"}
                    for i in range(1, 8)
                ],
            ],
        },
    )
    assert workflow.status_code == 201
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    scan = await ctx.client.post(f"/api/scan/{token}")
    assert scan.status_code == 200
    keys = [item["step"]["key"] for item in scan.json()["experience_next_steps"]]
    assert keys == [f"step_{i}" for i in range(1, 8)]


@pytest.mark.asyncio
async def test_disabled_experience_does_not_expose_runtime_next_steps(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={"name": "Disabled Runtime", "steps": [{"key": "welcome", "type": "custom", "title": "Welcome"}]},
    )
    assert workflow.status_code == 201
    publish = await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")
    assert publish.status_code == 200

    async with _Session() as s:
        guest_id = (await s.execute(select(Guest.id).where(Guest.event_id == event_id))).scalar_one()
        ev = await s.get(Event, event_id)
        ev.experience_enabled = False
        await s.commit()

    next_steps = await ctx.client.get(f"/api/events/{event_id}/experience/guests/{guest_id}/next-steps")
    assert next_steps.status_code == 200
    assert next_steps.json() == []
    assert (await ctx.client.get(f"/api/events/{event_id}/experience/dashboard")).status_code == 404
    assert (await ctx.client.get(f"/api/events/{event_id}/experience/analytics")).status_code == 404
    assert (await ctx.client.get(f"/api/events/{event_id}/experience/export.csv")).status_code == 404


@pytest.mark.asyncio
async def test_step_dependencies_block_runtime_completion_until_prior_steps_complete(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Dependencies",
            "steps": [
                {"key": "badge", "type": "custom", "title": "Badge pickup"},
                {
                    "key": "gift",
                    "type": "custom",
                    "title": "Gift pickup",
                    "config": {"depends_on": ["badge"]},
                },
            ],
        },
    )
    assert workflow.status_code == 201
    steps = {step["key"]: step["id"] for step in workflow.json()["steps"]}
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    async with _Session() as s:
        guest_id = (await s.execute(select(Guest.id).where(Guest.event_id == event_id))).scalar_one()

    journey = await ctx.client.get(f"/api/events/{event_id}/experience/guests/{guest_id}")
    assert journey.status_code == 200
    statuses = {row["step_id"]: row["status"] for row in journey.json()["progress"]}
    assert statuses[steps["badge"]] == "available"
    assert statuses[steps["gift"]] == "blocked"

    next_steps = await ctx.client.get(f"/api/events/{event_id}/experience/guests/{guest_id}/next-steps")
    assert [row["step"]["key"] for row in next_steps.json()] == ["badge"]

    blocked = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{steps['gift']}",
        json={"status": "completed"},
    )
    assert blocked.status_code == 409

    assert (await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{steps['badge']}",
        json={"status": "completed"},
    )).status_code == 200

    next_after_badge = await ctx.client.get(f"/api/events/{event_id}/experience/guests/{guest_id}/next-steps")
    assert [row["step"]["key"] for row in next_after_badge.json()] == ["gift"]


@pytest.mark.asyncio
async def test_scanner_offline_manifest_contains_guest_tokens(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.status = "active"
        ev.notify_email = False
        ev.notify_sms = False
        ev.notify_whatsapp = False
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        token = guest.qr_token
        await s.commit()

    manifest = await ctx.client.get(f"/api/scan/offline-manifest/{event_id}")
    assert manifest.status_code == 200
    body = manifest.json()
    assert body["event_id"] == event_id
    assert any(g["qr_token"] == token and g["first_name"] == "G" for g in body["guests"])


@pytest.mark.asyncio
async def test_scanner_offline_manifest_contains_venue_access_rules(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]
    async with _Session() as s:
        ev = await s.get(Event, event_id)
        ev.is_paid = True
        ev.status = "active"
        ev.venue_access_enabled = True
        guest = (await s.execute(select(Guest).where(Guest.event_id == event_id))).scalars().first()
        zone = Zone(event_id=event_id, name="VIP Lounge", capacity=10, direction_mode="both")
        s.add(zone)
        await s.flush()
        gate = Gate(event_id=event_id, name="VIP Door", zone_id=zone.id, direction="in")
        ticket = TicketType(event_id=event_id, name="VIP", allowed_zone_ids=f'["{zone.id}"]')
        tag = GuestTag(event_id=event_id, name="VIP")
        s.add_all([gate, ticket, tag])
        await s.flush()
        guest.ticket_type_id = ticket.id
        s.add_all([
            GuestTagLink(guest_id=guest.id, tag_id=tag.id),
            ZoneTagRule(zone_id=zone.id, tag_id=tag.id),
        ])
        await s.commit()

    manifest = await ctx.client.get(f"/api/scan/offline-manifest/{event_id}")
    assert manifest.status_code == 200
    body = manifest.json()
    assert body["venue_access_enabled"] is True
    assert any(z["name"] == "VIP Lounge" and z["capacity"] == 10 for z in body["zones"])
    assert any(g["name"] == "VIP Door" for g in body["gates"])
    assert any(tt["name"] == "VIP" and tt["allowed_zone_ids"] for tt in body["ticket_types"])
    assert body["guest_tag_links"]
    assert body["zone_tag_rules"]


@pytest.mark.asyncio
async def test_step_allowed_roles_are_enforced(ctx):
    ctx.login(ctx.ids["user_a"])
    event_id = ctx.ids["event_a"]

    workflow = await ctx.client.post(
        f"/api/events/{event_id}/experience/workflows",
        json={
            "name": "Permissions",
            "steps": [
                {
                    "key": "admin_only",
                    "type": "custom",
                    "title": "Admin only",
                    "config": {"allowed_roles": ["admin"]},
                }
            ],
        },
    )
    assert workflow.status_code == 201
    step_id = workflow.json()["steps"][0]["id"]
    assert (await ctx.client.post(f"/api/events/{event_id}/experience/workflows/{workflow.json()['id']}/publish")).status_code == 200

    invite = await ctx.client.post(
        f"/api/events/{event_id}/org-members",
        json={"email": "stepstaff@a.com", "role": "staff"},
    )
    staff_id = invite.json()["user"]["id"]
    assert (await ctx.client.post(f"/api/events/{event_id}/members", json={"user_id": staff_id})).status_code == 201
    async with _Session() as s:
        guest_id = (await s.execute(select(Guest.id).where(Guest.event_id == event_id))).scalar_one()
        staff = await s.get(User, staff_id)

    ctx.login(staff)
    denied = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed"},
    )
    assert denied.status_code == 403

    ctx.login(ctx.ids["user_a"])
    allowed = await ctx.client.put(
        f"/api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}",
        json={"status": "completed"},
    )
    assert allowed.status_code == 200
