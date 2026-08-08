import unittest

from app.main import safe_payment_event_replay, safe_refund_retry
from app.schemas import OperationsSubscriptionIn


class RefundRetrySafetyTests(unittest.TestCase):
    def test_only_confirmed_failure_below_limit_can_retry(self):
        self.assertTrue(safe_refund_retry("failed", 0))
        self.assertFalse(safe_refund_retry("processing", 0))
        self.assertFalse(safe_refund_retry("retry_unknown", 1))
        self.assertFalse(safe_refund_retry("failed", 3))


class WebhookReplaySafetyTests(unittest.TestCase):
    def test_only_unprocessed_payment_success_is_replayable(self):
        self.assertTrue(safe_payment_event_replay("stripe", "checkout.session.completed", False, 1))
        self.assertTrue(safe_payment_event_replay("paystack", "charge.success", False, 4))
        self.assertFalse(safe_payment_event_replay("stripe", "charge.dispute.created", False, 1))
        self.assertFalse(safe_payment_event_replay("stripe", "checkout.session.completed", True, 1))
        self.assertFalse(safe_payment_event_replay("paystack", "charge.success", False, 5))


class OperationsScheduleTests(unittest.TestCase):
    def test_daily_and_weekly_are_valid_frequencies(self):
        self.assertEqual(OperationsSubscriptionIn(recipient="ops@example.com").frequency, "daily")
        self.assertEqual(OperationsSubscriptionIn(
            recipient="ops@example.com", frequency="weekly").frequency, "weekly")

    def test_arbitrary_frequency_is_rejected(self):
        with self.assertRaises(ValueError):
            OperationsSubscriptionIn(recipient="ops@example.com", frequency="hourly")


if __name__ == "__main__":
    unittest.main()
