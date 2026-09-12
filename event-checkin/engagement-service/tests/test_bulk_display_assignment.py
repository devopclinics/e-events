"""Safety tests for the admin bulk display assignment operation."""
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, call, patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.auth import Identity
from app.routers import operations
from app.schemas import BulkDisplayUpdate


class BulkDisplayDb:
    """Minimal scoped-query result and transaction recorder for route tests."""

    def __init__(self, displays):
        self.displays = displays
        self.commits = 0
        self.executed = []
        self.timeline = []

    async def execute(self, statement):
        self.executed.append(statement)
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: self.displays))

    async def commit(self):
        self.commits += 1
        self.timeline.append(("commit",))

    async def refresh(self, display):
        self.timeline.append(("refresh", display.id))


def owner_identity():
    return Identity(
        identity_kind="staff", subject="owner-a", event_id="event-a",
        org_id="org-a", role="owner",
    )


def display(display_id, *, workflow="run-a"):
    return SimpleNamespace(
        id=display_id,
        event_id="event-a",
        org_id="org-a",
        name=f"Screen {display_id}",
        assigned_session_id="session-old",
        assigned_activity_id="activity-old",
        assigned_workflow_run_id=workflow,
        scene="welcome",
        settings={"motion": True, "retained": "keep"},
        status="active",
    )


class BulkDisplayRequestValidationTests(unittest.TestCase):
    def test_requires_unique_targets_and_a_content_patch(self):
        with self.assertRaises(ValidationError):
            BulkDisplayUpdate(display_ids=["display-a", "display-a"], assigned_activity_id="activity-a")
        with self.assertRaises(ValidationError):
            BulkDisplayUpdate(display_ids=["display-a"])


class BulkDisplayAssignmentTests(unittest.TestCase):
    def test_assigns_one_activity_to_each_target_in_one_commit_then_publishes(self):
        first, second = display("display-a"), display("display-b")
        db = BulkDisplayDb([first, second])
        body = BulkDisplayUpdate(
            display_ids=["display-b", "display-a"],
            assigned_activity_id="activity-new",
            scene="question",
            settings={"motion": False},
        )

        async def publish(display_id, event_name, payload):
            db.timeline.append(("publish", display_id, event_name, payload))

        with (
            patch("app.routers.operations._validate_assigned_activity", new=AsyncMock()) as validate_activity,
            patch("app.routers.operations.publish_display", new=AsyncMock(side_effect=publish)) as publish_display,
            patch("app.routers.operations._attach_connection_status", new=AsyncMock()) as attach_status,
        ):
            result = asyncio.run(operations.bulk_update_displays(body, owner_identity(), db))

        self.assertEqual([row.id for row in result], ["display-b", "display-a"])
        self.assertEqual(db.commits, 1)
        validate_activity.assert_awaited_once_with("activity-new", "event-a", "org-a", db)
        self.assertEqual([row.assigned_activity_id for row in (first, second)], ["activity-new", "activity-new"])
        self.assertEqual([row.scene for row in (first, second)], ["question", "question"])
        self.assertEqual([row.assigned_workflow_run_id for row in (first, second)], [None, None])
        self.assertEqual([row.settings for row in (first, second)], [
            {"motion": False, "retained": "keep"},
            {"motion": False, "retained": "keep"},
        ])
        publish_display.assert_has_awaits([
            call("display-b", "display.changed", {"scene": "question"}),
            call("display-a", "display.changed", {"scene": "question"}),
        ])
        attach_status.assert_awaited_once_with(result)
        commit_index = db.timeline.index(("commit",))
        self.assertTrue(all(index > commit_index for index, event in enumerate(db.timeline) if event[0] == "publish"))

    def test_missing_or_cross_tenant_target_rejects_the_whole_batch_without_mutation(self):
        owned = display("display-a")
        # A scoped SQL query would omit display-b because it belongs to another
        # event or organization. The route must not update display-a first.
        db = BulkDisplayDb([owned])
        body = BulkDisplayUpdate(
            display_ids=["display-a", "display-b"],
            assigned_activity_id="activity-new",
            scene="question",
        )
        with (
            patch("app.routers.operations._validate_assigned_activity", new=AsyncMock()),
            patch("app.routers.operations.publish_display", new=AsyncMock()) as publish_display,
            self.assertRaises(HTTPException) as raised,
        ):
            asyncio.run(operations.bulk_update_displays(body, owner_identity(), db))

        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(db.commits, 0)
        self.assertEqual(owned.assigned_activity_id, "activity-old")
        self.assertEqual(owned.scene, "welcome")
        self.assertEqual(owned.assigned_workflow_run_id, "run-a")
        publish_display.assert_not_awaited()

    def test_cross_tenant_activity_is_rejected_before_any_target_is_loaded_or_mutated(self):
        target = display("display-a")
        db = BulkDisplayDb([target])
        body = BulkDisplayUpdate(display_ids=["display-a"], assigned_activity_id="other-event-activity")
        foreign_activity = SimpleNamespace(event_id="event-b", org_id="org-a")
        with (
            patch("app.routers.operations._fetch_activity", new=AsyncMock(return_value=foreign_activity)),
            patch("app.routers.operations.publish_display", new=AsyncMock()) as publish_display,
            self.assertRaises(HTTPException) as raised,
        ):
            asyncio.run(operations.bulk_update_displays(body, owner_identity(), db))

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(db.executed, [])
        self.assertEqual(db.commits, 0)
        self.assertEqual(target.assigned_activity_id, "activity-old")
        self.assertEqual(target.assigned_workflow_run_id, "run-a")
        publish_display.assert_not_awaited()

    def test_admin_without_an_organization_scope_cannot_bulk_route_displays(self):
        unscoped_admin = Identity(
            identity_kind="staff", subject="owner-a", event_id="event-a",
            org_id="", role="owner",
        )
        db = BulkDisplayDb([display("display-a")])
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(operations.bulk_update_displays(
                BulkDisplayUpdate(display_ids=["display-a"], assigned_activity_id="activity-new"),
                unscoped_admin,
                db,
            ))
        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(db.executed, [])

    def test_presenter_cannot_bulk_route_displays(self):
        presenter = Identity(
            identity_kind="staff", subject="presenter-a", event_id="event-a",
            org_id="org-a", role="presenter", capabilities=("control",),
        )
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(operations.bulk_update_displays(
                BulkDisplayUpdate(display_ids=["display-a"], assigned_activity_id="activity-new"),
                presenter,
                BulkDisplayDb([display("display-a")]),
            ))
        self.assertEqual(raised.exception.status_code, 403)


