import pytest
from sqlalchemy import select

from app.models import Event, FestioMeOutbox, Guest
from app.services.festiome_outbox import guest_is_festiome_eligible
from conftest import _Session


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
