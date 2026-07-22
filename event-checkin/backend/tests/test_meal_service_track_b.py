"""Track B v2: MealService/GuestMealService replace the old category-keyed
GuestMealFulfillment. Covers the two write paths that touch it —
menu.py's per-category serve/unserve, and seating.py's single-button legacy
dual-write — plus the self-healing MealService creation and the
audit-preserving unserve (no more delete-on-reversal).
"""
import pytest
from sqlalchemy import select

from app.models import Event, Guest, GuestMealService, MealService, MenuCategory
from conftest import _Session


@pytest.mark.asyncio
async def test_mark_served_self_heals_meal_service_and_creates_audit_row(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        ev.menu_enabled = True
        cat = MenuCategory(event_id=ev.id, name="Dinner", display_only=False)
        s.add(cat)
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        await s.commit()
        cat_id, guest_id = cat.id, guest.id

    # No MealService exists yet for this category — the endpoint must create
    # one on demand rather than 404 or error.
    async with _Session() as s:
        assert (await s.scalar(select(MealService).where(MealService.category_id == cat_id))) is None

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.patch(
        f"/api/events/{ctx.ids['event_a']}/menu-categories/{cat_id}/guests/{guest_id}/served"
    )
    assert r.status_code == 200

    async with _Session() as s:
        service = await s.scalar(select(MealService).where(MealService.category_id == cat_id))
        assert service is not None
        row = await s.scalar(select(GuestMealService).where(
            GuestMealService.service_id == service.id, GuestMealService.guest_id == guest_id))
        assert row.fulfillment_status == "served"
        assert row.served_at is not None
        assert row.served_by_user_id == ctx.ids["user_a"].id

        guest = await s.get(Guest, guest_id)
        assert guest.meal_served is True


@pytest.mark.asyncio
async def test_unmark_served_preserves_audit_row_instead_of_deleting(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        ev.menu_enabled = True
        cat = MenuCategory(event_id=ev.id, name="Lunch", display_only=False)
        s.add(cat)
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        await s.commit()
        cat_id, guest_id = cat.id, guest.id

    ctx.login(ctx.ids["user_a"])
    await ctx.client.patch(f"/api/events/{ctx.ids['event_a']}/menu-categories/{cat_id}/guests/{guest_id}/served")

    r = await ctx.client.delete(f"/api/events/{ctx.ids['event_a']}/menu-categories/{cat_id}/guests/{guest_id}/served")
    assert r.status_code == 204

    async with _Session() as s:
        service = await s.scalar(select(MealService).where(MealService.category_id == cat_id))
        row = await s.scalar(select(GuestMealService).where(
            GuestMealService.service_id == service.id, GuestMealService.guest_id == guest_id))
        # The row must still exist (audit trail) — a prior version deleted it.
        assert row is not None
        assert row.fulfillment_status == "pending"
        assert row.served_at is None
        assert "alice@a.com" in row.override_reason

        guest = await s.get(Guest, guest_id)
        assert guest.meal_served is False


@pytest.mark.asyncio
async def test_legacy_single_button_dual_writes_guest_meal_service(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        ev.menu_enabled = True
        cat = MenuCategory(event_id=ev.id, name="Only Category", display_only=False)
        s.add(cat)
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        await s.commit()
        cat_id, guest_id = cat.id, guest.id

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.patch(f"/api/events/{ctx.ids['event_a']}/guests/{guest_id}/meal-served")
    assert r.status_code == 200

    async with _Session() as s:
        service = await s.scalar(select(MealService).where(MealService.category_id == cat_id))
        assert service is not None
        row = await s.scalar(select(GuestMealService).where(
            GuestMealService.service_id == service.id, GuestMealService.guest_id == guest_id))
        assert row is not None
        assert row.fulfillment_status == "served"

        guest = await s.get(Guest, guest_id)
        assert guest.meal_served is True


@pytest.mark.asyncio
async def test_legacy_single_button_skips_dual_write_when_categories_ambiguous(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        ev.menu_enabled = True
        s.add_all([
            MenuCategory(event_id=ev.id, name="Chicken", display_only=False),
            MenuCategory(event_id=ev.id, name="Fish", display_only=False),
        ])
        guest = (await s.execute(select(Guest).where(Guest.event_id == ev.id))).scalars().first()
        await s.commit()
        guest_id = guest.id

    ctx.login(ctx.ids["user_a"])
    r = await ctx.client.patch(f"/api/events/{ctx.ids['event_a']}/guests/{guest_id}/meal-served")
    assert r.status_code == 200

    async with _Session() as s:
        # Ambiguous which category this refers to — the legacy boolean still
        # flips, but no GuestMealService row should be fabricated.
        guest = await s.get(Guest, guest_id)
        assert guest.meal_served is True
        assert (await s.scalar(select(GuestMealService))) is None
