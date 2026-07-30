import pytest


@pytest.mark.asyncio
async def test_redesign_telemetry_accepts_allowlisted_operational_fields(ctx):
    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.post(
        "/api/telemetry/redesign",
        json={
            "event_type": "mutation_duration",
            "route": "/guests-redesign?tab=guests",
            "module": "guests",
            "event_id": ctx.ids["event_a"],
            "action": "bulk_assign_table_group",
            "duration_ms": 125,
            "success": True,
        },
    )
    assert response.status_code == 202
    assert response.json() == {"accepted": True}


@pytest.mark.asyncio
async def test_redesign_telemetry_rejects_arbitrary_pii_fields(ctx):
    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.post(
        "/api/telemetry/redesign",
        json={
            "event_type": "api_error",
            "route": "/guests-redesign",
            "guest_email": "should-not-be-accepted@example.test",
        },
    )
    assert response.status_code == 422
