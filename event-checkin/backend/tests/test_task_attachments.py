"""Task file attachments: upload/list/delete, any event team member can
manage them (same require_event_member bar as comments/subtasks — Task has
no created_by_user_id to gate more narrowly), activity log entries, and
storage cleanup on delete.

storage.save()/delete() are mocked rather than hitting real disk — this host
has no /app/uploads (that only exists inside the container image), and no
prior test in this suite exercises the upload-cover-image path either, so
there's no existing "real disk" precedent to follow; mocking matches this
suite's established pattern for other real I/O (email sends, payment calls)."""
import pytest
from sqlalchemy import select

from app import storage
from app.models import Task, TaskActivity, TaskAttachment
from conftest import _Session


def _mock_storage(monkeypatch):
    saved = {}
    deleted = []

    def fake_save(subpath, data, content_type):
        saved[subpath] = (data, content_type)
        return f"/api/uploads/{subpath}"

    def fake_delete(subpath):
        deleted.append(subpath)

    monkeypatch.setattr(storage, "save", fake_save)
    monkeypatch.setattr(storage, "delete", fake_delete)
    return saved, deleted


async def _create_task(ctx, ev) -> str:
    r = await ctx.client.post(f"/api/events/{ev}/tasks", json={"title": "Book florist"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_upload_list_and_delete_attachment(ctx, monkeypatch):
    saved, deleted = _mock_storage(monkeypatch)
    ctx.login(ctx.ids["user_a"])
    ev = ctx.ids["event_a"]
    task_id = await _create_task(ctx, ev)

    uploaded = await ctx.client.post(
        f"/api/events/{ev}/tasks/{task_id}/attachments",
        files={"file": ("contract.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert uploaded.status_code == 201, uploaded.text
    body = uploaded.json()
    assert body["filename"] == "contract.pdf"
    assert body["content_type"] == "application/pdf"
    assert body["size_bytes"] == len(b"%PDF-1.4 fake")
    assert body["uploaded_by_name"]
    assert body["url"].startswith("/api/uploads/tasks/")
    assert any(k.startswith("tasks/") for k in saved)

    listing = await ctx.client.get(f"/api/events/{ev}/tasks/{task_id}/attachments")
    assert listing.status_code == 200
    assert len(listing.json()) == 1

    async with _Session() as s:
        rows = (await s.execute(select(TaskActivity).where(TaskActivity.task_id == task_id))).scalars().all()
        assert any("Attached contract.pdf" in r.body for r in rows)

    attachment_id = body["id"]
    removed = await ctx.client.delete(f"/api/events/{ev}/tasks/{task_id}/attachments/{attachment_id}")
    assert removed.status_code == 204
    assert len(deleted) == 1

    async with _Session() as s:
        assert await s.get(TaskAttachment, attachment_id) is None
        rows = (await s.execute(select(TaskActivity).where(TaskActivity.task_id == task_id))).scalars().all()
        assert any("Removed attachment: contract.pdf" in r.body for r in rows)


@pytest.mark.asyncio
async def test_rejects_unsupported_file_type(ctx, monkeypatch):
    _mock_storage(monkeypatch)
    ctx.login(ctx.ids["user_a"])
    ev = ctx.ids["event_a"]
    task_id = await _create_task(ctx, ev)

    r = await ctx.client.post(
        f"/api/events/{ev}/tasks/{task_id}/attachments",
        files={"file": ("script.exe", b"MZ...", "application/x-msdownload")},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_rejects_oversized_file(ctx, monkeypatch):
    _mock_storage(monkeypatch)
    ctx.login(ctx.ids["user_a"])
    ev = ctx.ids["event_a"]
    task_id = await _create_task(ctx, ev)

    big = b"a" * (10 * 1024 * 1024 + 1)
    r = await ctx.client.post(
        f"/api/events/{ev}/tasks/{task_id}/attachments",
        files={"file": ("big.png", big, "image/png")},
    )
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_any_team_member_not_just_assignee_can_upload(ctx, monkeypatch):
    """Confirms the deliberate choice to gate on require_event_member (any
    staff on the event) rather than task creator/assignee specifically —
    matches how comments/subtasks already work."""
    _mock_storage(monkeypatch)
    ctx.login(ctx.ids["user_a"])
    ev = ctx.ids["event_a"]
    task_id = await _create_task(ctx, ev)

    # user_b has no relationship to this task or org_a's event at all.
    ctx.login(ctx.ids["user_b"])
    r = await ctx.client.post(
        f"/api/events/{ev}/tasks/{task_id}/attachments",
        files={"file": ("note.txt", b"hi", "text/plain")},
    )
    assert r.status_code == 404   # not a member of org_a — event not found, same as every other task route


@pytest.mark.asyncio
async def test_attachments_scoped_to_task_event(ctx, monkeypatch):
    _mock_storage(monkeypatch)
    ctx.login(ctx.ids["user_a"])
    ev = ctx.ids["event_a"]
    task_id = await _create_task(ctx, ev)

    wrong_event = await ctx.client.get(f"/api/events/{ev}-bogus/tasks/{task_id}/attachments")
    assert wrong_event.status_code == 404
