import asyncio
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.auth import Identity, require_activity_session, require_admin, require_capability, require_staff
from app.config import settings
from app.moderation import flag_public_text
from app.realtime import claim_display, mint_realtime_ticket, publish, renew_display, verify_realtime_ticket
from app.routers.operations import _apply_results_view, _csv_safe, _rehearsal_payload, _take_manual_display_control
from app.routers.activities import _apply_guided_advance, _guided_next_phase, _guided_phase_deadline
from app.routers.participate import _leaderboard_name, _load_activity, _participant_locator, _rule_matches, _survey_completion_summary
from app.scoring import score_choice_response
from app.wordcloud import word_cloud
from app.routers.workflows import (
    _big_number_data, _mint_preview_token, _step_data, _step_payload,
    create_run, export_workflow_pptx, preview_step,
)
from app.workflow_schemas import RunCommand, RunCreate, StepCreate


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

    def test_first_projector_owns_display_lease(self):
        with patch("app.realtime.redis.set", new=AsyncMock(return_value=True)) as set_value:
            self.assertTrue(asyncio.run(claim_display("display-a", "projector-client-0001")))
        set_value.assert_awaited_once()

    def test_second_projector_cannot_take_display_lease(self):
        with patch("app.realtime.redis.set", new=AsyncMock(return_value=False)), \
             patch("app.realtime.redis.get", new=AsyncMock(return_value="projector-client-0001")):
            self.assertFalse(asyncio.run(claim_display("display-a", "projector-client-0002")))

    def test_disconnected_stream_cannot_reclaim_released_lease(self):
        with patch("app.realtime.redis.eval", new=AsyncMock(return_value=0)) as renew:
            self.assertFalse(asyncio.run(renew_display("display-a", "projector-client-0001")))
        renew.assert_awaited_once()


class ExperienceWorkflowSafetyTests(unittest.TestCase):
    def test_display_rejects_a_second_active_workflow_channel(self):
        class Db:
            def __init__(self):
                self.rows = iter((
                    SimpleNamespace(id="display-a", event_id="event-a", org_id="org-a"),
                    SimpleNamespace(id="run-other"),
                ))

            async def scalar(self, _statement):
                return next(self.rows)

        identity = Identity(
            identity_kind="staff", subject="presenter-a", event_id="event-a", org_id="org-a",
            role="presenter", capabilities=("control",),
        )
        workflow = SimpleNamespace(
            id="workflow-a", event_id="event-a", org_id="org-a", current_revision_id="revision-a",
        )
        with patch.object(settings, "experience_workflows_enabled", True), \
             patch("app.routers.workflows._workflow", new=AsyncMock(return_value=workflow)):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(create_run("workflow-a", RunCreate(display_id="display-a"), identity, Db()))
        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("already assigned", raised.exception.detail)

    def test_manual_scene_or_activity_selection_detaches_workflow(self):
        for field in ("scene", "assigned_activity_id"):
            display = type("Display", (), {"assigned_workflow_run_id": "run-a"})()
            _take_manual_display_control(display, {field})
            self.assertIsNone(display.assigned_workflow_run_id)

        display = type("Display", (), {"assigned_workflow_run_id": "run-a"})()
        _take_manual_display_control(display, {"name"})
        self.assertEqual(display.assigned_workflow_run_id, "run-a")

    def test_interactive_steps_must_reference_existing_activity_engine(self):
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            StepCreate(step_type="poll", title="Audience poll")

    def test_auto_advance_requires_authoritative_duration(self):
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            StepCreate(step_type="hero", title="Opening", auto_advance=True)

    def test_presenter_notes_never_enter_public_scene_payload(self):
        step = type("Step", (), {
            "id": "step-a", "sequence": 0, "step_type": "hero", "title": "Opening",
            "subtitle": None, "config": {}, "linked_activity_id": None,
            "linked_question_id": None, "duration_seconds": 30, "auto_advance": False,
            "presenter_notes": "Private cue", "status": "active",
        })()
        self.assertNotIn("presenter_notes", _step_payload(step, presenter=False))
        self.assertEqual(_step_payload(step, presenter=True)["presenter_notes"], "Private cue")

    def test_run_commands_require_version_and_idempotency_key(self):
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            RunCommand(action="next", expected_version=0, idempotency_key="short")

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


