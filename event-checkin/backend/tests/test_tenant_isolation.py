"""Cross-tenant isolation tests — a user in one org must never reach another
org's events/guests/dashboard, and global endpoints are operator-only."""
import pytest


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
async def test_me_reports_effective_admin_role(ctx):
    ctx.login(ctx.ids["user_a"])           # owner of Org A
    me = (await ctx.client.get("/api/auth/me")).json()
    assert me["role"] == "admin"           # effective role from membership
    assert me["is_org_admin"] is True
    assert me["is_platform_superadmin"] is False
