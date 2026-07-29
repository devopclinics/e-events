"""Public API (Gatsby gap-backlog item): X-API-Key auth, org-scoping, request
audit log, and the no-auth docs endpoint."""
import pytest
from sqlalchemy import select

from app.models import ApiKeyRequestLog, Guest, Organization, WebhookDelivery
from conftest import _Session


async def _mint_key(ctx, owner) -> str:
    ctx.login(owner)
    created = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "Test key"})
    return created.json()["key"]


async def _mint_read_write_key(ctx, owner, org_id) -> str:
    async with _Session() as s:
        org = await s.get(Organization, org_id)
        org.subscription_status = "active"
        await s.commit()
    ctx.login(owner)
    created = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "RW key", "scope": "read_write"})
    assert created.status_code == 201, created.text
    return created.json()["key"]


@pytest.mark.asyncio
async def test_docs_endpoint_requires_no_auth(ctx):
    ctx.login(None)
    r = await ctx.client.get("/api/public/v1/docs")
    assert r.status_code == 200
    assert r.json()["auth"]["header"] == "X-API-Key"


@pytest.mark.asyncio
async def test_missing_or_invalid_key_is_rejected(ctx):
    ctx.login(None)
    no_header = await ctx.client.get("/api/public/v1/events")
    assert no_header.status_code == 401

    bad_key = await ctx.client.get("/api/public/v1/events", headers={"X-API-Key": "fk_live_bogus"})
    assert bad_key.status_code == 401


@pytest.mark.asyncio
async def test_valid_key_lists_only_its_own_orgs_events(ctx):
    key_a = await _mint_key(ctx, ctx.ids["user_a"])   # org_a owns event_a
    ctx.login(None)   # public API calls carry no Firebase session — key only
    resp = await ctx.client.get("/api/public/v1/events", headers={"X-API-Key": key_a})
    assert resp.status_code == 200
    events = resp.json()
    assert any(e["id"] == ctx.ids["event_a"] for e in events)

    key_b = await _mint_key(ctx, ctx.ids["user_b"])   # org_b owns nothing named event_a
    ctx.login(None)
    resp_b = await ctx.client.get("/api/public/v1/events", headers={"X-API-Key": key_b})
    assert resp_b.status_code == 200
    assert not any(e["id"] == ctx.ids["event_a"] for e in resp_b.json())


@pytest.mark.asyncio
async def test_event_from_other_org_404s(ctx):
    key_b = await _mint_key(ctx, ctx.ids["user_b"])
    ctx.login(None)
    r = await ctx.client.get(f"/api/public/v1/events/{ctx.ids['event_a']}", headers={"X-API-Key": key_b})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_revoked_key_is_rejected(ctx):
    ctx.login(ctx.ids["user_a"])
    created = await ctx.client.post("/api/organizations/me/api-keys", json={"name": "Soon revoked"})
    key_id, full_key = created.json()["id"], created.json()["key"]
    await ctx.client.delete(f"/api/organizations/me/api-keys/{key_id}")

    ctx.login(None)
    r = await ctx.client.get("/api/public/v1/events", headers={"X-API-Key": full_key})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_requests_are_audit_logged(ctx):
    key_a = await _mint_key(ctx, ctx.ids["user_a"])
    ctx.login(None)
    await ctx.client.get("/api/public/v1/events", headers={"X-API-Key": key_a})

    async with _Session() as s:
        from sqlalchemy import select
        rows = (await s.execute(select(ApiKeyRequestLog))).scalars().all()
        assert any(r.path == "/api/public/v1/events" and r.status_code == 200 for r in rows)


@pytest.mark.asyncio
async def test_guests_endpoint_scoped_to_owning_org(ctx):
    key_a = await _mint_key(ctx, ctx.ids["user_a"])
    ctx.login(None)
    ok = await ctx.client.get(f"/api/public/v1/events/{ctx.ids['event_a']}/guests", headers={"X-API-Key": key_a})
    assert ok.status_code == 200

    key_b = await _mint_key(ctx, ctx.ids["user_b"])
    ctx.login(None)
    denied = await ctx.client.get(f"/api/public/v1/events/{ctx.ids['event_a']}/guests", headers={"X-API-Key": key_b})
    assert denied.status_code == 404


