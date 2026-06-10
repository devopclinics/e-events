import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class Organization(Base):
    """A tenant/account. All events belong to exactly one organization; users
    access events only through a Membership in the owning org."""
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    region: Mapped[str] = mapped_column(String(10), default="US")       # "US" | "NG"
    currency: Mapped[str] = mapped_column(String(10), default="USD")    # "USD" | "NGN"
    plan: Mapped[str] = mapped_column(String(50), default="free")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Membership(Base):
    """User ↔ Organization with an org-scoped role. Replaces the global User.role
    for access decisions. A user may belong to multiple orgs."""
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("org_id", "user_id", name="uq_membership_org_user"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(20), default="staff")  # "owner" | "admin" | "staff"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    firebase_uid: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(50), default="official")  # legacy global role; superseded by Membership
    # Operator-only flag (you), distinct from customer org admins. Grants audited
    # cross-tenant support access. Never set for customer accounts.
    is_platform_superadmin: Mapped[bool] = mapped_column(Boolean, default=False)
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
    # Tenant owner. Backfilled then tightened to NOT NULL (see SCHEMA_PATCHES
    # and docs/PHASE1-MULTITENANCY-PLAN.md). Every event belongs to one org.
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255))
    couples_name: Mapped[str] = mapped_column(String(255))
    event_date: Mapped[datetime] = mapped_column(DateTime)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    checkin_base_url: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    seating_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    menu_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Logistics add-on: ship merchandise (pre-event) / gifts (post-event) to
    # guests. Off by default; paid-gated like seating/menu.
    logistics_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Gift registry add-on (mark-only — no money flows through the platform).
    registry_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    registry_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Venue Access Intelligence add-on (zones, multi-zone scanning, analytics).
    # Off by default — does not touch the legacy single-scan check-in flow.
    venue_access_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    venue_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    venue_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Unguessable public token for the registry page (cf. invite_token). Nullable
    # so existing rows backfill lazily; new events get one via the default.
    registry_token: Mapped[str | None] = mapped_column(
        String(36), unique=True, nullable=True, default=lambda: str(uuid.uuid4())
    )
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

    # ── Invite page & self-service RSVP ──────────────────────────────────────
    rsvp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Theme key: "default" | "gold" | "rose" | "midnight" | "forest"
    invite_theme: Mapped[str] = mapped_column(String(50), default="default")
    invite_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    rsvp_collect_phone: Mapped[bool] = mapped_column(Boolean, default=True)
    rsvp_collect_email: Mapped[bool] = mapped_column(Boolean, default=True)
    # None = unlimited; integer = max accepted RSVPs
    rsvp_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Cover image URL — served from /api/uploads/
    invite_cover_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Invite distribution mode:
    #   "open"   — shared /e/{event_id} link; anyone with it can RSVP.
    #   "closed" — invitation-only; each guest gets a unique /r/{invite_token}
    #              link and the open form is disabled.
    invite_mode: Mapped[str] = mapped_column(String(20), default="open")
    # RSVP cutoff. After this instant the invite page is read-only. None = no deadline.
    rsvp_deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Open mode only: when True, self-service RSVPs land as "pending" and a
    # planner must approve before a ticket is issued. No effect in closed mode.
    rsvp_require_approval: Mapped[bool] = mapped_column(Boolean, default=False)

    # ── Per-event entitlements (Phase 2) — what an Event Pass unlocks ─────────
    # plan_tier: "free" | "tier50" | "tier150" | "tier300" | "unlimited" | "comp"
    plan_tier: Mapped[str] = mapped_column(String(20), default="free")
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False)
    # Max guests for this event. None = unlimited (paid). Free uses FREE_GUEST_CAP.
    guest_cap: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # SMS/WhatsApp unlocked (email is always allowed).
    paid_channels: Mapped[bool] = mapped_column(Boolean, default=False)
    # Prepaid SMS/WhatsApp credits remaining (metering wired in Phase 3 billing).
    message_credits: Mapped[int] = mapped_column(Integer, default=0)

    members: Mapped[list["EventUser"]] = relationship("EventUser", back_populates="event", cascade="all, delete-orphan")
    guests: Mapped[list["Guest"]] = relationship("Guest", back_populates="event", cascade="all, delete-orphan")
    tables: Mapped[list["SeatingTable"]] = relationship("SeatingTable", back_populates="event", cascade="all, delete-orphan")
    menu_categories: Mapped[list["MenuCategory"]] = relationship("MenuCategory", back_populates="event", cascade="all, delete-orphan")
    rsvp_questions: Mapped[list["RSVPQuestion"]] = relationship("RSVPQuestion", back_populates="event", cascade="all, delete-orphan")


