import pytest

from app.models import Event, Guest, ScanEvent
from conftest import _Session


@pytest.mark.asyncio
async def test_guardian_handoff_is_opt_in_and_audited(ctx):
    event_id = ctx.ids["event_a"]
    ctx.login(ctx.ids["superadmin"])
    async with _Session() as db:
        event = await db.get(Event, event_id)
        event.is_paid = True
        event.status = "active"
        event.venue_access_enabled = True
        await db.commit()

    zone = (await ctx.client.post(f"/api/events/{event_id}/zones", json={"name": "Junior A", "direction_mode": "both"})).json()
    async def guest(first):
        response = await ctx.client.post(f"/api/events/{event_id}/guests", json={"first_name": first, "last_name": "Demo"})
        assert response.status_code == 201, response.text
        return response.json()

    child, guardian, stranger = await guest("Child"), await guest("Guardian"), await guest("Stranger")

    # Existing behavior is unchanged while the new capability is disabled.
    plain = await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": "in"})
    assert plain.status_code == 200 and plain.json()["denied"] is False
    await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": "out"})

    async with _Session() as db:
        event = await db.get(Event, event_id)
        event.junior_guardian_handoff_enabled = True
        event.separate_admission_access_enabled = True
        event.guardian_authorizations = {child["id"]: [{"guardian_guest_id": guardian["id"], "relationship": "Parent"}]}
        child_row = await db.get(Guest, child["id"])
        child_row.admitted = False
        child_row.admitted_at = None
        await db.commit()

    before_admission = await ctx.client.post(
        f"/api/scan/{child['qr_token']}/zone",
        json={"zone_id": zone["id"], "direction": "in", "guardian_token": guardian["qr_token"]},
    )
    assert before_admission.json()["denied"] is True
    assert "check in to the convention" in before_admission.json()["deny_reason"]

    admission = await ctx.client.post(f"/api/scan/{child['qr_token']}")
    assert admission.status_code == 200 and admission.json()["status"] == "admitted"

    missing = await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": "in"})
    assert missing.json()["denied"] is True
    wrong = await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": "in", "guardian_token": stranger["qr_token"]})
    assert wrong.json()["denied"] is True

    for direction in ("in", "out", "in", "out"):
        response = await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": direction, "guardian_token": guardian["qr_token"]})
        assert response.status_code == 200 and response.json()["denied"] is False
        assert response.json()["guardian_name"] == "Guardian Demo"
        assert response.json()["guardian_verification_method"] == "guardian_qr"

    config = await ctx.client.get(f"/api/events/{event_id}/access/guardian-authorizations")
    assert config.status_code == 200
    assert config.json()["authorizations"][0]["guardian_name"] == "Guardian Demo"

    update = await ctx.client.put(
        f"/api/events/{event_id}/access/guardian-authorizations",
        json={"enabled": True, "authorizations": [{
            "child_guest_id": child["id"], "guardian_guest_id": guardian["id"], "relationship": "Parent"
        }]},
    )
    assert update.status_code == 200 and update.json()["enabled"] is True

    movements = await ctx.client.get(f"/api/events/{event_id}/access/movements")
    assert movements.status_code == 200
    verified_movements = [row for row in movements.json() if row["guardian_guest_id"]]
    assert len(verified_movements) == 4
    assert all(row["guardian_name"] == "Guardian Demo" for row in verified_movements)

    journey = await ctx.client.get(f"/api/events/{event_id}/guests/{child['id']}/journey")
    assert journey.status_code == 200
    assert len([row for row in journey.json() if row["guardian_name"] == "Guardian Demo"]) == 4

    async with _Session() as db:
        rows = (await db.execute(ScanEvent.__table__.select().where(ScanEvent.guest_id == child["id"]))).all()
        verified = [row for row in rows if row.guardian_guest_id]
        assert len(verified) == 4
        assert all(row.guardian_relationship == "Parent" and row.scanned_by == ctx.ids["superadmin"].id for row in verified)
