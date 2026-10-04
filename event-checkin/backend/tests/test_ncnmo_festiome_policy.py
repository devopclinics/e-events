from datetime import datetime

import pytest
from sqlalchemy import select

from app.models import Event, FestioMeOutbox, Guest
from app.services.festiome_outbox import guest_is_festiome_eligible
from conftest import _Session
from app.main import app
from app.services.festiome_client import get_festiome_client
from test_festiome_integration import FakeFestioMeClient


@pytest.mark.asyncio
@pytest.mark.parametrize("rsvp_enabled,status", [(True, "confirmed"), (False, "invited")])
async def test_valid_attending_pass_explains_adult_approval_and_allows_after_approval(ctx, rsvp_enabled, status):
    app.dependency_overrides[get_festiome_client] = lambda: FakeFestioMeClient()
    event_id = ctx.ids["event_a"]
    async with _Session() as session:
        event = await session.get(Event, event_id)
        event.is_paid = True
        event.festiome_addon_enabled = True
        event.rsvp_enabled = rsvp_enabled
        event.festiome_access_policy = {"mode": "approved_adults", "adult_guest_ids": []}
        guest = await session.scalar(select(Guest).where(Guest.event_id == event_id))
        guest.rsvp_status = status
        guest_id, token = guest.id, guest.qr_token
        other_event = Event(org_id=ctx.ids["org_b"], name="Other event", couples_name="Other",
                            checkin_base_url="http://test", event_date=datetime(2026, 12, 24))
        session.add(other_event)
        await session.commit()
        other_event_id = other_event.id

    path = f"/api/events/{event_id}/festiome/guest-token"
    denied = await ctx.client.post(path, json={"pass_token": token})
    assert denied.status_code == 403
    assert "Your pass is valid" in denied.json()["detail"]
    assert "approved adults" in denied.json()["detail"]
    assert (await ctx.client.post(path, json={"pass_token": "00000000-0000-0000-0000-000000000000"})).status_code == 404
    cross_event = f"/api/events/{other_event_id}/festiome/guest-token"
    assert (await ctx.client.post(cross_event, json={"pass_token": token})).status_code == 404

    async with _Session() as session:
        event = await session.get(Event, event_id)
        event.festiome_access_policy = {"mode": "approved_adults", "adult_guest_ids": [guest_id]}
        await session.commit()
    assert (await ctx.client.post(path, json={"pass_token": token})).status_code == 200

    async with _Session() as session:
        guest = await session.get(Guest, guest_id)
        guest.rsvp_status = "declined"
        await session.commit()
    assert (await ctx.client.post(path, json={"pass_token": token})).status_code == 404


@pytest.mark.asyncio
async def test_approved_adults_policy_excludes_every_other_guest(ctx):
    event_id = ctx.ids["event_a"]
    async with _Session() as session:
        event = await session.get(Event, event_id)
        event.is_paid = True
        event.festiome_addon_enabled = True
        guests = (await session.execute(
            select(Guest).where(Guest.event_id == event_id)
        )).scalars().all()
        approved = guests[0]
        approved.rsvp_status = "confirmed"
        child = Guest(
            event_id=event_id,
            first_name="Demo",
            last_name="Child",
            email="demo.child@example.com",
            rsvp_status="confirmed",
        )
        session.add(child)
        await session.flush()
        event.festiome_access_policy = {
            "mode": "approved_adults",
            "adult_guest_ids": [approved.id],
        }
        await session.commit()
        assert guest_is_festiome_eligible(approved, event) is True
        assert guest_is_festiome_eligible(child, event) is False


@pytest.mark.asyncio
async def test_admin_policy_update_queues_upserts_and_removals(ctx):
    event_id = ctx.ids["event_a"]
    async with _Session() as session:
        event = await session.get(Event, event_id)
        event.is_paid = True
        event.festiome_addon_enabled = True
        guests = (await session.execute(
            select(Guest).where(Guest.event_id == event_id)
        )).scalars().all()
        approved = guests[0]
        approved.rsvp_status = "confirmed"
        child = Guest(
            event_id=event_id,
            first_name="Demo",
            last_name="Child",
            email="demo.child@example.com",
            rsvp_status="confirmed",
        )
        session.add(child)
        await session.commit()
        approved_id, child_id = approved.id, child.id

    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.put(
        f"/api/events/{event_id}/festiome/access-policy",
        json={"mode": "approved_adults", "adult_guest_ids": [approved_id]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["adult_guest_ids"] == [approved_id]
    async with _Session() as session:
        commands = (await session.execute(select(FestioMeOutbox))).scalars().all()
        by_guest = {row.payload["guest_ref"]: row.command for row in commands}
        assert by_guest[approved_id] == "member.upsert"
        assert by_guest[child_id] == "member.remove"


@pytest.mark.asyncio
async def test_adult_approvals_are_event_admin_only_and_validate_guest_ids(ctx):
    event_id = ctx.ids["event_a"]
    async with _Session() as session:
        event = await session.get(Event, event_id)
        event.is_paid = True
        guest = await session.scalar(select(Guest).where(Guest.event_id == event_id))
        event.festiome_access_policy = {"mode": "approved_adults", "adult_guest_ids": [guest.id]}
        guest_id = guest.id
        await session.commit()
    path = f"/api/events/{event_id}/festiome/access-policy"
    ctx.login(ctx.ids["user_b"])
    assert (await ctx.client.get(path)).status_code == 404
    assert (await ctx.client.put(path, json={"mode": "all_eligible"})).status_code == 404
    ctx.login(ctx.ids["user_a"])
    data = (await ctx.client.get(path)).json()
    assert data["adult_guest_ids"] == [guest_id]
    assert data["guests"][0]["approved"] is True
    response = await ctx.client.put(path, json={"mode": "approved_adults", "adult_guest_ids": ["not-in-this-event"]})
    assert response.status_code == 400
    assert (await ctx.client.get(path)).json()["adult_guest_ids"] == [guest_id]
