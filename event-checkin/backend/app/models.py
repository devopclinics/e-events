import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    firebase_uid: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(50), default="official")  # "admin" | "official"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class EventUser(Base):
    """Junction table — assigns a user to an event."""
    __tablename__ = "event_users"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="uq_event_user"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    can_reassign_seats: Mapped[bool] = mapped_column(Boolean, default=False)
    can_manage_menu: Mapped[bool] = mapped_column(Boolean, default=False)

    event: Mapped["Event"] = relationship("Event", back_populates="members")
    user: Mapped["User"] = relationship("User")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255))
    couples_name: Mapped[str] = mapped_column(String(255))
    event_date: Mapped[datetime] = mapped_column(DateTime)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    checkin_base_url: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    seating_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    menu_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Per-event notification channels — admin toggles which channels fire
    # for invites + admission. Defaults all on; provider-level config (Bird /
    # Twilio creds) decides whether a channel is actually wired.
    notify_email: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_sms: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_whatsapp: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Live guest-list sync from a Google Sheets / OneDrive / Excel Online URL.
    # Polled every source_sync_interval_seconds while the event is "active".
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    source_sync_interval_seconds: Mapped[int] = mapped_column(Integer, default=60)
    source_last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    source_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    members: Mapped[list["EventUser"]] = relationship("EventUser", back_populates="event", cascade="all, delete-orphan")
    guests: Mapped[list["Guest"]] = relationship("Guest", back_populates="event", cascade="all, delete-orphan")
    tables: Mapped[list["SeatingTable"]] = relationship("SeatingTable", back_populates="event", cascade="all, delete-orphan")
    table_groups: Mapped[list["TableGroup"]] = relationship("TableGroup", back_populates="event", cascade="all, delete-orphan")
    menu_categories: Mapped[list["MenuCategory"]] = relationship("MenuCategory", back_populates="event", cascade="all, delete-orphan")


class SeatingTable(Base):
    __tablename__ = "seating_tables"
    __table_args__ = (UniqueConstraint("event_id", "name", name="uq_seating_table_event_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(100))
    capacity: Mapped[int] = mapped_column(Integer)

    event: Mapped["Event"] = relationship("Event", back_populates="tables")
    guests: Mapped[list["Guest"]] = relationship("Guest", back_populates="table")
    group_memberships: Mapped[list["TableGroupTable"]] = relationship("TableGroupTable", back_populates="table", cascade="all, delete-orphan")


class TableGroup(Base):
    """A named grouping of tables within an event. Guests can be assigned to a
    group so the seating engine and scanner restrict them to tables in that group."""
    __tablename__ = "table_groups"
    __table_args__ = (UniqueConstraint("event_id", "tag", name="uq_table_group_event_tag"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(100))
    tag: Mapped[str] = mapped_column(String(50))   # short label used in imports
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    event: Mapped["Event"] = relationship("Event", back_populates="table_groups")
    memberships: Mapped[list["TableGroupTable"]] = relationship("TableGroupTable", back_populates="group", cascade="all, delete-orphan")
    guests: Mapped[list["Guest"]] = relationship("Guest", back_populates="table_group")


class TableGroupTable(Base):
    """Junction — which tables belong to a TableGroup."""
    __tablename__ = "table_group_tables"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    table_group_id: Mapped[str] = mapped_column(String(36), ForeignKey("table_groups.id"))
    table_id: Mapped[str] = mapped_column(String(36), ForeignKey("seating_tables.id"))

    group: Mapped["TableGroup"] = relationship("TableGroup", back_populates="memberships")
    table: Mapped["SeatingTable"] = relationship("SeatingTable", back_populates="group_memberships")


class MenuCategory(Base):
    __tablename__ = "menu_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(100))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    selection_type: Mapped[str] = mapped_column(String(10), default="single")
    min_selections: Mapped[int] = mapped_column(Integer, default=0)
    max_selections: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)

    event: Mapped["Event"] = relationship("Event", back_populates="menu_categories")
    items: Mapped[list["MenuItem"]] = relationship("MenuItem", back_populates="category", cascade="all, delete-orphan")
    combinations: Mapped[list["MenuCombination"]] = relationship("MenuCombination", back_populates="category", cascade="all, delete-orphan")


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    category_id: Mapped[str] = mapped_column(String(36), ForeignKey("menu_categories.id"))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    category: Mapped["MenuCategory"] = relationship("MenuCategory", back_populates="items")


class GuestMenuChoice(Base):
    """One row per guest per menu selection — their chosen item or combination.

    For single/multi categories: menu_item_id is set, combination_id is null.
    For combo categories: combination_id is set, menu_item_id is null.
    Multi-select stores one row per selected item.
    """
    __tablename__ = "guest_menu_choices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"))
    category_id: Mapped[str] = mapped_column(String(36), ForeignKey("menu_categories.id"))
    menu_item_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("menu_items.id"), nullable=True)
    combination_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("menu_combinations.id"), nullable=True)
    chosen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MenuCombination(Base):
    __tablename__ = "menu_combinations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    category_id: Mapped[str] = mapped_column(String(36), ForeignKey("menu_categories.id"))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    category: Mapped["MenuCategory"] = relationship("MenuCategory", back_populates="combinations")
    items: Mapped[list["MenuCombinationItem"]] = relationship("MenuCombinationItem", cascade="all, delete-orphan", back_populates="combination")


