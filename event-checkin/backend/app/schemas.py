from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from datetime import datetime, timezone
from typing import Any, Optional, Literal


# ── Auth ─────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["admin", "official"] = "official"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    email: str
    role: str
    created_at: datetime
    # Org-aware flags (populated for the current user by /auth/me).
    is_platform_superadmin: bool = False
    is_org_admin: bool = False


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ── Events ───────────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    name: str
    # Optional host/organizer/honoree label — blank for events with no such party.
    couples_name: Optional[str] = ""
    event_date: datetime
    description: Optional[str] = None
    checkin_base_url: str
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    admission_note: Optional[str] = None

    @field_validator("event_date", mode="after")
    @classmethod
    def strip_tz(cls, v):
        if v is not None and v.tzinfo is not None:
            return v.astimezone(timezone.utc).replace(tzinfo=None)
        return v


class EventUpdate(BaseModel):
    name: Optional[str] = None
    couples_name: Optional[str] = None
    event_date: Optional[datetime] = None
    description: Optional[str] = None
    checkin_base_url: Optional[str] = None
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    admission_note: Optional[str] = None
    notify_email: Optional[bool] = None
    notify_sms: Optional[bool] = None
    notify_whatsapp: Optional[bool] = None

    @field_validator("event_date", mode="after")
    @classmethod
    def strip_tz(cls, v):
        if v is not None and v.tzinfo is not None:
            return v.astimezone(timezone.utc).replace(tzinfo=None)
        return v


class EventSourceUpdate(BaseModel):
    source_url: Optional[str] = None
    source_sync_interval_seconds: Optional[int] = None
    source_sync_enabled: Optional[bool] = None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    couples_name: str
    event_date: datetime
    description: Optional[str]
    checkin_base_url: str
    status: str
    seating_enabled: bool
    menu_enabled: bool
    logistics_enabled: bool = False
    registry_enabled: bool = False
    venue_access_enabled: bool = False
    experience_enabled: bool = False
    partner_pairing_enabled: bool = False
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    admission_note: Optional[str] = None
    notify_email: bool = True
    notify_sms: bool = True
    notify_whatsapp: bool = True
    notify_mms: bool = False
    notify_rsvp_responses: bool = False
    walk_in_enabled: bool = False
    walk_in_table_group_id: Optional[str] = None
    enforce_table_groups: bool = True
    section_mode_enabled: bool = False
    manual_checkin_enabled: bool = False
    self_checkin_enabled: bool = False
    event_code: Optional[str] = None
    created_at: datetime
    source_url: Optional[str] = None
    source_sync_interval_seconds: int = 60
    source_sync_enabled: bool = True
    source_last_sync_at: Optional[datetime] = None
    source_last_error: Optional[str] = None
    source_last_warning: Optional[str] = None
    # Invite / RSVP
    rsvp_enabled: bool = False
    rsvp_token: Optional[str] = None
    invite_theme: str = "default"
    invite_message: Optional[str] = None
    rsvp_collect_phone: bool = True
    rsvp_collect_email: bool = True
    rsvp_allow_duplicate_emails: bool = False
    rsvp_capacity: Optional[int] = None
    invite_cover_image: Optional[str] = None
    invite_mode: str = "open"
    rsvp_deadline: Optional[datetime] = None
    rsvp_require_approval: bool = False
    rsvp_multi_invitee_enabled: bool = False
    rsvp_multi_invitee_limit: int = 10
    rsvp_multi_invitee_limit_rules: Optional[dict[str, int]] = None
    # Entitlements (Phase 2)
    plan_tier: str = "free"
    is_paid: bool = False
    guest_cap: Optional[int] = None
    paid_channels: bool = False
    message_credits: int = 0


class EventMemberOut(BaseModel):
    id: str
    user: UserOut
    assigned_at: datetime
    can_reassign_seats: bool
    can_manage_menu: bool = False
    can_view_dashboard: bool = False
    event_role: str = "staff"
    access_level: str = "edit"
    # Allowed sections (table group ids) for section-based scanning.
    # Empty = unrestricted ("All sections").
    section_group_ids: list[str] = []


class AssignUserRequest(BaseModel):
    user_id: str


