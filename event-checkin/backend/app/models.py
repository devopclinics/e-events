import uuid
from datetime import datetime
from sqlalchemy import String, BigInteger, Boolean, DateTime, ForeignKey, Integer, Float, Text, UniqueConstraint, Index, text, JSON
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
    # UI-redesign rollout cohort for this org (per-ORGANIZATION, not per-user, so
    # every operator in the org sees consistent UI). Independent of is_active.
    # One of: legacy_only | redesign_opt_in | redesign_internal | redesign_cohort
    # | redesign_default | legacy_retired. Platform superadmins can always reach
    # the redesign regardless of this value (see User.is_platform_superadmin).
    # Default flipped to redesign_default as of the 2026-08-06 cutover -- new
    # orgs land on the redesign by default; legacy stays reachable via each
    # RedesignGate's "Switch to legacy UI" escape hatch (?ui=legacy). This
    # intentionally does NOT retroactively migrate existing orgs (see
    # db_migrate.py note) -- only new rows pick this up.
    redesign_cohort: Mapped[str] = mapped_column(String(20), default="redesign_default")
    # Org-level recurring subscription (separate axis from the per-event one-time
    # Event.is_paid/plan_tier purchases) — gates org-wide paid features like
    # read-write API access. `plan` above doubles as the current subscription's
    # OrgPlan.key once one is active; "free" means no active subscription.
    subscription_status: Mapped[str | None] = mapped_column(String(20), nullable=True)  # active | past_due | canceled | None
    subscription_provider: Mapped[str | None] = mapped_column(String(20), nullable=True)  # stripe | paystack
    stripe_customer_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    paystack_subscription_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    paystack_email_token: Mapped[str | None] = mapped_column(String(120), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Pending trial grant from an approved TrialRequest when the org had no event
    # yet. Consumed (applied + cleared) by the next event the org creates.
    trial_tier: Mapped[str | None] = mapped_column(String(50), nullable=True)
    trial_credits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Operator entitlement overrides: {"addon_seating": true/false}. Missing
    # keys inherit the platform-wide catalog setting. Event overrides take
    # precedence over these organization defaults.
    addon_overrides: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    purchased_addons: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Event Pass v2 is organization-scoped. These additive fields deliberately
    # coexist with event-level billing during the staging rollout.
    event_pass_tier: Mapped[str | None] = mapped_column(String(50), nullable=True)
    event_pass_status: Mapped[str] = mapped_column(String(20), default="free")
    event_pass_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    event_pass_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    event_pass_guest_cap: Mapped[int | None] = mapped_column(Integer, nullable=True)
    addon_promo_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    free_event_used: Mapped[bool] = mapped_column(Boolean, default=False)
    # Integer tenths of one message credit: email costs 1 unit (0.1 credit).
    message_credit_units: Mapped[int] = mapped_column(Integer, default=100)
    # Partner referral program: which org's referral link/code this one signed
    # up through. `slug` doubles as the referral code — set once, at signup,
    # never overwritten (an org can't be re-attributed later).
    referred_by_org_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organizations.id"), nullable=True)


class OrganizationEntitlementAudit(Base):
    """Immutable operator audit trail for Event Pass and wallet changes."""
    __tablename__ = "organization_entitlement_audits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    actor_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(50))
    reason: Mapped[str] = mapped_column(Text)
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class OrganizationPassNotice(Base):
    """Deduplicates pass-expiry emails for each organization and milestone."""
    __tablename__ = "organization_pass_notices"
    __table_args__ = (UniqueConstraint("org_id", "expires_at", "days_before", name="uq_org_pass_notice"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    days_before: Mapped[int] = mapped_column(Integer)
    recipient: Mapped[str] = mapped_column(String(255))
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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


class TrainingAssignment(Base):
    __tablename__ = "training_assignments"
    __table_args__ = (UniqueConstraint("org_id", "user_id", "course_key", "course_version", name="uq_training_assignment"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    course_key: Mapped[str] = mapped_column(String(100), index=True)
    course_version: Mapped[int] = mapped_column(Integer, default=1)
    assigned_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="assigned")
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TrainingProgress(Base):
    __tablename__ = "training_progress"
    __table_args__ = (UniqueConstraint("org_id", "user_id", "course_key", "course_version", "lesson_key", name="uq_training_progress"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    course_key: Mapped[str] = mapped_column(String(100))
    course_version: Mapped[int] = mapped_column(Integer, default=1)
    lesson_key: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="in_progress")
    best_score: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TrainingQuizAttempt(Base):
    __tablename__ = "training_quiz_attempts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    course_key: Mapped[str] = mapped_column(String(100))
    course_version: Mapped[int] = mapped_column(Integer, default=1)
    lesson_key: Mapped[str] = mapped_column(String(100))
    score: Mapped[int] = mapped_column(Integer)
    passed: Mapped[bool] = mapped_column(Boolean, default=False)
    answers: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TrainingPractical(Base):
    __tablename__ = "training_practicals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    course_key: Mapped[str] = mapped_column(String(100))
    course_version: Mapped[int] = mapped_column(Integer, default=1)
    lesson_key: Mapped[str] = mapped_column(String(100))
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    reviewer_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    reviewer_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TrainingAuditLog(Base):
    __tablename__ = "training_audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    actor_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    target_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(60))
    course_key: Mapped[str] = mapped_column(String(100))
    lesson_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class TrainingCertificate(Base):
    __tablename__ = "training_certificates"
    __table_args__ = (UniqueConstraint("org_id", "user_id", "course_key", "course_version", name="uq_training_certificate"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    certificate_number: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    course_key: Mapped[str] = mapped_column(String(100))
    course_version: Mapped[int] = mapped_column(Integer)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TrainingCourseRelease(Base):
    """Immutable curriculum snapshots; publishing never rewrites prior training."""
    __tablename__ = "training_course_releases"
    __table_args__ = (UniqueConstraint("course_key", "version", name="uq_training_course_release"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    course_key: Mapped[str] = mapped_column(String(100), index=True)
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    content: Mapped[dict] = mapped_column(JSON)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TrainingAccessGrant(Base):
    __tablename__ = "training_access_grants"
    __table_args__ = (UniqueConstraint("org_id", "user_id", name="uq_training_access_grant"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    granted_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    granted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ApiKey(Base):
    """A programmatic-access credential for an org's public API integrations.
    Only the SHA-256 hash is stored; the full key is shown to the org once,
    at creation, and never again — mirrors how most API-key systems work
    (Stripe, GitHub, etc.), so a leaked database dump can't be used to
    impersonate a customer's integrations."""
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    # First few characters of the real key (e.g. "fk_live_a1b2"), shown in the
    # UI so an org can tell keys apart without ever re-displaying the full value.
    key_prefix: Mapped[str] = mapped_column(String(20))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # "read_only" | "read_write" — write access requires the org to have an
    # active OrgPlan subscription with the "api_write" feature at creation time.
    scope: Mapped[str] = mapped_column(String(20), default="read_only")


class ApiKeyRequestLog(Base):
    """Audit trail for public-API calls — one row per request, so an org can
    see exactly what their integration did and operators can investigate abuse."""
    __tablename__ = "api_key_request_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    api_key_id: Mapped[str] = mapped_column(String(36), ForeignKey("api_keys.id"), index=True)
    method: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(String(255))
    status_code: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class WebhookEndpoint(Base):
    """An org-configured outbound webhook subscription. `secret` signs every
    delivery (HMAC-SHA256 over the raw JSON body) so the receiver can verify
    a payload actually came from Festio."""
    __tablename__ = "webhook_endpoints"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    secret: Mapped[str] = mapped_column(String(64))
    event_types: Mapped[list] = mapped_column(JSON, default=list)  # e.g. ["guest.checked_in", "rsvp.confirmed"]
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class WebhookDelivery(Base):
    """One outbox row per (endpoint, event) pair — mirrors FestioMeOutbox's
    shape (services/festiome_outbox.py): claimed with SKIP LOCKED, retried
    with exponential backoff, capped at MAX_ATTEMPTS. A separate table rather
    than generalizing the FestioMe outbox, since that one's dispatch is
    hardcoded to FestioMe-specific commands."""
    __tablename__ = "webhook_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    endpoint_id: Mapped[str] = mapped_column(String(36), ForeignKey("webhook_endpoints.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(60))
    payload: Mapped[str] = mapped_column(Text)  # JSON-encoded string
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | delivered | failed
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


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
    # Optional, event-scoped guest-directory access for officials. This is
    # intentionally independent of manager/admin access and is read-only.
    can_view_guests: Mapped[bool] = mapped_column(Boolean, default=False)
    # Guest operations (add/edit/remove, approvals, invitations, imports) without
    # granting access to event setup, Team & Settings, or other admin modules.
    can_manage_guests: Mapped[bool] = mapped_column(Boolean, default=False)
    # Planner access is deliberately split by sensitive domain. Staff receive
    # no planner access by default; event managers and org admins are granted
    # all capabilities when the scoped planner token is minted.
    can_view_planner: Mapped[bool] = mapped_column(Boolean, default=False)
    can_manage_planner_tasks: Mapped[bool] = mapped_column(Boolean, default=False)
    can_manage_planner_budget: Mapped[bool] = mapped_column(Boolean, default=False)
    can_manage_planner_vendors: Mapped[bool] = mapped_column(Boolean, default=False)
    can_manage_planner_documents: Mapped[bool] = mapped_column(Boolean, default=False)
    can_manage_planner_runsheet: Mapped[bool] = mapped_column(Boolean, default=False)
    # Event-scoped role: "staff" (default scanner/day-of) or "manager"
    # (event owner/admin for this assigned event only).
    event_role: Mapped[str] = mapped_column(String(30), default="staff")
    # For event_role=manager: "edit" can change event setup; "view" can only
    # open setup/results/check-in/orders without mutating event configuration.
    access_level: Mapped[str] = mapped_column(String(20), default="edit")
    # Backing field for optimistic-concurrency checks on permission edits (see
    # update_member_permissions / if_unmodified_since) — two admins editing the
    # same member's access at once shouldn't silently clobber each other.
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

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
    # What kind of event this is (Wedding, Graduation, Conference, …). Chosen
    # from a preset list at creation; nullable for pre-existing events.
    event_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # How guests enter the event. This is lifecycle intent, not a paid-feature
    # toggle: setup, ticketing and planner all branch from this single value.
    attendance_mode: Mapped[str] = mapped_column(String(20), default="rsvp")
    event_date: Mapped[datetime] = mapped_column(DateTime)
    # Optional end date/time for events that span multiple days (e.g. a 3-day
    # conference or a wedding weekend). NULL for the vast majority of (single-day)
    # events; when set, event_date is treated as the start of the range.
    event_end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # IANA timezone (e.g. "Europe/Zurich") the event runs in. Nullable for events
    # created before this field existed; those need a one-time backfill and fall
    # back to UTC for server-rendered times until set.
    timezone: Mapped[str | None] = mapped_column(String(80), nullable=True)
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
    # Experience workflow engine. Off by default so legacy RSVP, QR check-in,
    # seating, menu, and messaging flows remain unchanged until explicitly enabled.
    experience_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Time-driven live program. Separate from Experience itself and off by
    # default; enabling it only surfaces timed agenda items and never alters
    # RSVP, admission, seating, or existing feedback steps.
    live_program_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    live_program_enabled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Paid add-on entitlement + organizer opt-in. Gates whether FestioMe is
    # offered for this event at all; distinct from festiome_enabled below, which
    # only caches the remote service link state.
    festiome_addon_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Gates the Planner module (budget/vendors/timeline/runsheet/documents),
    # a standalone microservice — see planner-service/. Off by default like
    # the other paid add-ons; the nav link and page both hide/upsell until set.
    planner_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Festio Live add-on (live quizzes/polls/surveys/feedback) — gates the
    # standalone engagement-service the same way planner_enabled gates
    # planner-service above: off by default, no dependency the rest of the
    # platform relies on, nav link + page both hide/upsell until set.
    engagement_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Stable room-wide Festio Live join code. It is minted lazily when an
    # organizer opens Broadcast Join, then remains unchanged so printed QR
    # codes and presentation slides keep working for the life of the event.
    engagement_join_code: Mapped[str | None] = mapped_column(
        String(6), unique=True, nullable=True, index=True
    )
    # Guest Speaker Showcase add-on. Off by default; same shape as registry
    # (bool + lazily-minted unguessable public token) below.
    speaker_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    speaker_token: Mapped[str | None] = mapped_column(
        String(36), unique=True, nullable=True, default=lambda: str(uuid.uuid4())
    )
    # Default is to reveal the Speaker Showcase only after RSVP confirmation
    # (inside FestioHub) — not on the public invite/RSVP landing page itself.
    # Some organizers want speakers visible before RSVP too (as a draw to get
    # people to confirm, matching how the ticketing site always shows them
    # pre-purchase); this is that per-event opt-in.
    speaker_show_before_rsvp: Mapped[bool] = mapped_column(Boolean, default=False)
    # Partner/Sponsor Showcase add-on. Distinct from partner_pairing_enabled
    # (guest seating partner) below — unrelated feature, similar name.
    partner_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    partner_token: Mapped[str | None] = mapped_column(
        String(36), unique=True, nullable=True, default=lambda: str(uuid.uuid4())
    )
    # Automated Reminders add-on. No public token — unlike Speakers/Partners/
    # Registry, reminders have no guest-facing page, purely outbound automation.
    reminders_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Add-on purchase ledger: keys from PricingPlan(kind="addon") this event has
    # bought (e.g. "addon_seating"). Independent of the *_enabled runtime toggles
    # above -- purchasing grants the entitlement, the *_enabled flags are the
    # on/off switch an admin can still flip freely once purchased. None/[] = none
    # bought. See entitlements.FEATURE_ADDON for the feature -> addon mapping.
    purchased_addons: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Operator entitlement overrides: {"addon_seating": true/false}. These do
    # not modify purchase history and take precedence over org/global policy.
    addon_overrides: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Materialized organization/platform policies keep entitlement checks
    # deterministic across backend replicas without a per-request DB lookup.
    org_addon_overrides: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    platform_addon_overrides: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    addon_promo_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Cached integration state only; FestioMe data remains service-owned.
    festiome_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    festiome_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    festiome_open_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    festiome_last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    festiome_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional invite CTA that lets guests pair with a spouse/partner for seating.
    # Requires seating to be useful, but is controlled separately from seating.
    partner_pairing_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    venue_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    venue_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    hotel_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hotel_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    admission_note: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    # Whether the guest-facing "Notification preferences" consent card (SMS/
    # WhatsApp opt-in checkboxes + STOP/HELP disclosure) shows on the Guest
    # Hub check-in screen. Defaults on for 10DLC/carrier compliance whenever
    # SMS or WhatsApp notifications are enabled — organizers who don't send
    # guest SMS/WhatsApp from this event can turn it off.
    notify_consent_prompt_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Optional per-flow channel policy for cost control, e.g.
    # {"invite": ["email","sms"], "admission": ["mms","whatsapp"]}. For a flow
    # with a policy, only the FIRST deliverable channel (consent+contact) is used
    # (priority + fallback). Flows absent from the map keep the legacy behavior of
    # sending on every enabled+available channel. NULL/{} = legacy everywhere.
    channel_policy: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Platform-superadmin hard blocks (console-only). Organizers cannot override
    # these — they win over notify_* flags and the channel policy. Lists of
    # "email"/"sms"/"whatsapp"/"mms" and comm features
    # ("guest_hub"/"guest_chat"/"host_messages"/"announcements"/"festiome").
    blocked_messaging_channels: Mapped[list | None] = mapped_column(JSON, nullable=True)
    blocked_comm_features: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Send a notice to a guest when they decline / are rejected. Off by default
    # (previously silent); organizer opt-in.
    notify_rsvp_responses: Mapped[bool] = mapped_column(Boolean, default=False)
    # Post-event thank-you + feedback message, sent once via whichever channels
    # are enabled, `post_event_thankyou_delay_hours` after event_end_date (or
    # event_date for single-day events). Off by default — organizer opt-in, same
    # as notify_rsvp_responses above. `_sent_at` is the idempotency guard the
    # poller checks before sending (see app/services/post_event_message.py).
    post_event_thankyou_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    post_event_thankyou_delay_hours: Mapped[int] = mapped_column(Integer, default=4)
    # Guest segment the message goes to: "admitted" (checked in — the default,
    # since a no-show has nothing to give feedback on) | "confirmed" | "all".
    post_event_thankyou_audience: Mapped[str] = mapped_column(String(20), default="admitted")
    post_event_thankyou_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Walk-in registration at the door (Scanner → Manual). Off by default. New
    # walk-ins are auto-assigned to walk_in_table_group_id. Stored as a plain
    # String (no FK) to avoid an extra Event↔TableGroup mapper relationship.
    walk_in_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    walk_in_table_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # When True, staff registering a walk-in may pick ANY of the event's table
    # groups for that guest instead of always landing in walk_in_table_group_id.
    # Off by default so existing events keep today's single-default behavior
    # unchanged; only meaningful for events with more than one table group.
    # Ignored while section_mode_enabled is on (that flow already resolves the
    # group from the staffer's assigned section, by design — see
    # _resolve_section_group in routers/guests.py).
    walk_in_group_choice_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Existing invited guests who reach check-in without a table or group can
    # be routed into a configured default group. This is intentionally separate
    # from walk_in_table_group_id: they are known guests, not door walk-ins.
    default_guest_table_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Table Groups add-on: when True (default), a guest with an assigned table
    # group may only be seated/checked-in at tables inside that group. Events
    # with no table groups are unaffected regardless of this flag.
    enforce_table_groups: Mapped[bool] = mapped_column(Boolean, default=True)
    # Cosmetic-only override for the word "Table" across guest/staff-facing
    # copy (pass, check-in, messages, Seating admin UI) — e.g. "Cabin" or
    # "Room" for a retreat that allocates guests to sleeping cabins instead of
    # banquet tables. NULL/blank = "Table" everywhere, unchanged. Does not
    # affect the underlying SeatingTable/TableGroup data model at all.
    seating_term: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Same idea as seating_term, but for the individual seat within a table —
    # e.g. "Bunk" for a cabin, "Chair" for a formal dinner. NULL/blank = "Seat".
    seat_term: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Order candidate tables are tried in during automatic seat assignment
    # (assign_next_seat) — "sequential" (default) fills tables in sort_order/name
    # order before moving to the next; "random" shuffles the candidate list per
    # assignment call, spreading walk-ins/unassigned guests across tables rather
    # than always packing the first one first. Table-group filtering (which
    # tables are even candidates) is unaffected — this only reorders within
    # whatever set is already eligible.
    seat_assignment_order: Mapped[str] = mapped_column(String(20), default="sequential")
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
    # Check-out: when on, staff can scan a guest's ticket/checkout QR to record
    # their exit (a ScanEvent with direction="out"), and the scanner shows the
    # Check-out mode. Off by default.
    checkout_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Short, human-shareable code (8 chars, no confusable letters). Unique;
    # nullable so existing events backfill lazily when self check-in is enabled.
    event_code: Mapped[str | None] = mapped_column(String(16), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Backing field for optimistic-concurrency checks (see change_status /
    # if_unmodified_since) so two operators editing lifecycle-critical fields
    # can't silently clobber each other. Nullable so existing rows don't need
    # a backfill; a row with NULL here just can't be conflict-checked yet
    # (treated as "no known prior state" by callers, same as omitting the guard).
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

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
    # Per-field required/optional for the RSVP form, split by audience. A field is
    # only enforced when it is also collected (rsvp_collect_*). Defaults preserve
    # historical behavior: submitter email required, everything else optional.
    rsvp_email_required: Mapped[bool] = mapped_column(Boolean, default=True)
    rsvp_phone_required: Mapped[bool] = mapped_column(Boolean, default=False)
    rsvp_invitee_email_required: Mapped[bool] = mapped_column(Boolean, default=False)
    rsvp_invitee_phone_required: Mapped[bool] = mapped_column(Boolean, default=False)
    # Some family/school workflows use one parent email for multiple invitees.
    # Off by default so ordinary RSVP still blocks duplicate email submissions.
    rsvp_allow_duplicate_emails: Mapped[bool] = mapped_column(Boolean, default=False)
    # None = unlimited; integer = max accepted RSVPs
    rsvp_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Cover image URL — served from /api/uploads/
    invite_cover_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Small organizer/community logo badge, distinct from the cover photo —
    # rendered on the public invite page header. Served from /api/uploads/.
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Which Guest Hub information architecture this event's guests see.
    # None/"classic" = today's tabbed FestioHub card, unchanged. "companion"
    # = the redesigned single-scroll layout (Pass/Next Step/Journey first,
    # one consolidated Event Details block, conditional modules). Per-event
    # and organizer-selectable so existing events are never silently switched.
    guest_hub_layout: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Invite distribution mode:
    #   "open"   — shared /e/{event_id} link; anyone with it can RSVP.
    #   "closed" — invitation-only; each guest gets a unique /r/{invite_token}
    #              link and the open form is disabled.
    invite_mode: Mapped[str] = mapped_column(String(20), default="open")
    # RSVP cutoff. After this instant the invite page is read-only. None = no deadline.
    rsvp_deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # When True, the invite page shows "Time to be announced" instead of the
    # event_date time, and hides calendar-download links (their time would be wrong).
    event_time_tbd: Mapped[bool] = mapped_column(Boolean, default=False)
    # Open mode only: when True, self-service RSVPs land as "pending" and a
    # planner must approve before a ticket is issued. No effect in closed mode.
    rsvp_require_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    # Optional open-RSVP mode for schools/conventions where one submitter
    # registers multiple invitees. Off by default so normal RSVP still creates
    # exactly one guest row per form submission.
    rsvp_multi_invitee_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    rsvp_multi_invitee_limit: Mapped[int] = mapped_column(Integer, default=10)
    # Optional per-category invitee caps for multi-invitee RSVP. JSON object,
    # keyed by the submitter category/role answer, e.g. {"Parent": 2, "VIP": 10}.
    rsvp_multi_invitee_limit_rules: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Optional per-category seating map for multi-invitee RSVP. JSON object keyed
    # by the same submitter category answer; each value is
    # {"submitter": "<table category bucket>", "invitee": "<table category bucket>"}.
    # On RSVP the submitter is pinned to a table in the submitter bucket and each
    # invited guest to a table in the invitee bucket (values match SeatingTable.category).
    # "invitee" may be omitted for submitter-only categories.
    rsvp_category_seating_rules: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Per-event override for the "Guest type" dropdown shown on each additional
    # invitee row in multi-invitee RSVP. None = use the platform default list
    # (InvitePage.jsx DEFAULT_INVITEE_TYPES) — existing events are unaffected.
    rsvp_invitee_type_options: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Per-event override for the "Age group" dropdown shown on each additional
    # invitee row in multi-invitee RSVP. None = no age-group field is shown.
    rsvp_invitee_age_options: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Guest-type values (drawn from rsvp_invitee_type_options) exempt from
    # rsvp_invitee_email_required/rsvp_invitee_phone_required — e.g. a child
    # doesn't need their own contact info when the submitting parent's is
    # already collected. None/empty = no exemptions, existing behavior.
    rsvp_invitee_contact_exempt_types: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # ── Invite page display controls ─────────────────────────────────────────
    # Each flag gates a UI widget on the public invite/confirmation page.
    # All default to True so existing events automatically get the new features.
    invite_countdown_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    invite_capacity_bar_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    invite_share_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    invite_add_to_calendar_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    rsvp_confetti_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

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
    # Email metering: the first EMAIL_FREE_QUOTA (25) guest emails per event
    # are free; beyond that, email draws from the same fractional credit-bank
    # mechanism as every other channel (see credit_bank below).
    emails_sent: Mapped[int] = mapped_column(Integer, default=0)
    # Deprecated: superseded by credit_bank["email"] (see entitlements.py's
    # _spend_channel_credit). Kept only so old rows don't break; no longer
    # read or written.
    email_half_pending: Mapped[int] = mapped_column(Integer, default=0)
    # Per-channel fractional credit ledger, e.g. {"sms": 0.5, "email": 0.3}.
    # A channel's credits_per_unit rate (MessagingCreditRate, admin-editable)
    # can be any positive float — below 1 (many sends per credit, like email)
    # or above 1 (multiple credits per send, like MMS). Since message_credits
    # itself stays a whole-number balance, _spend_channel_credit banks
    # whatever a whole-credit charge overpays (or, for sub-1 rates, whatever
    # a single unit still owes) here, so the average cost per send converges
    # exactly on the configured rate without ever needing fractional credits
    # in the balance itself.
    credit_bank: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=dict)

    credit_ledger: Mapped[list["MessageCreditLedger"]] = relationship("MessageCreditLedger", back_populates="event", cascade="all, delete-orphan")
    members: Mapped[list["EventUser"]] = relationship("EventUser", back_populates="event", cascade="all, delete-orphan")
    guests: Mapped[list["Guest"]] = relationship("Guest", back_populates="event", cascade="all, delete-orphan")
    tables: Mapped[list["SeatingTable"]] = relationship("SeatingTable", back_populates="event", cascade="all, delete-orphan")
    menu_categories: Mapped[list["MenuCategory"]] = relationship("MenuCategory", back_populates="event", cascade="all, delete-orphan")
    rsvp_questions: Mapped[list["RSVPQuestion"]] = relationship("RSVPQuestion", back_populates="event", cascade="all, delete-orphan")


# ── Experience workflow engine ───────────────────────────────────────────────

class ExperienceWorkflow(Base):
    __tablename__ = "experience_workflows"
    __table_args__ = (
        UniqueConstraint("event_id", "version", name="uq_experience_workflow_event_version"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), default="Default Experience")
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | published | archived
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_default: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    event: Mapped["Event"] = relationship("Event")
    steps: Mapped[list["ExperienceStep"]] = relationship(
        "ExperienceStep", back_populates="workflow", cascade="all, delete-orphan"
    )


class ExperienceStep(Base):
    __tablename__ = "experience_steps"
    __table_args__ = (
        UniqueConstraint("workflow_id", "key", name="uq_experience_step_workflow_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id: Mapped[str] = mapped_column(String(36), ForeignKey("experience_workflows.id"), index=True)
    key: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(40), index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Optional timed agenda metadata. Operational Experience steps leave these
    # NULL/false and retain their existing behavior.
    starts_offset_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_segment: Mapped[bool] = mapped_column(Boolean, default=False)
    conditions: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    workflow: Mapped["ExperienceWorkflow"] = relationship("ExperienceWorkflow", back_populates="steps")


class GuestExperienceProgress(Base):
    __tablename__ = "guest_experience_progress"
    __table_args__ = (
        UniqueConstraint("guest_id", "step_id", name="uq_guest_experience_progress_guest_step"),
        Index("ix_guest_experience_progress_event_guest", "event_id", "guest_id"),
        Index("ix_guest_experience_progress_event_step_status", "event_id", "step_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    workflow_id: Mapped[str] = mapped_column(String(36), ForeignKey("experience_workflows.id"), index=True)
    step_id: Mapped[str] = mapped_column(String(36), ForeignKey("experience_steps.id"), index=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="not_started", index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    completed_by_source: Mapped[str | None] = mapped_column(String(30), nullable=True)
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress_metadata: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ExperienceEvent(Base):
    __tablename__ = "experience_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    workflow_id: Mapped[str] = mapped_column(String(36), ForeignKey("experience_workflows.id"), index=True)
    step_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("experience_steps.id"), nullable=True, index=True)
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), nullable=True, index=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(50), index=True)
    source: Mapped[str] = mapped_column(String(30), default="system")
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class EngagementSyncOutbox(Base):
    """Durable Experience -> Festio Live program synchronization.

    Rows are committed in the same transaction as workflow publication/state
    changes. Delivery happens later over the engagement service's internal
    HTTP contract, so an unavailable Live service can never fail Experience.
    """
    __tablename__ = "engagement_sync_outbox"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_engagement_sync_outbox_idempotency"),
        Index("ix_engagement_sync_outbox_due", "status", "next_attempt_at"),
        Index("ix_engagement_sync_outbox_event_source", "event_id", "source_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    source_id: Mapped[str] = mapped_column(String(36), index=True)
    source_version: Mapped[int] = mapped_column(BigInteger)
    command: Mapped[str] = mapped_column(String(60), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class FeedbackSubmission(Base):
    """One guest response to one published Feedback Experience step."""
    __tablename__ = "feedback_submissions"
    __table_args__ = (
        UniqueConstraint("guest_id", "step_id", name="uq_feedback_submission_guest_step"),
        Index("ix_feedback_submission_event_step", "event_id", "step_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    workflow_id: Mapped[str] = mapped_column(String(36), ForeignKey("experience_workflows.id"), index=True)
    step_id: Mapped[str] = mapped_column(String(36), ForeignKey("experience_steps.id"), index=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    answers: Mapped[dict] = mapped_column(JSON, default=dict)
    question_snapshot: Mapped[list] = mapped_column(JSON, default=list)
    anonymous: Mapped[bool] = mapped_column(Boolean, default=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ConsentForm(Base):
    __tablename__ = "consent_forms"
    __table_args__ = (
        Index("ix_consent_forms_event_active", "event_id", "is_active"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    title: Mapped[str] = mapped_column(String(255), default="Event consent")
    body: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    require_signature: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ConsentSignature(Base):
    __tablename__ = "consent_signatures"
    __table_args__ = (
        UniqueConstraint("form_id", "guest_id", name="uq_consent_signature_form_guest"),
        Index("ix_consent_signatures_event_guest", "event_id", "guest_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    form_id: Mapped[str] = mapped_column(String(36), ForeignKey("consent_forms.id"), index=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    signer_name: Mapped[str] = mapped_column(String(255))
    signature_text: Mapped[str] = mapped_column(String(255))
    signed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(80), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sent_copy_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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


class OrgPlan(Base):
    """Editable catalogue of org-level recurring subscription plans (superadmin-
    managed) — a separate axis from PricingPlan above, which prices one-time
    per-event purchases. These are monthly recurring plans that unlock org-wide
    paid features (e.g. read-write Public API access) via `features`."""
    __tablename__ = "org_plans"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)  # e.g. "api_access"
    label: Mapped[str] = mapped_column(String(120))
    usd_monthly: Mapped[int] = mapped_column(Integer, default=0)  # cents
    ngn_monthly: Mapped[int] = mapped_column(Integer, default=0)  # kobo
    features: Mapped[list] = mapped_column(JSON, default=list)    # e.g. ["api_write"]
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Cached Paystack Plan code (Paystack plans are created once, lazily, on
    # first checkout for a given OrgPlan — see org_billing.py).
    paystack_plan_code: Mapped[str | None] = mapped_column(String(120), nullable=True)


class Payment(Base):
    """One Event Pass purchase. `reference` is the provider's id (Stripe session
    or Paystack reference) and is unique → webhook retries are idempotent."""
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    # Nullable: payments are org-level financial audit records — deleting an
    # event detaches its payments (event_id → NULL) instead of blocking the
    # delete or destroying the audit trail.
    event_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("events.id"), index=True, nullable=True)
    provider: Mapped[str] = mapped_column(String(20))           # "stripe" | "paystack"
    reference: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    tier_key: Mapped[str] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column(Integer)               # smallest unit
    currency: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|paid|failed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MessageCreditLedger(Base):
    """Append-only event credit ledger.

    `delta` is positive for grants/top-ups/refunds and negative for spend/reserve.
    `credits` stores the absolute weighted credit amount for this operation.
    """
    __tablename__ = "message_credit_ledger"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), nullable=True, index=True)
    payment_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("payments.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(30), index=True)  # grant|topup|reserve|spend|refund|adjust
    status: Mapped[str] = mapped_column(String(30), default="posted", index=True)  # reserved|posted|refunded|failed
    channel: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(60), nullable=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True, index=True)
    credit_units: Mapped[int] = mapped_column(Integer, default=0)
    unit_delta: Mapped[int] = mapped_column(Integer, default=0)
    unit_balance_after: Mapped[int] = mapped_column(Integer, default=0)
    units: Mapped[int] = mapped_column(Integer, default=1)
    unit_weight: Mapped[int] = mapped_column(Integer, default=1)
    credits: Mapped[int] = mapped_column(Integer, default=0)
    delta: Mapped[int] = mapped_column(Integer, default=0)
    balance_after: Mapped[int] = mapped_column(Integer, default=0)
    provider_cost_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider_currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    event: Mapped["Event"] = relationship("Event", back_populates="credit_ledger")


class FestioMeOutbox(Base):
    """Durable, failure-isolated commands destined for the FestioMe service.

    GuestHub commits these rows in the same transaction as the guest/event
    change.  A bounded background worker delivers them later, so an unavailable
    chat service can never fail RSVP, invitations, or check-in.
    """
    __tablename__ = "festiome_outbox"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_festiome_outbox_idempotency"),
        Index("ix_festiome_outbox_due", "status", "next_attempt_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    command: Mapped[str] = mapped_column(String(50), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


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
    # Floor-plan layout: canvas position (px), shape, and rotation. NULL pos means
    # "not placed yet" — the editor auto-arranges those into a grid on first open.
    pos_x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pos_y: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shape: Mapped[str] = mapped_column(String(12), default="round")  # round | rect
    rotation: Mapped[int] = mapped_column(Integer, default=0)        # degrees
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    event: Mapped["Event"] = relationship("Event", back_populates="tables")
    guests: Mapped[list["Guest"]] = relationship("Guest", back_populates="table")


class FloorPlan(Base):
    """One venue floor layout per event: canvas size, optional traced background
    image, and the tokens that let a client view (and optionally edit) it via a
    share link — same pattern as the RSVP/registry tokens."""
    __tablename__ = "floor_plans"
    __table_args__ = (UniqueConstraint("event_id", name="uq_floor_plan_event"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    width: Mapped[int] = mapped_column(Integer, default=1200)
    height: Mapped[int] = mapped_column(Integer, default=800)
    bg_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    bg_opacity: Mapped[int] = mapped_column(Integer, default=40)  # 0..100
    # Client share links. view = read-only, edit = drag/save without a login.
    share_token: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    edit_token: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FloorElement(Base):
    """Non-table decor on the floor plan: stage, entrance/exit, dance floor, bar,
    a plain label, or a wall box. Positioned on the same canvas as the tables."""
    __tablename__ = "floor_elements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    type: Mapped[str] = mapped_column(String(20))  # stage|entrance|exit|dancefloor|bar|label|wall
    label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    pos_x: Mapped[int] = mapped_column(Integer, default=0)
    pos_y: Mapped[int] = mapped_column(Integer, default=0)
    width: Mapped[int] = mapped_column(Integer, default=120)
    height: Mapped[int] = mapped_column(Integer, default=60)
    rotation: Mapped[int] = mapped_column(Integer, default=0)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)


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


class Household(Base):
    """A named group of guests belonging to the same family/household — distinct
    from TableGroup (seating). Lets invites/RSVPs/messaging be reasoned about at
    the household level (e.g. 'the Smith family') regardless of how each guest
    was added (manual, CSV import, or self-service RSVP)."""
    __tablename__ = "households"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Optional seating default: assigning a guest to this household auto-applies
    # these onto the guest (still editable per guest afterward — a one-time
    # default, not a live link).
    default_table_group_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("table_groups.id"), nullable=True)
    default_table_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("seating_tables.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Task(Base):
    """A per-event to-do item (e.g. 'confirm florist', 'print name badges').
    Visible/editable by any staff member on the event, not just guest managers —
    this is team coordination, not guest data."""
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Planner metadata lives on the canonical task so Timeline, My Tasks and
    # the team task board all operate on the same record.  Milestone/vendor
    # ids are opaque because those entities live in the planner service.
    planner_milestone_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    planner_vendor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    priority: Mapped[str] = mapped_column(String(10), default="normal")
    assignee_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | in_progress | done
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TaskActivity(Base):
    """One entry in a task's activity feed — either a staff-written comment
    (kind='comment') or an automatic system entry (kind='system', e.g. status
    changes, reassignment, creation). Single table so the UI renders one
    unified, chronological thread instead of stitching two sources together."""
    __tablename__ = "task_activities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), default="comment")  # comment | system
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Subtask(Base):
    """A lightweight checklist item under a Task — title + status, nothing
    else (no assignee/due date): this is a checklist, not a nested set of
    full tasks, but shares the same open/in_progress/done vocabulary as Task
    so the two feel consistent."""
    __tablename__ = "subtasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | in_progress | done
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TaskAttachment(Base):
    """A file/image attached to a Task — a contract, a reference photo, a
    spreadsheet. Uploadable by any staff member on the event (same bar as
    comments/subtasks; Task has no created_by_user_id to gate more narrowly)."""
    __tablename__ = "task_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(String(500))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    uploaded_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MenuCategory(Base):
    __tablename__ = "menu_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(100))
    # Optional day grouping for multi-day events (e.g. "Friday · July 17").
    # Categories sharing a label render under one day tab on the guest ticket.
    day_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Display-only: shown on the ticket as an informational menu (no selection).
    display_only: Mapped[bool] = mapped_column(Boolean, default=False)
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


class GuestMealFulfillment(Base):
    """One row per guest per meal category actually served — fills the gap
    `Guest.meal_served` can't: that single boolean can't say WHICH category
    (breakfast/lunch/dinner, or which day) was served, so a guest with three
    meal categories has exactly one served flag for all three, forever.

    Kept alongside `Guest.meal_served` (dual-write): this table is the
    source of truth for per-category reporting; the boolean stays in sync
    as "at least one category served" for any code that still reads it."""
    __tablename__ = "guest_meal_fulfillment"
    __table_args__ = (
        UniqueConstraint("guest_id", "category_id", name="uq_guest_meal_fulfillment"),
        # meals_breakdown() counts served rows per category — matches this shape.
        Index("ix_guest_meal_fulfillment_category_status", "category_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    category_id: Mapped[str] = mapped_column(String(36), ForeignKey("menu_categories.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="served")  # served | skipped | denied
    served_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    served_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class MealService(Base):
    """A scheduled serving occurrence of a menu category — Track B v2.

    GuestMealFulfillment (above) tracked fulfillment directly against a
    category, with no service date/time, station, capacity, or eligibility
    concept, and reversing a "served" mark deleted the row outright (no
    audit trail). This table + GuestMealService replace it: a category can
    have one or more MealService rows (normally one; the schema doesn't
    force that), each with its own schedule/venue/capacity/status, and
    GuestMealService keeps a durable per-guest fulfillment record instead of
    an all-or-nothing row that vanishes on reversal.

    GuestMealFulfillment itself is left in place (unused by new code) rather
    than dropped — existing rows were migrated forward via SCHEMA_PATCHES,
    dropping a live production table is not worth the risk for a rename."""
    __tablename__ = "meal_services"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    category_id: Mapped[str] = mapped_column(String(36), ForeignKey("menu_categories.id"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    service_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    venue_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("zones.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open")  # draft | open | closed | cancelled
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GuestMealService(Base):
    """Per-guest record for a MealService — the durable replacement for
    GuestMealFulfillment. Reversing a "served" mark sets fulfillment_status
    back to "pending" with an override_reason instead of deleting the row,
    so who-served-whom-when survives a correction. eligibility_status is a
    real, overridable field (default "eligible" for every non-declined
    guest) rather than inferring eligibility from whether they happened to
    make a menu choice, which excluded non-responders from the count
    entirely."""
    __tablename__ = "guest_meal_services"
    __table_args__ = (
        UniqueConstraint("service_id", "guest_id", name="uq_guest_meal_service"),
        Index("ix_guest_meal_service_service_status", "service_id", "fulfillment_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("meal_services.id"), index=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    eligibility_status: Mapped[str] = mapped_column(String(20), default="eligible")  # eligible | not_eligible
    fulfillment_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | served | skipped | denied
    served_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    served_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    station_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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
    # RSVP response state: "invited" (no response yet) | "confirmed" | "declined" |
    # "pending" (awaiting host approval) | "waitlisted" (capacity full at RSVP time).
    rsvp_status: Mapped[str] = mapped_column(String(20), default="invited")
    rsvp_responded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Set only while rsvp_status == "waitlisted"; the timestamp doubles as the
    # queue order (earliest first) so no separate position column needs
    # renumbering as guests are promoted or leave the queue.
    waitlisted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
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
    # Family/household grouping — independent of seating (assigned_table_group_id).
    # One household per guest, nullable for guests not grouped.
    household_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("households.id"), nullable=True)
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
    # Optional context from multi-invitee RSVP submissions.
    rsvp_submitter_guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), nullable=True)
    rsvp_submitter_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rsvp_submitter_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rsvp_submitter_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    rsvp_relationship: Mapped[str | None] = mapped_column(String(120), nullable=True)
    rsvp_guest_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    rsvp_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Stable linkage to the staging ticketing-service order. The order lives in
    # a separate database, so this is intentionally indexed rather than an FK.
    paid_ticket_order_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    paid_ticket_pass_design: Mapped[dict | None] = mapped_column(JSON, nullable=True)

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
    # Backing field for optimistic-concurrency checks on guest edits (see
    # update_guest / if_unmodified_since) — this is the highest-traffic,
    # most-shared table in the app (edits, RSVP approve/reject, seat
    # assignment, check-in all touch it), so silent-overwrite risk here is
    # the most likely to actually bite two operators working the same event.
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

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
    # Optional conditional visibility: when set, this question is only shown
    # (and only enforced as required) if the referenced question's submitted
    # answer equals depends_on_value. Both null = always shown, platform default.
    depends_on_question_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rsvp_questions.id"), nullable=True)
    depends_on_value: Mapped[str | None] = mapped_column(String(255), nullable=True)

    event: Mapped["Event"] = relationship("Event", back_populates="rsvp_questions")
    answers: Mapped[list["RSVPAnswer"]] = relationship("RSVPAnswer", cascade="all, delete-orphan")


# ── Guest communication / Guest Hub ───────────────────────────────────────────

class EventGuestMessagingSettings(Base):
    __tablename__ = "event_guest_messaging_settings"
    __table_args__ = (UniqueConstraint("event_id", name="uq_event_guest_messaging_settings_event"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    guest_hub_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    announcements_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    direct_host_messages_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    guest_chat_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    guest_chat_posting_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    attending_only_chat: Mapped[bool] = mapped_column(Boolean, default=True)
    # Staff-only operational push (e.g. denied-scan alerts) — off by default,
    # separate from every guest-facing toggle above.
    staff_operational_alerts_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Quiet hours for non-urgent push, "HH:MM" in the event's own timezone
    # (Event.timezone). Null on either end means quiet hours are off. Urgent
    # pushes (staff operational alerts) bypass this by design.
    quiet_hours_start: Mapped[str | None] = mapped_column(String(5), nullable=True)
    quiet_hours_end: Mapped[str | None] = mapped_column(String(5), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PushPreference(Base):
    """Per-actor, per-category push opt-out. Absence of a row means the
    default (enabled) — this is an opt-out model, not opt-in, so a guest who
    registers a device starts receiving push without an extra preferences
    step, matching how Web Push already works today."""
    __tablename__ = "push_preferences"
    __table_args__ = (
        UniqueConstraint("event_id", "actor_type", "actor_id", "category", name="uq_push_preference_actor_category"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    actor_type: Mapped[str] = mapped_column(String(20), index=True)
    actor_id: Mapped[str] = mapped_column(String(36), index=True)
    category: Mapped[str] = mapped_column(String(30))  # "announcement" | "chat" | "staff_ops"
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EventMessageThread(Base):
    __tablename__ = "event_message_threads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    thread_type: Mapped[str] = mapped_column(String(30), index=True)  # announcement | direct | group_chat
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by_type: Mapped[str] = mapped_column(String(30), default="system")
    created_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EventMessage(Base):
    __tablename__ = "event_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    thread_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("event_message_threads.id"), nullable=True, index=True)
    sender_type: Mapped[str] = mapped_column(String(30))  # organizer | guest | system
    sender_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), nullable=True, index=True)
    message_type: Mapped[str] = mapped_column(String(30), index=True)  # announcement | direct | group_chat | system
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    message_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EventAnnouncement(Base):
    __tablename__ = "event_announcements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    audience_type: Mapped[str] = mapped_column(String(40), default="attending_only", index=True)
    audience_filter: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    send_in_app: Mapped[bool] = mapped_column(Boolean, default=True)
    send_email: Mapped[bool] = mapped_column(Boolean, default=False)
    send_sms: Mapped[bool] = mapped_column(Boolean, default=False)
    send_whatsapp: Mapped[bool] = mapped_column(Boolean, default=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EventMessageRead(Base):
    __tablename__ = "event_message_reads"
    __table_args__ = (UniqueConstraint("message_id", "guest_id", "admin_user_id", name="uq_event_message_read_actor"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("event_messages.id"), index=True)
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), nullable=True, index=True)
    admin_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    read_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class EventMessageDeliveryLog(Base):
    __tablename__ = "event_message_delivery_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    message_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("event_messages.id"), nullable=True, index=True)
    announcement_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("event_announcements.id"), nullable=True, index=True)
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), nullable=True, index=True)
    channel: Mapped[str] = mapped_column(String(30), default="in_app")
    recipient: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    provider: Mapped[str | None] = mapped_column(String(60), nullable=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class BroadcastLog(Base):
    """One row per broadcast send (Messages tab) — the free-text message,
    audience, channels, and per-channel outcome counts. Broadcasts were
    previously ephemeral: the message text and "this went to N people"
    grouping vanished the moment the send finished."""
    __tablename__ = "broadcast_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    sent_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    message: Mapped[str] = mapped_column(Text)
    target: Mapped[str] = mapped_column(String(30))
    channels: Mapped[list] = mapped_column(JSON)
    channel_counts: Mapped[dict] = mapped_column(JSON)
    queued: Mapped[int] = mapped_column(Integer, default=0)
    skipped_no_contact: Mapped[int] = mapped_column(Integer, default=0)
    skipped_no_consent: Mapped[int] = mapped_column(Integer, default=0)
    skipped_no_credits: Mapped[int] = mapped_column(Integer, default=0)
    mms_media_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class GuestPushSubscription(Base):
    """A guest-approved browser/device endpoint for FestioHub Web Push.

    The endpoint and encryption keys remain server-side; the public event page
    never receives another guest's subscription information.
    """
    __tablename__ = "guest_push_subscriptions"
    __table_args__ = (UniqueConstraint("endpoint", name="uq_guest_push_subscription_endpoint"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    endpoint: Mapped[str] = mapped_column(Text)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FcmDeviceToken(Base):
    """A registered Firebase Cloud Messaging device token — actor-agnostic
    (guest or staff), unlike GuestPushSubscription which is guest-only Web
    Push. Kept alongside it rather than replacing it: FCM is for native
    mobile (Capacitor Android/iOS); Web Push stays the browser path. See
    docs/FCM-IMPLEMENTATION-BACKLOG-JIRA.csv, "Web push compatibility ADR."
    """
    __tablename__ = "fcm_device_tokens"
    __table_args__ = (UniqueConstraint("token", name="uq_fcm_device_token_token"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    actor_type: Mapped[str] = mapped_column(String(20), index=True)  # "guest" | "staff"
    actor_id: Mapped[str] = mapped_column(String(36), index=True)  # guests.id or users.id per actor_type
    platform: Mapped[str] = mapped_column(String(20))  # "android" | "ios" | "web"
    token: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # active | revoked | invalid
    device_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PushOutbox(Base):
    """Durable, retryable push-send jobs — mirrors FestioMeOutbox's pattern
    (transactional outbox + bounded tick worker) so a provider outage or a
    messaging-service crash mid-send can't silently lose a queued push.
    Self-contained: payload carries everything needed to deliver (title,
    body, url, and channel-specific target info) so a job survives even if
    the originating subscription/token row is later removed.
    """
    __tablename__ = "push_outbox"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_push_outbox_idempotency"),
        Index("ix_push_outbox_due", "status", "next_attempt_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    channel: Mapped[str] = mapped_column(String(20), index=True)  # "web_push" | "fcm"
    target_id: Mapped[str] = mapped_column(String(36))  # GuestPushSubscription.id or FcmDeviceToken.id
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), nullable=True, index=True)
    message_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("event_messages.id"), nullable=True)
    announcement_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("event_announcements.id"), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class EmailDeliveryEvent(Base):
    __tablename__ = "email_delivery_events"
    __table_args__ = (
        UniqueConstraint("provider_event_id", name="uq_email_delivery_provider_event"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    provider: Mapped[str] = mapped_column(String(60), default="resend", index=True)
    provider_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    provider_email_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    event_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("events.id"), nullable=True, index=True)
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), nullable=True, index=True)
    recipient: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    message_kind: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(40), index=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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
    claimer_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    relationship: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Server-normalized action: reserved | purchased | contributed | pledged |
    # used_external_registry. This makes the activity ledger meaningful across
    # every registry item type instead of treating every interaction as a claim.
    action: Mapped[str] = mapped_column(String(40), default="reserved")
    quantity: Mapped[int] = mapped_column(Integer, default=1)            # items
    amount_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)  # funds
    reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    thank_you_channel: Mapped[str | None] = mapped_column(String(20), nullable=True)
    thank_you_status: Mapped[str] = mapped_column(String(30), default="not_requested")
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


class GuestSpeaker(Base):
    """One entry on an event's public Speaker Showcase. No category grouping
    (unlike Partner below) — the reference this add-on is modeled on shows no
    speaker category filter, just a flat searchable list."""
    __tablename__ = "guest_speakers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # [{"platform": "linkedin", "url": "https://..."}, ...]
    social_links: Mapped[list | None] = mapped_column(JSON, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PartnerCategory(Base):
    """Admin-managed category for Partner Showcase entries (e.g. "Sponsors",
    "Vendors") — a real table, not a free-text field, because organizers create
    and reorder their own categories (unlike GuestSpeaker, which has none)."""
    __tablename__ = "partner_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Partner(Base):
    """One entry on an event's public Partner/Sponsor Showcase."""
    __tablename__ = "partners"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    category_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("partner_categories.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    logo_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    website_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
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
    __table_args__ = (
        # dashboard-service's day/range-scoped attendance queries filter on
        # exactly this pair; a composite index matches the query shape better
        # than the separate single-column indexes below.
        Index("ix_scan_events_event_scanned_at", "event_id", "scanned_at"),
        # First-scan-per-guest / on-site-as-of-cutoff queries group by
        # (event_id, guest_id) then aggregate scanned_at.
        Index("ix_scan_events_event_guest_scanned_at", "event_id", "guest_id", "scanned_at"),
    )

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


class EventReminder(Base):
    """Organizer-defined reminder step ("7 days before", "morning of", …).
    Audience (rsvp_status filter) is evaluated fresh at fire time -- see
    services/reminder_send.py -- not captured at creation, so a guest who
    confirms between reminder #1 and #2 stops matching a "please RSVP"
    reminder's audience automatically. Dedup is at the ROW level: fired_at
    set once, claimed via SKIP LOCKED (services/reminder_outbox.py) -- never
    per-guest (see EventReminderSend for the separate per-guest send log,
    which exists for crash-resume safety and the delivery audit trail, not
    dedup)."""
    __tablename__ = "event_reminders"
    __table_args__ = (Index("ix_event_reminders_due", "enabled", "fired_at", "fire_at_utc"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    label: Mapped[str] = mapped_column(String(120))

    # Timing -- offset in whole days before the event, fired at a local
    # wall-clock time in the event's own timezone (Event.timezone, falls
    # back to UTC if null -- see timeutil.py).
    offset_days: Mapped[int] = mapped_column(Integer, default=1)  # 0 = day-of
    send_time_local: Mapped[str] = mapped_column(String(5), default="09:00")  # "HH:MM"
    # Denormalized UTC instant, recomputed whenever this row or the parent
    # event's date/timezone changes (services/reminders.py::recompute_fire_times)
    # -- keeps the scheduler's due-query a plain indexed comparison instead of
    # redoing timezone math on every tick for every not-yet-fired reminder.
    fire_at_utc: Mapped[datetime] = mapped_column(DateTime, index=True)

    channels: Mapped[list] = mapped_column(JSON, default=list)  # subset of ["email","sms","whatsapp"]
    audience_rsvp_statuses: Mapped[list | None] = mapped_column(JSON, nullable=True)  # None = all guests

    subject: Mapped[str | None] = mapped_column(Text, nullable=True)  # email only
    email_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    sms_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    whatsapp_body: Mapped[str | None] = mapped_column(Text, nullable=True)

    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|sending|sent|failed
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    guests_targeted: Mapped[int] = mapped_column(Integer, default=0)
    guests_sent: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)


class EventReminderSend(Base):
    """Per-guest delivery log for one reminder's fire event. NOT the dedup
    guard (that's EventReminder.status/fired_at) -- this is what lets a
    crashed-mid-fanout reminder resume without double-sending to guests it
    already reached, plus the organizer-facing delivery audit trail."""
    __tablename__ = "event_reminder_sends"
    __table_args__ = (
        UniqueConstraint("reminder_id", "guest_id", name="uq_reminder_send_guest"),
        Index("ix_reminder_sends_reminder", "reminder_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    reminder_id: Mapped[str] = mapped_column(String(36), ForeignKey("event_reminders.id"), index=True)
    guest_id: Mapped[str] = mapped_column(String(36), ForeignKey("guests.id"), index=True)
    channels_sent: Mapped[list] = mapped_column(JSON, default=list)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class QaChecklistSubmission(Base):
    """One tester's saved progress from the standalone staging QA checklist
    (public/media/festio-qa-checklist.html). That page has no login of its own —
    testers just type a name — so this table is the only durable record of who
    tested what. `results` is a flat list of per-case entries the page already
    has in memory: {section_id, section_title, case_id, case_title, priority,
    status, note, evidence}. Visible to operators only, via the Console."""
    __tablename__ = "qa_checklist_submissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tester_name: Mapped[str] = mapped_column(String(255), index=True)
    summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    tested_count: Mapped[int] = mapped_column(Integer, default=0)
    pass_count: Mapped[int] = mapped_column(Integer, default=0)
    issue_count: Mapped[int] = mapped_column(Integer, default=0)
    blocked_count: Mapped[int] = mapped_column(Integer, default=0)
    na_count: Mapped[int] = mapped_column(Integer, default=0)
    results: Mapped[list] = mapped_column(JSON, default=list)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class PlatformSettings(Base):
    """Single-row table of platform-wide operational toggles, controlled from
    the operator Console. Off by default — flip on only once the gated
    feature is actually ready (e.g. support_chat_enabled requires the manual
    Chatwoot bootstrap in support-service/README.md to be done first)."""
    __tablename__ = "platform_settings"

    id: Mapped[str] = mapped_column(String(20), primary_key=True, default=lambda: "singleton")
    support_chat_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    addon_promo_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Event Calendars: curated cross-event public/private listing pages ───────
# (Gatsby-parity feature.) Contact/ContactList are a new, standalone org-level
# audience concept — Guest (above) is hard-scoped to one event and has no
# cross-event equivalent, so private calendars need their own recipient model.

class ContactList(Base):
    """A named, reusable group of Contacts an organizer manages directly —
    the audience source for private calendars (and any future feature that
    needs a persistent cross-event mailing list)."""
    __tablename__ = "contact_lists"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Contact(Base):
    """One person an org can reach outside of any specific event — unlike
    Guest, which only exists inside the event it RSVP'd to. A Contact can
    belong to multiple ContactLists and be the audience for multiple
    calendars."""
    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    first_name: Mapped[str] = mapped_column(String(120))
    last_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    email: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("org_id", "email", name="uq_contact_org_email"),)


class ContactListMember(Base):
    __tablename__ = "contact_list_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    contact_list_id: Mapped[str] = mapped_column(String(36), ForeignKey("contact_lists.id"), index=True)
    contact_id: Mapped[str] = mapped_column(String(36), ForeignKey("contacts.id"), index=True)

    __table_args__ = (UniqueConstraint("contact_list_id", "contact_id", name="uq_list_member"),)


class Calendar(Base):
    """A curated, cross-event listing page. Public calendars share one
    `share_token`-based URL with anyone; private calendars have no shared URL
    at all — only per-contact CalendarAccess links exist (see below)."""
    __tablename__ = "calendars"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_width: Mapped[int | None] = mapped_column(Integer, nullable=True)  # px
    visibility: Mapped[str] = mapped_column(String(10), default="public")   # public | private
    hide_past_events: Mapped[bool] = mapped_column(Boolean, default=True)
    # No column-level default — application code (calendars.py) always sets
    # this explicitly (a fresh UUID for public, None for private) since
    # SQLAlchemy's Python-side `default` can fire even when the caller passes
    # an explicit None, which broke "private calendars have no share_token."
    share_token: Mapped[str | None] = mapped_column(String(36), unique=True, nullable=True)
    # Incremented on every successful resolve (public or private) — no dedup
    # by visitor/session, matching Gatsby's own stated simplicity ("no
    # filtering, searching" — this is a simple summary counter, not
    # per-session analytics).
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CalendarEvent(Base):
    """Curation is manual — creating an event never auto-adds it here.
    click_count is incremented by the /go/ tracking redirect (calendars.py) —
    "how many times each event was viewed" per Gatsby's analytics summary."""
    __tablename__ = "calendar_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    calendar_id: Mapped[str] = mapped_column(String(36), ForeignKey("calendars.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("events.id"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    click_count: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (UniqueConstraint("calendar_id", "event_id", name="uq_calendar_event"),)


class CalendarContactList(Base):
    """Which ContactLists feed a private calendar's audience. A calendar can
    be tied to more than one list."""
    __tablename__ = "calendar_contact_lists"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    calendar_id: Mapped[str] = mapped_column(String(36), ForeignKey("calendars.id"), index=True)
    contact_list_id: Mapped[str] = mapped_column(String(36), ForeignKey("contact_lists.id"), index=True)

    __table_args__ = (UniqueConstraint("calendar_id", "contact_list_id", name="uq_calendar_list"),)


class CalendarAccess(Base):
    """One personalized link per (calendar, contact) — private calendars
    only. The token alone identifies both the calendar and the contact,
    mirroring Guest.invite_token's mint-once/lookup-by-token convention.
    No RSVP-status column here on purpose: a contact's status per event is
    resolved live from the existing Guest table (event_id + email match)
    rather than duplicating state that's already tracked there."""
    __tablename__ = "calendar_access"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    calendar_id: Mapped[str] = mapped_column(String(36), ForeignKey("calendars.id"), index=True)
    contact_id: Mapped[str] = mapped_column(String(36), ForeignKey("contacts.id"), index=True)
    token: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("calendar_id", "contact_id", name="uq_calendar_contact_access"),)


class MessagingCreditRate(Base):
    """Superadmin-editable credit weight per messaging channel — replaces the
    old env-var-only MESSAGE_CREDIT_WEIGHTS (required a redeploy to change)
    with a live, Console-editable setting (see entitlements.py's
    channel_weight()). org_id NULL is the global default; a row with org_id
    set overrides the global default for that one organisation only
    (negotiated per-org pricing). credits_per_unit may be any positive float:
    below 1 for a channel that should cost less than a single credit per
    send (e.g. email), at or above 1 for one that costs a full credit or
    more (e.g. MMS) — _spend_channel_credit in entitlements.py handles both
    with one algorithm, no separate "N per credit" vs "N credits per unit"
    special-casing."""
    __tablename__ = "messaging_credit_rates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("organizations.id"), nullable=True, index=True)
    channel: Mapped[str] = mapped_column(String(20))  # sms | whatsapp | mms | rcs | email
    credits_per_unit: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("org_id", "channel", name="uq_credit_rate_org_channel"),)


class ShortLink(Base):
    """Short redirect for SMS bodies: swaps a ~70-char ticket/RSVP URL (UUID
    tokens) for a ~15-char /api/s/{code} link so SMS has a fighting chance of
    staying under the 160-char GSM-7 single-segment limit alongside the fixed
    ~82-char brand prefix + compliance footer (see services/messaging.py's
    _brand_sms). Not used for email/WhatsApp, which have no such constraint."""
    __tablename__ = "short_links"

    code: Mapped[str] = mapped_column(String(12), primary_key=True)
    target_url: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