class ResultsOnlyDisplayTests(unittest.TestCase):
    @staticmethod
    def payload():
        return {
            "activity_id": "activity-a", "participant_count": 10, "response_count": 20,
            "activity_summary": {"question_count": 2, "participant_count": 10, "response_count": 20, "response_rate": 100},
            "questions": [
                {"question_id": "q1", "question_type": "single_choice", "prompt": "First", "response_count": 10, "option_labels": {"a": "A", "b": "B"}, "option_counts": {}},
                {"question_id": "q2", "question_type": "word_cloud", "prompt": "Second", "response_count": 10, "option_labels": {}, "word_cloud": []},
            ],
        }

    def test_result_selection_is_ordered_and_recalculates_summary(self):
        viewed = _apply_results_view(self.payload(), {"results_mode": "all", "results_question_ids": ["q2"]})
        self.assertEqual([question["question_id"] for question in viewed["questions"]], ["q2"])
        self.assertEqual(viewed["activity_summary"]["question_count"], 1)
        self.assertEqual(viewed["activity_summary"]["response_count"], 10)

    def test_rehearsal_is_a_pure_display_snapshot(self):
        source = self.payload()
        rehearsed = _rehearsal_payload(source, 10)
        self.assertEqual(source["questions"][0]["option_counts"], {})
        self.assertEqual(rehearsed["participant_count"], 10)
        self.assertEqual(rehearsed["response_count"], 20)
        self.assertEqual(sum(rehearsed["questions"][0]["option_counts"].values()), 10)
        self.assertTrue(rehearsed["questions"][1]["word_cloud"])
        self.assertTrue(rehearsed["display_config"]["rehearsal_mode"])


class GuidedShowPhaseTests(unittest.TestCase):
    @staticmethod
    def activity(activity_type="quiz", phase="lobby", current_id=None, questions=None, leaderboard=False):
        return type("Activity", (), {
            "type": activity_type,
            "config": {"show_phase": phase, "current_question_id": current_id, "leaderboard_enabled": leaderboard},
            "questions": questions or [],
        })()

    @staticmethod
    def question(question_id, sequence=0, correct=False):
        option = type("Option", (), {"is_correct": correct})()
        return type("Question", (), {
            "id": question_id, "sequence": sequence, "status": "active", "options": [option],
            "live_state": "pending", "config": {}, "time_limit_seconds": None,
        })()

    def test_quiz_preview_voting_lock_reveal_results_sequence(self):
        question = self.question("q1", correct=True)
        activity = self.activity(phase="intro", questions=[question])
        self.assertEqual(_guided_next_phase(activity), "question_preview")
        activity.config.update(show_phase="question_preview", current_question_id="q1")
        self.assertEqual(_guided_next_phase(activity), "answering")
        activity.config["show_phase"] = "answering"
        self.assertEqual(_guided_next_phase(activity), "locked")
        activity.config["show_phase"] = "locked"
        self.assertEqual(_guided_next_phase(activity), "reveal")
        activity.config["show_phase"] = "reveal"
        self.assertEqual(_guided_next_phase(activity), "results")

    def test_quiz_results_move_to_leaderboard_then_next_question(self):
        questions = [self.question("q1", 0), self.question("q2", 1)]
        activity = self.activity(phase="results", current_id="q1", questions=questions, leaderboard=True)
        self.assertEqual(_guided_next_phase(activity), "leaderboard")
        activity.config["show_phase"] = "leaderboard"
        self.assertEqual(_guided_next_phase(activity), "question_preview")

    def test_survey_has_one_controlled_answering_window(self):
        activity = self.activity(activity_type="survey", phase="intro")
        self.assertEqual(_guided_next_phase(activity), "answering")
        activity.config["show_phase"] = "answering"
        self.assertEqual(_guided_next_phase(activity), "locked")
        activity.config["show_phase"] = "locked"
        self.assertEqual(_guided_next_phase(activity), "results")

    def test_automated_word_cloud_runs_every_question_and_sets_deadlines(self):
        questions = [self.question("q1", 0), self.question("q2", 1)]
        activity = self.activity(activity_type="word_cloud", phase="intro", questions=questions)
        activity.status = "live"
        activity.config.update(show_mode="guided", show_automation_enabled=True, show_automation_timings={
            "lobby": 10, "intro": 8, "question_preview": 5, "answering": 45,
            "locked": 3, "reveal": 6, "results": 10, "leaderboard": 8,
        })
        now = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)

        phase, current = _apply_guided_advance(activity, now)
        self.assertEqual((phase, current.id), ("question_preview", "q1"))
        self.assertTrue(activity.config["show_phase_deadline_at"].endswith("12:00:05+00:00"))
        phase, current = _apply_guided_advance(activity, now)
        self.assertEqual((phase, current.live_state), ("answering", "open"))
        self.assertTrue(activity.config["show_phase_deadline_at"].endswith("12:00:45+00:00"))
        _apply_guided_advance(activity, now)  # locked
        phase, _ = _apply_guided_advance(activity, now)  # results
        self.assertEqual(phase, "results")
        phase, current = _apply_guided_advance(activity, now)
        self.assertEqual((phase, current.id), ("question_preview", "q2"))

    def test_question_timer_overrides_activity_answering_duration(self):
        question = self.question("q1")
        question.time_limit_seconds = 17
        activity = self.activity(activity_type="quiz", phase="answering", current_id="q1", questions=[question])
        activity.config.update(show_automation_enabled=True, show_automation_timings={"answering": 90})
        deadline = _guided_phase_deadline(activity, "answering", datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc), question)
        self.assertTrue(deadline.endswith("12:00:17+00:00"))


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


