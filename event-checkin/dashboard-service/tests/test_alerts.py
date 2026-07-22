"""Regression tests for the alert-eligibility bug found via the Women's
Convention import: events that skip RSVP leave every guest at rsvp_status
"invited" forever, so alerts must use "not declined", not "== confirmed"."""
from app.models import Event, Guest, MenuCategory


async def _enable_menu(ctx):
    async with ctx.session_factory() as s:
        ev = await s.get(Event, ctx.event_id)
        ev.menu_enabled = True
        await s.commit()


async def test_missing_meal_alert_fires_for_invited_not_just_confirmed(ctx):
    await _enable_menu(ctx)
    async with ctx.session_factory() as s:
        cat = MenuCategory(id="cat1", event_id=ctx.event_id, name="Lunch", display_only=False)
        s.add(cat)
        # RSVP-skipping event: guest never leaves "invited".
        await ctx.add_guest(s, id="g1", rsvp_status="invited")
        await s.commit()

    resp = (await ctx.client.get(f"/api/results/events/{ctx.event_id}/command-center")).json()
    alert = next((a for a in resp["alerts"] if a["type"] == "missing_meal_selection"), None)
    assert alert is not None, "invited (not declined) guests must count as eligible for the meal alert"
    assert alert["count"] == 1


async def test_missing_meal_alert_excludes_declined(ctx):
    await _enable_menu(ctx)
    async with ctx.session_factory() as s:
        s.add(MenuCategory(id="cat1", event_id=ctx.event_id, name="Lunch", display_only=False))
        await ctx.add_guest(s, id="g1", rsvp_status="declined")
        await s.commit()

    resp = (await ctx.client.get(f"/api/results/events/{ctx.event_id}/command-center")).json()
    alert = next((a for a in resp["alerts"] if a["type"] == "missing_meal_selection"), None)
    assert alert is None


async def test_missing_meal_alert_silent_when_all_categories_display_only(ctx):
    """An informational-only menu (all display_only) has nothing to "miss" —
    this guards against a false "N missing" alert when there's no selectable
    category at all (the Women's Convention case)."""
    await _enable_menu(ctx)
    async with ctx.session_factory() as s:
        s.add(MenuCategory(id="cat1", event_id=ctx.event_id, name="Menu", display_only=True))
        await ctx.add_guest(s, id="g1", rsvp_status="invited")
        await s.commit()

    resp = (await ctx.client.get(f"/api/results/events/{ctx.event_id}/command-center")).json()
    assert all(a["type"] != "missing_meal_selection" for a in resp["alerts"])


async def test_low_credits_alert(ctx):
    async with ctx.session_factory() as s:
        ev = await s.get(Event, ctx.event_id)
        ev.message_credits = 5
        await s.commit()

    resp = (await ctx.client.get(f"/api/results/events/{ctx.event_id}/command-center")).json()
    alert = next((a for a in resp["alerts"] if a["type"] == "low_credits"), None)
    assert alert is not None
    assert alert["count"] == 5


async def test_no_low_credits_alert_above_threshold(ctx):
    async with ctx.session_factory() as s:
        ev = await s.get(Event, ctx.event_id)
        ev.message_credits = 500
        await s.commit()

    resp = (await ctx.client.get(f"/api/results/events/{ctx.event_id}/command-center")).json()
    assert all(a["type"] != "low_credits" for a in resp["alerts"])
