import unittest
from types import SimpleNamespace
from pydantic import ValidationError

from app.main import add_journal, allocate_ticket_values
from app.schemas import RefundIn


class TicketAllocationTests(unittest.TestCase):
    def test_allocation_is_exact_and_weighted(self):
        values = allocate_ticket_values(1001, [500, 500, 1000])
        self.assertEqual(sum(values), 1001)
        self.assertEqual(values, [251, 250, 500])

    def test_free_ticket_allocation_is_exact(self):
        values = allocate_ticket_values(10, [0, 0, 0])
        self.assertEqual(values, [4, 3, 3])

    def test_empty_allocation(self):
        self.assertEqual(allocate_ticket_values(100, []), [])


class RefundSchemaTests(unittest.TestCase):
    def test_ticket_level_refund(self):
        body = RefundIn(guest_ids=["guest-a", "guest-b"], reason="event cancellation")
        self.assertIsNone(body.amount)

    def test_amount_and_ticket_selection_are_mutually_exclusive(self):
        with self.assertRaises(ValidationError):
            RefundIn(amount=500, guest_ids=["guest-a"])

    def test_duplicate_ticket_is_rejected(self):
        with self.assertRaises(ValidationError):
            RefundIn(guest_ids=["guest-a", "guest-a"])


class JournalTests(unittest.TestCase):
    def test_payment_and_refund_transactions_balance(self):
        class Session:
            def __init__(self): self.rows = []
            def add(self, row): self.rows.append(row)

        order = SimpleNamespace(id="order-1", event_id="event-1", total=10_000,
                                platform_fee=500, tax_amount=750, currency="NGN")
        for kind, amount in (("payment", 10_000), ("refund", 3_333)):
            db = Session()
            transaction_id = add_journal(db, order, kind=kind, amount=amount)
            lines = [row for row in db.rows if row.transaction_id == transaction_id]
            self.assertEqual(sum(row.debit for row in lines), sum(row.credit for row in lines))
            self.assertEqual(sum(row.debit for row in lines), amount)

    def test_organizer_borne_costs_above_cash_create_receivable(self):
        class Session:
            def __init__(self): self.rows = []
            def add(self, row): self.rows.append(row)
        order = SimpleNamespace(id="order-2", event_id="event-1", total=100,
                                platform_fee=50, tax_amount=100, currency="USD")
        db = Session()
        add_journal(db, order, kind="payment", amount=100)
        self.assertEqual(sum(row.debit for row in db.rows), sum(row.credit for row in db.rows))
        self.assertTrue(any(row.account == "organizer_receivable" and row.debit == 50 for row in db.rows))


if __name__ == "__main__":
    unittest.main()
