"""Pure-function tests — no DB, no HTTP. Mirrors ticketing-service's
test_financial_integrity.py style: mock ORM objects with SimpleNamespace
since these functions only read attributes, never query."""
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.routers.budget import _rollup
from app.routers.documents import _safe_filename
from app.routers.timeline import _milestone_out, _starter_sections
from app.routers.runsheet import _conflict_map
from app.auth import Identity, ensure_capability
from app.schemas import BudgetIn, BudgetItemIn, ChangeOrderIn, QuoteSelectionIn, RunsheetItemIn, StarterPlanIn, VendorQuoteIn, VendorUpdate
from app.routers.procurement import _token_hash
from fastapi import HTTPException
from pydantic import ValidationError


def _task(status, **overrides):
    base = dict(id="t1", milestone_id="m1", title="Task", assigned_to=None, due_at=None,
                priority="normal", status=status, notes=None, vendor_id=None, created_at=datetime.utcnow())
    base.update(overrides)
    return SimpleNamespace(**base)


def _milestone(tasks):
    return SimpleNamespace(id="m1", event_id="e1", title="Milestone", description=None,
                            due_at=None, status="in_progress", sort_order=0, tasks=tasks)


class BudgetRollupTests(unittest.TestCase):
    def test_distinguishes_unset_actual_from_a_real_zero(self):
        # No item has `actual` set at all — total_remaining must fall back to
        # the estimate, not silently treat "unset" as "spent $0" (the bug in
        # dashboard.py's coalesce-to-0 version before the fix).
        item = SimpleNamespace(estimated=100.0, actual=None)
        category = SimpleNamespace(allocated=200.0, items=[item])
        budget = SimpleNamespace(total_budget=500.0, categories=[category])
        result = _rollup(budget)
        self.assertEqual(result["total_actual"], 0.0)          # display value
        self.assertEqual(result["total_remaining"], 400.0)     # 500 - estimated(100), not 500 - 0

    def test_a_real_zero_actual_is_not_confused_with_unset(self):
        item = SimpleNamespace(estimated=100.0, actual=0.0)
        category = SimpleNamespace(allocated=200.0, items=[item])
        budget = SimpleNamespace(total_budget=500.0, categories=[category])
        result = _rollup(budget)
        self.assertEqual(result["total_actual"], 0.0)
        self.assertEqual(result["total_remaining"], 500.0)     # 500 - actual(0), not 500 - estimated(100)

    def test_empty_budget_has_zero_everything(self):
        budget = SimpleNamespace(total_budget=0, categories=[])
        result = _rollup(budget)
        self.assertEqual(result, {
            "total_allocated": 0.0, "total_estimated": 0.0,
            "total_actual": 0.0, "total_remaining": 0.0,
        })


class MilestoneCompletionTests(unittest.TestCase):
    def test_completion_percent_rounds(self):
        tasks = [_task("done"), _task("done"), _task("todo")]
        out = _milestone_out(_milestone(tasks))
        self.assertEqual(out.completion_pct, 67)  # 2/3 rounds up from 66.67

    def test_no_tasks_is_zero_percent_not_a_crash(self):
        out = _milestone_out(_milestone([]))
        self.assertEqual(out.completion_pct, 0)


class StarterPlanTests(unittest.TestCase):
    def test_ticketed_plan_launches_sales_and_links_ticketing(self):
        plan = _starter_sections(StarterPlanIn(
            event_name="Summit", event_type="Conference", attendance_mode="ticketed",
            event_date="2026-12-10",
        ))
        launch_tasks = plan[1][2]
        self.assertEqual(launch_tasks[0][0], "Launch ticket sales")
        self.assertEqual(launch_tasks[0][1], "/ticketing-redesign")

    def test_rsvp_plan_uses_invitation_launch(self):
        plan = _starter_sections(StarterPlanIn(
            event_name="Wedding", attendance_mode="rsvp", event_date="2026-12-10",
        ))
        self.assertIn("RSVP", plan[1][2][0][0])


