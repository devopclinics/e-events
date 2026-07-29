"""Console-editable messaging credit weights (global default + per-org
negotiated override) — see team-docs/index.html §2c."""
import pytest

from app import entitlements


@pytest.mark.asyncio
async def test_global_credit_rates_list_falls_back_to_hardcoded_defaults(ctx):
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.get("/api/admin/credit-rates/global")
    assert r.status_code == 200
    by_channel = {row["channel"]: row for row in r.json()}
    assert set(by_channel) == {"sms", "whatsapp", "mms", "rcs", "email"}
    assert by_channel["sms"]["credits_per_unit"] == entitlements.DEFAULT_CHANNEL_WEIGHTS["sms"]
    assert by_channel["email"]["credits_per_unit"] == entitlements.DEFAULT_EMAIL_CREDITS_PER_EMAIL
    assert all(row["is_override"] is False for row in by_channel.values())


@pytest.mark.asyncio
async def test_saving_a_global_rate_takes_effect_immediately_via_cache_reload(ctx):
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.put("/api/admin/credit-rates/global/sms", json={"credits_per_unit": 0.5})
    assert r.status_code == 200

    # take_message_credit reads the live cache, not the DB directly — a save
    # must be visible to it without a process restart.
    assert entitlements.channel_weight("sms") == 0.5

    r = await ctx.client.get("/api/admin/credit-rates/global")
    row = next(x for x in r.json() if x["channel"] == "sms")
    assert row["credits_per_unit"] == 0.5 and row["is_override"] is True


@pytest.mark.asyncio
async def test_global_rate_rejects_unknown_channel_and_non_positive_value(ctx):
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.put("/api/admin/credit-rates/global/carrier-pigeon", json={"credits_per_unit": 1})
    assert r.status_code == 400
    r = await ctx.client.put("/api/admin/credit-rates/global/sms", json={"credits_per_unit": 0})
    assert r.status_code == 400
    r = await ctx.client.put("/api/admin/credit-rates/global/sms", json={"credits_per_unit": -1})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_org_override_wins_over_global_and_clear_reverts_to_it(ctx):
    ctx.login(ctx.ids["superadmin"])
    org_id = ctx.ids["org_a"]

    r = await ctx.client.put("/api/admin/credit-rates/global/mms", json={"credits_per_unit": 3})
    assert r.status_code == 200

    # No override yet: effective_rate mirrors the global default.
    r = await ctx.client.get(f"/api/admin/credit-rates/org/{org_id}")
    row = next(x for x in r.json() if x["channel"] == "mms")
    assert row["is_override"] is False and row["effective_rate"] == 3 and row["credits_per_unit"] is None

    # Negotiated deal: this org pays less for MMS than everyone else.
    r = await ctx.client.put(f"/api/admin/credit-rates/org/{org_id}/mms", json={"credits_per_unit": 1})
    assert r.status_code == 200
    assert entitlements.channel_weight("mms", org_id=org_id) == 1
    assert entitlements.channel_weight("mms", org_id="some-other-org") == 3  # unaffected

    r = await ctx.client.get(f"/api/admin/credit-rates/org/{org_id}")
    row = next(x for x in r.json() if x["channel"] == "mms")
    assert row["is_override"] is True and row["credits_per_unit"] == 1 and row["effective_rate"] == 1

    # Clearing the override reverts this org back to the global default.
    r = await ctx.client.delete(f"/api/admin/credit-rates/org/{org_id}/mms")
    assert r.status_code == 204
    assert entitlements.channel_weight("mms", org_id=org_id) == 3


@pytest.mark.asyncio
async def test_org_credit_rate_endpoints_404_for_unknown_org(ctx):
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.get("/api/admin/credit-rates/org/does-not-exist")
    assert r.status_code == 404
    r = await ctx.client.put("/api/admin/credit-rates/org/does-not-exist/sms", json={"credits_per_unit": 1})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_clearing_a_never_set_override_404s(ctx):
    ctx.login(ctx.ids["superadmin"])
    r = await ctx.client.delete(f'/api/admin/credit-rates/org/{ctx.ids["org_a"]}/rcs')
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_credit_rate_endpoints_require_superadmin(ctx):
    ctx.login(ctx.ids["user_a"])  # org admin, not platform superadmin
    r = await ctx.client.get("/api/admin/credit-rates/global")
    assert r.status_code in (401, 403)
    r = await ctx.client.put("/api/admin/credit-rates/global/sms", json={"credits_per_unit": 1})
    assert r.status_code in (401, 403)
