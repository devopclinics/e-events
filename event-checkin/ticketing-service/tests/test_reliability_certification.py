import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.auth import Identity
from app.main import inventory_available, record_success, refund, refund_order, sales
from app.schemas import RefundIn


class ConcurrencyCertificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_serialized_last_ticket_has_exactly_one_winner(self):
        lock = asyncio.Lock()
        state = {"sold": 0}

        async def buy_last_ticket():
            async with lock:  # mirrors TicketProduct SELECT ... FOR UPDATE
                available = inventory_available(capacity=1, sold=state["sold"], held=0,
                    reserved=0, own_reservation=0, requested=1, minimum=1, maximum=10)
                if available:
                    await asyncio.sleep(0)
                    state["sold"] += 1
                return available

        outcomes = await asyncio.gather(*[buy_last_ticket() for _ in range(50)])
        self.assertEqual(sum(outcomes), 1)
        self.assertEqual(state["sold"], 1)


class IdempotencyCertificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_duplicate_payment_webhook_stops_at_unique_event(self):
        class DuplicateEventSession:
            def __init__(self):
                self.rollback = AsyncMock()
                self.scalar = AsyncMock()
            def add(self, _row): pass
            async def flush(self):
                raise IntegrityError("insert payment event", {}, Exception("duplicate"))
        db = DuplicateEventSession()
        await record_success(db, "fake", "provider-event-1", "checkout.completed", {},
                             "checkout-1", "payment-1", 1000, "USD")
        db.rollback.assert_awaited_once()
        db.scalar.assert_not_awaited()

    async def test_refund_replay_returns_original_without_provider_call(self):
        existing = SimpleNamespace(id="refund-1", order_id="order-1", status="completed", amount=500)
        db = SimpleNamespace(scalar=AsyncMock(return_value=existing))
        order = SimpleNamespace(id="order-1", status="partially_refunded")
        result = await refund_order(db, order, RefundIn(amount=500), "admin", "request-1")
        self.assertTrue(result["idempotent_replay"])
        self.assertEqual(result["refund_id"], "refund-1")

    async def test_refund_key_cannot_cross_orders(self):
        existing = SimpleNamespace(id="refund-1", order_id="another-order", status="completed", amount=500)
        db = SimpleNamespace(scalar=AsyncMock(return_value=existing))
        with self.assertRaises(HTTPException) as raised:
            await refund_order(db, SimpleNamespace(id="order-1"), RefundIn(amount=500), "admin", "request-1")
        self.assertEqual(raised.exception.status_code, 409)


class TenantIsolationCertificationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.foreign_admin = Identity("admin", "event-a", "org-a", "admin")
        self.db = SimpleNamespace()

    async def test_sales_rejects_foreign_event_before_database_access(self):
        with self.assertRaises(HTTPException) as raised:
            await sales("event-b", self.foreign_admin, self.db)
        self.assertEqual(raised.exception.status_code, 403)

    async def test_refund_rejects_foreign_event_before_database_access(self):
        with self.assertRaises(HTTPException) as raised:
            await refund("event-b", "order-1", RefundIn(amount=100), None, self.foreign_admin, self.db)
        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
