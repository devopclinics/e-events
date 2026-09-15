import pytest
from sqlalchemy import select

from app.models import Event, Guest, GuestMealService, MealService, MenuCategory
from conftest import _Session


async def setup_meal(ctx, name):
    async with _Session() as session:
        event = await session.get(Event, ctx.ids["event_a"])
        event.is_paid = True
        event.menu_enabled = True
        category = MenuCategory(event_id=event.id, name=name, display_only=False)
        session.add(category)
        guest = (await session.execute(
            select(Guest).where(Guest.event_id == event.id)
        )).scalars().first()
        await session.commit()
        return event.id, category.id, guest.id


@pytest.mark.asyncio
async def test_repeat_meal_collection_is_idempotent(ctx):
    event_id, category_id, guest_id = await setup_meal(ctx, "NCNMO lunch")
    ctx.login(ctx.ids["user_a"])
    url = f"/api/events/{event_id}/menu-categories/{category_id}/guests/{guest_id}/served"

    first = await ctx.client.patch(url)
    second = await ctx.client.patch(url)

    assert first.status_code == 200 and first.json()["already_served"] is False
    assert second.status_code == 200 and second.json()["already_served"] is True
    async with _Session() as session:
        service = await session.scalar(select(MealService).where(MealService.category_id == category_id))
        row = await session.scalar(select(GuestMealService).where(
            GuestMealService.service_id == service.id,
            GuestMealService.guest_id == guest_id,
        ))
        assert second.json()["served_at"] == row.served_at.isoformat()


@pytest.mark.asyncio
async def test_ineligible_guest_cannot_collect_meal(ctx):
    event_id, category_id, guest_id = await setup_meal(ctx, "NCNMO restricted lunch")
    async with _Session() as session:
        service = MealService(event_id=event_id, category_id=category_id, name="Restricted", status="open")
        session.add(service)
        await session.flush()
        session.add(GuestMealService(
            service_id=service.id,
            guest_id=guest_id,
            eligibility_status="not_eligible",
        ))
        await session.commit()

    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.patch(
        f"/api/events/{event_id}/menu-categories/{category_id}/guests/{guest_id}/served"
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Guest is not eligible for this meal service"