class OrgMemberInvite(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    role: Literal["admin", "staff"] = "staff"


class OrgMemberOut(BaseModel):
    user: UserOut
    role: str


class MemberRoleUpdate(BaseModel):
    role: Literal["owner", "admin", "staff"]


# ── Superadmin console ──────────────────────────────────────────────────────

class GrantRequest(BaseModel):
    tier: Optional[str] = None          # comp this event onto a tier
    add_credits: Optional[int] = None   # add message credits


# ── Guest tags & gates (tag-based zone access) ───────────────────────────────

class GuestTagIn(BaseModel):
    name: str
    color: Optional[str] = None
    rsvp_question_id: Optional[str] = None
    rsvp_value: Optional[str] = None
    sort_order: int = 0


class GuestTagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    event_id: str
    name: str
    color: Optional[str] = None
    rsvp_question_id: Optional[str] = None
    rsvp_value: Optional[str] = None
    sort_order: int = 0
    guest_count: int = 0


class TagIdList(BaseModel):
    tag_ids: list[str] = []


class GateIn(BaseModel):
    name: str
    zone_id: str
    direction: Literal["in", "out"] = "in"


class GateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    event_id: str
    name: str
    zone_id: str
    zone_name: Optional[str] = None
    direction: str
    is_active: bool = True


class GateScanRequest(BaseModel):
    qr_token: str


class GateScanResult(BaseModel):
    status: str               # allowed | denied | invalid
    message: str
    allowed: bool = False
    guest_name: Optional[str] = None
    zone_name: Optional[str] = None
    direction: Optional[str] = None
    occupancy: Optional[int] = None
    matched_tags: list[str] = []


class TrialRequestCreate(BaseModel):
    contact_name: str
    phone: Optional[str] = None
    event_name: Optional[str] = None
    guest_count: Optional[int] = None
    use_case: Optional[str] = None


class TrialRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    org_id: str
    contact_name: str
    phone: Optional[str] = None
    event_name: Optional[str] = None
    guest_count: Optional[int] = None
    use_case: Optional[str] = None
    status: str
    created_at: datetime
    resolved_at: Optional[datetime] = None
    resolution_note: Optional[str] = None
    # Populated for the operator console:
    org_name: Optional[str] = None
    requester_email: Optional[str] = None


class TrialResolve(BaseModel):
    action: Literal["approve", "decline"]
    event_id: Optional[str] = None      # which event to comp (approve only)
    tier: Optional[str] = None          # tier to comp onto
    add_credits: Optional[int] = None   # message credits to add
    note: Optional[str] = None


class OperatorInvite(BaseModel):
    email: EmailStr


class AccountMemberOut(BaseModel):
    user_id: str
    name: str
    email: str
    role: str
    is_active: bool
    is_platform_superadmin: bool


class AccountOrgOut(BaseModel):
    id: str
    name: str
    slug: str
    is_active: bool
    created_at: datetime
    event_count: int
    members: list[AccountMemberOut] = []


class ActiveToggle(BaseModel):
    active: bool


# ── Experience workflow engine ───────────────────────────────────────────────

ExperienceStepType = Literal[
    "rsvp",
    "approval",
    "check_in",
    "consent",
    "souvenir",
    "badge",
    "room_assignment",
    "seating_assignment",
    "meal_selection",
    "session_attendance",
    "certificate",
    "checkout",
    "custom",
]


class ExperienceStepCreate(BaseModel):
    key: str
    type: ExperienceStepType
    title: str
    description: Optional[str] = None
    sort_order: int = 0
    required: bool = True
    enabled: bool = True
    conditions: Optional[dict] = None
    config: Optional[dict] = None

    @field_validator("key", "title", mode="after")
    @classmethod
    def clean_required_text(cls, v):
        cleaned = " ".join((v or "").split())
        if not cleaned:
            raise ValueError("value is required")
        return cleaned

    @field_validator("conditions", "config", mode="after")
    @classmethod
    def validate_json_shape(cls, v):
        _validate_experience_json(v)
        return v


class ExperienceStepUpdate(BaseModel):
    key: Optional[str] = None
    type: Optional[ExperienceStepType] = None
    title: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    required: Optional[bool] = None
    enabled: Optional[bool] = None
    conditions: Optional[dict] = None
    config: Optional[dict] = None

    @field_validator("key", "title", mode="after")
    @classmethod
    def clean_optional_text(cls, v):
        if v is None:
            return v
        cleaned = " ".join(v.split())
        if not cleaned:
            raise ValueError("value cannot be blank")
        return cleaned

    @field_validator("conditions", "config", mode="after")
    @classmethod
    def validate_json_shape(cls, v):
        _validate_experience_json(v)
        return v


class ExperienceStepReorder(BaseModel):
    step_ids: list[str] = Field(default_factory=list)


class ExperienceWorkflowClone(BaseModel):
    name: Optional[str] = None


class ExperienceWorkflowCreate(BaseModel):
    name: str = "Default Experience"
    steps: list[ExperienceStepCreate] = Field(default_factory=list)

    @field_validator("name", mode="after")
    @classmethod
    def clean_name(cls, v):
        cleaned = " ".join((v or "").split())
        if not cleaned:
            raise ValueError("Workflow name is required")
        return cleaned


class ExperienceProgressUpdate(BaseModel):
    status: Literal["available", "blocked", "completed", "skipped", "failed", "overridden"]
    override_reason: Optional[str] = None
    metadata: Optional[dict] = None


class ExperienceStepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workflow_id: str
    key: str
    type: str
    title: str
    description: Optional[str] = None
    sort_order: int
    required: bool
    enabled: bool
    conditions: Optional[dict] = None
    config: Optional[dict] = None
    created_at: datetime
    updated_at: datetime


class ExperienceWorkflowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    name: str
    status: str
    version: int
    is_default: bool
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    steps: list[ExperienceStepOut] = []


class GuestExperienceProgressOut(BaseModel):
    id: str
    event_id: str
    workflow_id: str
    step_id: str
    guest_id: str
    status: str
    completed_at: Optional[datetime] = None
    completed_by_user_id: Optional[str] = None
    completed_by_source: Optional[str] = None
    override_reason: Optional[str] = None
    metadata: Optional[dict] = None
    created_at: datetime
    updated_at: datetime


class GuestExperienceOut(BaseModel):
    guest_id: str
    workflow: ExperienceWorkflowOut
    progress: list[GuestExperienceProgressOut]


class ExperienceStepDashboardOut(BaseModel):
    step_id: str
    key: str
    type: str
    title: str
    sort_order: int
    required: bool
    enabled: bool
    not_started: int = 0
    available: int = 0
    blocked: int = 0
    completed: int = 0
    skipped: int = 0
    failed: int = 0
    overridden: int = 0
    total: int = 0
    completion_rate: float = 0


class ExperienceDashboardOut(BaseModel):
    event_id: str
    workflow: Optional[ExperienceWorkflowOut] = None
    guest_total: int = 0
    step_count: int = 0
    completed_total: int = 0
    progress_total: int = 0
    completion_rate: float = 0
    steps: list[ExperienceStepDashboardOut] = Field(default_factory=list)


class ExperienceEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    workflow_id: str
    step_id: Optional[str] = None
    guest_id: Optional[str] = None
    actor_user_id: Optional[str] = None
    event_type: str
    source: str
    payload: Optional[dict] = None
    occurred_at: datetime


class ExperienceNextStepOut(BaseModel):
    step: ExperienceStepOut
    progress: Optional[GuestExperienceProgressOut] = None


class ConsentFormUpsert(BaseModel):
    title: str = "Event consent"
    body: str
    require_signature: bool = True

    @field_validator("title", "body", mode="after")
    @classmethod
    def clean_consent_text(cls, v):
        cleaned = (v or "").strip()
        if not cleaned:
            raise ValueError("value is required")
        return cleaned


class ConsentFormOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    title: str
    body: str
    version: int
    is_active: bool
    require_signature: bool
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ConsentSignatureCreate(BaseModel):
    signer_name: str
    signature_text: str

    @field_validator("signer_name", "signature_text", mode="after")
    @classmethod
    def clean_signature_text(cls, v):
        cleaned = " ".join((v or "").split())
        if not cleaned:
            raise ValueError("value is required")
        return cleaned


class ConsentSignatureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    form_id: str
    guest_id: str
    signer_name: str
    signature_text: str
    signed_at: datetime
    sent_copy_at: Optional[datetime] = None
    created_at: datetime


# ── Guest-facing Experience (Guest Hub journey view) ─────────────────────────
# These are the guest-safe projections used by the token-authenticated
# /experience/me surface. Unlike the staff schemas above they deliberately omit
# internal step config/conditions and only expose what a guest may see or act on.

class GuestJourneyGuestOut(BaseModel):
    id: str
    name: str
    rsvp_status: Optional[str] = None


class GuestJourneyWorkflowOut(BaseModel):
    id: str
    name: str
    version: int


class GuestJourneyStepOut(BaseModel):
    id: str
    key: str
    type: str
    title: str
    description: Optional[str] = None
    required: bool
    status: str  # available | blocked | completed | skipped | not_started | ...
    completed_at: Optional[datetime] = None
    self_service: bool = False  # a guest can complete this step from the Hub
    actionable: bool = False     # self_service AND still pending
    guest_message: Optional[str] = None
    completion_message: Optional[str] = None
    session: Optional[dict[str, Any]] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class GuestConsentStateOut(BaseModel):
    required: bool = False
    signed: bool = False
    signed_at: Optional[datetime] = None
    form: Optional[ConsentFormOut] = None


class GuestJourneyOut(BaseModel):
    experience_enabled: bool = False
    guest: Optional[GuestJourneyGuestOut] = None
    workflow: Optional[GuestJourneyWorkflowOut] = None
    steps: list[GuestJourneyStepOut] = Field(default_factory=list)
    next_steps: list[GuestJourneyStepOut] = Field(default_factory=list)
    consent: Optional[GuestConsentStateOut] = None
    completed_count: int = 0
    total_count: int = 0


class PublicConsentOut(BaseModel):
    status: Literal["none", "available", "signed", "invalid", "not_admitted"]
    form: Optional[ConsentFormOut] = None
    signature: Optional[ConsentSignatureOut] = None


class SendConsentCopyOut(BaseModel):
    ok: bool
    sent_to: str


def _validate_experience_json(value, depth: int = 0):
    if value is None:
        return
    if depth > 5:
        raise ValueError("JSON is too deeply nested")
    if isinstance(value, dict):
        if len(value) > 50:
            raise ValueError("JSON object has too many keys")
        for key, child in value.items():
            if not isinstance(key, str) or not key:
                raise ValueError("JSON object keys must be non-empty strings")
            _validate_experience_json(child, depth + 1)
        return
    if isinstance(value, list):
        if len(value) > 100:
            raise ValueError("JSON list is too long")
        for child in value:
            _validate_experience_json(child, depth + 1)
        return
    if isinstance(value, (str, int, float, bool)):
        return
    raise ValueError("JSON contains an unsupported value")


class MemberRole(BaseModel):
    role: Literal["owner", "admin", "staff"]


class PlanUpsert(BaseModel):
    kind: Literal["tier", "pack"]
    label: str
    guest_cap: Optional[int] = None
    credits: int = 0
    usd: int = 0
    ngn: int = 0
    active: bool = True
    sort_order: int = 0


# ── Seating ───────────────────────────────────────────────────────────────────

class SeatingTableCreate(BaseModel):
    name: str
    capacity: int
    category: Optional[str] = None
    sort_order: Optional[int] = None


class SeatingTableOut(BaseModel):
    id: str
    event_id: str
    name: str
    capacity: int
    category: Optional[str] = None
    sort_order: int = 0
    assigned_count: int = 0
    # Floor-plan layout
    pos_x: Optional[int] = None
    pos_y: Optional[int] = None
    shape: str = "round"
    rotation: int = 0


# ── Floor plan (venue layout designer) ───────────────────────────────────────

class FloorElementIn(BaseModel):
    id: Optional[str] = None  # present when updating an existing element
    type: str
    label: Optional[str] = None
    pos_x: int = 0
    pos_y: int = 0
    width: int = 120
    height: int = 60
    rotation: int = 0
    color: Optional[str] = None


class FloorElementOut(FloorElementIn):
    model_config = ConfigDict(from_attributes=True)
    id: str
    event_id: str


class FloorTablePos(BaseModel):
    """A single table's placement in a bulk layout save."""
    id: str
    pos_x: Optional[int] = None
    pos_y: Optional[int] = None
    shape: Optional[str] = None
    rotation: Optional[int] = None


class FloorTableOut(BaseModel):
    """A table as drawn on the plan (name + seats + placement + live occupancy)."""
    id: str
    name: str
    capacity: int
    category: Optional[str] = None
    table_group_id: Optional[str] = None
    table_group_name: Optional[str] = None
    seated: int = 0
    pos_x: Optional[int] = None
    pos_y: Optional[int] = None
    shape: str = "round"
    rotation: int = 0


class FloorPlanOut(BaseModel):
    event_id: str
    event_name: str
    width: int = 1200
    height: int = 800
    bg_image_url: Optional[str] = None
    bg_opacity: int = 40
    editable: bool = False          # did the caller arrive with edit rights?
    share_token: Optional[str] = None   # only exposed to admins
    edit_token: Optional[str] = None    # only exposed to admins
    tables: list[FloorTableOut] = Field(default_factory=list)
    elements: list[FloorElementOut] = Field(default_factory=list)


class FloorPlanSave(BaseModel):
    """Bulk save from the editor: canvas + all table placements + all elements."""
    width: Optional[int] = None
    height: Optional[int] = None
    bg_image_url: Optional[str] = None
    bg_opacity: Optional[int] = None
    tables: list[FloorTablePos] = Field(default_factory=list)
    elements: list[FloorElementIn] = Field(default_factory=list)


class SeatAssignRequest(BaseModel):
    table_id: Optional[str] = None
    seat_number: Optional[str] = None


class TableGroupCreate(BaseModel):
    name: str
    tag: Optional[str] = None          # defaults to name when omitted
    description: Optional[str] = None
    sort_order: Optional[int] = None
    table_ids: Optional[list[str]] = None  # optional member tables at create time
    table_orders: Optional[dict[str, int]] = None  # {table_id: sort_order} saved on group edit


class TableGroupOut(BaseModel):
    id: str
    event_id: str
    name: str
    tag: str
    description: Optional[str] = None
    sort_order: int = 0
    table_ids: list[str] = []
    assigned_guest_count: int = 0
    total_seats: int = 0
    remaining_seats: int = 0
    over_capacity: bool = False


class TableGroupTablesUpdate(BaseModel):
    table_ids: list[str] = []


class BulkAssignGroupRequest(BaseModel):
    guest_ids: list[str]
    table_group_id: Optional[str] = None  # None clears the assignment


class WalkInRegister(BaseModel):
    first_name: str
    last_name: Optional[str] = ""
    phone: Optional[str] = None
    # Section-based scanning: the scanner device's active section (table group).
    # Used in place of the event's walk_in_table_group_id when section mode is on.
    table_group_id: Optional[str] = None


class WalkInGroupUpdate(BaseModel):
    table_group_id: Optional[str] = None


# ── Message templates ──────────────────────────────────────────────────────────

class MessageTemplateSave(BaseModel):
    subject: Optional[str] = None
    email_body: Optional[str] = None
    sms_body: Optional[str] = None
    whatsapp_body: Optional[str] = None
    mms_body: Optional[str] = None


class TemplatePreviewRequest(MessageTemplateSave):
    """Draft fields to render with sample data (renders unsaved edits)."""
    pass


class TemplateTestSendRequest(MessageTemplateSave):
    channel: str                 # "email" | "sms" | "whatsapp"
    to: str                      # email address or phone number


# ── Public self check-in (event code) ───────────────────────────────────────────

class SelfCheckinSearch(BaseModel):
    query: str


class SelfCheckinGuest(BaseModel):
    id: str
    name: str            # full name only — no phone/email exposed publicly


class SelfCheckinResult(BaseModel):
    status: str          # ok | not_active | invalid | admitted | already_admitted | denied | no_seat_available
    message: Optional[str] = None
    name: Optional[str] = None            # event name (info call)
    guests: list[SelfCheckinGuest] = []   # search results
    admitted_guest: Optional[str] = None  # full name on a successful check-in
    table_name: Optional[str] = None
    seat_number: Optional[str] = None
    admitted_at: Optional[datetime] = None


# ── Superadmin: reset event data ────────────────────────────────────────────────

class EventResetRequest(BaseModel):
    """What a superadmin reset should clear. Each flag is independent; the event
    record and its settings/templates are always kept."""
    guests: bool = False                 # delete all guests (+ their menu/rsvp/tags/shipments/scans)
    checkins: bool = False               # clear admitted/served flags + delete scan log
    seat_assignments: bool = False       # clear table/seat/held-seat on guests
    group_assignments: bool = False      # clear guests' assigned table group
    table_groups: bool = False           # delete table groups + memberships
    tables: bool = False                 # delete seating tables


# ── Logistics / Fulfillment ───────────────────────────────────────────────────

class ShipmentCreate(BaseModel):
    name: str
    phase: Literal["pre", "post"] = "pre"
    collect_size: bool = True
    auto_add: Optional[bool] = None  # None → default by phase (pre=True, post=False)
    size_options: Optional[list[str]] = None
    notes: Optional[str] = None
    vendor_name: Optional[str] = None
    vendor_email: Optional[EmailStr] = None
    vendor_phone: Optional[str] = None


class ShipmentUpdate(BaseModel):
    name: Optional[str] = None
    phase: Optional[Literal["pre", "post"]] = None
    collect_size: Optional[bool] = None
    auto_add: Optional[bool] = None
    size_options: Optional[list[str]] = None
    notes: Optional[str] = None
    vendor_name: Optional[str] = None
    vendor_email: Optional[EmailStr] = None
    vendor_phone: Optional[str] = None


class ShipmentOut(BaseModel):
    id: str
    event_id: str
    name: str
    phase: str
    collect_size: bool
    auto_add: bool = True
    size_options: Optional[list[str]] = None
    notes: Optional[str] = None
    vendor_name: Optional[str] = None
    vendor_email: Optional[str] = None
    vendor_phone: Optional[str] = None
    share_token: str
    sent_at: Optional[datetime] = None
    viewed_at: Optional[datetime] = None
    line_count: int = 0
    created_at: Optional[datetime] = None


class ShippingAddressUpdate(BaseModel):
    ship_address1: Optional[str] = None
    ship_address2: Optional[str] = None
    ship_city: Optional[str] = None
    ship_state: Optional[str] = None
    ship_postal: Optional[str] = None
    ship_country: Optional[str] = None


class GuestShipmentOut(BaseModel):
    guest_id: str
    first_name: str
    last_name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    ship_address1: Optional[str] = None
    ship_address2: Optional[str] = None
    ship_city: Optional[str] = None
    ship_state: Optional[str] = None
    ship_postal: Optional[str] = None
    ship_country: Optional[str] = None
    has_address: bool = False
    item: Optional[str] = None
    size: Optional[str] = None
    quantity: int = 1
    ship_status: str = "pending"
    tracking_number: Optional[str] = None


class GuestShipmentUpdate(BaseModel):
    item: Optional[str] = None
    size: Optional[str] = None
    quantity: Optional[int] = None
    ship_status: Optional[Literal["pending", "shipped", "delivered"]] = None
    tracking_number: Optional[str] = None


class VendorPageOut(BaseModel):
    shipment_name: str
    phase: str
    event_name: str
    notes: Optional[str] = None
    vendor_name: Optional[str] = None
    collect_size: bool = True
    lines: list[GuestShipmentOut] = []


# What the public invite page needs to collect for logistics, if anything.
class InviteShipmentNeed(BaseModel):
    shipment_id: str
    name: str
    collect_size: bool = True
    size_options: Optional[list[str]] = None


class InviteShippingOut(BaseModel):
    collect_address: bool = False
    shipments: list[InviteShipmentNeed] = []


# ── Gift Registry ─────────────────────────────────────────────────────────────

class RegistryItemCreate(BaseModel):
    kind: Literal["item", "fund", "link"] = "item"
    title: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    external_url: Optional[str] = None
    amount_minor: Optional[int] = None
    currency: Optional[str] = None  # defaults to org currency
    quantity_wanted: int = 1
    payment_instructions: Optional[str] = None
    sort_order: int = 0


class RegistryItemUpdate(BaseModel):
    kind: Optional[Literal["item", "fund", "link"]] = None
    title: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    external_url: Optional[str] = None
    amount_minor: Optional[int] = None
    currency: Optional[str] = None
    quantity_wanted: Optional[int] = None
    payment_instructions: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class RegistryItemOut(BaseModel):
    id: str
    event_id: str
    kind: str
    title: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    external_url: Optional[str] = None
    amount_minor: Optional[int] = None
    currency: str
    quantity_wanted: int
    payment_instructions: Optional[str] = None
    sort_order: int
    is_active: bool
    # Outbound buy link with any affiliate tag applied (falls back to external_url).
    buy_url: Optional[str] = None
    # Computed progress
    reserved_qty: int = 0     # items: total reserved
    remaining: Optional[int] = None  # items: quantity_wanted - reserved_qty
    raised_minor: int = 0     # funds: total pledged (minor units)
    claim_count: int = 0


class RegistryUnfurlRequest(BaseModel):
    url: str


class RegistryUnfurlOut(BaseModel):
    title: Optional[str] = None
    image_url: Optional[str] = None
    amount_minor: Optional[int] = None
    currency: Optional[str] = None
    site_name: Optional[str] = None


class AffiliateStoreIn(BaseModel):
    domain: str
    label: str
    param_key: str
    param_value: str
    active: bool = True
    sort_order: int = 0


class AffiliateStoreOut(BaseModel):
    id: str
    domain: str
    label: str
    param_key: str
    param_value: str
    active: bool
    sort_order: int


class RegistrySettingsUpdate(BaseModel):
    registry_message: Optional[str] = None


class RegistrySettingsOut(BaseModel):
    registry_message: Optional[str] = None
    registry_token: Optional[str] = None


class RegistryClaimCreate(BaseModel):
    claimer_name: str
    claimer_email: Optional[EmailStr] = None
    quantity: int = 1
    amount_minor: Optional[int] = None
    message: Optional[str] = None


class RegistryClaimOut(BaseModel):
    id: str
    item_id: str
    item_title: str
    claimer_name: str
    claimer_email: Optional[str] = None
    quantity: int
    amount_minor: Optional[int] = None
    message: Optional[str] = None
    created_at: Optional[datetime] = None


class RegistryPageOut(BaseModel):
    event_name: str
    couples_name: Optional[str] = None
    registry_message: Optional[str] = None
    items: list[RegistryItemOut] = []


# ── Venue Access Intelligence ─────────────────────────────────────────────────

class ZoneCreate(BaseModel):
    name: str
    description: Optional[str] = None
    capacity: Optional[int] = None
    direction_mode: Literal["both", "entry", "exit"] = "both"
    sort_order: int = 0


class ZoneUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    capacity: Optional[int] = None
    direction_mode: Optional[Literal["both", "entry", "exit"]] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class ZoneOut(BaseModel):
    id: str
    event_id: str
    name: str
    description: Optional[str] = None
    capacity: Optional[int] = None
    direction_mode: str
    sort_order: int
    is_active: bool
    occupancy: int = 0  # computed live count currently inside


class TicketTypeCreate(BaseModel):
    name: str
    color: Optional[str] = None
    description: Optional[str] = None
    capacity: Optional[int] = None
    allowed_zone_ids: Optional[list[str]] = None  # null/empty = all zones
    sort_order: int = 0


class TicketTypeUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    capacity: Optional[int] = None
    allowed_zone_ids: Optional[list[str]] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class TicketTypeOut(BaseModel):
    id: str
    event_id: str
    name: str
    color: Optional[str] = None
    description: Optional[str] = None
    capacity: Optional[int] = None
    allowed_zone_ids: Optional[list[str]] = None
    sort_order: int
    is_active: bool
    assigned_count: int = 0


class GuestTicketAssign(BaseModel):
    ticket_type_id: Optional[str] = None  # null = clear


class ScanZoneRequest(BaseModel):
    zone_id: str
    direction: Optional[Literal["in", "out"]] = None  # default from zone mode


class ScanZoneResult(BaseModel):
    status: str               # "ok" | "denied"
    denied: bool = False
    deny_reason: Optional[str] = None
    guest_name: str
    ticket_type: Optional[str] = None
    zone_name: str
    direction: str
    occupancy: int = 0
    journey_count: int = 0
    seat_number: Optional[str] = None
    table_name: Optional[str] = None


class PeakBucket(BaseModel):
    t: str        # ISO bucket start
    ins: int = 0
    outs: int = 0


class FlowEdge(BaseModel):
    from_zone: Optional[str] = None
    to_zone: str
    count: int


class JourneyStep(BaseModel):
    zone_name: Optional[str] = None
    direction: str
    scanned_at: datetime
    denied: bool = False
    deny_reason: Optional[str] = None


# ── Menu ─────────────────────────────────────────────────────────────────────

class MenuItemCreate(BaseModel):
    name: str
    description: Optional[str] = None


class MenuItemOut(BaseModel):
    id: str
    category_id: str
    name: str
    description: Optional[str]


class MenuCategoryCreate(BaseModel):
    name: str
    sort_order: int = 0
    selection_type: str = "single"  # single|multi|combo
    min_selections: int = 0
    max_selections: Optional[int] = None
    is_required: bool = False


class MenuCombinationItemOut(BaseModel):
    menu_item_id: str
    name: str
    quantity: int


class MenuCombinationOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    sort_order: int = 0
    items: list[MenuCombinationItemOut] = []


class MenuCombinationItemIn(BaseModel):
    menu_item_id: str
    quantity: int = 1


class MenuCombinationCreate(BaseModel):
    name: str
    description: Optional[str] = None
    sort_order: int = 0
    items: list[MenuCombinationItemIn] = []


class MenuCategoryOut(BaseModel):
    id: str
    event_id: str
    name: str
    sort_order: int
    selection_type: str = "single"
    min_selections: int = 0
    max_selections: Optional[int] = None
    is_required: bool = False
    items: list[MenuItemOut] = []
    combinations: list[MenuCombinationOut] = []


class GuestMenuChoiceOut(BaseModel):
    category_id: str
    menu_item_id: str


class GuestMenuSubmit(BaseModel):
    single: dict[str, str] = {}  # category_id → menu_item_id
    multi: dict[str, list[str]] = {}  # category_id → [menu_item_id, ...]
    combo: dict[str, str] = {}  # category_id → combination_id


# ── Guests ───────────────────────────────────────────────────────────────────

class GuestCreate(BaseModel):
    first_name: str
    last_name: str
    email: Optional[str] = ""   # empty allowed for VVIP walk-ins with no contact email
    phone: Optional[str] = None
    is_vip: bool = False
    assigned_table_group_id: Optional[str] = None
    is_walk_in: bool = False   # added at the door, not on the original list


class GuestUpdate(BaseModel):
    """Partial edit of a guest from the admin guest-edit modal (ported from prod)."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    is_vip: Optional[bool] = None
    sms_consent: Optional[bool] = None
    whatsapp_consent: Optional[bool] = None
    # Manual seating from the edit modal. Send "" to clear a table/seat; a non-empty
    # seat on an occupied (table, seat) pair returns 409.
    table_id: Optional[str] = None
    seat_number: Optional[str] = None


class GuestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str]
    qr_token: str
    qr_generated_at: Optional[datetime]
    invite_sent_at: Optional[datetime]
    invite_status: Optional[str] = None
    email_delivery_status: Optional[str] = None
    email_delivery_event_type: Optional[str] = None
    email_delivery_kind: Optional[str] = None
    email_delivery_at: Optional[datetime] = None
    invite_token: Optional[str] = None
    rsvp_status: str = "invited"
    rsvp_responded_at: Optional[datetime] = None
    admitted: bool
    admitted_at: Optional[datetime]
    admit_notified: bool
    table_id: Optional[str] = None
    seat_number: Optional[str] = None
    assigned_table_group_id: Optional[str] = None
    table_group_name: Optional[str] = None
    meal_served: bool = False
    is_vip: bool = False
    is_walk_in: bool = False
    ticket_type_id: Optional[str] = None
    sms_consent: bool = True
    whatsapp_consent: bool = True
    rsvp_submitter_guest_id: Optional[str] = None
    rsvp_submitter_name: Optional[str] = None
    rsvp_submitter_email: Optional[str] = None
    rsvp_submitter_phone: Optional[str] = None
    rsvp_relationship: Optional[str] = None
    rsvp_guest_type: Optional[str] = None
    rsvp_notes: Optional[str] = None


# ── Scanner ──────────────────────────────────────────────────────────────────

class ScanResult(BaseModel):
    status: str  # admitted | already_admitted | invalid | not_active | not_assigned
    message: str
    guest: Optional[GuestOut] = None
    table_name: Optional[str] = None
    seat_number: Optional[str] = None
    experience_next_steps: list[ExperienceNextStepOut] = Field(default_factory=list)


class EventBrief(BaseModel):
    name: str
    couples_name: str
    event_date: datetime
    status: str
    seating_enabled: bool = False
    partner_pairing_enabled: bool = False
    experience_enabled: bool = False
    menu_enabled: bool = False
    notify_sms: bool = True
    notify_whatsapp: bool = True
    # Gift registry — surfaced on the ticket so guests can reach it from their pass.
    registry_enabled: bool = False
    registry_token: Optional[str] = None
    registry_message: Optional[str] = None


class PartnerInfo(BaseModel):
    first_name: str
    last_name: str
    email: str
    admitted: bool = False


class TicketView(BaseModel):
    status: str  # valid | admitted | invalid
    guest: Optional[GuestOut] = None
    event: Optional[EventBrief] = None
    table_name: Optional[str] = None
    seat_number: Optional[str] = None
    menu_locked: bool = False
    menu_categories: list[MenuCategoryOut] = []
    # Shape: {"single": {category_id: item_id}, "multi": {category_id: [item_ids]}, "combo": {category_id: combo_id}}
    guest_choices: dict[str, dict] = {}
    partner: Optional[PartnerInfo] = None


class PairRequest(BaseModel):
    partner_first_name: str
    partner_last_name: str
    partner_email: str


# ── Dashboard ─────────────────────────────────────────────────────────────────

class ZoneOccupancy(BaseModel):
    name: str
    inside: int
    capacity: Optional[int] = None


class TableReport(BaseModel):
    name: str
    capacity: Optional[int] = None
    seated: int = 0
    checked_in: int = 0
    served: int = 0


class DashboardBreakdown(BaseModel):
    name: str
    total: int = 0
    admitted: int = 0
    pending: int = 0
    capacity: Optional[int] = None


class DashboardTimelinePoint(BaseModel):
    label: str
    count: int


class DashboardInviteDelivery(BaseModel):
    sent: int = 0
    failed: int = 0
    unsent: int = 0


class DashboardEmailDelivery(BaseModel):
    sent: int = 0
    delivered: int = 0
    opened: int = 0
    clicked: int = 0
    delayed: int = 0
    bounced: int = 0
    failed: int = 0
    complained: int = 0
    suppressed: int = 0
    unknown: int = 0
    tracked: int = 0


class DashboardContactStats(BaseModel):
    email_available: int = 0
    phone_available: int = 0
    both_available: int = 0
    no_contact: int = 0
    invite_sent: int = 0
    invite_failed: int = 0
    responses_received: int = 0


class MenuEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    couples_name: Optional[str] = None
    menu_enabled: bool = True


class DashboardStats(BaseModel):
    total: int
    admitted: int
    pending: int
    walk_in: int = 0   # guests added at the door (kiosk or manual walk-in)
    admitted_guests: list[GuestOut]
    # RSVP breakdown (always present)
    rsvp_confirmed: int = 0
    rsvp_declined: int = 0
    rsvp_pending: int = 0
    rsvp_invited: int = 0
    vip_total: int = 0
    vip_admitted: int = 0
    invite_delivery: DashboardInviteDelivery = DashboardInviteDelivery()
    email_delivery: DashboardEmailDelivery = DashboardEmailDelivery()
    contact_stats: DashboardContactStats = DashboardContactStats()
    arrival_timeline: list[DashboardTimelinePoint] = []
    pending_guests: list[GuestOut] = []
    ticket_types: list[DashboardBreakdown] = []
    table_groups: list[DashboardBreakdown] = []
    # Adaptive sections — only populated when the feature is enabled
    zones: list[ZoneOccupancy] = []
    catering_served: Optional[int] = None
    catering_total: Optional[int] = None
    tables: list[TableReport] = []


# ── Menu dashboard ────────────────────────────────────────────────────────────

class MenuItemTotal(BaseModel):
    item_id: str
    name: str
    category_name: str
    count: int


class MenuCombinationTotal(BaseModel):
    combination_id: str
    name: str
    count: int


class MenuDashboardGuest(BaseModel):
    guest_id: str
    name: str
    email: Optional[str] = None
    table_name: Optional[str] = None
    seat_number: Optional[str] = None
    admitted: bool
    meal_served: bool
    is_vip: bool = False
    single: dict[str, dict] = {}  # category_id → {item_name, category_name}
    multi: dict[str, dict] = {}  # category_id → {category_name, items: [item_name]}
    combo: dict[str, dict] = {}  # category_id → {category_name, combination_name, items: [item_name]}


class MenuDashboardOut(BaseModel):
    item_totals: list[MenuItemTotal]
    combination_totals: list[MenuCombinationTotal]
    guests: list[MenuDashboardGuest]


# ── Invite page & RSVP ───────────────────────────────────────────────────────

class RSVPQuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    question: str
    question_type: str   # "text" | "select" | "boolean"
    options: Optional[str] = None  # JSON string e.g. '["Option A","Option B"]'
    is_required: bool
    sort_order: int


class RSVPQuestionCreate(BaseModel):
    question: str
    question_type: Literal["text", "select", "boolean"] = "text"
    options: Optional[str] = None
    is_required: bool = False
    sort_order: int = 0


class RSVPQuestionUpdate(BaseModel):
    question: Optional[str] = None
    question_type: Optional[Literal["text", "select", "boolean"]] = None
    options: Optional[str] = None
    is_required: Optional[bool] = None
    sort_order: Optional[int] = None


class InviteSettingsUpdate(BaseModel):
    rsvp_enabled: Optional[bool] = None
    invite_theme: Optional[Literal["default", "gold", "rose", "midnight", "forest"]] = None
    invite_message: Optional[str] = None
    rsvp_collect_phone: Optional[bool] = None
    rsvp_collect_email: Optional[bool] = None
    rsvp_allow_duplicate_emails: Optional[bool] = None
    rsvp_capacity: Optional[int] = None
    invite_cover_image: Optional[str] = None
    invite_mode: Optional[Literal["open", "closed"]] = None
    rsvp_deadline: Optional[datetime] = None
    rsvp_require_approval: Optional[bool] = None
    rsvp_multi_invitee_enabled: Optional[bool] = None
    rsvp_multi_invitee_limit: Optional[int] = None
    rsvp_multi_invitee_limit_rules: Optional[dict[str, int]] = None


class InvitePageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    couples_name: str
    event_date: datetime
    description: Optional[str]
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    admission_note: Optional[str] = None
    invite_theme: str
    invite_message: Optional[str]
    rsvp_token: Optional[str] = None
    rsvp_enabled: bool
    experience_enabled: bool = False
    rsvp_collect_phone: bool
    rsvp_collect_email: bool
    rsvp_allow_duplicate_emails: bool = False
    rsvp_capacity: Optional[int]
    invite_cover_image: Optional[str] = None
    invite_mode: str = "open"
    rsvp_deadline: Optional[datetime] = None
    rsvp_multi_invitee_enabled: bool = False
    rsvp_multi_invitee_limit: int = 10
    rsvp_multi_invitee_limit_rules: Optional[dict[str, int]] = None
    # rsvp_count populated by the endpoint
    rsvp_count: int = 0
    # deadline_passed computed by the endpoint
    deadline_passed: bool = False
    questions: list[RSVPQuestionOut] = []
    # Logistics: address/size collection needed for this event, if any.
    shipping: Optional[InviteShippingOut] = None
    registry_enabled: bool = False
    registry_token: Optional[str] = None


class RSVPInviteeSubmit(BaseModel):
    full_name: str = ""
    first_name: str = ""
    last_name: str = ""
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    relationship: Optional[str] = None
    guest_type: Optional[str] = None
    notes: Optional[str] = None


class RSVPSubmit(BaseModel):
    first_name: str
    last_name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    sms_consent: bool = False
    # key = question_id, value = answer string
    answers: dict[str, str] = {}
    invitees: list[RSVPInviteeSubmit] = []
    # Logistics add-on (optional): shipping address + per-shipment size choices.
    shipping_address: Optional[ShippingAddressUpdate] = None
    sizes: dict[str, str] = {}  # shipment_id -> size


class RSVPConfirm(BaseModel):
    id: str
    qr_token: str
    # Personal token that powers the guest's cross-device Guest Hub link
    # (/r/{invite_token}). Generated for self-registrations so the Hub is
    # reachable from any browser, not just the one that RSVP'd.
    invite_token: str | None = None
    first_name: str
    last_name: str
    rsvp_status: str = "confirmed"
    message: str = "RSVP confirmed!"


# ── Personalised (token) invite — closed mode ────────────────────────────────

class InviteGuestPrefill(BaseModel):
    """The invited guest's known details, used to pre-fill the RSVP form.
    `email_locked` / `phone_locked` flag which identifiers came from the
    planner's list and must not be edited (they're the identity key)."""
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    sms_consent: bool = False
    rsvp_status: str = "invited"
    email_locked: bool = False
    phone_locked: bool = False


class InviteTokenPageOut(BaseModel):
    """Payload for a personalised /r/{invite_token} link: the event page plus
    the specific guest's prefill + response state."""
    event: InvitePageOut
    guest: InviteGuestPrefill
    deadline_passed: bool = False
    already_responded: bool = False


