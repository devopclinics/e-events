from pydantic import BaseModel, ConfigDict, EmailStr, field_validator
from datetime import datetime, timezone
from typing import Optional, Literal


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
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    notify_email: bool = True
    notify_sms: bool = True
    notify_whatsapp: bool = True
    created_at: datetime
    source_url: Optional[str] = None
    source_sync_interval_seconds: int = 60
    source_last_sync_at: Optional[datetime] = None
    source_last_error: Optional[str] = None
    source_last_warning: Optional[str] = None
    # Invite / RSVP
    rsvp_enabled: bool = False
    invite_theme: str = "default"
    invite_message: Optional[str] = None
    rsvp_collect_phone: bool = True
    rsvp_collect_email: bool = True
    rsvp_capacity: Optional[int] = None
    invite_cover_image: Optional[str] = None
    invite_mode: str = "open"
    rsvp_deadline: Optional[datetime] = None
    rsvp_require_approval: bool = False
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


class SeatingTableOut(BaseModel):
    id: str
    event_id: str
    name: str
    capacity: int
    category: Optional[str] = None
    assigned_count: int = 0


class SeatAssignRequest(BaseModel):
    table_id: Optional[str] = None
    seat_number: Optional[str] = None


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
    invite_token: Optional[str] = None
    rsvp_status: str = "invited"
    rsvp_responded_at: Optional[datetime] = None
    admitted: bool
    admitted_at: Optional[datetime]
    admit_notified: bool
    table_id: Optional[str] = None
    seat_number: Optional[str] = None
    meal_served: bool = False
    is_vip: bool = False
    ticket_type_id: Optional[str] = None
    sms_consent: bool = True
    whatsapp_consent: bool = True


# ── Scanner ──────────────────────────────────────────────────────────────────

class ScanResult(BaseModel):
    status: str  # admitted | already_admitted | invalid | not_active | not_assigned
    message: str
    guest: Optional[GuestOut] = None
    table_name: Optional[str] = None
    seat_number: Optional[str] = None


class EventBrief(BaseModel):
    name: str
    couples_name: str
    event_date: datetime
    status: str
    seating_enabled: bool = False
    menu_enabled: bool = False
    notify_sms: bool = True
    notify_whatsapp: bool = True


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

class DashboardStats(BaseModel):
    total: int
    admitted: int
    pending: int
    admitted_guests: list[GuestOut]


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
    email: str
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
    rsvp_capacity: Optional[int] = None
    invite_cover_image: Optional[str] = None
    invite_mode: Optional[Literal["open", "closed"]] = None
    rsvp_deadline: Optional[datetime] = None
    rsvp_require_approval: Optional[bool] = None


class InvitePageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    couples_name: str
    event_date: datetime
    description: Optional[str]
    invite_theme: str
    invite_message: Optional[str]
    rsvp_enabled: bool
    rsvp_collect_phone: bool
    rsvp_collect_email: bool
    rsvp_capacity: Optional[int]
    invite_cover_image: Optional[str] = None
    invite_mode: str = "open"
    rsvp_deadline: Optional[datetime] = None
    # rsvp_count populated by the endpoint
    rsvp_count: int = 0
    # deadline_passed computed by the endpoint
    deadline_passed: bool = False
    questions: list[RSVPQuestionOut] = []
    # Logistics: address/size collection needed for this event, if any.
    shipping: Optional[InviteShippingOut] = None
    registry_enabled: bool = False
    registry_token: Optional[str] = None


class RSVPSubmit(BaseModel):
    first_name: str
    last_name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    # key = question_id, value = answer string
    answers: dict[str, str] = {}
    # Logistics add-on (optional): shipping address + per-shipment size choices.
    shipping_address: Optional[ShippingAddressUpdate] = None
    sizes: dict[str, str] = {}  # shipment_id -> size


class RSVPConfirm(BaseModel):
    id: str
    qr_token: str
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
