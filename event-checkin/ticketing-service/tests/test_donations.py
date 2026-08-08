"""Donation/sponsorship product schema validation — no DB required."""
import unittest

from pydantic import ValidationError

from app.schemas import OrderLineIn, ProductIn, AttendeeIn


class ProductInDonationTests(unittest.TestCase):
    def _base(self, **overrides):
        data = dict(name="Gold Sponsor", price=5000, currency="USD", capacity=10, **overrides)
        return data

    def test_ticket_is_the_default_type(self):
        product = ProductIn(**self._base())
        self.assertEqual(product.product_type, "ticket")
        self.assertFalse(product.allow_custom_amount)

    def test_donation_type_is_accepted(self):
        product = ProductIn(**self._base(product_type="donation"))
        self.assertEqual(product.product_type, "donation")

    def test_unknown_product_type_is_rejected(self):
        with self.assertRaises(ValidationError):
            ProductIn(**self._base(product_type="sponsorship"))

    def test_custom_amount_only_valid_on_donation_products(self):
        with self.assertRaises(ValidationError):
            ProductIn(**self._base(product_type="ticket", allow_custom_amount=True))

    def test_custom_amount_is_fine_on_a_donation_product(self):
        product = ProductIn(**self._base(product_type="donation", allow_custom_amount=True))
        self.assertTrue(product.allow_custom_amount)


class OrderLineCustomAmountTests(unittest.TestCase):
    def test_ordinary_ticket_line_has_no_custom_amount(self):
        line = OrderLineIn(product_id="p1", quantity=2,
                           attendees=[AttendeeIn(), AttendeeIn()])
        self.assertIsNone(line.custom_amount)

    def test_custom_amount_must_be_positive(self):
        with self.assertRaises(ValidationError):
            OrderLineIn(product_id="p1", quantity=1, attendees=[AttendeeIn()], custom_amount=0)

    def test_custom_amount_line_still_needs_one_attendee_slot(self):
        # Donations don't collect per-attendee identity in the UI, but the
        # schema's attendee_count invariant is shared across all product
        # types on purpose — the checkout client fills it from buyer info.
        with self.assertRaises(ValidationError):
            OrderLineIn(product_id="p1", quantity=1, attendees=[], custom_amount=5000)


if __name__ == "__main__":
    unittest.main()
