"""A display's public /d/ link is a random 16-character token by default.
These tests cover letting an admin set a custom one instead (e.g. "iedpu26"),
mirroring an event's custom self check-in / Giving Hub code."""
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.auth import Identity
from app.routers import operations
from app.schemas import DisplayUpdate


def owner_identity():
    return Identity(
        identity_kind="staff", subject="owner-a", event_id="event-a",
        org_id="org-a", role="owner",
    )


def display(display_id="display-a", short_code="random-token-abc"):
    return SimpleNamespace(
        id=display_id, event_id="event-a", org_id="org-a", name="Lobby",
        scene="welcome", assigned_session_id=None, assigned_activity_id=None,
        assigned_workflow_run_id=None, short_code=short_code, settings={},
    )


class DisplayDb:
    def __init__(self, target, conflict=None):
        self.target = target
        self.conflict = conflict
        self.commits = 0

    async def get(self, _model, display_id):
        return self.target if display_id == self.target.id else None

    async def scalar(self, _statement):
        # Only the short-code uniqueness check calls .scalar() in this path.
        return self.conflict

    async def commit(self):
        self.commits += 1

    async def refresh(self, _row):
        pass


class DisplayShortCodeTests(unittest.TestCase):
    def _patched(self):
        return (
            patch("app.routers.operations.publish_display", new=AsyncMock()),
            patch("app.routers.operations._attach_connection_status", new=AsyncMock()),
        )

    def test_setting_a_custom_short_code_lowercases_and_saves_it(self):
        target = display()
        db = DisplayDb(target, conflict=None)
        body = DisplayUpdate(short_code="IEDPU26")
        p1, p2 = self._patched()
        with p1, p2:
            result = asyncio.run(operations.update_display("display-a", body, owner_identity(), db))
        self.assertEqual(result.short_code, "iedpu26")
        self.assertEqual(db.commits, 1)

    def test_short_code_rejects_invalid_characters(self):
        target = display()
        db = DisplayDb(target, conflict=None)
        body = DisplayUpdate(short_code="iedpu 26!")
        p1, p2 = self._patched()
        with p1, p2, self.assertRaises(HTTPException) as raised:
            asyncio.run(operations.update_display("display-a", body, owner_identity(), db))
        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(target.short_code, "random-token-abc")  # unchanged
        self.assertEqual(db.commits, 0)

    def test_short_code_rejects_when_already_used_by_another_display(self):
        target = display()
        db = DisplayDb(target, conflict="some-other-display-id")
        body = DisplayUpdate(short_code="iedpu26")
        p1, p2 = self._patched()
        with p1, p2, self.assertRaises(HTTPException) as raised:
            asyncio.run(operations.update_display("display-a", body, owner_identity(), db))
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(target.short_code, "random-token-abc")  # unchanged
        self.assertEqual(db.commits, 0)

    def test_short_code_too_short_is_rejected_by_the_schema_itself(self):
        with self.assertRaises(ValidationError):
            DisplayUpdate(short_code="ab")

    def test_omitting_short_code_leaves_it_untouched(self):
        target = display()
        db = DisplayDb(target, conflict=None)
        body = DisplayUpdate(name="Renamed screen")
        p1, p2 = self._patched()
        with p1, p2:
            result = asyncio.run(operations.update_display("display-a", body, owner_identity(), db))
        self.assertEqual(result.short_code, "random-token-abc")
        self.assertEqual(result.name, "Renamed screen")


if __name__ == "__main__":
    unittest.main()
