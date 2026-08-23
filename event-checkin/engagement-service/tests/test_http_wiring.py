"""Basic wiring tests: health endpoint, and that every activity/participate
route actually requires authentication (no accidental unauthenticated route)."""
import unittest

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class HealthTests(unittest.TestCase):
    def test_health(self):
        resp = client.get("/health")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["service"], "engagement-service")

    def test_health_live(self):
        self.assertEqual(client.get("/health/live").status_code, 200)


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

    def test_status_requires_auth(self):
        self.assertEqual(client.post("/api/engagement/v1/activities/x/status", json={"status": "live"}).status_code, 401)

    def test_realtime_ticket_requires_auth(self):
        self.assertEqual(client.get("/api/engagement/v1/activities/x/realtime-ticket").status_code, 401)

    # The TV/projector display endpoints (unauthenticated except by their own
    # display_token) touch the database on every call, unlike everything else
    # in this file -- there's no test DB fixture here, so that "wrong token
    # -> 404, not 401" behavior is instead verified live against staging
    # (see the E2E pass this was built and checked in).


if __name__ == "__main__":
    unittest.main()