class BulkDisplayPatchSemanticsTests(unittest.TestCase):
    def test_explicit_null_clears_activity_and_session_assignments(self):
        target = display("display-a")
        db = BulkDisplayDb([target])
        body = BulkDisplayUpdate(
            display_ids=["display-a"],
            assigned_activity_id=None,
            assigned_session_id=None,
        )
        with (
            patch("app.routers.operations._validate_assigned_activity", new=AsyncMock()) as validate_activity,
            patch("app.routers.operations._validate_assigned_session", new=AsyncMock()) as validate_session,
            patch("app.routers.operations.publish_display", new=AsyncMock()),
            patch("app.routers.operations._attach_connection_status", new=AsyncMock()),
        ):
            result = asyncio.run(operations.bulk_update_displays(body, owner_identity(), db))

        self.assertEqual([row.id for row in result], ["display-a"])
        self.assertIsNone(target.assigned_activity_id)
        self.assertIsNone(target.assigned_session_id)
        self.assertIsNone(target.assigned_workflow_run_id)
        validate_activity.assert_awaited_once_with(None, "event-a", "org-a", db)
        validate_session.assert_awaited_once_with(None, "event-a", "org-a", db)

    def test_omitted_assignment_fields_preserve_existing_routing(self):
        target = display("display-a", workflow=None)
        db = BulkDisplayDb([target])
        body = BulkDisplayUpdate(display_ids=["display-a"], scene="join")
        with (
            patch("app.routers.operations._validate_assigned_activity", new=AsyncMock()) as validate_activity,
            patch("app.routers.operations.publish_display", new=AsyncMock()),
            patch("app.routers.operations._attach_connection_status", new=AsyncMock()),
        ):
            asyncio.run(operations.bulk_update_displays(body, owner_identity(), db))

        self.assertEqual(target.assigned_activity_id, "activity-old")
        self.assertEqual(target.assigned_session_id, "session-old")
        self.assertEqual(target.scene, "join")
        validate_activity.assert_awaited_once_with(None, "event-a", "org-a", db)


if __name__ == "__main__":
    unittest.main()
