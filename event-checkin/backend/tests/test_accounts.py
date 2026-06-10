"""Operator account management: accounts list, org suspend/delete, member
roles, user suspend/delete, and the self/default guards."""
import pytest
from sqlalchemy import select, func

from conftest import _Session
from app.models import Event, Guest, Organization, Membership, User

DEFAULT_ORG = "00000000-0000-0000-0000-000000000001"


@pytest.mark.asyncio
async def test_accounts_operator_only(ctx):
    ctx.login(ctx.ids["user_a"])
    assert (await ctx.client.get("/api/admin/accounts")).status_code == 403
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.get("/api/admin/accounts")
    assert r.status_code == 200
    names = {o["name"] for o in r.json()}
    assert {"Org A", "Org B"} <= names
    org_a = next(o for o in r.json() if o["name"] == "Org A")
    assert org_a["event_count"] == 1
    assert any(m["email"] == "alice@a.com" and m["role"] == "owner" for m in org_a["members"])


@pytest.mark.asyncio
async def test_suspend_org_hides_events_and_blocks_access(ctx):
    eid, oid = ctx.ids["event_a"], ctx.ids["org_a"]
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.patch(f"/api/admin/orgs/{oid}/active", json={"active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False

    # Owner can no longer see or reach the org's events.
    ctx.login(ctx.ids["user_a"])
    assert (await ctx.client.get("/api/events")).json() == []
    assert (await ctx.client.get(f"/api/events/{eid}/guests")).status_code == 404

    # Reactivate → access restored.
    ctx.login(ctx.ids["superadmin"])
    await ctx.client.patch(f"/api/admin/orgs/{oid}/active", json={"active": True})
    ctx.login(ctx.ids["user_a"])
    assert len((await ctx.client.get("/api/events")).json()) == 1


@pytest.mark.asyncio
async def test_delete_org_cascades(ctx):
    eid, oid = ctx.ids["event_a"], ctx.ids["org_a"]
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.delete(f"/api/admin/orgs/{oid}")
    assert r.status_code == 204
    async with _Session() as s:
        assert await s.get(Organization, oid) is None
        assert await s.get(Event, eid) is None
        assert (await s.scalar(select(func.count(Guest.id)).where(Guest.event_id == eid))) == 0
        assert (await s.scalar(select(func.count(Membership.id)).where(Membership.org_id == oid))) == 0


@pytest.mark.asyncio
async def test_default_org_protected(ctx):
    ctx.login(ctx.ids["superadmin"])
    assert (await ctx.client.delete(f"/api/admin/orgs/{DEFAULT_ORG}")).status_code == 400
    assert (await ctx.client.patch(f"/api/admin/orgs/{DEFAULT_ORG}/active", json={"active": False})).status_code == 400


@pytest.mark.asyncio
async def test_member_role_change_and_remove(ctx):
    oid = ctx.ids["org_a"]
    ua = ctx.ids["user_a"]
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.patch(f"/api/admin/orgs/{oid}/members/{ua.id}", json={"role": "staff"})
    assert r.status_code == 200 and r.json()["role"] == "staff"
    async with _Session() as s:
        role = await s.scalar(select(Membership.role).where(
            Membership.org_id == oid, Membership.user_id == ua.id))
        assert role == "staff"
    assert (await ctx.client.delete(f"/api/admin/orgs/{oid}/members/{ua.id}")).status_code == 204
    async with _Session() as s:
        assert (await s.scalar(select(func.count(Membership.id)).where(
            Membership.org_id == oid, Membership.user_id == ua.id))) == 0


@pytest.mark.asyncio
async def test_suspend_and_delete_user_with_guards(ctx):
    ctx.login(ctx.ids["superadmin"])
    ub = ctx.ids["user_b"]
    # Suspend toggles the flag.
    r = await ctx.client.patch(f"/api/admin/users/{ub.id}/active", json={"active": False})
    assert r.status_code == 200
    async with _Session() as s:
        assert (await s.get(User, ub.id)).is_active is False

    # Can't act on yourself.
    me = ctx.ids["superadmin"]
    assert (await ctx.client.patch(f"/api/admin/users/{me.id}/active", json={"active": False})).status_code == 400
    assert (await ctx.client.delete(f"/api/admin/users/{me.id}")).status_code == 400

    # Delete another user removes them + their memberships.
    assert (await ctx.client.delete(f"/api/admin/users/{ub.id}")).status_code == 204
    async with _Session() as s:
        assert await s.get(User, ub.id) is None
        assert (await s.scalar(select(func.count(Membership.id)).where(Membership.user_id == ub.id))) == 0
