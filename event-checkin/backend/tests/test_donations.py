"""Donation Tracker API isolation, privacy, pledge, and verification tests."""
import pytest


@pytest.mark.asyncio
async def test_donation_tracker_public_flow_keeps_pledges_separate_and_private(ctx):
    ctx.login(ctx.ids["superadmin"])
    event_id = ctx.ids["event_a"]
    campaign = {
        "enabled": True,
        "title": "Support the mission",
        "description": "Help us reach the goal.",
        "goal_minor": 100000,
        "currency": "USD",
        "public_total_mode": "confirmed_and_pledged_separate",
        "show_donor_names": True,
        "show_donor_amounts": True,
        "show_pledged_total": True,
        "celebrate_milestones": True,
        "milestones_minor": [25000, 50000],
        "channels": [
            {"type": "zelle", "enabled": True, "label": "Zelle", "public_instructions": "Send to giving@example.org"},
            {"type": "pledge", "enabled": True, "label": "Pledge now"},
        ],
    }
    saved = await ctx.client.put(f"/api/events/{event_id}/donation-campaign", json=campaign)
    assert saved.status_code == 200, saved.text
    token = saved.json()["public_token"]

    pledge = await ctx.client.post(f"/api/give/{token}/contributions", json={
        "channel": "pledge", "amount_minor": 30000, "donor_name": "Private Person",
        "anonymous_publicly": True, "hide_amount_publicly": True,
        "expected_payment_channel": "zelle", "expected_payment_date": "2026-10-01T12:00:00Z",
    })
    assert pledge.status_code == 201, pledge.text
    assert pledge.json()["status"] == "pledged"
    assert pledge.json()["expected_payment_date"].startswith("2026-10-01T12:00:00")

    public = await ctx.client.get(f"/api/give/{token}")
    assert public.status_code == 200
    snapshot = public.json()
    assert snapshot["confirmed_minor"] == 0
    assert snapshot["pledged_minor"] == 30000
    assert snapshot["pledge_count"] == 1
    assert {item["type"] for item in snapshot["pledge_payment_channels"]} == {"festio_pay", "cash_app", "zelle", "bank_transfer", "offline"}
    assert snapshot["recent_public"][0]["name"] == "Anonymous donor"
    assert snapshot["recent_public"][0]["amount_minor"] is None

    verified = await ctx.client.post(
        f"/api/events/{event_id}/donations/{pledge.json()['id']}/verify", json={"note": "Zelle received"}
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "confirmed"

    public = (await ctx.client.get(f"/api/give/{token}")).json()
    assert public["confirmed_minor"] == 30000
    assert public["pledged_minor"] == 0


@pytest.mark.asyncio
async def test_donation_public_url_uses_short_event_code(ctx):
    ctx.login(ctx.ids["superadmin"])
    event_id = ctx.ids["event_a"]
    campaign = {
        "enabled": True, "title": "Support the mission", "description": None,
        "goal_minor": 0, "currency": "USD", "public_total_mode": "confirmed_and_pledged_separate",
        "show_donor_names": True, "show_donor_amounts": True, "show_pledged_total": True,
        "celebrate_milestones": False, "milestones_minor": [],
        "channels": [{"type": "zelle", "enabled": True, "label": "Zelle"}],
    }
    saved = await ctx.client.put(f"/api/events/{event_id}/donation-campaign", json=campaign)
    assert saved.status_code == 200, saved.text
    body = saved.json()
    # public_url is short (event_code), not the long public_token uuid.
    assert body["public_url"].endswith(f"/give/{body['public_token']}") is False
    short_code = body["public_url"].rsplit("/give/", 1)[1]
    assert len(short_code) < len(body["public_token"])

    # the short code resolves the same campaign as the public_token would.
    by_code = await ctx.client.get(f"/api/give/{short_code}")
    assert by_code.status_code == 200
    by_token = await ctx.client.get(f"/api/give/{body['public_token']}")
    assert by_token.status_code == 200
    assert by_code.json()["title"] == by_token.json()["title"] == "Support the mission"


@pytest.mark.asyncio
async def test_disabled_campaign_and_disabled_channel_are_not_public(ctx):
    ctx.login(ctx.ids["superadmin"])
    event_id = ctx.ids["event_a"]
    draft = await ctx.client.get(f"/api/events/{event_id}/donation-campaign")
    assert draft.status_code == 200
    token = draft.json()["public_token"]
    assert (await ctx.client.get(f"/api/give/{token}")).status_code == 404

    payload = {key: value for key, value in draft.json().items() if key in {
        "enabled", "title", "description", "goal_minor", "currency", "public_total_mode",
        "show_donor_names", "show_donor_amounts", "show_pledged_total", "celebrate_milestones",
        "milestones_minor", "channels",
    }}
    payload["enabled"] = True
    payload["channels"] = [{"type": "zelle", "enabled": False, "label": "Zelle"}]
    assert (await ctx.client.put(f"/api/events/{event_id}/donation-campaign", json=payload)).status_code == 200
    denied = await ctx.client.post(f"/api/give/{token}/contributions", json={"channel": "zelle", "amount_minor": 1000})
    assert denied.status_code == 422
