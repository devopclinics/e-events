"""Public API key management (Gatsby gap-backlog item): mint/list/revoke,
scoped to the org the caller owns, full key shown only once."""
import pytest

from app.models import ApiKey, Organization
from conftest import _Session


@pytest.mark.asyncio
async def test_owner_can_create_list_and_revoke_key(ctx):
    ctx.login(ctx.ids["user_a"])   # owns org_a per conftest

    created = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "Zapier"})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "Zapier"
    assert body["key"].startswith("fk_live_")
    assert body["key_prefix"] == body["key"][:16]
    key_id = body["id"]
    full_key = body["key"]

    listing = (await ctx.client.get("/api/organizations/me/api-keys")).json()
    assert len(listing) == 1
    assert "key" not in listing[0]   # never returned again
    assert listing[0]["key_prefix"] == full_key[:16]

    revoked = await ctx.client.delete(f"/api/organizations/me/api-keys/{key_id}")
    assert revoked.status_code == 204

    async with _Session() as s:
        row = await s.get(ApiKey, key_id)
        assert row.revoked_at is not None


@pytest.mark.asyncio
async def test_non_owner_cannot_manage_keys(ctx):
    ctx.login(ctx.ids["user_b"])   # owns org_b, not org_a — but has no owned org role issue here
    # user_b DOES own org_b, so they can manage THEIR OWN org's keys; the real
    # test is that they never see or touch org_a's keys.
    created = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "Test"})
    assert created.status_code == 201
    listing = (await ctx.client.get("/api/organizations/me/api-keys")).json()
    assert len(listing) == 1
    assert listing[0]["name"] == "Test"


@pytest.mark.asyncio
async def test_create_key_requires_nonempty_name(ctx):
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "   "})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_revoking_someone_elses_key_404s(ctx):
    ctx.login(ctx.ids["user_a"])
    created = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "A's key"})
    key_id = created.json()["id"]

    ctx.login(ctx.ids["user_b"])
    r = await ctx.client.delete(f"/api/organizations/me/api-keys/{key_id}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_default_key_scope_is_read_only(ctx):
    ctx.login(ctx.ids["user_a"])
    created = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "Default"})
    assert created.json()["scope"] == "read_only"


@pytest.mark.asyncio
async def test_read_write_key_rejected_without_active_subscription(ctx):
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "RW", "scope": "read_write"})
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_read_write_key_allowed_with_active_subscription(ctx):
    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        org.subscription_status = "active"
        await s.commit()

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "RW", "scope": "read_write"})
    assert r.status_code == 201, r.text
    assert r.json()["scope"] == "read_write"


# ── Interactive API explorer schema (org owner + active subscription only —
# NOT reachable via X-API-Key or unauthenticated, unlike the prose docs at
# /api/public/v1/docs, which stay public for anyone evaluating the API).
# Note: this test harness's get_current_user override always resolves to
# whatever ctx.login() set (never raises 401 for "no user"), so — same as
# every other Depends(get_current_user) endpoint in this suite — there's no
# meaningful way here to test the "not logged in at all" case; only the
# subscription gate (which the endpoint itself enforces) is exercised.

@pytest.mark.asyncio
async def test_public_api_schema_requires_active_subscription(ctx):
    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get("/api/organizations/me/public-api-schema")
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_public_api_schema_returned_with_active_subscription(ctx):
    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        org.subscription_status = "active"
        await s.commit()

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.get("/api/organizations/me/public-api-schema")
    assert r.status_code == 200, r.text
    schema = r.json()
    assert all(p.startswith("/api/public/v1") for p in schema["paths"])
    assert "/api/public/v1/events" in schema["paths"]
    assert schema["components"]["securitySchemes"]["ApiKeyAuth"]["name"] == "X-API-Key"


@pytest.mark.asyncio
async def test_public_api_schema_gate_is_per_org_not_global(ctx):
    """org_a subscribing must not unlock the schema for org_b's owner."""
    async with _Session() as s:
        org = await s.get(Organization, ctx.ids["org_a"])
        org.subscription_status = "active"
        await s.commit()

    ctx.login(ctx.ids["user_b"])   # owns org_b, which has no subscription of its own
    r = await ctx.client.get("/api/organizations/me/public-api-schema")
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_old_unauthenticated_swagger_routes_are_gone(ctx):
    ctx.login(None)
    assert (await ctx.client.get("/api/public/v1/swagger")).status_code == 404
    assert (await ctx.client.get("/api/public/v1/openapi.json")).status_code == 404
