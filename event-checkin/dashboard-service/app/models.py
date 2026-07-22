"""Read-only mirrors of tables owned by the main backend (`backend/app/models.py`).

This service never writes to these tables — the `dashboard_ro` Postgres role
it connects with only has SELECT granted, so even a bug here can't mutate
guest data. Column definitions must stay in sync with the main backend by
hand; there is no shared migration between the two services (same pattern
already used by messaging-service).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Membership(Base):
    __tablename__ = "memberships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(20), default="staff")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(255))
    firebase_uid: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_platform_superadmin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class EventUser(Base):
    __tablename__ = "event_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    event_role: Mapped[str] = mapped_column(String(30), default="staff")
    access_level: Mapped[str] = mapped_column(String(20), default="edit")
    can_view_dashboard: Mapped[bool] = mapped_column(Boolean, default=False)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String(255))
    event_date: Mapped[datetime] = mapped_column(DateTime)
    event_end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    seating_term: Mapped[str | None] = mapped_column(String(30), nullable=True)
    venue_access_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    seating_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    menu_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    experience_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    message_credits: Mapped[int] = mapped_column(Integer, default=0)
    plan_tier: Mapped[str] = mapped_column(String(20), default="free")


class Guest(Base):
    __tablename__ = "guests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    rsvp_status: Mapped[str] = mapped_column(String(20), default="invited")
    admitted: Mapped[bool] = mapped_column(Boolean, default=False)
    admitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_walk_in: Mapped[bool] = mapped_column(Boolean, default=False)
    meal_served: Mapped[bool] = mapped_column(Boolean, default=False)
    ticket_type_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("ticket_types.id"), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    invite_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    table_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("seating_tables.id"), nullable=True)


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(150))
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    direction_mode: Mapped[str] = mapped_column(String(10), default="both")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class TicketType(Base):
    __tablename__ = "ticket_types"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(120))
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ScanEvent(Base):
    __tablename__ = "scan_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"))
    zone_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("zones.id"), nullable=True)
    direction: Mapped[str] = mapped_column(String(4), default="in")
    scanned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    denied: Mapped[bool] = mapped_column(Boolean, default=False)
    deny_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ExperienceWorkflow(Base):
    __tablename__ = "experience_workflows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(255), default="Default Experience")
    status: Mapped[str] = mapped_column(String(20), default="draft")
    is_default: Mapped[bool] = mapped_column(Boolean, default=True)


class ExperienceStep(Base):
    __tablename__ = "experience_steps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(String(36), ForeignKey("experience_workflows.id"))
    key: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    starts_offset_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class GuestExperienceProgress(Base):
    __tablename__ = "guest_experience_progress"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    workflow_id: Mapped[str] = mapped_column(String(36), ForeignKey("experience_workflows.id"))
    step_id: Mapped[str] = mapped_column(String(36), ForeignKey("experience_steps.id"))
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"))
    status: Mapped[str] = mapped_column(String(30), default="not_started")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MenuCategory(Base):
    __tablename__ = "menu_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(100))
    day_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    display_only: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class GuestMenuChoice(Base):
    __tablename__ = "guest_menu_choices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"))
    category_id: Mapped[str] = mapped_column(String(36), ForeignKey("menu_categories.id"))
    chosen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class GuestMealFulfillment(Base):
    __tablename__ = "guest_meal_fulfillment"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"))
    category_id: Mapped[str] = mapped_column(String(36), ForeignKey("menu_categories.id"))
    status: Mapped[str] = mapped_column(String(20), default="served")
    served_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SeatingTable(Base):
    __tablename__ = "seating_tables"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(100))
    capacity: Mapped[int] = mapped_column(Integer)


class MessageCreditLedger(Base):
    __tablename__ = "message_credit_ledger"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    action: Mapped[str] = mapped_column(String(30))
    status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    channel: Mapped[str | None] = mapped_column(String(30), nullable=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    delta: Mapped[int] = mapped_column(Integer)


class EmailDeliveryEvent(Base):
    __tablename__ = "email_delivery_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("events.id"), nullable=True)
    provider_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_email_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(40))
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
