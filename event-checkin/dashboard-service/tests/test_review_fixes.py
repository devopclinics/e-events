"""Regression coverage for the command-center review fixes."""
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.auth import require_dashboard_access
from app.main import _consent_step, _parse_session_dt
from app.models import (
    EmailDeliveryEvent, Event, EventUser, ExperienceStep, ExperienceWorkflow,
    GuestMealFulfillment, GuestMenuChoice, MenuCategory, Membership, ScanEvent,
    User, Zone,
)


async def _set_event(ctx, **values):
    async with ctx.session_factory() as s:
        event = await s.get(Event, ctx.event_id)
        for key, value in values.items():
            setattr(event, key, value)
        await s.commit()


async def test_current_day_is_live_not_upcoming(ctx):
    now = datetime.now(UTC).replace(tzinfo=None)
    await _set_event(
        ctx,
        event_date=now.replace(hour=12, minute=0, second=0, microsecond=0),
        event_end_date=None,
        timezone="UTC",
    )
    payload = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/attendance"
    )).json()
    assert payload["by_day"][0]["status"] == "live"
    assert payload["by_day"][0]["upcoming"] is False


async def test_future_scope_has_no_fake_current_occupancy(ctx):
    payload = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/attendance?day=2026-08-02"
    )).json()
    assert payload["occupancy_mode"] == "future"
    assert payload["on_site"] is None
    assert payload["occupancy_as_of"] is None


async def test_custom_range_validation(ctx):
    missing_end = await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/attendance?start=2026-08-02"
    )
    assert missing_end.status_code == 400

    reversed_range = await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/attendance?start=2026-08-03&end=2026-08-02"
    )
    assert reversed_range.status_code == 400


async def test_zone_filter_restricts_attendance_and_occupancy(ctx):
    await _set_event(ctx, venue_access_enabled=True)
    async with ctx.session_factory() as s:
        zone_a = Zone(id="zone-a", event_id=ctx.event_id, name="Hall A", is_active=True)
        zone_b = Zone(id="zone-b", event_id=ctx.event_id, name="Hall B", is_active=True)
        s.add_all([zone_a, zone_b])
        guest_a = await ctx.add_guest(s, id="guest-a")
        guest_b = await ctx.add_guest(s, id="guest-b")
        await ctx.add_scan(s, guest_a.id, "in", datetime(2026, 8, 2, 12), zone_id=zone_a.id)
        await ctx.add_scan(s, guest_b.id, "in", datetime(2026, 8, 2, 12), zone_id=zone_b.id)
        await s.commit()

    payload = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/command-center?day=2026-08-02&venue_id=zone-a"
    )).json()
    assert payload["attendance"]["checked_in"] == 1
    assert [z["id"] for z in payload["venue_occupancy"]] == ["zone-a"]
    assert "venue_occupancy" in payload["venue_scoped_sections"]


async def test_rsvp_funnel_distinguishes_guests_from_sent_invites(ctx):
    async with ctx.session_factory() as s:
        await ctx.add_guest(s, id="sent", invite_status="sent")
        await ctx.add_guest(s, id="unsent", invite_status=None)
        await s.commit()
    payload = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/invitations"
    )).json()["rsvp_funnel"]
    assert payload["guests"] == 2
    assert payload["invited"] == 1


async def test_email_reached_requires_confirmed_delivery(ctx):
    async with ctx.session_factory() as s:
        s.add_all([
            EmailDeliveryEvent(
                id="email-sent", event_id=ctx.event_id, provider_email_id="p1",
                provider_event_id="e1", status="sent", occurred_at=datetime(2026, 8, 1),
            ),
            EmailDeliveryEvent(
                id="email-delivered", event_id=ctx.event_id, provider_email_id="p2",
                provider_event_id="e2", status="delivered", occurred_at=datetime(2026, 8, 1),
            ),
        ])
        await s.commit()
    email = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/invitations"
    )).json()["communication"]["email"]
    assert email == {"sent": 2, "reached": 1, "rate": 50}


async def test_only_published_workflow_drives_consent(ctx):
    await _set_event(ctx, experience_enabled=True)
    async with ctx.session_factory() as s:
        draft = ExperienceWorkflow(
            id="draft", event_id=ctx.event_id, name="Draft", status="draft",
            version=2, is_default=True, created_at=datetime(2026, 8, 1),
        )
        published = ExperienceWorkflow(
            id="published", event_id=ctx.event_id, name="Published", status="published",
            version=1, is_default=False, created_at=datetime(2026, 7, 1),
        )
        s.add_all([draft, published])
        s.add_all([
            ExperienceStep(id="draft-consent", workflow_id=draft.id, key="draft", type="consent", title="Draft consent"),
            ExperienceStep(id="live-consent", workflow_id=published.id, key="live", type="consent", title="Live consent"),
        ])
        await s.commit()
        consent = await _consent_step(s, ctx.event_id)
        assert consent.id == "live-consent"


def test_session_datetime_uses_event_timezone():
    session = {"date": "2026-07-22", "start_time": "10:00"}
    parsed = _parse_session_dt(session, "start_time", ZoneInfo("America/Chicago"))
    assert parsed == datetime(2026, 7, 22, 15, 0)


async def test_meal_totals_count_distinct_guests(ctx):
    await _set_event(ctx, menu_enabled=True)
    async with ctx.session_factory() as s:
        guest = await ctx.add_guest(s, id="meal-guest")
        breakfast = MenuCategory(id="breakfast", event_id=ctx.event_id, name="Breakfast", display_only=False)
        lunch = MenuCategory(id="lunch", event_id=ctx.event_id, name="Lunch", display_only=False)
        s.add_all([breakfast, lunch])
        await s.flush()
        s.add_all([
            GuestMenuChoice(id="choice-1", guest_id=guest.id, category_id=breakfast.id),
            GuestMenuChoice(id="choice-2", guest_id=guest.id, category_id=lunch.id),
            GuestMealFulfillment(id="served-1", guest_id=guest.id, category_id=breakfast.id, status="served"),
            GuestMealFulfillment(id="served-2", guest_id=guest.id, category_id=lunch.id, status="served"),
        ])
        await s.commit()
    payload = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/meals"
    )).json()
    assert payload["eligible_total"] == 1
    assert payload["served_total"] == 1
    assert len(payload["categories"]) == 2


async def test_dashboard_permission_allows_event_staff(ctx):
    async with ctx.session_factory() as s:
        staff = User(id="staff", email="staff@test.com", is_active=True)
        s.add(staff)
        s.add(Membership(id="staff-membership", org_id=ctx.org_id, user_id=staff.id, role="staff"))
        s.add(EventUser(
            id="event-staff", event_id=ctx.event_id, user_id=staff.id,
            event_role="staff", can_view_dashboard=True,
        ))
        await s.commit()
        event = await require_dashboard_access(ctx.event_id, staff, s)
        assert event.id == ctx.event_id
