"""Per-event task/to-do management (Gatsby gap-backlog item): CRUD, assignee
validation against the event's team, completion, and the overdue computation."""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import Event, EventUser, Subtask, TaskActivity
from app.routers import tasks as tasks_mod
from conftest import _Session


def _capture_email(monkeypatch):
    """Every test that causes an assignee to be set MUST call this — otherwise
    the real send_simple_email runs, and this environment's real RESEND_API_KEY
    (loaded from backend/.env with nothing in conftest to clear it) means an
    actual email goes out through the real Resend account. Confirmed live during
    this feature's own test development — see the session's flagged finding."""
    calls = []
    async def fake(to, subject, html, *args, **kwargs):
        calls.append((to, subject, html))
    monkeypatch.setattr(tasks_mod, "send_simple_email", fake)
    return calls


@pytest.mark.asyncio
async def test_task_crud_and_complete(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    created = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Confirm florist"})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["title"] == "Confirm florist"
    assert body["status"] == "open"
    assert body["overdue"] is False
    tid = body["id"]

    updated = await ctx.client.put(f"/api/events/{ev}/tasks/{tid}", json={"title": "Confirm florist ASAP"})
    assert updated.status_code == 200
    assert updated.json()["title"] == "Confirm florist ASAP"

    done = await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/complete")
    assert done.status_code == 200
    assert done.json()["status"] == "done"
    assert done.json()["completed_at"] is not None

    reopened = await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/reopen")
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "open"
    assert reopened.json()["completed_at"] is None

    listing = await ctx.client.get(f"/api/events/{ev}/tasks")
    assert listing.status_code == 200
    assert len(listing.json()) == 1

    deleted = await ctx.client.delete(f"/api/events/{ev}/tasks/{tid}")
    assert deleted.status_code == 204
    listing2 = await ctx.client.get(f"/api/events/{ev}/tasks")
    assert listing2.json() == []


@pytest.mark.asyncio
async def test_task_requires_nonempty_title(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    r = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "   "})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_task_overdue_is_computed_not_stored(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    past = (datetime.utcnow() - timedelta(days=1)).isoformat()
    future = (datetime.utcnow() + timedelta(days=1)).isoformat()

    overdue_task = (await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Late one", "due_date": past})).json()
    assert overdue_task["overdue"] is True

    upcoming_task = (await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Upcoming", "due_date": future})).json()
    assert upcoming_task["overdue"] is False

    # Completing an overdue task clears the overdue flag (status != 'open').
    completed = await ctx.client.post(f"/api/events/{ev}/tasks/{overdue_task['id']}/complete")
    assert completed.json()["overdue"] is False


@pytest.mark.asyncio
async def test_task_assignee_must_be_event_team_member(ctx, monkeypatch):
    _capture_email(monkeypatch)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    not_on_team = ctx.ids["user_b"]
    rejected = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "X", "assignee_user_id": not_on_team.id})
    assert rejected.status_code == 404

    async with _Session() as s:
        s.add(EventUser(event_id=ev, user_id=not_on_team.id))
        await s.commit()

    accepted = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "X", "assignee_user_id": not_on_team.id})
    assert accepted.status_code == 201
    assert accepted.json()["assignee_name"] == not_on_team.name


