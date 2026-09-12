"""Routing output must preserve the live audience run and durable answers."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.auth import Identity
from app.config import settings
from app.models import WorkflowRunEvent
from app.routers.workflows import assign_run_displays, command_run, create_run, _validate_display_owner
from app.workflow_schemas import RunCommand, RunCreate, RunDisplayAssignment


class RoutingDb:
    def __init__(self, run, displays, *, existing=None, owner=None):
        self.run = run
        self.displays = displays
        self.existing = existing
        self.owner = owner
        self.scalar_calls = 0
        self.commits = 0
        self.events = []

    async def scalar(self, _query):
        self.scalar_calls += 1
        return self.run if self.scalar_calls == 1 else self.existing

    async def execute(self, _query):
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: self.displays))

    async def get(self, _model, _id):
        return self.owner

    def add(self, value):
        # Transfer may append audit events; it must not insert another run,
        # participant, response, score, or question.
        if not isinstance(value, WorkflowRunEvent):
            raise AssertionError(f"Unexpected durable write: {type(value)}")
        self.events.append(value)

    async def commit(self):
        self.commits += 1

    async def refresh(self, _value):
        pass


def fixture():
    now = datetime.now(timezone.utc)
    run = SimpleNamespace(
        id="run-a", event_id="event-a", org_id="org-a", workflow_id="workflow-a",
        display_id="display-a", status="live", state_version=7,
        current_step_id="step-poll", active_activity_id="activity-a", active_question_id="question-a",
        timer_started_at=now, timer_ends_at=now + timedelta(seconds=90),
        timer_paused_remaining_seconds=None, step_started_at=now,
        runtime_state={"media_command": "play", "media_command_id": "existing-play"},
        elapsed_before_pause_seconds=17, started_at=now, paused_at=None, completed_at=None,
    )
    displays = [SimpleNamespace(id=id, status="active", assigned_workflow_run_id="run-a" if id == "display-a" else None)
                for id in ("display-a", "display-b", "display-c")]
    identity = Identity(identity_kind="staff", subject="presenter-a", event_id="event-a", org_id="org-a", role="presenter", capabilities=("control",))
    return run, displays, identity


class WorkflowDisplayAssignmentTests(unittest.TestCase):
    def invoke(self, ids, *, version=7, mutate=None):
        run, displays, identity = fixture()
        db = RoutingDb(run, displays)
        if mutate:
            mutate(run, displays, db)
        body = RunDisplayAssignment(display_ids=ids, expected_version=version, idempotency_key="transfer-once-123")
        with patch.object(settings, "experience_workflows_enabled", True), \
             patch("app.routers.workflows._run_payload", new=AsyncMock(return_value={"id": run.id})) as payload, \
             patch("app.routers.workflows.publish_display", new=AsyncMock()) as publish_display, \
             patch("app.routers.workflows.publish_run", new=AsyncMock()) as publish_run:
            result = asyncio.run(assign_run_displays(run.id, body, identity, db))
        return run, displays, db, publish_display, publish_run, result

    def test_transfer_to_multiple_channels_preserves_the_same_live_run(self):
        original = deepcopy(vars(fixture()[0]))
        # Capture exact timestamp values from the route fixture itself.
        before = {}
        def capture(run, _displays, _db): before.update(deepcopy(vars(run)))
        run, displays, db, changed, published, _ = self.invoke(["display-b", "display-c"], mutate=capture)
        after = vars(run)
        for field in before.keys() - {"display_id", "state_version"}:
            self.assertEqual(after[field], before[field], field)
        self.assertEqual(run.display_id, "display-b")
        self.assertEqual(run.state_version, 8)
        self.assertEqual([display.assigned_workflow_run_id for display in displays], [None, "run-a", "run-a"])
        self.assertEqual(db.commits, 1)
        self.assertEqual(len(db.events), 1)
        self.assertEqual(db.events[0].event_type, "workflow.displays_changed")
        self.assertEqual(changed.await_count, 3)
        published.assert_awaited_once_with("run-a", "workflow.displays_changed", {"run_id": "run-a", "state_version": 8})

    def test_detach_keeps_activity_and_timer_running(self):
        run, displays, db, _, _, _ = self.invoke([])
        self.assertEqual(run.status, "live")
        self.assertEqual(run.active_activity_id, "activity-a")
        self.assertIsNotNone(run.timer_ends_at)
        self.assertIsNone(run.display_id)
        self.assertTrue(all(display.assigned_workflow_run_id is None for display in displays))

    def test_duplicate_transfer_does_not_write_again(self):
        def replay(_run, _displays, db): db.existing = SimpleNamespace(id="event-existing")
        run, displays, db, changed, published, _ = self.invoke(["display-b"], version=0, mutate=replay)
        self.assertEqual(run.state_version, 7)
        self.assertEqual(db.commits, 0)
        self.assertEqual(db.events, [])
        changed.assert_not_awaited(); published.assert_not_awaited()

    def test_stale_version_cannot_replace_newer_routing(self):
        with self.assertRaises(HTTPException) as error:
            self.invoke(["display-b"], version=6)
        self.assertEqual(error.exception.status_code, 409)

    def test_display_outside_scoped_query_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            self.invoke(["other-event-display"])
        self.assertEqual(error.exception.status_code, 404)

    def test_conflicting_owner_is_rejected_before_any_assignment_changes(self):
        observed = {}
        def occupied(run, displays, db):
            displays[1].assigned_workflow_run_id = "other-run"
            db.owner = SimpleNamespace(status="live")
            observed.update(run=run, displays=displays, db=db)
        with self.assertRaises(HTTPException) as error:
            self.invoke(["display-b"], mutate=occupied)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(observed["displays"][0].assigned_workflow_run_id, "run-a")
        self.assertEqual(observed["run"].state_version, 7)
        self.assertEqual(observed["db"].commits, 0)

    def test_finished_run_cannot_claim_a_display(self):
        with self.assertRaises(HTTPException) as error:
            self.invoke(["display-b"], mutate=lambda run, displays, db: setattr(run, "status", "completed"))
        self.assertEqual(error.exception.status_code, 409)

    def test_moderator_cannot_route_displays(self):
        run, displays, _ = fixture()
        identity = Identity(identity_kind="staff", subject="moderator-a", event_id="event-a", org_id="org-a", role="moderator", capabilities=("moderate",))
        with patch.object(settings, "experience_workflows_enabled", True), self.assertRaises(HTTPException) as error:
            asyncio.run(assign_run_displays(run.id, RunDisplayAssignment(display_ids=[], expected_version=7, idempotency_key="denied-request"), identity, RoutingDb(run, displays)))
        self.assertEqual(error.exception.status_code, 403)

    def test_duplicate_display_ids_are_invalid(self):
        with self.assertRaises(ValidationError):
            RunDisplayAssignment(display_ids=["a", "a"], expected_version=0, idempotency_key="same-target-twice")

    def test_stale_legacy_primary_does_not_block_detached_channel(self):
        display = SimpleNamespace(status="active", assigned_workflow_run_id=None)
        db = SimpleNamespace(get=AsyncMock(side_effect=AssertionError("Legacy run pointer must not establish ownership")))
        asyncio.run(_validate_display_owner(display, "new-run", db))

    def test_create_does_not_complete_an_existing_audience_run(self):
        run, displays, identity = fixture()
        workflow = SimpleNamespace(id="workflow-a", current_revision_id="revision-a")
        db = RoutingDb(run, displays)
        with patch.object(settings, "experience_workflows_enabled", True), \
             patch("app.routers.workflows._workflow", new=AsyncMock(return_value=workflow)), \
             patch("app.routers.workflows._activate_step", new=AsyncMock()) as activate, \
             self.assertRaises(HTTPException) as error:
            asyncio.run(create_run("workflow-a", RunCreate(display_id="display-b"), identity, db))
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(run.status, "live")
        self.assertEqual(db.commits, 0)
        activate.assert_not_awaited()

    def test_completion_detaches_all_mirrored_channels(self):
        run, displays, identity = fixture()
        displays[1].assigned_workflow_run_id = run.id
        db = RoutingDb(run, displays[:2])
        db.scalar_calls = -1  # command's duplicate lookup precedes its run lock
        async def scalar(_query):
            db.scalar_calls += 1
            return None if db.scalar_calls == 0 else run
        db.scalar = scalar
        with patch.object(settings, "experience_workflows_enabled", True), \
             patch("app.routers.workflows._run_steps", new=AsyncMock(return_value=[SimpleNamespace(id=run.current_step_id)])), \
             patch("app.routers.workflows._activate_step", new=AsyncMock()), \
             patch("app.routers.workflows._run_payload", new=AsyncMock(return_value={"id": run.id})), \
             patch("app.routers.workflows.publish_run", new=AsyncMock()), \
             patch("app.routers.workflows.publish_display", new=AsyncMock()) as changed:
            asyncio.run(command_run(run.id, RunCommand(action="complete", expected_version=7, idempotency_key="complete-once-123"), identity, db))
        self.assertEqual(run.status, "completed")
        self.assertTrue(all(display.assigned_workflow_run_id is None for display in displays))
        self.assertEqual(changed.await_count, 2)
        self.assertIsNone(run.display_id)


if __name__ == "__main__":
    unittest.main()