class PricingPlan(Base):
    """Editable catalogue of Event Pass tiers and credit packs (superadmin-managed).
    Seeded from defaults; the billing flow reads prices/limits from here."""
    __tablename__ = "pricing_plans"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)  # e.g. "tier50", "credits_100"
    kind: Mapped[str] = mapped_column(String(10))                   # "tier" | "pack"
    label: Mapped[str] = mapped_column(String(120))
    guest_cap: Mapped[int | None] = mapped_column(Integer, nullable=True)  # tiers; None = unlimited
    credits: Mapped[int] = mapped_column(Integer, default=0)
    usd: Mapped[int] = mapped_column(Integer, default=0)            # cents
    ngn: Mapped[int] = mapped_column(Integer, default=0)            # kobo
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Payment(Base):
    """One Event Pass purchase. `reference` is the provider's id (Stripe session
    or Paystack reference) and is unique → webhook retries are idempotent."""
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    provider: Mapped[str] = mapped_column(String(20))           # "stripe" | "paystack"
    reference: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    tier_key: Mapped[str] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column(Integer)               # smallest unit
    currency: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|paid|failed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SeatingTable(Base):
    __tablename__ = "seating_tables"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(100))
    capacity: Mapped[int] = mapped_column(Integer)
    # Optional seating category/restriction label (e.g. Male, Female, Kids,
    # Youth, VIP). Display-only guidance for manual seat assignment.
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)

    event: Mapped["Event"] = relationship("Event", back_populates="tables")
    guests: Mapped[list["Guest"]] = relationship("Guest", back_populates="table")


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
    # Nullable: events with rsvp_collect_email=False register guests with no email.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    qr_token: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid.uuid4()))
    qr_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    invite_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Per-guest RSVP invite-link token (closed mode). Generated when the invite
    # is sent; distinct from qr_token (the post-confirmation ticket credential).
    invite_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # RSVP response state: "invited" (no response yet) | "confirmed" | "declined".
    rsvp_status: Mapped[str] = mapped_column(String(20), default="invited")
    rsvp_responded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
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

    # Shipping address for the logistics add-on. One address per guest, reused
    # across shipments. Phone (above) doubles as the shipping contact number.
    ship_address1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ship_address2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ship_city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    ship_state: Mapped[str | None] = mapped_column(String(120), nullable=True)
    ship_postal: Mapped[str | None] = mapped_column(String(40), nullable=True)
    ship_country: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Venue-access add-on: optional ticket type (GA/VIP/…). Nullable; ignored by
    # the legacy check-in flow.
    ticket_type_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("ticket_types.id"), nullable=True)

    event: Mapped["Event"] = relationship("Event", back_populates="guests")
    table: Mapped["SeatingTable | None"] = relationship("SeatingTable", back_populates="guests")
    menu_choices: Mapped[list["GuestMenuChoice"]] = relationship("GuestMenuChoice", cascade="all, delete-orphan")
    rsvp_answers: Mapped[list["RSVPAnswer"]] = relationship("RSVPAnswer", cascade="all, delete-orphan")


# ── RSVP / Invite page ────────────────────────────────────────────────────────

class RSVPQuestion(Base):
    """A custom question shown on the public invite page before/during RSVP."""
    __tablename__ = "rsvp_questions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    question: Mapped[str] = mapped_column(String(500))
    # "text" — free-form text input
    # "select" — single-choice from options (JSON array stored in options col)
    # "boolean" — yes/no toggle
    question_type: Mapped[str] = mapped_column(String(20), default="text")
    options: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: ["Option A", "Option B"]
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    event: Mapped["Event"] = relationship("Event", back_populates="rsvp_questions")
    answers: Mapped[list["RSVPAnswer"]] = relationship("RSVPAnswer", cascade="all, delete-orphan")


class RSVPAnswer(Base):
    """One row per guest per RSVP question answer."""
    __tablename__ = "rsvp_answers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"))
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("rsvp_questions.id"))
    answer: Mapped[str] = mapped_column(Text)
    answered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ── Logistics / Fulfillment add-on ────────────────────────────────────────────

