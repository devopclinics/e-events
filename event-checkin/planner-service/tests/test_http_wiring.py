"""HTTP-layer tests: the event-scope (IDOR) guard and the unauthenticated
document-file route's DB-match requirement. Same TestClient +
dependency_override pattern as ticketing-service's test_http_wiring.py."""
import unittest

from fastapi.testclient import TestClient

from app.auth import Identity, current_identity
from app.database import get_db
from app.main import app


class _EmptyResult:
    def scalar_one_or_none(self):
        return None

    def scalars(self):
        class _Scalars:
            def all(self_inner):
                return []
        return _Scalars()


class _FakeSession:
    """Enough of an AsyncSession surface for routes whose event-scope check
    (or, for the file route, its DB lookup) short-circuits before any real
    query result would matter."""
    async def execute(self, *_a, **_k):
        return _EmptyResult()

    async def scalar(self, *_a, **_k):
        return None


class EventScopeGuardTests(unittest.TestCase):
    """Every router checks `identity.event_id != event_id` before touching
    the DB. One representative endpoint per router is enough to catch a
    router that forgets the guard entirely — that's the failure mode this
    protects against, not per-endpoint exhaustiveness."""

    def setUp(self):
        async def override_identity():
            return Identity(subject="u1", email="a@b.com", name="A",
                             event_id="event-a", org_id="org-a", role="admin")

        async def override_db():
            yield _FakeSession()

        app.dependency_overrides[current_identity] = override_identity
        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_budget_rejects_foreign_event(self):
        self.assertEqual(self.client.get("/api/planner/event-b/budget").status_code, 403)

    def test_vendors_rejects_foreign_event(self):
        self.assertEqual(self.client.get("/api/planner/event-b/vendors").status_code, 403)

    def test_milestones_rejects_foreign_event(self):
        self.assertEqual(self.client.get("/api/planner/event-b/milestones").status_code, 403)

    def test_runsheet_rejects_foreign_event(self):
        self.assertEqual(self.client.get("/api/planner/event-b/runsheet").status_code, 403)

    def test_documents_rejects_foreign_event(self):
        self.assertEqual(self.client.get("/api/planner/event-b/documents").status_code, 403)

    def test_dashboard_rejects_foreign_event(self):
        self.assertEqual(self.client.get("/api/planner/event-b/dashboard").status_code, 403)

    def test_procurement_rejects_foreign_event(self):
        self.assertEqual(self.client.get("/api/planner/event-b/procurement").status_code, 403)


class DocumentFileRouteTests(unittest.TestCase):
    def setUp(self):
        async def override_db():
            yield _FakeSession()
        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_unknown_filename_404s_instead_of_touching_disk(self):
        # No matching PlannerDocument row (db.scalar mocked to None) must
        # 404 before any filesystem access — this is the route that used to
        # not exist at all (every document link 200'd with the SPA shell).
        async def override_identity():
            return Identity(subject="u1", email="a@b.com", name="A",
                            event_id="event-a", org_id="org-a", role="admin")
        app.dependency_overrides[current_identity] = override_identity
        response = self.client.get("/api/planner/event-a/documents/files/nope.pdf")
        self.assertEqual(response.status_code, 404)

    def test_auth_header_is_required(self):
        response = self.client.get("/api/planner/event-a/documents/files/nope.pdf",
                                    headers={})
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
