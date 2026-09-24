"""Donation Tracker API isolation, privacy, pledge, and verification tests."""
import pytest


@pytest.mark.asyncio
async def test_unidentified_offline_donation_records_source(ctx):
    # No donor name at all (e.g. an offering-basket count) is still a valid
    # record, as long as staff note where it came from.
    ctx.login(ctx.ids["superadmin"])
    event_id = ctx.ids["event_a"]
    campaign = {
        "enabled": True, "title": "Support the mission", "description": None,
        "goal_minor": 0, "currency": "USD", "public_total_mode": "confirmed_and_pledged_separate",
        "show_donor_names": True, "show_donor_amounts": True, "show_pledged_total": True,
        "celebrate_milestones": False, "milestones_minor": [],
        "channels": [{"type": "offline", "enabled": True, "label": "Cash / cheque"}],
    }
    await ctx.client.put(f"/api/events/{event_id}/donation-campaign", json=campaign)

    added = await ctx.client.post(f"/api/events/{event_id}/donations/offline", json={
        "channel": "offline", "amount_minor": 34000, "status": "confirmed",
        "source": "Sunday morning collection basket",
    })
    assert added.status_code == 201, added.text
    body = added.json()
    assert body["donor_name"] is None
    assert body["source"] == "Sunday morning collection basket"

    rows = (await ctx.client.get(f"/api/events/{event_id}/donations")).json()
    row = next(r for r in rows if r["id"] == body["id"])
    assert row["source"] == "Sunday morning collection basket"

    audit = (await ctx.client.get(f"/api/events/{event_id}/donations/audit")).json()
    assert any("Sunday morning collection basket" in (e["note"] or "") for e in audit)


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
    assert {item["type"] for item in snapshot["pledge_payment_channels"]} == {"festio_pay", "cash_app", "zelle", "paypal", "bank_transfer", "offline"}
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
async def test_paypal_channel_accepts_public_contributions(ctx):
    ctx.login(ctx.ids["superadmin"])
    event_id = ctx.ids["event_a"]
    campaign = {
        "enabled": True, "title": "Support the mission", "description": None,
        "goal_minor": 0, "currency": "USD", "public_total_mode": "confirmed_and_pledged_separate",
        "show_donor_names": True, "show_donor_amounts": True, "show_pledged_total": True,
        "celebrate_milestones": False, "milestones_minor": [],
        "channels": [{"type": "paypal", "enabled": True, "label": "PayPal", "public_instructions": "Send to paypal.me/example"}],
    }
    saved = await ctx.client.put(f"/api/events/{event_id}/donation-campaign", json=campaign)
    assert saved.status_code == 200, saved.text
    token = saved.json()["public_token"]

    public = await ctx.client.get(f"/api/give/{token}")
    assert public.status_code == 200
    assert [item["type"] for item in public.json()["channels"]] == ["paypal"]

    contribution = await ctx.client.post(f"/api/give/{token}/contributions", json={
        "channel": "paypal", "amount_minor": 2000, "donor_name": "PayPal Donor",
    })
    assert contribution.status_code == 201, contribution.text
    assert contribution.json()["status"] == "pending_verification"
    assert contribution.json()["instructions"] == "Send to paypal.me/example"


@pytest.mark.asyncio
async def test_blank_donor_email_does_not_fail_validation(ctx):
    # The public form's email field is optional and sends "" rather than
    # omitting the key when left blank; EmailStr must not reject that.
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
    token = saved.json()["public_token"]

    contribution = await ctx.client.post(f"/api/give/{token}/contributions", json={
        "channel": "zelle", "amount_minor": 2000, "donor_name": "No Email Donor", "donor_email": "",
    })
    assert contribution.status_code == 201, contribution.text


@pytest.mark.asyncio
async def test_contact_consent_and_phone_are_captured(ctx):
    ctx.login(ctx.ids["superadmin"])
    event_id = ctx.ids["event_a"]
    campaign = {
        "enabled": True, "title": "Support the mission", "description": None,
        "goal_minor": 0, "currency": "USD", "public_total_mode": "confirmed_and_pledged_separate",
        "show_donor_names": True, "show_donor_amounts": True, "show_pledged_total": True,
        "celebrate_milestones": False, "milestones_minor": [],
        "channels": [{"type": "zelle", "enabled": True, "label": "Zelle"}, {"type": "pledge", "enabled": True, "label": "Pledge now"}],
    }
    saved = await ctx.client.put(f"/api/events/{event_id}/donation-campaign", json=campaign)
    assert saved.status_code == 200, saved.text
    token = saved.json()["public_token"]

    # A donor who opts in gets both phone and consent stored (never blocks the response).
    donate = await ctx.client.post(f"/api/give/{token}/contributions", json={
        "channel": "zelle", "amount_minor": 3000, "donor_name": "Follow Up Donor",
        "donor_email": "donor@example.org", "donor_phone": "+15551234567", "contact_consent": True,
    })
    assert donate.status_code == 201, donate.text

    pledge = await ctx.client.post(f"/api/give/{token}/contributions", json={
        "channel": "pledge", "amount_minor": 5000, "donor_name": "Pledge Follow Up",
        "donor_phone": "+15557654321", "contact_consent": True,
        "expected_payment_channel": "zelle", "expected_payment_date": "2026-10-01T12:00:00Z",
    })
    assert pledge.status_code == 201, pledge.text

    rows = await ctx.client.get(f"/api/events/{event_id}/donations")
    assert rows.status_code == 200
    by_name = {row["donor_name"]: row for row in rows.json()}
    assert by_name["Follow Up Donor"]["contact_consent"] is True
    assert by_name["Follow Up Donor"]["donor_phone"] == "+15551234567"
    assert by_name["Pledge Follow Up"]["contact_consent"] is True
    assert by_name["Pledge Follow Up"]["donor_phone"] == "+15557654321"

    # Declining consent still lets the gift through -- it's optional.
    quiet = await ctx.client.post(f"/api/give/{token}/contributions", json={
        "channel": "zelle", "amount_minor": 1000, "donor_name": "Quiet Donor",
    })
    assert quiet.status_code == 201, quiet.text
    quiet_row = next(row for row in (await ctx.client.get(f"/api/events/{event_id}/donations")).json() if row["donor_name"] == "Quiet Donor")
    assert quiet_row["contact_consent"] is False