class Shipment(Base):
    """A batch of items shipped to guests for an event — pre-event merchandise
    (e.g. aso-ebi cloth) or post-event gifts. The organizer pays the vendor
    off-platform; this model only collects sizes/addresses and produces the
    packing list (download + tokenized vendor page)."""
    __tablename__ = "shipments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    phase: Mapped[str] = mapped_column(String(10), default="pre")  # "pre" | "post"
    collect_size: Mapped[bool] = mapped_column(Boolean, default=True)
    # Whether guests who RSVP are auto-added to this shipment. True suits "ship
    # to everyone" (e.g. aso-ebi); False keeps the list admin-curated (e.g. VIP
    # gifts) so removed guests don't get re-added on the next RSVP.
    auto_add: Mapped[bool] = mapped_column(Boolean, default=True)
    size_options: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: ["S","M","L","XL"]
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)  # instructions shown to the vendor
    vendor_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    vendor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vendor_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Unguessable token powering the public, read-only vendor page.
    share_token: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid.uuid4()))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)    # emailed to vendor
    viewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # vendor first opened page
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    event: Mapped["Event"] = relationship("Event")
    lines: Mapped[list["GuestShipment"]] = relationship("GuestShipment", cascade="all, delete-orphan")


class GuestShipment(Base):
    """One guest's line within a shipment: their chosen size/quantity and the
    fulfillment status the organizer tracks against the vendor."""
    __tablename__ = "guest_shipments"
    __table_args__ = (UniqueConstraint("shipment_id", "guest_id", name="uq_guest_shipment"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    shipment_id: Mapped[str] = mapped_column(String(36), ForeignKey("shipments.id"), index=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    # Optional per-guest item override. Blank → the shipment's name is the item.
    item: Mapped[str | None] = mapped_column(String(150), nullable=True)
    size: Mapped[str | None] = mapped_column(String(40), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    ship_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | shipped | delivered
    tracking_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    guest: Mapped["Guest"] = relationship("Guest")


# ── Gift Registry add-on ──────────────────────────────────────────────────────

class RegistryItem(Base):
    """One entry on an event's gift registry. Mark-only: no money moves through
    the platform. `kind` distinguishes a physical item (external buy link), a
    cash fund (target + the organizer's own payment instructions), or a link to
    an external registry (e.g. the couple's Amazon/Jumia list)."""
    __tablename__ = "registry_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="item")  # "item" | "fund" | "link"
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # item: store/buy link; link: external registry URL; fund: optional pay link.
    external_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # item: display price; fund: target amount. Minor units (cents/kobo).
    amount_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="USD")  # "USD" | "NGN"
    quantity_wanted: Mapped[int] = mapped_column(Integer, default=1)  # items only
    # funds: how to send the money (bank details, Paystack/PayPal/Venmo link…).
    payment_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    claims: Mapped[list["RegistryClaim"]] = relationship("RegistryClaim", cascade="all, delete-orphan")


class RegistryClaim(Base):
    """A guest reserving an item or pledging to a fund. Self-reported; the actual
    purchase/transfer happens off-platform."""
    __tablename__ = "registry_claims"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    item_id: Mapped[str] = mapped_column(String(36), ForeignKey("registry_items.id"), index=True)
    claimer_name: Mapped[str] = mapped_column(String(255))
    claimer_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)            # items
    amount_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)  # funds
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AffiliateStore(Base):
    """Platform-wide (superadmin-managed) affiliate store. When a registry item's
    buy link points to a matching domain, the store's query param is appended so
    purchases carry the platform's affiliate tag (Amazon Associates, Jumia, …)."""
    __tablename__ = "affiliate_stores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    domain: Mapped[str] = mapped_column(String(255))      # host suffix, e.g. "amazon.com"
    label: Mapped[str] = mapped_column(String(120))       # "Amazon US"
    param_key: Mapped[str] = mapped_column(String(60))    # e.g. "tag"
    param_value: Mapped[str] = mapped_column(String(255)) # your affiliate id
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ── Venue Access Intelligence add-on ──────────────────────────────────────────

class Zone(Base):
    """A room/area within an event's venue. Guests are scanned in/out of zones;
    the scan log powers occupancy, flow, peak-times and journeys."""
    __tablename__ = "zones"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # How scans at this zone are recorded: "both" (official picks), "entry"
    # (always counts as in), "exit" (always out).
    direction_mode: Mapped[str] = mapped_column(String(10), default="both")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TicketType(Base):
    """A ticket class (GA / VIP / Press / Speaker) with optional per-zone access."""
    __tablename__ = "ticket_types"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)  # badge tint
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # JSON list of zone ids this ticket may enter. null/empty = all zones.
    allowed_zone_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ScanEvent(Base):
    """One row per scan — a timestamped, directional, per-zone movement. This is
    the log the whole analytics layer reads. Separate from the legacy
    Guest.admitted boolean, which the old check-in flow still uses."""
    __tablename__ = "scan_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    zone_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("zones.id"), index=True, nullable=True)
    direction: Mapped[str] = mapped_column(String(4), default="in")  # "in" | "out"
    scanned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    scanned_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    denied: Mapped[bool] = mapped_column(Boolean, default=False)
    deny_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