class BigNumberDataTests(unittest.TestCase):
    def test_combines_multiple_options_into_one_percentage_using_the_questions_own_denominator(self):
        step = SimpleNamespace(config={"metrics": [
            {"question_id": "q1", "option_labels": ["Yes — several people", "Yes — one person"], "label": "have someone to talk to"},
        ]})

        class Db:
            def __init__(self):
                self._call = 0

            async def execute(self, _statement):
                self._call += 1
                if self._call == 1:
                    options = [
                        SimpleNamespace(id="opt-several", label="Yes — several people"),
                        SimpleNamespace(id="opt-one", label="Yes — one person"),
                        SimpleNamespace(id="opt-not-really", label="Not really"),
                    ]
                    return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: options))
                if self._call == 2:
                    rows = [("q1", "opt-several"), ("q1", "opt-several"), ("q1", "opt-one"), ("q1", "opt-not-really")]
                    return SimpleNamespace(all=lambda: rows)
                return SimpleNamespace(all=lambda: [("q1", 4)])

        result = asyncio.run(_big_number_data(step, Db()))
        self.assertEqual(result["metrics"][0]["value"], "75%")
        self.assertEqual(result["metrics"][0]["response_count"], 4)
        self.assertEqual(result["metrics"][0]["label"], "have someone to talk to")

    def test_returns_none_when_no_metric_has_a_bound_question(self):
        step = SimpleNamespace(config={"metrics": [{"label": "orphaned config, never resolved at import time"}]})
        self.assertIsNone(asyncio.run(_big_number_data(step, object())))

    def test_zero_responses_reports_zero_percent_instead_of_dividing_by_zero(self):
        step = SimpleNamespace(config={"metrics": [{"question_id": "q1", "option_labels": ["Yes"], "label": "x"}]})

        class Db:
            async def execute(self, _statement):
                return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []), all=lambda: [])

        result = asyncio.run(_big_number_data(step, Db()))
        self.assertEqual(result["metrics"][0]["value"], "0%")
        self.assertEqual(result["metrics"][0]["response_count"], 0)


class StepDataDispatchTests(unittest.TestCase):
    """_step_data backs both the live run payload and the PPTX exporter's
    step-preview route -- these pin the dispatch so the two can never see
    different data for the same step."""

    def test_comparison_steps_use_the_comparison_helper(self):
        step = SimpleNamespace(step_type="comparison", linked_activity_id=None)
        with patch("app.routers.workflows._comparison_data", new=AsyncMock(return_value={"rows": []})) as mocked:
            result = asyncio.run(_step_data(step, object()))
        mocked.assert_awaited_once()
        self.assertEqual(result, {"rows": []})

    def test_big_number_steps_use_the_big_number_helper(self):
        step = SimpleNamespace(step_type="big_number", linked_activity_id=None)
        with patch("app.routers.workflows._big_number_data", new=AsyncMock(return_value={"metrics": []})):
            result = asyncio.run(_step_data(step, object()))
        self.assertEqual(result, {"metrics": []})

    def test_steps_linked_to_an_activity_fall_back_to_the_generic_scene_helper(self):
        step = SimpleNamespace(step_type="poll", linked_activity_id="activity-a")
        with patch("app.routers.workflows._activity_scene_data", new=AsyncMock(return_value={"results": []})):
            result = asyncio.run(_step_data(step, object()))
        self.assertEqual(result, {"results": []})

    def test_unlinked_non_special_steps_have_no_data(self):
        step = SimpleNamespace(step_type="hero", linked_activity_id=None)
        self.assertIsNone(asyncio.run(_step_data(step, object())))