@pytest.mark.asyncio
async def test_discrepancy_flags_needs_attention_and_resolves_on_verify(ctx):
    ctx.login(ctx.ids["superadmin"])
    event_id = ctx.ids["event_a"]
    campaign = {
        "enabled": True, "title": "Support the mission", "description": None,
        "goal_minor": 0, "currency": "USD", "public_total_mode": "confirmed_and_pledged_separate",
        "show_donor_names": True, "show_donor_amounts": True, "show_pledged_total": True,
        "celebrate_milestones": False, "milestones_minor": [],
        "channels": [{"type": "bank_transfer", "enabled": True, "label": "Bank transfer"}],
    }
    saved = await ctx.client.put(f"/api/events/{event_id}/donation-campaign", json=campaign)
    token = saved.json()["public_token"]

    contribution = await ctx.client.post(f"/api/give/{token}/contributions", json={
        "channel": "bank_transfer", "amount_minor": 10000, "donor_name": "Discrepancy Donor",
    })
    contribution_id = contribution.json()["id"]

    snapshot = (await ctx.client.get(f"/api/events/{event_id}/donation-campaign")).json()
    assert snapshot["needs_attention_count"] == 0
    assert snapshot["total_potential_minor"] == 10000

    flagged = await ctx.client.post(
        f"/api/events/{event_id}/donations/{contribution_id}/discrepancy",
        json={"reported_amount_minor": 9000, "note": "Bank shows $90"},
    )
    assert flagged.status_code == 200, flagged.text
    assert flagged.json()["reported_amount_minor"] == 9000
    assert flagged.json()["status"] == "pending_verification"  # unchanged

    snapshot = (await ctx.client.get(f"/api/events/{event_id}/donation-campaign")).json()
    assert snapshot["needs_attention_count"] == 1

    resolved = await ctx.client.post(
        f"/api/events/{event_id}/donations/{contribution_id}/verify",
        json={"reported_amount_minor": 9000, "note": "Confirmed at bank amount"},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "confirmed"
    assert resolved.json()["amount_minor"] == 9000
    assert resolved.json()["reported_amount_minor"] is None

    snapshot = (await ctx.client.get(f"/api/events/{event_id}/donation-campaign")).json()
    assert snapshot["needs_attention_count"] == 0
    assert snapshot["confirmed_minor"] == 9000


@pytest.mark.asyncio
async def test_bulk_verify_confirms_multiple_and_reports_failures(ctx):
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
    token = saved.json()["public_token"]

    ids = []
    for i in range(3):
        r = await ctx.client.post(f"/api/give/{token}/contributions", json={
            "channel": "zelle", "amount_minor": 1000 * (i + 1), "donor_name": f"Bulk Donor {i}",
        })
        ids.append(r.json()["id"])

    result = await ctx.client.post(f"/api/events/{event_id}/donations/bulk-verify", json={
        "contribution_ids": ids + ["does-not-exist"], "note": "Batch confirmed",
    })
    assert result.status_code == 200, result.text
    body = result.json()
    assert set(body["confirmed"]) == set(ids)
    assert len(body["failed"]) == 1
    assert body["failed"][0]["id"] == "does-not-exist"

    rows = {row["id"]: row for row in (await ctx.client.get(f"/api/events/{event_id}/donations")).json()}
    for cid in ids:
        assert rows[cid]["status"] == "confirmed"


@pytest.mark.asyncio
async def test_audit_trail_and_csv_export(ctx):
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
    token = saved.json()["public_token"]
    contribution = await ctx.client.post(f"/api/give/{token}/contributions", json={
        "channel": "zelle", "amount_minor": 4200, "donor_name": "Audit Donor",
    })
    contribution_id = contribution.json()["id"]
    await ctx.client.post(f"/api/events/{event_id}/donations/{contribution_id}/verify", json={"note": "Zelle received"})

    audit = await ctx.client.get(f"/api/events/{event_id}/donations/audit")
    assert audit.status_code == 200
    entries = audit.json()
    assert any(e["contribution_id"] == contribution_id and e["to_status"] == "confirmed" and e["note"] == "Zelle received" for e in entries)
    assert entries[0]["donor_name"] == "Audit Donor"

    export = await ctx.client.get(f"/api/events/{event_id}/donations/export")
    assert export.status_code == 200
    assert export.headers["content-type"].startswith("text/csv")
    assert "Audit Donor" in export.text
    assert "42.0" in export.text or "42" in export.text


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