class RSVPTokenSubmit(BaseModel):
    status: Literal["confirmed", "declined"] = "confirmed"
    # Editable fields; email is never editable on a token link (identity key).
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    sms_consent: bool = False
    answers: dict[str, str] = {}
    shipping_address: Optional[ShippingAddressUpdate] = None
    sizes: dict[str, str] = {}  # shipment_id -> size


# ── Broadcast ────────────────────────────────────────────────────────────────

class BroadcastRequest(BaseModel):
    message: str
    # which guests to target:
    #   all          — everyone on the guest list
    #   admitted     — checked in (admitted == True)
    #   not_admitted — not yet checked in
    #   confirmed    — RSVP'd attending
    #   declined     — RSVP'd no
    #   no_reply     — invited but no RSVP response yet
    target: Literal[
        "all", "admitted", "not_admitted", "confirmed", "declined", "no_reply"
    ] = "all"
    channels: list[Literal["email", "sms", "whatsapp"]] = ["sms"]


class CheckoutRequest(BaseModel):
    event_id: str
    tier: str


class CurrencyRequest(BaseModel):
    event_id: str
    currency: Literal["USD", "NGN"]


class CheckoutOut(BaseModel):
    url: str
    provider: str


class BroadcastResult(BaseModel):
    queued: int
    # couldn't reach: no email (for email) and no phone (for sms/whatsapp)
    skipped_no_contact: int
    skipped_no_consent: int
    skipped_no_credits: int = 0


# ── Manual invite ─────────────────────────────────────────────────────────────

class ManualInviteRecipient(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None


class ManualInviteRequest(BaseModel):
    recipients: list[ManualInviteRecipient]
    channels: list[Literal["email", "sms", "whatsapp"]] = ["email"]


class ManualInviteResult(BaseModel):
    sent: int
    skipped: int
    errors: list[str] = []
