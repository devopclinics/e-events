from types import SimpleNamespace

from app.routers.training import _manager, _safe_course
from app.training_catalog import COURSE_VERSION, lessons, published_course
from app.config import settings
import pytest


def test_published_course_is_complete_ordered_and_unique():
    course = published_course()
    items = lessons()
    assert course["version"] == COURSE_VERSION
    assert course["status"] == "published"
    assert course["lesson_count"] == 33
    assert [item["order"] for item in items] == list(range(1, 34))
    assert len({item["key"] for item in items}) == 33
    assert all(item["image_url"].startswith("/knowledge-transfer/assets/") for item in items)


def test_client_catalog_never_exposes_answer_key():
    for module in _safe_course()["modules"]:
        for lesson in module["lessons"]:
            assert all("correct" not in question for question in lesson["quiz"])


def test_training_manager_permissions_are_org_role_scoped():
    ordinary = SimpleNamespace(is_platform_superadmin=False)
    superadmin = SimpleNamespace(is_platform_superadmin=True)
    assert _manager(ordinary, SimpleNamespace(role="owner"))
    assert _manager(ordinary, SimpleNamespace(role="admin"))
    assert not _manager(ordinary, SimpleNamespace(role="staff"))
    assert _manager(superadmin, SimpleNamespace(role="staff"))


@pytest.mark.asyncio
async def test_training_assignment_quiz_sequence_and_tenant_isolation(ctx, monkeypatch):
    monkeypatch.setattr(settings, "training_internal_org_slugs", "org-a")
    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.get("/api/training/me")
    assert response.status_code == 200
    assert response.json()["course"]["lesson_count"] == 33

    response = await ctx.client.post("/api/training/manage/assignments", json={
        "org_id": ctx.ids["org_a"], "user_ids": [ctx.ids["user_a"].id]
    })
    assert response.status_code == 200

    # Lesson two is locked until lesson one is passed.
    response = await ctx.client.post("/api/training/quiz/audience", json={"answers": [0, 0]})
    assert response.status_code == 409
    response = await ctx.client.post("/api/training/quiz/platform-overview", json={"answers": [0, 0]})
    assert response.status_code == 200
    assert response.json()["passed"] is True

    response = await ctx.client.get("/api/training/me")
    assert response.json()["progress"]["platform-overview"]["status"] == "completed"

    # An owner cannot manage another organization's academy.
    response = await ctx.client.get(f"/api/training/manage/people?org_id={ctx.ids['org_b']}")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_manager_due_date_audit_and_release_permissions(ctx, monkeypatch):
    monkeypatch.setattr(settings, "training_internal_org_slugs", "org-a")
    ctx.login(ctx.ids["user_a"])
    await ctx.client.post("/api/training/manage/assignments", json={
        "org_id": ctx.ids["org_a"], "user_ids": [ctx.ids["user_a"].id]
    })
    people = (await ctx.client.get("/api/training/manage/people")).json()["people"]
    assignment_id = people[0]["assignment"]["id"]
    response = await ctx.client.patch(
        f"/api/training/manage/assignments/{assignment_id}/due-date",
        json={"due_at": "2026-09-30T23:59:00"},
    )
    assert response.status_code == 200
    audit = (await ctx.client.get("/api/training/manage/audit")).json()
    assert any(row["action"] == "due_date_updated" for row in audit)
    assert (await ctx.client.get("/api/training/admin/releases")).status_code == 403

    ctx.login(ctx.ids["superadmin"])
    response = await ctx.client.post("/api/training/admin/releases", json={"title": "Next curriculum"})
    assert response.status_code == 200
    release_id = response.json()["id"]
    response = await ctx.client.post(f"/api/training/admin/releases/{release_id}/publish")
    assert response.json()["status"] == "published"


@pytest.mark.asyncio
async def test_manage_orgs_lists_only_orgs_the_caller_can_actually_manage(ctx, monkeypatch):
    monkeypatch.setattr(settings, "training_internal_org_slugs", "org-a")
    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.get("/api/training/manage/orgs")
    assert response.status_code == 200
    assert [org["id"] for org in response.json()] == [ctx.ids["org_a"]]

    # user_b owns org-b, which isn't in the internal slug list, so they can't manage its academy.
    ctx.login(ctx.ids["user_b"])
    assert (await ctx.client.get("/api/training/manage/orgs")).json() == []


@pytest.mark.asyncio
async def test_customer_owner_is_denied_until_superadmin_grants_access(ctx, monkeypatch):
    monkeypatch.setattr(settings, "training_internal_org_slugs", "org-a")
    ctx.login(ctx.ids["user_b"])
    assert (await ctx.client.get("/api/training/me")).status_code == 403

    ctx.login(ctx.ids["superadmin"])
    response = await ctx.client.post("/api/training/admin/access", json={
        "email": ctx.ids["user_b"].email, "reason": "Approved partner training",
    })
    assert response.status_code == 200
    grant_id = response.json()["id"]

    ctx.login(ctx.ids["user_b"])
    response = await ctx.client.get("/api/training/me")
    assert response.status_code == 200
    assert response.json()["can_manage"] is False
    assert (await ctx.client.get("/api/training/manage/people")).status_code == 403

    ctx.login(ctx.ids["superadmin"])
    assert (await ctx.client.delete(f"/api/training/admin/access/{grant_id}")).status_code == 204
    ctx.login(ctx.ids["user_b"])
    assert (await ctx.client.get("/api/training/me")).status_code == 403
