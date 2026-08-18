from datetime import datetime
from typing import Literal
from pydantic import BaseModel, EmailStr, Field, model_validator


class CheckoutFieldIn(BaseModel):
    id: str = Field(min_length=1, max_length=50, pattern="^[A-Za-z0-9_-]+$")
    label: str = Field(min_length=1, max_length=120)
    type: Literal["text", "textarea", "select", "checkbox"] = "text"
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def select_options(self):
        if self.type == "select" and not self.options:
            raise ValueError("select fields require at least one option")
        return self


class EventConfigIn(BaseModel):
    enabled: bool = False
    currency: str = Field(default="USD", pattern="^[A-Z]{3}$")
    provider: str = Field(default="stripe", pattern="^(stripe|paystack|fake)$")
    provider_account_id: str | None = None
    fees_paid_by: str = Field(default="buyer", pattern="^(buyer|organizer)$")
    public_listing: bool = False
    tax_enabled: bool = False
    tax_bps: int = Field(default=0, ge=0, le=10000)
    tax_paid_by: str = Field(default="buyer", pattern="^(buyer|organizer)$")
    checkout_fields: list[CheckoutFieldIn] | None = Field(default=None, max_length=30)
    delivery_settings: dict | None = None


class ProviderBootstrapIn(BaseModel):
    provider: str = Field(pattern="^(stripe|paystack)$")
    register_webhook: bool = True


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    access_ticket_type_id: str | None = None
    price: int = Field(ge=0)
    currency: str = Field(pattern="^[A-Z]{3}$")
    capacity: int = Field(gt=0, le=1_000_000)
    min_per_order: int = Field(default=1, ge=1, le=100)
    max_per_order: int = Field(default=10, ge=1, le=100)
    sale_starts_at: datetime | None = None
    sale_ends_at: datetime | None = None
    active: bool = True
    sort_order: int = 0
    # "ticket" grants admission (fulfillment issues a QR pass); "donation"
    # is a payment-only line — fulfillment records the payment but never
    # creates a guest/pass for it. allow_custom_amount is donation-only:
    # `price` becomes the minimum, and the buyer may pledge more at checkout.
    # "external" is informational-only: price/description display normally
    # but checkout is refused (see create_order) -- the public page links to
    # external_url instead. price/currency/capacity are still required so it
    # displays consistently with real tickets; capacity/sold aren't
    # meaningfully enforced since nothing is ever purchased through Festio.
    product_type: str = Field(default="ticket", pattern="^(ticket|donation|external)$")
    allow_custom_amount: bool = False
    external_url: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def limits(self):
        if self.max_per_order < self.min_per_order:
            raise ValueError("max_per_order must be >= min_per_order")
        if self.allow_custom_amount and self.product_type != "donation":
            raise ValueError("allow_custom_amount only applies to donation products")
        if self.product_type == "external":
            if not self.external_url or not self.external_url.strip():
                raise ValueError("external_url is required for external-registration products")
            if not self.external_url.startswith(("http://", "https://")):
                raise ValueError("external_url must be a full http(s) URL")
        elif self.external_url:
            raise ValueError("external_url only applies to external-registration products")
        return self


class AttendeeIn(BaseModel):
    first_name: str = Field(default="", max_length=120)
    last_name: str = Field(default="", max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=50)


class OrderLineIn(BaseModel):
    product_id: str
    quantity: int = Field(gt=0, le=100)
    attendees: list[AttendeeIn]
    # Donation products with allow_custom_amount=True only: the buyer's
    # pledged amount (minor currency units), must be >= the product's price
    # (the configured minimum). Ignored for ordinary ticket products.
    custom_amount: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def attendee_count(self):
        if len(self.attendees) != self.quantity:
            raise ValueError("one attendee is required for each ticket")
        return self


class OrderIn(BaseModel):
    buyer_name: str = Field(min_length=1, max_length=200)
    buyer_email: EmailStr
    buyer_phone: str | None = Field(default=None, max_length=50)
    lines: list[OrderLineIn] = Field(min_length=1, max_length=20)
    promo_code: str | None = Field(default=None, max_length=40)
    waitlist_token: str | None = Field(default=None, max_length=64)
    custom_answers: dict[str, str | bool] = Field(default_factory=dict)


class RefundIn(BaseModel):
    amount: int | None = Field(default=None, gt=0)
    reason: str = Field(default="requested_by_customer", max_length=200)
    guest_ids: list[str] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def one_refund_mode(self):
        if self.amount is not None and self.guest_ids:
            raise ValueError("choose either an amount or specific tickets")
        if len(self.guest_ids) != len(set(self.guest_ids)):
            raise ValueError("a ticket may only be selected once")
        return self


class PromoIn(BaseModel):
    code: str = Field(min_length=2, max_length=40, pattern="^[A-Za-z0-9_-]+$")
    kind: str = Field(default="percent", pattern="^(percent|fixed)$")
    amount: int = Field(gt=0)
    max_uses: int | None = Field(default=None, gt=0)
    active: bool = True


class PaystackAccountIn(BaseModel):
    business_name: str = Field(min_length=2, max_length=200)
    settlement_bank: str = Field(min_length=2, max_length=20)
    account_number: str = Field(min_length=6, max_length=20, pattern="^[0-9]+$")
    contact_name: str | None = Field(default=None, max_length=200)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=50)


class StripeAccountIn(BaseModel):
    business_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    country: str = Field(default="US", pattern="^[A-Z]{2}$")


class FeePolicyIn(BaseModel):
    scope: str = Field(pattern="^(global|organization|event)$")
    fee_bps: int = Field(ge=0, le=5000)
    fees_paid_by: str = Field(default="buyer", pattern="^(buyer|organizer)$")


class CancellationIn(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class CancellationDecisionIn(BaseModel):
    action: str = Field(pattern="^(approve|reject)$")
    note: str | None = Field(default=None, max_length=1000)


class ComplimentaryOrderIn(BaseModel):
    product_id: str
    quantity: int = Field(gt=0, le=500)
    buyer_name: str = Field(min_length=1, max_length=200)
    buyer_email: EmailStr
    reason: str = Field(default="organizer_comp", max_length=300)
    attendees: list[AttendeeIn] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def complimentary_attendees(self):
        if self.attendees and len(self.attendees) != self.quantity:
            raise ValueError("attendee count must match quantity")
        return self


class WaitlistIn(BaseModel):
    product_id: str
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    quantity: int = Field(default=1, gt=0, le=20)


class TransferIn(BaseModel):
    guest_id: str
    recipient_name: str = Field(min_length=1, max_length=200)
    recipient_email: EmailStr


class WaitlistOfferIn(BaseModel):
    minutes: int = Field(default=30, ge=5, le=1440)


class PrivacyRequestIn(BaseModel):
    kind: str = Field(pattern="^(export|delete)$")
    reason: str | None = Field(default=None, max_length=1000)


class PrivacyDecisionIn(BaseModel):
    action: str = Field(pattern="^(approve|reject)$")
    note: str | None = Field(default=None, max_length=1000)


class SalesReportIn(BaseModel):
    recipient: EmailStr


class OperationsSubscriptionIn(BaseModel):
    recipient: EmailStr
    frequency: str = Field(default="daily", pattern="^(daily|weekly)$")
    enabled: bool = True
    include_alerts: bool = True
