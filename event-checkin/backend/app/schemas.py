from pydantic import BaseModel, ConfigDict, EmailStr, field_validator
from datetime import datetime, timezone
from typing import Optional, Literal, Any


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


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ── Events ───────────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    name: str
    couples_name: str
    event_date: datetime
    description: Optional[str] = None
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    checkin_base_url: str

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
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    checkin_base_url: Optional[str] = None
    notify_email: Optional[bool] = None
    notify_sms: Optional[bool] = None
    notify_mms: Optional[bool] = None
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


class EventResetRequest(BaseModel):
    confirm_text: str
    clear_guests: bool = True
    clear_assignments: bool = True
    clear_tables: bool = False
    clear_table_groups: bool = False
    clear_menu: bool = False
    clear_templates: bool = False
    reset_status_to_draft: bool = False


class EventResetResult(BaseModel):
    ok: bool = True
    event_id: str
    guests_deleted: int = 0
    assignments_cleared: int = 0
    tables_deleted: int = 0
    table_groups_deleted: int = 0
    menu_rows_deleted: int = 0
    templates_deleted: int = 0


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    couples_name: str
    event_date: datetime
    description: Optional[str]
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    checkin_base_url: str
    status: str
    seating_enabled: bool
    menu_enabled: bool
    notify_email: bool = True
    notify_sms: bool = True
    notify_mms: bool = False
    notify_whatsapp: bool = True
    manual_checkin_enabled: bool = False
    walk_in_enabled: bool = False
    walk_in_table_group_id: Optional[str] = None
    self_checkin_enabled: bool = False
    partner_pairing_enabled: bool = True
    event_code: Optional[str] = None
    created_at: datetime
    source_url: Optional[str] = None
    source_sync_interval_seconds: int = 60
    source_last_sync_at: Optional[datetime] = None
    source_last_error: Optional[str] = None


class EventMemberOut(BaseModel):
    id: str
    user: UserOut
    assigned_at: datetime
    can_reassign_seats: bool
    can_manage_menu: bool = False


class AssignUserRequest(BaseModel):
    user_id: str


# ── Seating ───────────────────────────────────────────────────────────────────

class SeatingTableCreate(BaseModel):
    name: str
    capacity: int
    sort_order: int = 0


class SeatingTableOut(BaseModel):
    id: str
    event_id: str
    name: str
    capacity: int
    assigned_count: int = 0
    sort_order: int = 0


# ── Table Groups ──────────────────────────────────────────────────────────────

class TableGroupCreate(BaseModel):
    name: str
    tag: str
    description: Optional[str] = None
    sort_order: int = 0
    table_ids: Optional[list[str]] = None


class TableGroupUpdate(BaseModel):
    name: Optional[str] = None
    tag: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    table_ids: Optional[list[str]] = None   # replaces current memberships


class TableGroupOut(BaseModel):
    id: str
    event_id: str
    name: str
    tag: str
    description: Optional[str] = None
    sort_order: int = 0
    created_at: datetime
    table_ids: list[str] = []
    table_names: list[str] = []
    total_capacity: int = 0
    tagged_guest_count: int = 0
    assigned_seat_count: int = 0


class TableGroupAssignRequest(BaseModel):
    guest_ids: list[str]


class SeatAssignRequest(BaseModel):
    table_id: Optional[str] = None
    seat_number: Optional[str] = None


# ── Bulk import ───────────────────────────────────────────────────────────────

class BulkImportError(BaseModel):
    row: int
    reason: str
    data: Optional[dict] = None


class BulkTableRow(BaseModel):
    name: str
    capacity: int


class BulkTableImportRequest(BaseModel):
    rows: Optional[list[BulkTableRow]] = None   # JSON path
    csv_text: Optional[str] = None              # CSV path
    mode: str = "lenient"                       # "strict" | "lenient"
    dry_run: bool = False
    on_duplicate: str = "skip"                  # "skip" | "error"


class BulkTableImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[BulkImportError] = []
    created_ids: list[str] = []
    dry_run: bool = False


class BulkTableGroupRow(BaseModel):
    name: str
    tag: str
    description: Optional[str] = None
    tables: Optional[str] = None    # comma-separated table names


class BulkTableGroupImportRequest(BaseModel):
    rows: Optional[list[BulkTableGroupRow]] = None
    csv_text: Optional[str] = None
    mode: str = "lenient"
    dry_run: bool = False
    on_duplicate: str = "skip"      # "skip" | "error"


class BulkTableGroupImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[BulkImportError] = []
    created_ids: list[str] = []
    dry_run: bool = False


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


class GuestUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    is_vip: Optional[bool] = None
    sms_consent: Optional[bool] = None
    whatsapp_consent: Optional[bool] = None
    # Pass the group's UUID to assign, or explicitly pass null to clear.
    # Uses model_fields_set so omitting the field means "don't change".
    table_group_id: Optional[str] = None


class GuestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    first_name: str
    last_name: str
    email: str
    phone: Optional[str]
    qr_token: str
    qr_generated_at: Optional[datetime]
    invite_sent_at: Optional[datetime]
    invite_status: Optional[str] = None
    admitted: bool
    admitted_at: Optional[datetime]
    admit_notified: bool
    table_id: Optional[str] = None
    seat_number: Optional[str] = None
    meal_served: bool = False
    is_vip: bool = False
    sms_consent: bool = True
    whatsapp_consent: bool = True
    table_group_id: Optional[str] = None
    table_group_name: Optional[str] = None


# ── Scanner ──────────────────────────────────────────────────────────────────

class ScanResult(BaseModel):
    status: str  # admitted | already_admitted | invalid | not_active | not_assigned | no_seat_available | group_mismatch
    message: str
    guest: Optional[GuestOut] = None
    table_name: Optional[str] = None
    seat_number: Optional[str] = None


class GuestSearchResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    first_name: str
    last_name: str
    phone: Optional[str] = None
    table_name: Optional[str] = None
    seat_number: Optional[str] = None
    admitted: bool
    admitted_at: Optional[datetime] = None
    is_vip: bool = False


class EventBrief(BaseModel):
    name: str
    couples_name: str
    event_date: datetime
    status: str
    seating_enabled: bool = False
    menu_enabled: bool = False
    notify_sms: bool = True
    notify_mms: bool = False
    notify_whatsapp: bool = True
    partner_pairing_enabled: bool = True
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None


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

class TableStat(BaseModel):
    id: str
    name: str
    capacity: int
    assigned: int      # guests with this table_id
    seated: int        # guests with a seat_number on this table
    admitted: int      # admitted guests at this table

class DashboardStats(BaseModel):
    total: int
    admitted: int
    pending: int
    invited: int
    invite_failed: int
    no_qr: int
    vip_total: int
    vip_admitted: int
    no_phone: int
    last_admitted_at: Optional[datetime] = None
    admitted_timeline: list[dict] = []   # [{label, count}] — 15-min buckets last 2h
    seating_enabled: bool = False
    tables: list[TableStat] = []
    total_seats: int = 0
    seats_assigned: int = 0
    seats_seated: int = 0
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


# ── Message Templates ─────────────────────────────────────────────────────────

class MessageTemplateUpsert(BaseModel):
    subject: Optional[str] = None
    email_body: Optional[str] = None
    sms_body: Optional[str] = None
    mms_body: Optional[str] = None
    whatsapp_body: Optional[str] = None


class MessageTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    scope: str          # "platform" | "event"
    event_id: Optional[str] = None
    template_key: str
    subject: Optional[str] = None
    email_body: Optional[str] = None
    sms_body: Optional[str] = None
    mms_body: Optional[str] = None
    whatsapp_body: Optional[str] = None
    updated_at: datetime
    updated_by: Optional[str] = None
    is_default: bool = False    # True when this is the platform default row


class TemplatePreviewRequest(BaseModel):
    template_key: str
    event_id: Optional[str] = None
    # Override specific fields for preview (uses stored template otherwise)
    subject: Optional[str] = None
    email_body: Optional[str] = None
    sms_body: Optional[str] = None
    mms_body: Optional[str] = None
    whatsapp_body: Optional[str] = None
    # Sample data overrides
    sample_data: Optional[dict[str, Any]] = None


class TemplatePreviewOut(BaseModel):
    subject: Optional[str] = None
    email_body: Optional[str] = None
    sms_body: Optional[str] = None
    mms_body: Optional[str] = None
    whatsapp_body: Optional[str] = None


class TemplateTestSendRequest(BaseModel):
    template_key: str
    event_id: Optional[str] = None
    channel: Literal["email", "sms", "mms", "whatsapp"]


# ── Self check-in ─────────────────────────────────────────────────────────────

class SelfCheckinEventInfo(BaseModel):
    name: str
    couples_name: str
    event_date: datetime
    status: str


class SelfCheckinMatch(BaseModel):
    id: str
    first_name: str
    last_name: str
    admitted: bool
    admitted_at: Optional[datetime] = None


class SelfCheckinResult(BaseModel):
    status: str  # admitted | already_admitted | not_found | not_active | no_seat_available
    message: str
    table_name: Optional[str] = None
    seat_number: Optional[str] = None
    recipient: Optional[str] = None  # email address or phone number
