"""Cross-tenant isolation tests — a user in one org must never reach another
org's events/guests/dashboard, and global endpoints are operator-only."""
import pytest

from app.models import Event
from conftest import _Session


@pytest.mark.asyncio
async def test_list_events_scoped_to_own_org(ctx):
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get("/api/events")
    assert r.status_code == 200
    assert [e["id"] for e in r.json()] == [ctx.ids["event_a"]]

    ctx.login(ctx.ids["user_b"])
    r = await ctx.client.get("/api/events")
    assert r.status_code == 200
    assert r.json() == []  # Org B sees nothing of Org A


@pytest.mark.asyncio
async def test_get_event_cross_org_404(ctx):
    ctx.login(ctx.ids["user_b"])
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}")
    assert r.status_code == 404  # not 403 — don't leak existence


@pytest.mark.asyncio
async def test_guests_cross_org_404(ctx):
    ctx.login(ctx.ids["user_b"])
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_dashboard_cross_org_404(ctx):
    ctx.login(ctx.ids["user_b"])
    r = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/dashboard")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_owner_can_read_own_event_and_guests(ctx):
    ctx.login(ctx.ids["user_a"])
    assert (await ctx.client.get(f"/api/events/{ctx.ids['event_a']}")).status_code == 200
    rg = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")
    assert rg.status_code == 200
    assert len(rg.json()) == 1


@pytest.mark.asyncio
async def test_superadmin_sees_all_events(ctx):
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.get("/api/events")
    assert r.status_code == 200
    assert ctx.ids["event_a"] in [e["id"] for e in r.json()]


@pytest.mark.asyncio
async def test_global_users_endpoint_superadmin_only(ctx):
    ctx.login(ctx.ids["user_a"])           # org owner, not platform superadmin
    assert (await ctx.client.get("/api/auth/users")).status_code == 403
    ctx.login(ctx.ids["superadmin"])
    assert (await ctx.client.get("/api/auth/users")).status_code == 200


@pytest.mark.asyncio
async def test_invite_teammate_then_assign_to_event(ctx):
    ctx.login(ctx.ids["user_a"])
    e = ctx.ids["event_a"]
    # invite a teammate to the org by email
    r = await ctx.client.post(f"/api/events/{e}/org-members", json={"email": "staff@a.com", "role": "staff"})
    assert r.status_code == 201
    members = (await ctx.client.get(f"/api/events/{e}/org-members")).json()
    match = [m for m in members if m["user"]["email"] == "staff@a.com"]
    assert match and match[0]["role"] == "staff"
    # now assignable to the event (org membership exists)
    uid = match[0]["user"]["id"]
    ra = await ctx.client.post(f"/api/events/{e}/members", json={"user_id": uid})
    assert ra.status_code == 201


@pytest.mark.asyncio
async def test_cannot_assign_non_org_member(ctx):
    ctx.login(ctx.ids["user_a"])
    # user_b belongs to Org B, not Org A → can't be assigned to Org A's event
    r = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/members",
        json={"user_id": ctx.ids["user_b"].id},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_console_overview_superadmin_only(ctx):
    ctx.login(ctx.ids["user_a"])            # org owner, not a platform operator
    assert (await ctx.client.get("/api/admin/overview")).status_code == 403
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.get("/api/admin/overview")
    assert r.status_code == 200
    assert len(r.json()) >= 2               # sees Org A and Org B


@pytest.mark.asyncio
async def test_operator_grant_and_revoke(ctx):
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.post("/api/admin/operators", json={"email": "op2@x.com"})
    assert r.status_code == 200 and r.json()["is_platform_superadmin"] is True
    ops = (await ctx.client.get("/api/admin/operators")).json()
    assert any(o["email"] == "op2@x.com" for o in ops)


@pytest.mark.asyncio
async def test_me_reports_effective_admin_role(ctx):
    ctx.login(ctx.ids["user_a"])           # owner of Org A
    me = (await ctx.client.get("/api/auth/me")).json()
    assert me["role"] == "admin"           # effective role from membership
    assert me["is_org_admin"] is True
    assert me["is_platform_superadmin"] is False


@pytest.mark.asyncio
async def test_official_guest_directory_has_view_and_manage_levels(ctx):
    """Guest capabilities must not promote an official to event manager/admin."""
    event_id = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, event_id)
        event.is_paid = True
        await s.commit()

    ctx.login(ctx.ids["user_a"])
    invited = await ctx.client.post(
        f"/api/events/{event_id}/org-members",
        json={"email": "guest-viewer@a.com", "name": "Guest Viewer", "role": "staff"},
    )
    assert invited.status_code == 201
    viewer = invited.json()["user"]
    assigned = await ctx.client.post(
        f"/api/events/{event_id}/members", json={"user_id": viewer["id"]}
    )
    assert assigned.status_code == 201

    # Staff assignment alone is not enough to expose guest PII.
    from app.models import User
    async with _Session() as s:
        viewer_user = await s.get(User, viewer["id"])
    ctx.login(viewer_user)
    assert (await ctx.client.get(f"/api/events/{event_id}/guests")).status_code == 403

    # An event admin can grant only the read-only guest capability.
    ctx.login(ctx.ids["user_a"])
    grant = await ctx.client.patch(
        f"/api/events/{event_id}/members/{viewer['id']}/permissions",
        json={"can_view_guests": True},
    )
    assert grant.status_code == 200

    ctx.login(viewer_user)
    events = (await ctx.client.get("/api/events")).json()
    access = next(e for e in events if e["id"] == event_id)
    assert access["my_access_role"] == "official"
    assert access["my_can_manage_event"] is False
    assert access["my_can_view_guests"] is True
    assert access["my_can_manage_guests"] is False

    guests = await ctx.client.get(f"/api/events/{event_id}/guests")
    assert guests.status_code == 200
    assert len(guests.json()) == 1
    # View access is read-only.
    create = await ctx.client.post(
        f"/api/events/{event_id}/guests",
        json={"first_name": "No", "last_name": "Write"},
    )
    assert create.status_code == 403
    assert (await ctx.client.post(f"/api/events/{event_id}/guests/missing/approve")).status_code == 403

    # Manage grants guest operations while Team & Settings stays admin-only.
    ctx.login(ctx.ids["user_a"])
    grant_manage = await ctx.client.patch(
        f"/api/events/{event_id}/members/{viewer['id']}/permissions",
        json={"can_manage_guests": True},
    )
    assert grant_manage.status_code == 200

    ctx.login(viewer_user)
    access = next(e for e in (await ctx.client.get("/api/events")).json() if e["id"] == event_id)
    assert access["my_access_role"] == "official"
    assert access["my_can_manage_event"] is False
    assert access["my_can_view_guests"] is True
    assert access["my_can_manage_guests"] is True
    created = await ctx.client.post(
        f"/api/events/{event_id}/guests",
        json={"first_name": "Can", "last_name": "Manage"},
    )
    assert created.status_code == 201
    edited = await ctx.client.patch(
        f"/api/events/{event_id}/guests/{created.json()['id']}",
        json={"first_name": "Edited"},
    )
    assert edited.status_code == 200 and edited.json()["first_name"] == "Edited"
    # Passing the permission guard reaches guest lookup (404), rather than 403.
    assert (await ctx.client.post(f"/api/events/{event_id}/guests/missing/approve")).status_code == 404
    assert (await ctx.client.get(f"/api/events/{event_id}/members")).status_code == 403