@pytest.mark.asyncio
async def test_task_ordering_open_before_done_and_due_date_ascending(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    soon = (datetime.utcnow() + timedelta(hours=1)).isoformat()
    later = (datetime.utcnow() + timedelta(hours=5)).isoformat()

    t_later = (await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Later", "due_date": later})).json()
    t_soon = (await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Soon", "due_date": soon})).json()
    t_no_due = (await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "No due date"})).json()
    t_done = (await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Done already"})).json()
    await ctx.client.post(f"/api/events/{ev}/tasks/{t_done['id']}/complete")

    listing = (await ctx.client.get(f"/api/events/{ev}/tasks")).json()
    titles = [t["title"] for t in listing]
    assert titles.index("Soon") < titles.index("Later") < titles.index("No due date")
    assert titles.index("Done already") == len(titles) - 1   # done tasks sort last


@pytest.mark.asyncio
async def test_email_sent_when_task_assigned(ctx, monkeypatch):
    calls = _capture_email(monkeypatch)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    teammate = ctx.ids["user_b"]
    async with _Session() as s:
        s.add(EventUser(event_id=ev, user_id=teammate.id))
        await s.commit()

    created = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Confirm florist", "assignee_user_id": teammate.id})
    assert created.status_code == 201
    assert len(calls) == 1
    assert calls[0][0] == teammate.email
    assert "Confirm florist" in calls[0][1]
    assert "/admin?event=" in calls[0][2] and "tab=tasks" in calls[0][2]   # link back to the task


@pytest.mark.asyncio
async def test_no_email_when_unassigned_or_unchanged(ctx, monkeypatch):
    calls = _capture_email(monkeypatch)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    created = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "No assignee"})
    assert created.status_code == 201
    assert calls == []

    teammate = ctx.ids["user_b"]
    async with _Session() as s:
        s.add(EventUser(event_id=ev, user_id=teammate.id))
        await s.commit()
    assigned = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "X", "assignee_user_id": teammate.id})
    assert len(calls) == 1
    tid = assigned.json()["id"]

    # Re-saving with the SAME assignee must not re-fire the email.
    await ctx.client.put(f"/api/events/{ev}/tasks/{tid}", json={"title": "X renamed", "assignee_user_id": teammate.id})
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_task_start_sets_in_progress_and_affects_ordering(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    t_open = (await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Open one"})).json()
    t_started = (await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Started one"})).json()
    t_done = (await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Done one"})).json()

    start = await ctx.client.post(f"/api/events/{ev}/tasks/{t_started['id']}/start")
    assert start.status_code == 200
    assert start.json()["status"] == "in_progress"
    await ctx.client.post(f"/api/events/{ev}/tasks/{t_done['id']}/complete")

    listing = (await ctx.client.get(f"/api/events/{ev}/tasks")).json()
    titles = [t["title"] for t in listing]
    assert titles.index("Open one") < titles.index("Started one") < titles.index("Done one")


@pytest.mark.asyncio
async def test_in_progress_task_can_still_be_overdue(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    past = (datetime.utcnow() - timedelta(days=1)).isoformat()
    t = (await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Late", "due_date": past})).json()
    started = await ctx.client.post(f"/api/events/{ev}/tasks/{t['id']}/start")
    assert started.json()["overdue"] is True


@pytest.mark.asyncio
async def test_my_tasks_scoped_to_accessible_events_and_assignment_filter(ctx, monkeypatch):
    """user_a owns org_a (so sees event_a's tasks); a task on a foreign event
    in org_b must never appear, regardless of assignment filter."""
    _capture_email(monkeypatch)
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["superadmin"])
    async with _Session() as s:
        s.add(EventUser(event_id=ev, user_id=ctx.ids["user_a"].id))
        s.add(EventUser(event_id=ev, user_id=ctx.ids["user_b"].id))
        foreign_event = Event(org_id=ctx.ids["org_b"], name="Foreign", couples_name="Foreign",
                               event_date=datetime(2026, 9, 1), checkin_base_url="http://x")
        s.add(foreign_event)
        await s.commit()
        foreign_event_id = foreign_event.id

    mine = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Mine", "assignee_user_id": ctx.ids["user_a"].id})
    assert mine.status_code == 201, mine.text
    others_created = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Someone else's", "assignee_user_id": ctx.ids["user_b"].id})
    assert others_created.status_code == 201, others_created.text

    # A superadmin-only task creation to seed the foreign event (org_b) — user_a
    # is NOT a member of org_b, so this must never leak into their "all" view.
    ctx.login(ctx.ids["superadmin"])
    await ctx.client.post(f"/api/events/{foreign_event_id}/tasks", json={"title": "Foreign task"})

    ctx.login(ctx.ids["user_a"])
    mine = (await ctx.client.get("/api/tasks/mine", params={"assignment": "mine"})).json()
    assert [t["title"] for t in mine] == ["Mine"]

    others = (await ctx.client.get("/api/tasks/mine", params={"assignment": "others"})).json()
    assert [t["title"] for t in others] == ["Someone else's"]

    everything = (await ctx.client.get("/api/tasks/mine", params={"assignment": "all"})).json()
    titles = {t["title"] for t in everything}
    assert titles == {"Mine", "Someone else's"}   # foreign event's task never appears
    assert all(t["event_name"] == "A Wedding" for t in everything)


@pytest.mark.asyncio
async def test_activity_log_records_creation_reassignment_and_status_changes(ctx, monkeypatch):
    _capture_email(monkeypatch)
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    teammate = ctx.ids["user_b"]
    async with _Session() as s:
        s.add(EventUser(event_id=ev, user_id=teammate.id))
        await s.commit()

    created = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Confirm florist"})
    tid = created.json()["id"]

    await ctx.client.put(f"/api/events/{ev}/tasks/{tid}", json={"title": "Confirm florist", "assignee_user_id": teammate.id})
    await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/start")
    await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/complete")

    activity = (await ctx.client.get(f"/api/events/{ev}/tasks/{tid}/activity")).json()
    bodies = [a["body"] for a in activity]
    assert any("Created this task" in b for b in bodies)
    assert any("Reassigned to" in b and teammate.name in b for b in bodies)
    assert any("Open to In Progress" in b for b in bodies)
    assert any("In Progress to Done" in b for b in bodies)
    assert all(a["kind"] == "system" for a in activity)
    # Chronological order.
    assert activity == sorted(activity, key=lambda a: a["created_at"])


@pytest.mark.asyncio
async def test_status_unchanged_does_not_log_activity(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    created = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "X"})
    tid = created.json()["id"]
    await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/reopen")   # already open — no-op

    activity = (await ctx.client.get(f"/api/events/{ev}/tasks/{tid}/activity")).json()
    assert len(activity) == 1   # only the creation entry


@pytest.mark.asyncio
async def test_add_and_list_comments(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    created = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Confirm florist"})
    tid = created.json()["id"]

    comment = await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/comments", json={"body": "Vendor confirmed the quote."})
    assert comment.status_code == 201, comment.text
    assert comment.json()["kind"] == "comment"
    assert comment.json()["body"] == "Vendor confirmed the quote."
    assert comment.json()["user_name"] == ctx.ids["superadmin"].name

    activity = (await ctx.client.get(f"/api/events/{ev}/tasks/{tid}/activity")).json()
    kinds = [a["kind"] for a in activity]
    assert kinds == ["system", "comment"]


@pytest.mark.asyncio
async def test_comment_requires_nonempty_body(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    created = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "X"})
    tid = created.json()["id"]
    r = await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/comments", json={"body": "   "})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_deleting_task_removes_its_activity(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    created = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "X"})
    tid = created.json()["id"]
    await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/comments", json={"body": "note"})

    delete_resp = await ctx.client.delete(f"/api/events/{ev}/tasks/{tid}")
    assert delete_resp.status_code == 204

    async with _Session() as s:
        remaining = (await s.execute(
            select(TaskActivity).where(TaskActivity.task_id == tid)
        )).scalars().all()
        assert remaining == []


@pytest.mark.asyncio
async def test_subtask_crud_and_ordering(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    task = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "food"})
    tid = task.json()["id"]

    s1 = await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/subtasks", json={"title": "Order plates"})
    assert s1.status_code == 201, s1.text
    assert s1.json()["status"] == "open"
    s2 = await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/subtasks", json={"title": "Book caterer"})

    listing = (await ctx.client.get(f"/api/events/{ev}/tasks/{tid}/subtasks")).json()
    assert [s["title"] for s in listing] == ["Order plates", "Book caterer"]   # creation order preserved

    renamed = await ctx.client.patch(
        f"/api/events/{ev}/tasks/{tid}/subtasks/{s1.json()['id']}", json={"title": "Order 200 plates"})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Order 200 plates"

    deleted = await ctx.client.delete(f"/api/events/{ev}/tasks/{tid}/subtasks/{s2.json()['id']}")
    assert deleted.status_code == 204
    listing2 = (await ctx.client.get(f"/api/events/{ev}/tasks/{tid}/subtasks")).json()
    assert len(listing2) == 1


@pytest.mark.asyncio
async def test_subtask_requires_nonempty_title(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    task = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "food"})
    tid = task.json()["id"]
    r = await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/subtasks", json={"title": "   "})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_toggling_subtask_status_logs_activity_but_renaming_does_not(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    task = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "food"})
    tid = task.json()["id"]
    sub = await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/subtasks", json={"title": "Order plates"})
    sid = sub.json()["id"]

    await ctx.client.patch(f"/api/events/{ev}/tasks/{tid}/subtasks/{sid}", json={"title": "Order 200 plates"})
    started = await ctx.client.patch(f"/api/events/{ev}/tasks/{tid}/subtasks/{sid}", json={"status": "in_progress"})
    assert started.json()["status"] == "in_progress"
    done = await ctx.client.patch(f"/api/events/{ev}/tasks/{tid}/subtasks/{sid}", json={"status": "done"})
    assert done.json()["status"] == "done"
    reopened = await ctx.client.patch(f"/api/events/{ev}/tasks/{tid}/subtasks/{sid}", json={"status": "open"})
    assert reopened.json()["status"] == "open"

    activity = (await ctx.client.get(f"/api/events/{ev}/tasks/{tid}/activity")).json()
    bodies = [a["body"] for a in activity]
    assert any("Added subtask: Order plates" in b for b in bodies)
    assert any('"Order 200 plates" from Open to In Progress' in b for b in bodies)
    assert any('"Order 200 plates" from In Progress to Done' in b for b in bodies)
    assert any('"Order 200 plates" from Done to Open' in b for b in bodies)
    assert not any("rename" in b.lower() for b in bodies)   # renaming alone is silent


@pytest.mark.asyncio
async def test_subtask_status_must_be_valid(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    task = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "food"})
    tid = task.json()["id"]
    sub = await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/subtasks", json={"title": "Order plates"})
    r = await ctx.client.patch(f"/api/events/{ev}/tasks/{tid}/subtasks/{sub.json()['id']}", json={"status": "bogus"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_deleting_task_removes_its_subtasks(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    task = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "food"})
    tid = task.json()["id"]
    await ctx.client.post(f"/api/events/{ev}/tasks/{tid}/subtasks", json={"title": "Order plates"})

    await ctx.client.delete(f"/api/events/{ev}/tasks/{tid}")

    async with _Session() as s:
        remaining = (await s.execute(select(Subtask).where(Subtask.task_id == tid))).scalars().all()
        assert remaining == []
