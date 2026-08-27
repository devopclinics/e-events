"""Basic wiring tests: health endpoint, and that every activity/participate
route actually requires authentication (no accidental unauthenticated route)."""
import unittest
from types import SimpleNamespace
from pydantic import ValidationError

from fastapi.testclient import TestClient

from app.main import app
from app.auth import Identity, current_identity
from app.database import get_db
from app.routers.activities import VALID_STATUS_TRANSITIONS
from app.schemas import DisplayControlUpdate, DisplayCreate, DisplayResultsControlIn, QuestionLiveStateIn, RespondIn

client = TestClient(app)


class _QuestionDeleteDb:
    def __init__(self, response_count, status="active"):
        self.question = SimpleNamespace(
            id="question-a", status=status, options=[],
            activity=SimpleNamespace(event_id="event-a", org_id="org-a"),
        )
        self._values = iter((self.question, response_count))
        self.deleted = []
        self.commits = 0

    async def scalar(self, _statement):
        return next(self._values)

    async def delete(self, value):
        self.deleted.append(value)

    async def commit(self):
        self.commits += 1


class _PublicDisplayDb:
    async def scalar(self, _statement):
        return SimpleNamespace(
            id="display-a", event_id="event-a", org_id="org-a", name="Lobby", scene="join",
            settings={}, assigned_session_id=None, assigned_activity_id=None,
        )

    async def execute(self, _statement):
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))


def _admin_identity():
    return Identity(identity_kind="staff", subject="owner-a", event_id="event-a", org_id="org-a", role="owner")


class HealthTests(unittest.TestCase):
    def test_health(self):
        resp = client.get("/health")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["service"], "engagement-service")

    def test_health_live(self):
        self.assertEqual(client.get("/health/live").status_code, 200)

    def test_metrics(self):
        resp = client.get("/metrics")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("engagement_http_requests_total", resp.text)


class AuthRequiredTests(unittest.TestCase):
    def test_activities_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/activities").status_code, 401)

    def test_question_bank_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/question-bank").status_code, 401)

    def test_participate_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/activities/x/participate").status_code, 401)

    def test_respond_requires_auth(self):
        resp = client.post("/api/engagement/v1/activities/x/respond", json={"question_id": "q", "idempotency_key": "k"})
        self.assertEqual(resp.status_code, 401)

    def test_complete_requires_auth(self):
        self.assertEqual(client.post("/api/engagement/v1/activities/x/complete").status_code, 401)

    def test_live_activities_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/activities/live").status_code, 401)

    def test_leaderboard_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/activities/x/leaderboard").status_code, 401)

    def test_qna_list_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/activities/x/qna").status_code, 401)

    def test_qna_submit_requires_auth(self):
        self.assertEqual(client.post("/api/engagement/v1/activities/x/qna", json={"text": "hi"}).status_code, 401)

    def test_word_cloud_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/questions/x/word-cloud").status_code, 401)

    def test_ai_analysis_requires_auth(self):
        self.assertEqual(client.post("/api/engagement/v1/questions/x/ai-analysis").status_code, 401)

    def test_advance_requires_auth(self):
        self.assertEqual(client.post("/api/engagement/v1/activities/x/advance", json={}).status_code, 401)

    def test_guided_show_controls_require_auth(self):
        self.assertEqual(client.post("/api/engagement/v1/activities/x/show/start").status_code, 401)
        self.assertEqual(client.post("/api/engagement/v1/activities/x/show/advance").status_code, 401)
        self.assertEqual(client.put("/api/engagement/v1/activities/x/show/automation", json={"enabled": True}).status_code, 401)

    def test_status_requires_auth(self):
        self.assertEqual(client.post("/api/engagement/v1/activities/x/status", json={"status": "live"}).status_code, 401)

    def test_question_live_state_requires_auth(self):
        self.assertEqual(client.post("/api/engagement/v1/questions/x/live-state", json={"state": "open"}).status_code, 401)

    def test_displays_require_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/displays").status_code, 401)

    def test_program_sessions_require_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/program-sessions").status_code, 401)

    def test_guest_program_participation_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/my-program-participation").status_code, 401)

    def test_program_sync_rejects_invalid_internal_token(self):
        body = {
            "delivery_id": "delivery-a", "event_type": "experience.program_session.upsert",
            "occurred_at": "2026-08-24T12:00:00Z", "org_id": "org-a", "event_id": "event-a",
            "source_id": "step-a", "source_version": 1,
            "data": {"source_step_id": "step-a"},
        }
        self.assertEqual(client.post("/api/engagement/internal/v1/program-events", headers={"X-Internal-Token": "wrong"}, json=body).status_code, 401)

    def test_presenter_display_controls_require_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/control/displays").status_code, 401)
        self.assertEqual(client.patch("/api/engagement/v1/control/displays/x", json={"scene": "welcome"}).status_code, 401)
        self.assertEqual(client.put("/api/engagement/v1/control/displays/x/results", json={"activity_id": "a"}).status_code, 401)
        self.assertEqual(client.put("/api/engagement/v1/control/displays/x/rehearsal", json={"activity_id": "a"}).status_code, 401)

    def test_rules_require_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/activities/x/rules").status_code, 401)

    def test_exports_require_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/activities/x/export.csv").status_code, 401)
        self.assertEqual(client.get("/api/engagement/v1/analytics/export.csv").status_code, 401)
        self.assertEqual(client.get("/api/engagement/v1/activities/x/responses").status_code, 401)

    def test_moderation_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/activities/x/moderation").status_code, 401)
        self.assertEqual(client.patch("/api/engagement/v1/moderation/x", json={"status": "approved"}).status_code, 401)

    def test_question_bank_import_requires_auth(self):
        body = {"items": [{"question_type": "short_text", "prompt": "Imported question"}]}
        self.assertEqual(client.post("/api/engagement/v1/question-bank/import", json=body).status_code, 401)

    def test_analysis_status_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/analysis/x").status_code, 401)

    def test_realtime_ticket_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/activities/x/realtime-ticket").status_code, 401)

    # The TV/projector display endpoints (unauthenticated except by their own
    # display_token) touch the database on every call, unlike everything else
    # in this file -- there's no test DB fixture here, so that "wrong token
    # -> 404, not 401" behavior is instead verified live against staging
    # (see the E2E pass this was built and checked in).


