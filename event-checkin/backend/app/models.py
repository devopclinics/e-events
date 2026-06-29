import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Text, UniqueConstraint, Index, text
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
    # Operator can suspend a tenant: members lose access to its events (login
    # still works for other orgs they belong to). Superadmins bypass.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Pending trial grant from an approved TrialRequest when the org had no event
    # yet. Consumed (applied + cleared) by the next event the org creates.
    trial_tier: Mapped[str | None] = mapped_column(String(50), nullable=True)
    trial_credits: Mapped[int | None] = mapped_column(Integer, nullable=True)


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
    # Operator can suspend an account: blocks sign-in entirely. Paired with
    # disabling the Firebase user so they can't re-authenticate.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
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
    # Lets a non-admin staffer open the live event dashboard (admins always can).
    can_view_dashboard: Mapped[bool] = mapped_column(Boolean, default=False)

    event: Mapped["Event"] = relationship("Event", back_populates="members")
    user: Mapped["User"] = relationship("User")
    sections: Mapped[list["EventUserSection"]] = relationship(
        "EventUserSection", cascade="all, delete-orphan", passive_deletes=True
    )


class EventUserSection(Base):
    """A team member's allowed sections (table groups) for section-based scanning.

    NO rows for a member = unrestricted ("All sections"). Exactly one allowed
    section → the scanner auto-routes their check-ins there with no picker; two or
    more (or All) → the scanner shows a picker limited to the allowed sections."""
    __tablename__ = "event_user_sections"
    __table_args__ = (UniqueConstraint("event_user_id", "table_group_id", name="uq_event_user_section"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("event_users.id", ondelete="CASCADE"), index=True)
    table_group_id: Mapped[str] = mapped_column(String(36), ForeignKey("table_groups.id", ondelete="CASCADE"), index=True)


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
    # MMS (image ticket card). Superadmin-only per-event toggle; off by default.
    notify_mms: Mapped[bool] = mapped_column(Boolean, default=False)
    # Send a notice to a guest when they decline / are rejected. Off by default
    # (previously silent); organizer opt-in.
    notify_rsvp_responses: Mapped[bool] = mapped_column(Boolean, default=False)
    # Walk-in registration at the door (Scanner → Manual). Off by default. New
    # walk-ins are auto-assigned to walk_in_table_group_id. Stored as a plain
    # String (no FK) to avoid an extra Event↔TableGroup mapper relationship.
    walk_in_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    walk_in_table_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Table Groups add-on: when True (default), a guest with an assigned table
    # group may only be seated/checked-in at tables inside that group. Events
    # with no table groups are unaffected regardless of this flag.
    enforce_table_groups: Mapped[bool] = mapped_column(Boolean, default=True)
    # Section-based scanning add-on: when True, each scanner device picks one
    # table group ("section", e.g. men's/women's entrance) per session. Walk-ins
    # and group-less manual check-ins at that device route to the active section
    # instead of the single walk_in_table_group_id. Off by default; only
    # meaningful for events that have table groups. Guests with a pre-assigned
    # group keep it (the section never overrides an existing assignment).
    section_mode_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Manual check-in: when on, staff can admit a guest by searching name/phone
    # (no QR). Superadmin-toggled per event; off by default.
    manual_checkin_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Self check-in: guests admit themselves via a public page found by a short
    # event_code (no login). Off by default; code generated on enable/create.
    self_checkin_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Short, human-shareable code (8 chars, no confusable letters). Unique;
    # nullable so existing events backfill lazily when self check-in is enabled.
    event_code: Mapped[str | None] = mapped_column(String(16), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Live guest-list sync from a Google Sheets / OneDrive / Excel Online URL.
    # Polled every source_sync_interval_seconds while the event is "active".
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # Master on/off switch for the poll. When False the poller skips this event
    # entirely (so an organizer can pause a noisy/finished sync without clearing
    # the source URL). Defaults True so existing events keep syncing unchanged.
    source_sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    source_sync_interval_seconds: Mapped[int] = mapped_column(Integer, default=60)
    source_last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    source_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Non-fatal issues from the last sync (rows over plan cap, unknown ticket
    # types, bad phones) — the sync succeeded but the admin should know.
    source_last_warning: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Invite page & self-service RSVP ──────────────────────────────────────
    rsvp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Unguessable open-RSVP share token. This powers /rsvp/{token}; older
    # event-id invite URLs remain supported for compatibility.
    rsvp_token: Mapped[str | None] = mapped_column(
        String(36), unique=True, nullable=True, default=lambda: str(uuid.uuid4())
    )
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
    # Display + FCFS-fill order (lower first), then name.
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    event: Mapped["Event"] = relationship("Event", back_populates="tables")
    guests: Mapped[list["Guest"]] = relationship("Guest", back_populates="table")


class TableGroup(Base):
    """A named, tagged group of tables (e.g. 'VIP Tables', 'Family Tables').
    Guests assigned to a group may only be seated at tables in that group when
    the event has `enforce_table_groups` on. Mirrors the GuestTag pattern but a
    guest belongs to at most one table group."""
    __tablename__ = "table_groups"
    __table_args__ = (UniqueConstraint("event_id", "tag", name="uq_table_group_event_tag"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    # Import/assignment label (e.g. "VIP"). Unique per event, case-insensitive
    # uniqueness enforced in the router.
    tag: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TableGroupTable(Base):
    """Membership of a table in a table group. A table belongs to at most one
    group (enforced by the unique constraint on table_id)."""
    __tablename__ = "table_group_tables"
    __table_args__ = (UniqueConstraint("table_id", name="uq_table_group_table_table"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    table_group_id: Mapped[str] = mapped_column(String(36), ForeignKey("table_groups.id"), index=True)
    table_id: Mapped[str] = mapped_column(String(36), ForeignKey("seating_tables.id"), index=True)


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
    __table_args__ = (
        # A given seat at a table holds at most one guest. Partial unique index
        # (only rows where BOTH table and seat are set) so the many guests with
        # no table/seat don't collide on NULLs. This is the DB-level backstop for
        # the application checks in seating.py/guests.py — it holds even under
        # concurrency (two doors seating at the same instant). Mirrored for
        # existing prod tables by a SCHEMA_PATCHES entry (db_migrate.py).
        Index(
            "uq_guest_table_seat", "event_id", "table_id", "seat_number",
            unique=True,
            sqlite_where=text("table_id IS NOT NULL AND seat_number IS NOT NULL"),
            postgresql_where=text("table_id IS NOT NULL AND seat_number IS NOT NULL"),
        ),
    )

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
    # Delivery outcome at last dispatch: None (never sent) | "sent" (>=1 channel
    # fired) | "failed" (no reachable channel). Powers the Message Delivery card.
    invite_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Per-guest RSVP invite-link token (closed mode). Generated when the invite
    # is sent; distinct from qr_token (the post-confirmation ticket credential).
    invite_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # RSVP response state: "invited" (no response yet) | "confirmed" | "declined".
    rsvp_status: Mapped[str] = mapped_column(String(20), default="invited")
    rsvp_responded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    admitted: Mapped[bool] = mapped_column(Boolean, default=False)
    admitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    admit_notified: Mapped[bool] = mapped_column(Boolean, default=False)
    # True when the guest wasn't on the original list: added at the door via the
    # walk-in kiosk or the "Add Guest" button with walk-in checked. Powers the
    # dashboard "Walk-ins / Manual" stat + the WALK-IN badge.
    is_walk_in: Mapped[bool] = mapped_column(Boolean, default=False)
    # Seating
    table_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("seating_tables.id"), nullable=True)
    seat_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Table Groups: optional restriction to a group of tables. Nullable — guests
    # without a group follow the default seating behavior.
    assigned_table_group_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("table_groups.id"), nullable=True)
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


class GuestTag(Base):
    """Customer-defined classifier for an event (e.g. 'Speaker', 'Press', '21+',
    'Engineering'). Maps to zones via ZoneTagRule. Fully isolated from the
    legacy ticket_type gating — this is the new tag-based access system."""
    __tablename__ = "guest_tags"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Optional auto-source: guests whose RSVP answer to this question equals
    # `rsvp_value` get this tag when synced. Null = manual/import assignment only.
    rsvp_question_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rsvp_questions.id"), nullable=True)
    rsvp_value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class GuestTagLink(Base):
    """A guest carries a tag (many-to-many)."""
    __tablename__ = "guest_tag_links"
    __table_args__ = (UniqueConstraint("guest_id", "tag_id", name="uq_guest_tag"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    tag_id: Mapped[str] = mapped_column(String(36), ForeignKey("guest_tags.id"), index=True)


class ZoneTagRule(Base):
    """A zone permits a tag. A zone with no rules admits everyone; with rules,
    a guest needs at least one matching tag (any-of)."""
    __tablename__ = "zone_tag_rules"
    __table_args__ = (UniqueConstraint("zone_id", "tag_id", name="uq_zone_tag"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    zone_id: Mapped[str] = mapped_column(String(36), ForeignKey("zones.id"), index=True)
    tag_id: Mapped[str] = mapped_column(String(36), ForeignKey("guest_tags.id"), index=True)


class Gate(Base):
    """A scanner pinned to a zone + direction. Scanning at a gate auto-supplies
    the zone (no manual pick) and auto-evaluates the guest's tags against the
    zone's rules. Separate from the legacy/manual scan flows."""
    __tablename__ = "gates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    zone_id: Mapped[str] = mapped_column(String(36), ForeignKey("zones.id"))
    direction: Mapped[str] = mapped_column(String(4), default="in")  # "in" | "out"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TrialRequest(Base):
    """A customer's request to try paid features for free. Submitted from the
    onboarding banner; an operator approves it in the Console by comping one of
    the org's events (reusing the existing grant mechanism). Mark-only — no
    automatic grant, the operator chooses tier/credits per request."""
    __tablename__ = "trial_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    contact_name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    event_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    guest_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    use_case: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | approved | declined
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)


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


# ── Customizable message templates ─────────────────────────────────────────────

class MessageTemplate(Base):
    """An event-level override of an outbound message. Platform defaults live in
    code (services/templates.py::TEMPLATE_DEFS); a row here exists only when an
    organizer has customized a template for an event. Resolution is
    event-override → code default. Null body columns fall back to the default for
    that channel."""
    __tablename__ = "message_templates"
    __table_args__ = (UniqueConstraint("event_id", "template_key", name="uq_message_template_event_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    template_key: Mapped[str] = mapped_column(String(60), index=True)
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    sms_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    whatsapp_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    mms_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)


class MessageTemplateAudit(Base):
    """Append-only history of who changed (or reset) a template and when. Stores a
    JSON snapshot of the saved override (null = reset to default)."""
    __tablename__ = "message_template_audits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    template_key: Mapped[str] = mapped_column(String(60), index=True)
    action: Mapped[str] = mapped_column(String(20))  # "save" | "reset"
    snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON of saved fields
    changed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    changed_by_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