class WorkflowPreviewAndExportTests(unittest.TestCase):
    """The step-preview route and the PPTX exporter are deliberately built on
    top of the published revision only, and never create or touch a
    WorkflowRun/LiveDisplay -- generating a deck (or previewing a step) must
    never be able to interfere with an actively-presenting run."""

    def _identity(self):
        return Identity(
            identity_kind="staff", subject="presenter-a", event_id="event-a", org_id="org-a",
            role="presenter", capabilities=("control",),
        )

    def _fake_request(self):
        return SimpleNamespace(headers=SimpleNamespace(get=lambda *_a: ""), client=SimpleNamespace(host="test"))

    def test_preview_requires_a_published_revision(self):
        workflow = SimpleNamespace(id="workflow-a", event_id="event-a", org_id="org-a", current_revision_id=None)
        with patch.object(settings, "experience_workflows_enabled", True), \
             patch("app.routers.workflows._workflow", new=AsyncMock(return_value=workflow)):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(preview_step("workflow-a", "step-a", self._identity(), object()))
        self.assertEqual(raised.exception.status_code, 422)

    def test_preview_404s_for_a_step_outside_the_published_revision(self):
        workflow = SimpleNamespace(id="workflow-a", event_id="event-a", org_id="org-a", current_revision_id="revision-a")

        class Db:
            async def scalar(self, _statement):
                return None

        with patch.object(settings, "experience_workflows_enabled", True), \
             patch("app.routers.workflows._workflow", new=AsyncMock(return_value=workflow)):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(preview_step("workflow-a", "step-not-in-revision", self._identity(), Db()))
        self.assertEqual(raised.exception.status_code, 404)

    def test_preview_carries_presenter_notes_for_this_staff_only_route(self):
        # Unlike the guest-facing public run payload, this route is staff-only
        # (require_capability "control"), so presenter_notes are expected here
        # -- pinned so it isn't "fixed" later by copying the public-payload pattern.
        workflow = SimpleNamespace(id="workflow-a", event_id="event-a", org_id="org-a", current_revision_id="revision-a")
        step = SimpleNamespace(
            id="step-a", sequence=0, step_type="hero", title="Opening", subtitle=None,
            config={}, linked_activity_id=None, linked_question_id=None,
            duration_seconds=None, auto_advance=False, presenter_notes="Private cue", status="active",
        )
        revision = SimpleNamespace(theme={"preset": "legacy_cinematic"})

        class Db:
            async def scalar(self, _statement):
                return step

            async def get(self, _model, _id):
                return revision

        with patch.object(settings, "experience_workflows_enabled", True), \
             patch("app.routers.workflows._workflow", new=AsyncMock(return_value=workflow)), \
             patch("app.routers.workflows._step_data", new=AsyncMock(return_value=None)):
            payload = asyncio.run(preview_step("workflow-a", "step-a", self._identity(), Db()))
        self.assertEqual(payload["presenter_notes"], "Private cue")
        self.assertEqual(payload["theme"], {"preset": "legacy_cinematic"})

    def test_export_requires_a_published_revision(self):
        workflow = SimpleNamespace(id="workflow-a", event_id="event-a", org_id="org-a", current_revision_id=None, name="Draft")
        with patch.object(settings, "experience_workflows_enabled", True), \
             patch("app.routers.workflows.enforce_rate_limit", new=AsyncMock()), \
             patch("app.routers.workflows._workflow", new=AsyncMock(return_value=workflow)):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(export_workflow_pptx("workflow-a", self._fake_request(), self._identity(), object()))
        self.assertEqual(raised.exception.status_code, 422)

    def test_export_rejects_a_published_workflow_with_no_active_steps(self):
        workflow = SimpleNamespace(id="workflow-a", event_id="event-a", org_id="org-a", current_revision_id="revision-a", name="Empty")

        class Db:
            async def execute(self, _statement):
                return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))

        with patch.object(settings, "experience_workflows_enabled", True), \
             patch("app.routers.workflows.enforce_rate_limit", new=AsyncMock()), \
             patch("app.routers.workflows._workflow", new=AsyncMock(return_value=workflow)):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(export_workflow_pptx("workflow-a", self._fake_request(), self._identity(), Db()))
        self.assertEqual(raised.exception.status_code, 422)

    def test_export_never_launches_a_browser_for_an_unpublished_workflow(self):
        # render_workflow_pptx is what actually launches Chromium; a guard
        # clause failing must return before it's ever called.
        workflow = SimpleNamespace(id="workflow-a", event_id="event-a", org_id="org-a", current_revision_id=None, name="Draft")
        with patch.object(settings, "experience_workflows_enabled", True), \
             patch("app.routers.workflows.enforce_rate_limit", new=AsyncMock()), \
             patch("app.routers.workflows._workflow", new=AsyncMock(return_value=workflow)), \
             patch("app.routers.workflows.render_workflow_pptx", new=AsyncMock()) as mocked_render:
            with self.assertRaises(HTTPException):
                asyncio.run(export_workflow_pptx("workflow-a", self._fake_request(), self._identity(), object()))
        mocked_render.assert_not_awaited()

    def test_export_is_rate_limited_per_staff_member_per_workflow(self):
        workflow = SimpleNamespace(id="workflow-a", event_id="event-a", org_id="org-a", current_revision_id=None, name="Draft")
        with patch.object(settings, "experience_workflows_enabled", True), \
             patch("app.routers.workflows.enforce_rate_limit", new=AsyncMock(side_effect=HTTPException(429, "Too many requests — please wait a moment"))) as mocked_limit, \
             patch("app.routers.workflows._workflow", new=AsyncMock(return_value=workflow)):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(export_workflow_pptx("workflow-a", self._fake_request(), self._identity(), object()))
        self.assertEqual(raised.exception.status_code, 429)
        mocked_limit.assert_awaited_once()
        self.assertEqual(mocked_limit.await_args.args[1], "export_pptx")

    def test_export_returns_the_rendered_deck_as_a_pptx_attachment(self):
        workflow = SimpleNamespace(
            id="workflow-a", event_id="event-a", org_id="org-a", current_revision_id="revision-a",
            name="MBF Summit 2026 — Better Together",
        )
        step = SimpleNamespace(id="step-a", sequence=0)

        class Db:
            async def execute(self, _statement):
                return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [step]))

        with patch.object(settings, "experience_workflows_enabled", True), \
             patch.object(settings, "internal_service_token", "qa-export-attachment-secret-at-least-32-bytes"), \
             patch("app.routers.workflows.enforce_rate_limit", new=AsyncMock()), \
             patch("app.routers.workflows._workflow", new=AsyncMock(return_value=workflow)), \
             patch("app.routers.workflows.render_workflow_pptx", new=AsyncMock(return_value=b"fake-pptx-bytes")):
            response = asyncio.run(export_workflow_pptx("workflow-a", self._fake_request(), self._identity(), Db()))
        self.assertEqual(response.body, b"fake-pptx-bytes")
        self.assertEqual(response.media_type, "application/vnd.openxmlformats-officedocument.presentationml.presentation")
        self.assertIn("MBF_Summit_2026", response.headers["content-disposition"])

    def test_preview_token_is_scoped_to_the_calling_staff_members_own_event_and_org(self):
        import jwt as pyjwt
        identity = Identity(identity_kind="staff", subject="presenter-a", event_id="event-a", org_id="org-a", role="presenter")
        with patch.object(settings, "internal_service_token", "qa-preview-token-secret-at-least-32-bytes"):
            token = _mint_preview_token(identity)
            claims = pyjwt.decode(
                token, "qa-preview-token-secret-at-least-32-bytes",
                algorithms=["HS256"], audience="engagement", issuer="guesthub",
            )
        self.assertEqual(claims["event_id"], "event-a")
        self.assertEqual(claims["org_id"], "org-a")
        self.assertEqual(claims["identity_kind"], "staff")
        self.assertTrue(claims["sub"].startswith("pptx-export:"))


if __name__ == "__main__":
    unittest.main()