class DomainSafetyTests(unittest.TestCase):
    def test_activity_status_machine_does_not_skip_live_flow(self):
        self.assertNotIn("completed", VALID_STATUS_TRANSITIONS["draft"])
        self.assertNotIn("archived", VALID_STATUS_TRANSITIONS["live"])

    def test_question_live_state_rejects_unknown_state(self):
        with self.assertRaises(ValidationError):
            QuestionLiveStateIn(state="revealed_without_moderation")

    def test_response_time_rejects_negative_or_unbounded_values(self):
        with self.assertRaises(ValidationError):
            RespondIn(question_id="q", idempotency_key="k", response_time_ms=-1)
        with self.assertRaises(ValidationError):
            RespondIn(question_id="q", idempotency_key="k", response_time_ms=86_400_001)

    def test_broadcast_contract_supports_every_approved_scene(self):
        scenes = {
            "welcome", "join", "agenda", "question", "responding", "results", "all_results",
            "survey_insights",
            "correct_answer", "leaderboard", "team_battle", "rating", "feedback",
            "word_cloud", "q_and_a", "room_pulse", "ai_insight", "idea_galaxy",
            "live_spectrum", "interactive_quadrant", "image_heatmap", "ranking_race",
            "prediction_reveal", "commitment_wall", "photo_mosaic", "location_map",
            "journey_recap", "spotlight_wheel", "announcement", "break", "countdown",
            "celebration", "custom_message",
        }
        for scene in scenes:
            self.assertEqual(DisplayCreate(name="Main stage", scene=scene).scene, scene)
        self.assertEqual(len(scenes), 33)

    def test_results_control_validates_playback_bounds(self):
        model = DisplayResultsControlIn(activity_id="activity-a", mode="all", question_ids=["q2", "q1"], freeze=True, page_seconds=12)
        self.assertEqual(model.question_ids, ["q2", "q1"])
        with self.assertRaises(ValidationError):
            DisplayResultsControlIn(activity_id="activity-a", page_seconds=2)

    def test_broadcast_settings_validate_themes_and_countdowns(self):
        update = DisplayControlUpdate(scene="room_pulse", settings={"theme": "citrus", "countdown_seconds": 90})
        self.assertEqual(update.settings.theme, "citrus")
        with self.assertRaises(ValidationError):
            DisplayControlUpdate(settings={"theme": "copied-competitor-theme"})
        with self.assertRaises(ValidationError):
            DisplayControlUpdate(settings={"countdown_seconds": 604801})

    def test_public_display_includes_event_id_for_canonical_join_code(self):
        app.dependency_overrides[get_db] = lambda: _PublicDisplayDb()
        try:
            response = client.get("/api/engagement/v1/live/ROOM01?token=display-token")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["event_id"], "event-a")
        finally:
            app.dependency_overrides.pop(get_db, None)


class QuestionDeletionRegressionTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def _delete(self, response_count, status="active"):
        db = _QuestionDeleteDb(response_count, status)
        app.dependency_overrides[current_identity] = _admin_identity
        app.dependency_overrides[get_db] = lambda: db
        return client.delete("/api/engagement/v1/questions/question-a"), db

    def test_delete_unanswered_question(self):
        response, db = self._delete(0)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(db.deleted, [db.question])
        self.assertEqual(db.commits, 1)

    def test_direct_api_delete_answered_question_is_conflict(self):
        response, db = self._delete(12)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {
            "code": "QUESTION_HAS_RESPONSES",
            "message": "This question has participant responses and cannot be deleted.",
        })
        self.assertEqual(db.deleted, [])
        self.assertEqual(db.commits, 0)

    def test_archived_answered_question_keeps_analytics_and_responses(self):
        response, db = self._delete(12, status="archived")
        self.assertEqual(response.status_code, 409)
        # No question/response cascade was initiated: historical result rows
        # remain available to the analytics query path.
        self.assertEqual(db.deleted, [])
        self.assertEqual(db.commits, 0)


if __name__ == "__main__":
    unittest.main()
