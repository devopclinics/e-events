"""Regression coverage for the command-center review fixes."""
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.auth import require_dashboard_access
from app.main import _consent_step, _parse_session_dt
from app.models import (
    EmailDeliveryEvent, Event, EventUser, ExperienceStep, ExperienceWorkflow,
    GuestExperienceProgress, GuestMealService, GuestMenuChoice, MealService, MenuCategory,
    Membership, ScanEvent, SeatingTable, User, Zone,
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


async def test_legacy_admitted_guests_backfill_attendance_without_scan_events(ctx):
    await _set_event(ctx, event_date=datetime(2026, 7, 1, 16), event_end_date=None)
    admitted_at = datetime(2026, 7, 1, 18, 30)
    async with ctx.session_factory() as s:
        await ctx.add_guest(s, id="legacy-regular", admitted=True, admitted_at=admitted_at)
        await ctx.add_guest(
            s, id="legacy-walkin", admitted=True,
            admitted_at=admitted_at + timedelta(minutes=5), is_walk_in=True,
        )
        await ctx.add_guest(s, id="not-here", admitted=False)
        await s.commit()

    payload = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/command-center"
    )).json()
    attendance = payload["attendance"]
    assert attendance["checked_in"] == 2
    assert attendance["first_time"] == 2
    assert attendance["on_site"] == 2
    assert attendance["walk_ins"] == 1
    assert attendance["confirmed_not_here"] == 1
    assert attendance["arrival_gap_mode"] == "confirmed"
    assert sum(hour["first_arrival"] for hour in attendance["hourly"]) == 2
    assert len(payload["recent_activity"]) == 2


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


async def test_program_combines_timed_agenda_and_attendance_sessions(ctx):
    await _set_event(ctx, experience_enabled=True, timezone="UTC")
    async with ctx.session_factory() as s:
        workflow = ExperienceWorkflow(
            id="program-workflow", event_id=ctx.event_id, name="Program",
            status="published", version=1, is_default=True,
        )
        agenda = ExperienceStep(
            id="agenda-talk", workflow_id=workflow.id, key="talk", type="custom",
            title="Opening talk", enabled=True, is_segment=True,
            starts_offset_seconds=3600, duration_seconds=1800,
            config={"program": {"category": "program"}},
        )
        checkin = ExperienceStep(
            id="day-two-checkin", workflow_id=workflow.id, key="day2", type="session_attendance",
            title="Day 2 Check-in", enabled=True,
            config={"session": {
                "date": "2026-08-03", "start_time": "09:00", "end_time": "10:00",
            }},
        )
        guest = await ctx.add_guest(s, id="program-guest")
        s.add_all([workflow, agenda, checkin])
        await s.flush()
        s.add(GuestExperienceProgress(
            id="program-progress", event_id=ctx.event_id, workflow_id=workflow.id,
            step_id=checkin.id, guest_id=guest.id, status="completed",
        ))
        await s.commit()

    payload = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/program"
    )).json()
    assert [item["topic"] for item in payload["sessions"]] == ["Opening talk", "Day 2 Check-in"]
    talk, tracked = payload["sessions"]
    assert talk["day"] == "2026-08-02"
    assert talk["category"] == "program"
    assert talk["attendance_tracked"] is False
    assert talk["attended"] is None
    assert tracked["attendance_tracked"] is True
    assert tracked["attended"] == 1
    assert payload["attendance_tracked_count"] == 1

    day_two = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/program?day=2026-08-03"
    )).json()
    assert [item["topic"] for item in day_two["sessions"]] == ["Day 2 Check-in"]


