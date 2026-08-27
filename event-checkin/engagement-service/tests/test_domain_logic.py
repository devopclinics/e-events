import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.auth import Identity, require_activity_session, require_admin, require_capability, require_staff
from app.config import settings
from app.moderation import flag_public_text
from app.realtime import mint_realtime_ticket, publish, verify_realtime_ticket
from app.routers.operations import _csv_safe
from app.routers.participate import _leaderboard_name, _load_activity, _participant_locator, _rule_matches, _survey_completion_summary
from app.scoring import score_choice_response
from app.wordcloud import word_cloud


class ScoringTests(unittest.TestCase):
    def test_fixed_points_are_exact_and_deterministic(self):
        self.assertEqual(score_choice_response(["a"], ["a"], points=250), (250, True))
        self.assertEqual(score_choice_response(["b"], ["a"], points=250), (0, False))

    def test_time_weighted_has_a_fifty_percent_floor(self):
        self.assertEqual(score_choice_response(["a"], ["a"], points=100, strategy="time_weighted", response_time_ms=0, time_limit_seconds=20), (100, True))
        self.assertEqual(score_choice_response(["a"], ["a"], points=100, strategy="time_weighted", response_time_ms=20_000, time_limit_seconds=20), (50, True))

    def test_partial_points_penalize_guessing(self):
        self.assertEqual(score_choice_response(["a"], ["a", "b"], points=100, strategy="partial"), (50, False))
        self.assertEqual(score_choice_response(["a", "x"], ["a", "b"], points=100, strategy="partial"), (0, False))


class BranchingAndModerationTests(unittest.TestCase):
    def test_every_documented_branch_operator(self):
        self.assertTrue(_rule_matches("equals", 4, 4))
        self.assertTrue(_rule_matches("not_equals", 4, 3))
        self.assertTrue(_rule_matches("greater_than", 4, 3))
        self.assertTrue(_rule_matches("less_than", 3, 4))
        self.assertTrue(_rule_matches("contains", "Festio Live", "Live"))
        self.assertTrue(_rule_matches("answered", "yes", None))
        self.assertTrue(_rule_matches("not_answered", None, None))

    def test_public_text_filter_flags_profanity_and_links_without_rewriting(self):
        self.assertEqual(flag_public_text("A thoughtful response"), (False, None))
        self.assertTrue(flag_public_text("visit https://spam.test")[0])
        self.assertTrue(flag_public_text("this is shit")[0])

    def test_word_cloud_normalizes_case_and_stop_words(self):
        self.assertEqual(word_cloud(["Connected connected THE", "connected creative"])[0], {"word": "connected", "count": 3})


class FailureIsolationTests(unittest.TestCase):
    def test_redis_publish_failure_never_fails_durable_request_path(self):
        with patch("app.realtime.redis.publish", new=AsyncMock(side_effect=ConnectionError("redis down"))):
            asyncio.run(publish("activity", "response.submitted", {"question_id": "q"}))

    def test_csv_cells_cannot_execute_spreadsheet_formulas(self):
        self.assertEqual(_csv_safe("=HYPERLINK('bad')"), "'=HYPERLINK('bad')")
        self.assertEqual(_csv_safe("ordinary answer"), "ordinary answer")


class SurveyDisplaySummaryTests(unittest.TestCase):
    def test_completion_uses_final_submission_and_real_elapsed_time(self):
        from datetime import datetime, timedelta, timezone

        joined = datetime(2026, 8, 26, 12, 0, tzinfo=timezone.utc)
        participants = [
            type("Participant", (), {"joined_at": joined, "completed_at": joined + timedelta(seconds=120)})(),
            type("Participant", (), {"joined_at": joined, "completed_at": joined + timedelta(seconds=180)})(),
            type("Participant", (), {"joined_at": joined, "completed_at": None})(),
        ]

        self.assertEqual(_survey_completion_summary(participants, participant_count=3, answer_count=42), {
            "participant_count": 3,
            "completed_count": 2,
            "completion_rate": 67,
            "avg_completion_seconds": 150.0,
            "answer_count": 42,
        })


