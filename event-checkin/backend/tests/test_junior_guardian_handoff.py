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
        event.guardian_authorizations = {child["id"]: [{"guardian_guest_id": guardian["id"], "relationship": "Parent"}]}
        await db.commit()

    missing = await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": "in"})
    assert missing.json()["denied"] is True
    wrong = await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": "in", "guardian_token": stranger["qr_token"]})
    assert wrong.json()["denied"] is True

    for direction in ("in", "out", "in", "out"):
        response = await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": direction, "guardian_token": guardian["qr_token"]})
        assert response.status_code == 200 and response.json()["denied"] is False
        assert response.json()["guardian_name"] == "Guardian Demo"
        assert response.json()["guardian_verification_method"] == "guardian_qr"

    async with _Session() as db:
        rows = (await db.execute(ScanEvent.__table__.select().where(ScanEvent.guest_id == child["id"]))).all()
        verified = [row for row in rows if row.guardian_guest_id]
        assert len(verified) == 4
        assert all(row.guardian_relationship == "Parent" and row.scanned_by == ctx.ids["superadmin"].id for row in verified)
