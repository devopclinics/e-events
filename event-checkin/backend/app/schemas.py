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
    checkin_base_url: Optional[str] = None

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


class AssignUserRequest(BaseModel):
    user_id: str


# ── Seating ───────────────────────────────────────────────────────────────────

class SeatingTableCreate(BaseModel):
    name: str
    capacity: int


class SeatingTableOut(BaseModel):
    id: str
    event_id: str
    name: str
    capacity: int
    assigned_count: int = 0


class SeatAssignRequest(BaseModel):
    table_id: Optional[str] = None
    seat_number: Optional[str] = None


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


class MenuCategoryOut(BaseModel):
    id: str
    event_id: str
    name: str
    sort_order: int
    items: list[MenuItemOut] = []


class GuestMenuChoiceOut(BaseModel):
    category_id: str
    menu_item_id: str


class GuestMenuSubmit(BaseModel):
    choices: dict[str, str]  # category_id → menu_item_id


# ── Guests ───────────────────────────────────────────────────────────────────

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
    admitted: bool
    admitted_at: Optional[datetime]
    admit_notified: bool
    table_id: Optional[str] = None
    seat_number: Optional[str] = None
    meal_served: bool = False


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


class TicketView(BaseModel):
    status: str  # valid | admitted | invalid
    guest: Optional[GuestOut] = None
    event: Optional[EventBrief] = None
    table_name: Optional[str] = None
    seat_number: Optional[str] = None
    menu_categories: list[MenuCategoryOut] = []
    guest_choices: dict[str, str] = {}  # category_id → menu_item_id


# ── Dashboard ─────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total: int
    admitted: int
    pending: int
    admitted_guests: list[GuestOut]