class MenuCombinationItem(Base):
    __tablename__ = "menu_combination_items"

    combination_id: Mapped[str] = mapped_column(String(36), ForeignKey("menu_combinations.id"), primary_key=True)
    menu_item_id: Mapped[str] = mapped_column(String(36), ForeignKey("menu_items.id"), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)

    combination: Mapped["MenuCombination"] = relationship("MenuCombination", back_populates="items")
    menu_item: Mapped["MenuItem"] = relationship("MenuItem")


class Guest(Base):
    __tablename__ = "guests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    qr_token: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid.uuid4()))
    qr_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    invite_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    admitted: Mapped[bool] = mapped_column(Boolean, default=False)
    admitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    admit_notified: Mapped[bool] = mapped_column(Boolean, default=False)
    # Seating
    table_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("seating_tables.id"), nullable=True)
    seat_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Couple/party — mutual link to another guest in the same event.
    # When the first partner is seated and the second hasn't arrived, the
    # adjacent seat is reserved via `held_seat` so other FCFS arrivals skip it.
    partner_guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), nullable=True)
    held_seat: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Menu
    meal_served: Mapped[bool] = mapped_column(Boolean, default=False)
    # VVIP: added on the fly via the Reserve modal — flagged for visual emphasis.
    is_vip: Mapped[bool] = mapped_column(Boolean, default=False)
    # Per-guest notification consent. Default true: host adding a guest's phone
    # is an implicit invite-to-message. Guests can opt out from their ticket page
    # (the visible toggle satisfies TCR's "opt-in workflow" documentation).
    sms_consent: Mapped[bool] = mapped_column(Boolean, default=True)
    whatsapp_consent: Mapped[bool] = mapped_column(Boolean, default=True)
    # Table group assignment — restricts which tables the guest can sit at.
    table_group_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("table_groups.id"), nullable=True)

    event: Mapped["Event"] = relationship("Event", back_populates="guests")
    table: Mapped["SeatingTable | None"] = relationship("SeatingTable", back_populates="guests")
    table_group: Mapped["TableGroup | None"] = relationship("TableGroup", back_populates="guests")
    menu_choices: Mapped[list["GuestMenuChoice"]] = relationship("GuestMenuChoice", cascade="all, delete-orphan")


class MessageTemplate(Base):
    """Customizable outbound message template.

    Scope hierarchy (highest priority first):
      event  → org (reserved for future multi-tenant use)  → platform

    The template_service looks up the most specific override and falls back to
    the platform default if none exists.
    """
    __tablename__ = "message_templates"
    __table_args__ = (
        UniqueConstraint("scope", "event_id", "template_key", name="uq_msg_template"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # "platform" | "event"
    scope: Mapped[str] = mapped_column(String(20), default="platform")
    # null for platform-scope templates; event.id for event-scope overrides
    event_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("events.id"), nullable=True)
    template_key: Mapped[str] = mapped_column(String(100))   # e.g. "invite_email"
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    email_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    sms_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    whatsapp_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by: Mapped[str | None] = mapped_column(String(255), nullable=True)   # user email

    event: Mapped["Event | None"] = relationship("Event")