# ── Guest writes (read_write scope only) ─────────────────────────────────────

@pytest.mark.asyncio
async def test_read_only_key_gets_403_on_guest_writes(ctx):
    key_a = await _mint_key(ctx, ctx.ids["user_a"])
    ev = ctx.ids["event_a"]
    ctx.login(None)
    r = await ctx.client.post(f"/api/public/v1/events/{ev}/guests", headers={"X-API-Key": key_a},
                               json={"first_name": "Ada", "last_name": "Lovelace"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_read_write_key_creates_guest_and_fires_webhook(ctx):
    ev = ctx.ids["event_a"]
    org_id = ctx.ids["org_a"]

    ctx.login(ctx.ids["user_a"])
    await ctx.client.post("/api/organizations/me/webhooks", json={
        "url": "https://example.com/hook", "event_types": ["guest.created"],
    })

    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], org_id)
    ctx.login(None)
    r = await ctx.client.post(f"/api/public/v1/events/{ev}/guests", headers={"X-API-Key": key_a},
                               json={"first_name": "Ada", "last_name": "Lovelace", "email": "ada@x.com"})
    assert r.status_code == 201, r.text
    guest_id = r.json()["id"]
    assert r.json()["first_name"] == "Ada"

    async with _Session() as s:
        guest = await s.get(Guest, guest_id)
        assert guest is not None
        assert guest.event_id == ev
        rows = (await s.execute(select(WebhookDelivery))).scalars().all()
        assert any(row.event_type == "guest.created" for row in rows)


@pytest.mark.asyncio
async def test_read_write_key_cannot_create_guest_in_other_orgs_event(ctx):
    ev = ctx.ids["event_a"]
    key_b = await _mint_read_write_key(ctx, ctx.ids["user_b"], ctx.ids["org_b"])
    ctx.login(None)
    r = await ctx.client.post(f"/api/public/v1/events/{ev}/guests", headers={"X-API-Key": key_b},
                               json={"first_name": "Eve", "last_name": "Intruder"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_read_write_key_updates_guest(ctx):
    ev = ctx.ids["event_a"]
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    created = await ctx.client.post(f"/api/public/v1/events/{ev}/guests", headers={"X-API-Key": key_a},
                                     json={"first_name": "Ada", "last_name": "Lovelace"})
    guest_id = created.json()["id"]

    r = await ctx.client.patch(f"/api/public/v1/guests/{guest_id}", headers={"X-API-Key": key_a},
                                json={"is_vip": True, "phone": "+18327941707"})
    assert r.status_code == 200, r.text
    assert r.json()["phone"] == "+18327941707"

    async with _Session() as s:
        guest = await s.get(Guest, guest_id)
        assert guest.is_vip is True


@pytest.mark.asyncio
async def test_read_write_key_rejects_update_to_other_orgs_guest(ctx):
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    created = await ctx.client.post(f"/api/public/v1/events/{ctx.ids['event_a']}/guests",
                                     headers={"X-API-Key": key_a},
                                     json={"first_name": "Ada", "last_name": "Lovelace"})
    guest_id = created.json()["id"]

    key_b = await _mint_read_write_key(ctx, ctx.ids["user_b"], ctx.ids["org_b"])
    ctx.login(None)
    r = await ctx.client.patch(f"/api/public/v1/guests/{guest_id}", headers={"X-API-Key": key_b},
                                json={"is_vip": True})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_read_write_key_deletes_guest(ctx):
    ev = ctx.ids["event_a"]
    key_a = await _mint_read_write_key(ctx, ctx.ids["user_a"], ctx.ids["org_a"])
    ctx.login(None)
    created = await ctx.client.post(f"/api/public/v1/events/{ev}/guests", headers={"X-API-Key": key_a},
                                     json={"first_name": "Temp", "last_name": "Guest"})
    guest_id = created.json()["id"]

    r = await ctx.client.delete(f"/api/public/v1/guests/{guest_id}", headers={"X-API-Key": key_a})
    assert r.status_code == 204

    async with _Session() as s:
        assert await s.get(Guest, guest_id) is None

    # Deleting again 404s (already gone).
    r2 = await ctx.client.delete(f"/api/public/v1/guests/{guest_id}", headers={"X-API-Key": key_a})
    assert r2.status_code == 404
