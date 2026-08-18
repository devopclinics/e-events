import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


def uid() -> str:
    return str(uuid.uuid4())


class EventConfig(Base):
    __tablename__ = "event_configs"
    event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    provider: Mapped[str] = mapped_column(String(20), default="stripe")
    provider_account_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    fee_bps: Mapped[int] = mapped_column(Integer, default=500)
    fees_paid_by: Mapped[str] = mapped_column(String(20), default="buyer")
    public_listing: Mapped[bool] = mapped_column(Boolean, default=False)
    tax_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    tax_bps: Mapped[int] = mapped_column(Integer, default=0)
    tax_paid_by: Mapped[str] = mapped_column(String(20), default="buyer")
    checkout_fields: Mapped[list] = mapped_column(JSON, default=list)
    delivery_settings: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PayoutAccount(Base):
    __tablename__ = "payout_accounts"
    __table_args__ = (UniqueConstraint("provider", "provider_account_id", name="uq_payout_provider_account"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    provider: Mapped[str] = mapped_column(String(20), index=True)
    provider_account_id: Mapped[str] = mapped_column(String(255))
    business_name: Mapped[str] = mapped_column(String(200))
    account_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    account_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    currency: Mapped[str] = mapped_column(String(3))
    status: Mapped[str] = mapped_column(String(30), default="pending")
    charges_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    payouts_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FeePolicy(Base):
    __tablename__ = "fee_policies"
    __table_args__ = (UniqueConstraint("scope_type", "scope_id", name="uq_fee_policy_scope"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    scope_type: Mapped[str] = mapped_column(String(20), index=True)
    scope_id: Mapped[str] = mapped_column(String(36), index=True)
    fee_bps: Mapped[int] = mapped_column(Integer)
    fees_paid_by: Mapped[str] = mapped_column(String(20), default="buyer")
    updated_by: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TicketProduct(Base):
    __tablename__ = "ticket_products"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    access_ticket_type_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    capacity: Mapped[int] = mapped_column(Integer)
    sold: Mapped[int] = mapped_column(Integer, default=0)
    min_per_order: Mapped[int] = mapped_column(Integer, default=1)
    max_per_order: Mapped[int] = mapped_column(Integer, default=10)
    sale_starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sale_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # "ticket" (default) grants admission; "donation" is payment-only — see
    # ProductIn for the full contract. allow_custom_amount only applies when
    # product_type="donation": price becomes a floor, not a fixed amount.
    # "external": informational listing only -- price/name/description display
    # normally, but checkout is refused server-side (see create_order) and the
    # public page links out to external_url instead of adding to cart. For
    # organizers who take payment on their own registration site but still
    # want their pricing to show on Festio.
    product_type: Mapped[str] = mapped_column(String(20), default="ticket")
    allow_custom_amount: Mapped[bool] = mapped_column(Boolean, default=False)
    external_url: Mapped[str | None] = mapped_column(String(500), nullable=True)


class PromoCode(Base):
    __tablename__ = "promo_codes"
    __table_args__ = (UniqueConstraint("event_id", "code", name="uq_promo_event_code"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    code: Mapped[str] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(12), default="percent")
    amount: Mapped[int] = mapped_column(Integer)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    org_id: Mapped[str] = mapped_column(String(36), index=True)
    buyer_name: Mapped[str] = mapped_column(String(200))
    buyer_email: Mapped[str] = mapped_column(String(255), index=True)
    buyer_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    currency: Mapped[str] = mapped_column(String(3))
    subtotal: Mapped[int] = mapped_column(Integer)
    discount: Mapped[int] = mapped_column(Integer, default=0)
    platform_fee: Mapped[int] = mapped_column(Integer, default=0)
    tax_amount: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    provider: Mapped[str] = mapped_column(String(20))
    provider_reference: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    checkout_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_token: Mapped[str] = mapped_column(String(64), unique=True, default=lambda: uuid.uuid4().hex)
    delivery_status: Mapped[str] = mapped_column(String(30), default="pending")
    delivery_attempts: Mapped[int] = mapped_column(Integer, default=0)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pre_dispute_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    promo_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    waitlist_entry_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    hold_expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fulfillment_result: Mapped[dict] = mapped_column(JSON, default=dict)
    custom_answers: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id"), index=True)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("ticket_products.id"), index=True)
    product_name: Mapped[str] = mapped_column(String(120))
    unit_price: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)
    attendee_data: Mapped[list] = mapped_column(JSON, default=list)


class PaymentEvent(Base):
    __tablename__ = "payment_events"
    __table_args__ = (UniqueConstraint("provider", "provider_event_id", name="uq_provider_event"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    provider: Mapped[str] = mapped_column(String(20))
    provider_event_id: Mapped[str] = mapped_column(String(255))
    event_type: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict] = mapped_column(JSON)
    processed: Mapped[bool] = mapped_column(Boolean, default=False)
    processing_attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    amount: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    provider_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class JournalLine(Base):
    """Append-only accounting line. Lines sharing transaction_id must balance."""
    __tablename__ = "journal_lines"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    transaction_id: Mapped[str] = mapped_column(String(36), index=True)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    account: Mapped[str] = mapped_column(String(40), index=True)
    debit: Mapped[int] = mapped_column(Integer, default=0)
    credit: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(3))
    reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CancellationRequest(Base):
    __tablename__ = "cancellation_requests"
    __table_args__ = (UniqueConstraint("order_id", name="uq_cancellation_order"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class WaitlistEntry(Base):
    __tablename__ = "waitlist_entries"
    __table_args__ = (UniqueConstraint("product_id", "email", name="uq_waitlist_product_email"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("ticket_products.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(255), index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(30), default="waiting", index=True)
    offer_token: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    offer_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    offered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    offer_attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    actor: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(100), index=True)
    subject_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class TicketTransfer(Base):
    __tablename__ = "ticket_transfers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    guest_id: Mapped[str] = mapped_column(String(36), index=True)
    recipient_name: Mapped[str] = mapped_column(String(200))
    recipient_email: Mapped[str] = mapped_column(String(255))
    token: Mapped[str] = mapped_column(String(64), unique=True, default=lambda: uuid.uuid4().hex)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PaymentRefund(Base):
    __tablename__ = "payment_refunds"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    provider: Mapped[str] = mapped_column(String(20))
    provider_refund_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    amount: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(30), default="processing", index=True)
    requested_by: Mapped[str] = mapped_column(String(255))
    request_key: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    guest_ids: Mapped[list] = mapped_column(JSON, default=list)
    item_quantities: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PrivacyRequest(Base):
    __tablename__ = "privacy_requests"
    __table_args__ = (UniqueConstraint("order_id", "kind", name="uq_privacy_order_kind"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class OperationsSubscription(Base):
    __tablename__ = "operations_subscriptions"
    event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    recipient: Mapped[str] = mapped_column(String(255))
    frequency: Mapped[str] = mapped_column(String(20), default="daily")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    include_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    next_run_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
