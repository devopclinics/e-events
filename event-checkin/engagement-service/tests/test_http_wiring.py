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


if __name__ == "__main__":
    unittest.main()