class SafeFilenameTests(unittest.TestCase):
    def test_strips_posix_path_traversal(self):
        self.assertEqual(_safe_filename("../../../etc/passwd"), "passwd")

    def test_strips_windows_style_traversal_via_charset(self):
        # os.path.basename doesn't split on backslash on POSIX, so the
        # character whitelist is what actually neutralizes this — without it
        # a name like this would survive into the stored path unchanged.
        result = _safe_filename("..\\..\\evil.exe")
        self.assertNotIn("/", result)
        self.assertNotIn("\\", result)

    def test_dots_only_name_falls_back_to_a_safe_default(self):
        self.assertEqual(_safe_filename("..."), "upload")

    def test_ordinary_name_is_left_alone(self):
        self.assertEqual(_safe_filename("vendor-contract.pdf"), "vendor-contract.pdf")

    def test_empty_or_none_falls_back(self):
        self.assertEqual(_safe_filename(""), "upload")
        self.assertEqual(_safe_filename(None), "upload")


class PlannerAuthorizationTests(unittest.TestCase):
    def test_admin_has_every_planner_capability(self):
        identity = Identity("u", "a@b.com", "A", "e", "o", "admin")
        ensure_capability(identity, "budget")

    def test_member_needs_explicit_domain_capability(self):
        identity = Identity("u", "a@b.com", "A", "e", "o", "member", ("tasks",))
        ensure_capability(identity, "tasks")
        with self.assertRaises(HTTPException) as raised:
            ensure_capability(identity, "budget")
        self.assertEqual(raised.exception.status_code, 403)


class PlannerInputIntegrityTests(unittest.TestCase):
    def test_rejects_negative_budget_and_invalid_currency(self):
        with self.assertRaises(ValidationError):
            BudgetIn(total_budget=-1, currency="dollars")

    def test_rejects_invalid_cost_status(self):
        with self.assertRaises(ValidationError):
            BudgetItemIn(name="Venue", estimated=1, status="approved")

    def test_rejects_vendor_rating_outside_five_stars(self):
        with self.assertRaises(ValidationError):
            VendorUpdate(rating=7)

    def test_runsheet_requires_timezone_aware_ordered_datetimes(self):
        with self.assertRaises(ValidationError):
            RunsheetItemIn(start_time="09:00", end_time="10:00", title="Doors", start_at=datetime(2026, 1, 1, 9))
        with self.assertRaises(ValidationError):
            RunsheetItemIn(
                start_time="10:00", end_time="09:00", title="Doors",
                start_at=datetime(2026, 1, 1, 10, tzinfo=timezone.utc),
                end_at=datetime(2026, 1, 1, 9, tzinfo=timezone.utc),
            )

    def test_procurement_rejects_negative_quotes_and_bad_currency(self):
        with self.assertRaises(ValidationError):
            VendorQuoteIn(title="Venue", amount=-1, currency="USD")
        with self.assertRaises(ValidationError):
            VendorQuoteIn(title="Venue", amount=100, currency="NAIRA")

    def test_change_orders_allow_bounded_positive_or_negative_adjustments(self):
        self.assertEqual(ChangeOrderIn(title="Remove chairs", amount_delta=-250).amount_delta, -250)

    def test_vendor_portal_tokens_are_stored_as_irreversible_hashes(self):
        raw = "secret-link-value"
        self.assertNotEqual(_token_hash(raw), raw)
        self.assertEqual(_token_hash(raw), _token_hash(raw))

    def test_item_selection_rejects_negative_price_or_zero_quantity(self):
        with self.assertRaises(ValidationError):
            QuoteSelectionIn(comparison_group="Catering", item_key="rice::tray", item_name="Rice", quote_id="q", vendor_id="v", unit_price=-1)
        with self.assertRaises(ValidationError):
            QuoteSelectionIn(comparison_group="Catering", item_key="rice::tray", item_name="Rice", quote_id="q", vendor_id="v", unit_price=1, quantity=0)


class RunsheetConflictTests(unittest.TestCase):
    def test_flags_overlapping_owner_or_location_only(self):
        start = datetime(2026, 1, 1, 9, tzinfo=timezone.utc)
        def item(item_id, owner, location, offset=0):
            return SimpleNamespace(
                id=item_id, owner=owner, location=location,
                start_at=start + timedelta(minutes=offset),
                end_at=start + timedelta(minutes=offset + 60),
            )
        conflicts = _conflict_map([
            item("a", "Alex", "Hall A"),
            item("b", "Alex", "Hall B", 30),
            item("c", "Sam", "Hall A", 15),
            item("d", "Sam", "Hall B", 120),
        ])
        self.assertEqual(set(conflicts["a"]), {"b", "c"})
        self.assertEqual(conflicts["d"], [])


if __name__ == "__main__":
    unittest.main()