async def test_meal_totals_count_distinct_guests(ctx):
    await _set_event(ctx, menu_enabled=True)
    async with ctx.session_factory() as s:
        guest = await ctx.add_guest(s, id="meal-guest")
        breakfast = MenuCategory(id="breakfast", event_id=ctx.event_id, name="Breakfast", display_only=False)
        lunch = MenuCategory(id="lunch", event_id=ctx.event_id, name="Lunch", display_only=False)
        s.add_all([breakfast, lunch])
        await s.flush()
        breakfast_svc = MealService(id="svc-breakfast", event_id=ctx.event_id, category_id=breakfast.id, name="Breakfast")
        lunch_svc = MealService(id="svc-lunch", event_id=ctx.event_id, category_id=lunch.id, name="Lunch")
        s.add_all([breakfast_svc, lunch_svc])
        await s.flush()
        s.add_all([
            GuestMenuChoice(id="choice-1", guest_id=guest.id, category_id=breakfast.id),
            GuestMenuChoice(id="choice-2", guest_id=guest.id, category_id=lunch.id),
            GuestMealService(id="served-1", service_id=breakfast_svc.id, guest_id=guest.id, fulfillment_status="served"),
            GuestMealService(id="served-2", service_id=lunch_svc.id, guest_id=guest.id, fulfillment_status="served"),
        ])
        await s.commit()
    payload = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/meals"
    )).json()
    assert payload["eligible_total"] == 1
    assert payload["served_total"] == 1
    assert len(payload["categories"]) == 2


async def test_alert_guests_no_contact_info(ctx):
    async with ctx.session_factory() as s:
        await ctx.add_guest(s, id="no-contact", email=None, phone=None)
        await ctx.add_guest(s, id="has-email", email="a@test.com", phone=None)
        await s.commit()

    payload = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/alerts/no_contact_info/guests"
    )).json()
    assert [g["id"] for g in payload["guests"]] == ["no-contact"]


async def test_alert_guests_tables_over_capacity_includes_context(ctx):
    await _set_event(ctx, seating_enabled=True)
    async with ctx.session_factory() as s:
        table = SeatingTable(id="table-1", event_id=ctx.event_id, name="Table 1", capacity=1)
        s.add(table)
        await s.flush()
        await ctx.add_guest(s, id="overbook-a", table_id=table.id)
        await ctx.add_guest(s, id="overbook-b", table_id=table.id)
        await s.commit()

    payload = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/alerts/tables_over_capacity/guests"
    )).json()
    ids = {g["id"] for g in payload["guests"]}
    assert ids == {"overbook-a", "overbook-b"}
    assert all("Table 1" in g["context"] for g in payload["guests"])


async def test_alert_guests_unknown_type_404s(ctx):
    resp = await ctx.client.get(f"/api/results/events/{ctx.event_id}/alerts/not_a_real_alert/guests")
    assert resp.status_code == 404


async def test_experience_step_guests_only_returns_failed_status(ctx):
    await _set_event(ctx, experience_enabled=True)
    async with ctx.session_factory() as s:
        workflow = ExperienceWorkflow(
            id="wf-blocked", event_id=ctx.event_id, name="Consent", status="published",
            version=1, is_default=True,
        )
        step = ExperienceStep(
            id="consent-step", workflow_id=workflow.id, key="consent", type="consent",
            title="Consent", enabled=True,
        )
        blocked_guest = await ctx.add_guest(s, id="blocked-guest")
        started_guest = await ctx.add_guest(s, id="not-started-guest")
        s.add_all([workflow, step])
        await s.flush()
        s.add_all([
            GuestExperienceProgress(
                id="prog-failed", event_id=ctx.event_id, workflow_id=workflow.id,
                step_id=step.id, guest_id=blocked_guest.id, status="failed",
            ),
            GuestExperienceProgress(
                id="prog-not-started", event_id=ctx.event_id, workflow_id=workflow.id,
                step_id=step.id, guest_id=started_guest.id, status="not_started",
            ),
        ])
        await s.commit()

    payload = (await ctx.client.get(
        f"/api/results/events/{ctx.event_id}/analytics/experience/steps/{step.id}/guests"
    )).json()
    assert [g["id"] for g in payload["guests"]] == ["blocked-guest"]
    assert payload["step_title"] == "Consent"


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