class AuthorizationAndPrivacyTests(unittest.TestCase):
    @staticmethod
    def identity(role, capabilities=()):
        return Identity(identity_kind="staff", subject=role, event_id="event-a", org_id="org-a", role=role, capabilities=capabilities)

    def test_owner_and_admin_have_full_event_administration(self):
        for role in ("owner", "admin"):
            self.assertEqual(require_admin(self.identity(role)).role, role)

    def test_presenter_can_control_but_not_administer_or_moderate(self):
        presenter = self.identity("presenter", ("control",))
        self.assertEqual(require_capability(presenter, "control"), presenter)
        for check in (lambda: require_admin(presenter), lambda: require_capability(presenter, "moderate")):
            with self.assertRaises(HTTPException) as raised:
                check()
            self.assertEqual(raised.exception.status_code, 403)

    def test_moderator_can_moderate_but_not_control_or_administer(self):
        moderator = self.identity("moderator", ("moderate",))
        self.assertEqual(require_capability(moderator, "moderate"), moderator)
        for check in (lambda: require_admin(moderator), lambda: require_capability(moderator, "control")):
            with self.assertRaises(HTTPException) as raised:
                check()
            self.assertEqual(raised.exception.status_code, 403)

    def test_analyst_and_viewer_are_read_only(self):
        for role in ("analyst", "viewer"):
            identity = self.identity(role)
            self.assertEqual(require_staff(identity), identity)
            for check in (lambda: require_admin(identity), lambda: require_capability(identity, "control"), lambda: require_capability(identity, "moderate")):
                with self.assertRaises(HTTPException) as raised:
                    check()
                self.assertEqual(raised.exception.status_code, 403)

    def test_anonymous_leaderboard_alias_is_stable_and_private(self):
        alias = _leaderboard_name("activity-a", "participant-a", "Amina Yusuf", "first_last_initial", True)
        self.assertEqual(alias, _leaderboard_name("activity-a", "participant-a", "Different Name", "first_name", True))
        self.assertTrue(alias.startswith("Guest "))
        self.assertNotIn("Amina", alias)
        self.assertEqual(_leaderboard_name("a", "p", "Amina Yusuf", "first_last_initial", False), "Amina Y.")

    def test_realtime_ticket_cannot_cross_activity_boundary(self):
        with patch.object(settings, "internal_service_token", "qa-realtime-secret-at-least-32-bytes"):
            ticket = mint_realtime_ticket("activity-a", "guest-a", minutes=1)
            verify_realtime_ticket(ticket, "activity-a")
            with self.assertRaises(ValueError):
                verify_realtime_ticket(ticket, "activity-b")

    def test_activity_lookup_rejects_cross_event_and_cross_organization_ids(self):
        class Db:
            async def scalar(self, _statement):
                return type("Activity", (), {"event_id": "event-b", "org_id": "org-b"})()

        for event_id, org_id in (("event-a", "org-b"), ("event-b", "org-a")):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(_load_activity("guessed-id", event_id, org_id, Db()))
            self.assertEqual(raised.exception.status_code, 404)

    def test_identified_guest_is_limited_to_their_program_sessions(self):
        guest = Identity(
            identity_kind="guest", subject="guest-a", event_id="event-a", org_id="org-a",
            role="guest", allowed_session_ids=("session-a",), session_scope_enforced=True,
        )
        require_activity_session(guest, "session-a", {"eligibility": "session"})
        with self.assertRaises(HTTPException) as raised:
            require_activity_session(guest, "session-b", {"eligibility": "session"})
        self.assertEqual(raised.exception.status_code, 403)

    def test_broadcast_guest_can_join_event_wide_and_session_activities(self):
        guest = Identity(
            identity_kind="guest", subject="anon-a", event_id="event-a", org_id="org-a",
            role="guest", is_anonymous=True, session_scope_enforced=True,
        )
        require_activity_session(guest, "session-not-in-a-personal-program", {"eligibility": "event"})

    def test_checked_in_activity_rejects_guest_not_admitted(self):
        guest = Identity(identity_kind="guest", subject="guest-a", event_id="event-a", org_id="org-a", role="guest")
        with self.assertRaises(HTTPException) as raised:
            require_activity_session(guest, None, {"eligibility": "checked_in"})
        self.assertEqual(raised.exception.status_code, 403)

    def test_anonymous_activity_uses_same_private_participant_locator_for_reads_and_writes(self):
        guest = Identity(identity_kind="guest", subject="guest-a", event_id="event-a", org_id="org-a", role="guest")
        with patch.object(settings, "internal_service_token", "qa-private-participant-secret"):
            column, subject = _participant_locator("activity-a", guest, truly_anonymous=True)
            self.assertEqual(column.key, "anon_id")
            self.assertNotEqual(subject, guest.subject)
            self.assertEqual(subject, _participant_locator("activity-a", guest, truly_anonymous=True)[1])


if __name__ == "__main__":
    unittest.main()
