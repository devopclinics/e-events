"""Festio planner-service data model — event planning suite: budget, vendors,
timeline (milestones/tasks), day-of runsheet, and document vault.

Every table is keyed by event_id (an opaque UUID string owned by the main
backend) with no foreign keys crossing service boundaries — this DB has zero
knowledge of the main backend's schema, and vice versa.
"""
import uuid
from datetime import datetime, time as time_

from sqlalchemy import (
    JSON, Date, DateTime, ForeignKey, Numeric, SmallInteger, String, Text, Time,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


# ── Budget ───────────────────────────────────────────────────────────────────

class PlannerBudget(Base):
    __tablename__ = "planner_budgets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    total_budget: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    categories: Mapped[list["PlannerBudgetCategory"]] = relationship(
        back_populates="budget", cascade="all, delete-orphan", order_by="PlannerBudgetCategory.sort_order",
    )


class PlannerBudgetCategory(Base):
    __tablename__ = "planner_budget_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    budget_id: Mapped[str] = mapped_column(ForeignKey("planner_budgets.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    allocated: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    color: Mapped[str] = mapped_column(String(7), default="#0f766e")
    sort_order: Mapped[int] = mapped_column(default=0)

    budget: Mapped["PlannerBudget"] = relationship(back_populates="categories")
    items: Mapped[list["PlannerBudgetItem"]] = relationship(
        back_populates="category", cascade="all, delete-orphan", order_by="PlannerBudgetItem.created_at",
    )


class PlannerBudgetItem(Base):
    __tablename__ = "planner_budget_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    category_id: Mapped[str] = mapped_column(ForeignKey("planner_budget_categories.id", ondelete="CASCADE"), index=True)
    vendor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    estimated: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    actual: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|paid|cancelled
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional {vendor_name: price} map so the UI can render a side-by-side
    # vendor price-comparison table instead of cramming quotes into notes.
    vendor_quotes: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    category: Mapped["PlannerBudgetCategory"] = relationship(back_populates="items")


# ── Vendors ──────────────────────────────────────────────────────────────────

class PlannerVendor(Base):
    __tablename__ = "planner_vendors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(20), default="prospect")  # prospect|shortlisted|contracted|paid|cancelled
    contact_name: Mapped[str] = mapped_column(String(120), default="")
    contact_email: Mapped[str] = mapped_column(String(200), default="")
    contact_phone: Mapped[str] = mapped_column(String(30), default="")
    website: Mapped[str | None] = mapped_column(Text, nullable=True)
    contract_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    contract_expires_at: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    agreed_amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    deposit_amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    deposit_due_at: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    rating: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    payments: Mapped[list["PlannerVendorPayment"]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan", order_by="PlannerVendorPayment.due_at",
    )


class PlannerVendorPayment(Base):
    __tablename__ = "planner_vendor_payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("planner_vendors.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(120), default="Payment")
    amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    due_at: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    method: Mapped[str | None] = mapped_column(String(40), nullable=True)

    vendor: Mapped["PlannerVendor"] = relationship(back_populates="payments")


class PlannerVendorQuote(Base):
    __tablename__ = "planner_vendor_quotes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("planner_vendors.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    comparison_group: Mapped[str] = mapped_column(String(120), default="General")
    line_items: Mapped[list | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    valid_until: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class PlannerChangeOrder(Base):
    __tablename__ = "planner_change_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("planner_vendors.id", ondelete="CASCADE"), index=True)
    quote_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount_delta: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    status: Mapped[str] = mapped_column(String(20), default="proposed")
    requested_by: Mapped[str] = mapped_column(String(200))
    decided_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class PlannerVendorPortalToken(Base):
    __tablename__ = "planner_vendor_portal_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("planner_vendors.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class PlannerQuoteSelection(Base):
    __tablename__ = "planner_quote_selections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    comparison_group: Mapped[str] = mapped_column(String(120))
    item_key: Mapped[str] = mapped_column(String(320))
    item_name: Mapped[str] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(80), default="")
    quote_id: Mapped[str] = mapped_column(ForeignKey("planner_vendor_quotes.id", ondelete="CASCADE"), index=True)
    vendor_id: Mapped[str] = mapped_column(ForeignKey("planner_vendors.id", ondelete="CASCADE"), index=True)
    unit_price: Mapped[float] = mapped_column(Numeric(14, 2))
    quantity: Mapped[float] = mapped_column(Numeric(14, 3), default=1)
    selected_by: Mapped[str] = mapped_column(String(200))
    selected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class PlannerProcurementRequirement(Base):
    __tablename__ = "planner_procurement_requirements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    comparison_group: Mapped[str] = mapped_column(String(120))
    item_key: Mapped[str] = mapped_column(String(320))
    required_quantity: Mapped[float] = mapped_column(Numeric(14, 3), default=1)
    updated_by: Mapped[str] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Timeline (milestones + tasks) ───────────────────────────────────────────

class PlannerMilestone(Base):
    __tablename__ = "planner_milestones"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="not_started")  # not_started|in_progress|done
    sort_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    tasks: Mapped[list["PlannerTask"]] = relationship(
        back_populates="milestone", cascade="all, delete-orphan", order_by="PlannerTask.created_at",
    )


class PlannerTask(Base):
    __tablename__ = "planner_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    milestone_id: Mapped[str] = mapped_column(ForeignKey("planner_milestones.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(300))
    assigned_to: Mapped[str | None] = mapped_column(String(200), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    priority: Mapped[str] = mapped_column(String(10), default="normal")  # low|normal|high
    status: Mapped[str] = mapped_column(String(20), default="todo")  # todo|in_progress|done
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    vendor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    milestone: Mapped["PlannerMilestone"] = relationship(back_populates="tasks")


# ── Runsheet ─────────────────────────────────────────────────────────────────

class PlannerRunsheetItem(Base):
    __tablename__ = "planner_runsheet"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    start_time: Mapped[time_] = mapped_column(Time)
    end_time: Mapped[time_ | None] = mapped_column(Time, nullable=True)
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    dependency_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    version: Mapped[int] = mapped_column(default=1)
    title: Mapped[str] = mapped_column(String(300))
    type: Mapped[str] = mapped_column(String(20), default="other")  # setup|program|break|ceremony|other
    owner: Mapped[str | None] = mapped_column(String(200), nullable=True)
    cue: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="upcoming")  # upcoming|in_progress|done
    sort_order: Mapped[int] = mapped_column(default=0)


# ── Documents ────────────────────────────────────────────────────────────────

class PlannerDocument(Base):
    __tablename__ = "planner_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    vendor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    type: Mapped[str] = mapped_column(String(20), default="other")  # contract|quote|invoice|proposal|other
    name: Mapped[str] = mapped_column(String(200))
    file_url: Mapped[str] = mapped_column(Text)
    file_size_bytes: Mapped[int | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft|sent|signed|expired
    expires_at: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class PlannerAuditEvent(Base):
    """Append-only planner mutation trail, including denied attempts."""
    __tablename__ = "planner_audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    actor_subject: Mapped[str] = mapped_column(String(200), index=True)
    actor_email: Mapped[str] = mapped_column(String(255), default="")
    method: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(Text)
    outcome: Mapped[str] = mapped_column(String(20))
    status_code: Mapped[int] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)
