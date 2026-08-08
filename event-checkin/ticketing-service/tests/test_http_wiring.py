import unittest
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.config import settings


class _Scalars:
    def all(self):
        return []


class _Result:
    def scalars(self):
        return _Scalars()


class _DiscoverySession:
    def __init__(self):
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        return _Result()


class PublicDiscoveryHttpTests(unittest.TestCase):
    def test_marketplace_requires_enabled_and_public_listing(self):
        session = _DiscoverySession()

        async def override_db():
            yield session

        app.dependency_overrides[get_db] = override_db
        previous_enabled = settings.service_enabled
        settings.service_enabled = True
        try:
            client = TestClient(app)
            response = client.get("/api/ticketing/public/events")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"events": []})
            sql = str(session.statement)
            self.assertIn("event_configs.enabled IS true", sql)
            self.assertIn("event_configs.public_listing IS true", sql)
        finally:
            settings.service_enabled = previous_enabled
            app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
