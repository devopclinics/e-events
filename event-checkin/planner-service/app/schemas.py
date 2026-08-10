"""Pydantic request/response shapes for planner-service. Field names here are
the wire contract both the routers (this service) and the frontend Planner
pages are built against."""
from datetime import date, datetime, time
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


# ── Budget ───────────────────────────────────────────────────────────────────

class BudgetItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    estimated: float = Field(default=0, ge=0, le=999_999_999_999.99)
    actual: Optional[float] = Field(default=None, ge=0, le=999_999_999_999.99)
    status: Literal["pending", "paid", "cancelled"] = "pending"
    notes: Optional[str] = Field(default=None, max_length=10_000)
    vendor_id: Optional[str] = None
    vendor_quotes: Optional[dict[str, float]] = None


class BudgetItemUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    estimated: Optional[float] = Field(default=None, ge=0, le=999_999_999_999.99)
    actual: Optional[float] = Field(default=None, ge=0, le=999_999_999_999.99)
    status: Optional[Literal["pending", "paid", "cancelled"]] = None
    notes: Optional[str] = Field(default=None, max_length=10_000)
    vendor_id: Optional[str] = None
    vendor_quotes: Optional[dict[str, float]] = None
    paid_at: Optional[datetime] = None


class BudgetItemOut(BaseModel):
    id: str
    category_id: str
    vendor_id: Optional[str] = None
    name: str
    estimated: float
    actual: Optional[float] = None
    status: str
    notes: Optional[str] = None
    vendor_quotes: Optional[dict[str, float]] = None
    paid_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class BudgetCategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    allocated: float = Field(default=0, ge=0, le=999_999_999_999.99)
    color: str = Field(default="#0f766e", pattern=r"^#[0-9A-Fa-f]{6}$")
    sort_order: int = 0


class BudgetCategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    allocated: Optional[float] = Field(default=None, ge=0, le=999_999_999_999.99)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    sort_order: Optional[int] = None


class BudgetCategoryOut(BaseModel):
    id: str
    budget_id: str
    name: str
    allocated: float
    color: str
    sort_order: int
    items: list[BudgetItemOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class BudgetIn(BaseModel):
    total_budget: float = Field(default=0, ge=0, le=999_999_999_999.99)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    notes: Optional[str] = Field(default=None, max_length=10_000)


class BudgetOut(BaseModel):
    id: str
    event_id: str
    total_budget: float
    currency: str
    notes: Optional[str] = None
    categories: list[BudgetCategoryOut] = Field(default_factory=list)
    # Computed rollups
    total_allocated: float = 0
    total_estimated: float = 0
    total_actual: float = 0
    total_remaining: float = 0

    model_config = {"from_attributes": True}


# ── Vendors ──────────────────────────────────────────────────────────────────

class VendorIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(default="", max_length=80)
    status: Literal["prospect", "shortlisted", "contracted", "paid", "cancelled"] = "prospect"
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    website: Optional[str] = None
    contract_url: Optional[str] = None
    contract_expires_at: Optional[date] = None
    agreed_amount: Optional[float] = Field(default=None, ge=0, le=999_999_999_999.99)
    deposit_amount: Optional[float] = Field(default=None, ge=0, le=999_999_999_999.99)
    deposit_due_at: Optional[date] = None
    notes: Optional[str] = None


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    status: Optional[Literal["prospect", "shortlisted", "contracted", "paid", "cancelled"]] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    contract_url: Optional[str] = None
    contract_expires_at: Optional[date] = None
    agreed_amount: Optional[float] = Field(default=None, ge=0, le=999_999_999_999.99)
    deposit_amount: Optional[float] = Field(default=None, ge=0, le=999_999_999_999.99)
    deposit_due_at: Optional[date] = None
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    notes: Optional[str] = None


class VendorPaymentIn(BaseModel):
    label: str = Field(default="Payment", min_length=1, max_length=120)
    amount: float = Field(default=0, ge=0, le=999_999_999_999.99)
    due_at: Optional[date] = None
    reference: Optional[str] = None
    method: Optional[str] = None


class VendorPaymentUpdate(BaseModel):
    label: Optional[str] = None
    amount: Optional[float] = Field(default=None, ge=0, le=999_999_999_999.99)
    due_at: Optional[date] = None
    paid_at: Optional[datetime] = None
    reference: Optional[str] = None
    method: Optional[str] = None


class VendorPaymentOut(BaseModel):
    id: str
    vendor_id: str
    label: str
    amount: float
    due_at: Optional[date] = None
    paid_at: Optional[datetime] = None
    reference: Optional[str] = None
    method: Optional[str] = None

    model_config = {"from_attributes": True}


class VendorOut(BaseModel):
    id: str
    event_id: str
    name: str
    category: str
    status: str
    contact_name: str
    contact_email: str
    contact_phone: str
    website: Optional[str] = None
    contract_url: Optional[str] = None
    contract_expires_at: Optional[date] = None
    agreed_amount: Optional[float] = None
    deposit_amount: Optional[float] = None
    deposit_due_at: Optional[date] = None
    rating: Optional[int] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    payments: list[VendorPaymentOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class VendorQuoteLine(BaseModel):
    item: str = Field(min_length=1, max_length=200)
    unit: str = Field(default="", max_length=80)
    quantity: float = Field(default=1, gt=0, le=1_000_000)
    unit_price: float = Field(ge=0, le=999_999_999_999.99)
    notes: Optional[str] = Field(default=None, max_length=2_000)


class VendorQuoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    amount: float = Field(default=0, ge=0, le=999_999_999_999.99)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    comparison_group: str = Field(default="General", min_length=1, max_length=120)
    line_items: list[VendorQuoteLine] = Field(default_factory=list, max_length=500)
    scope: Optional[str] = Field(default=None, max_length=20_000)
    valid_until: Optional[date] = None
    status: Literal["draft", "submitted"] = "draft"


class VendorQuoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    amount: Optional[float] = Field(default=None, ge=0, le=999_999_999_999.99)
    currency: Optional[str] = Field(default=None, pattern=r"^[A-Z]{3}$")
    comparison_group: Optional[str] = Field(default=None, min_length=1, max_length=120)
    line_items: Optional[list[VendorQuoteLine]] = Field(default=None, max_length=500)
    scope: Optional[str] = Field(default=None, max_length=20_000)
    valid_until: Optional[date] = None
    status: Optional[Literal["draft", "submitted"]] = None


class VendorQuoteDecision(BaseModel):
    decision: Literal["approved", "rejected"]


class VendorQuoteOut(BaseModel):
    id: str
    event_id: str
    vendor_id: str
    title: str
    amount: float
    currency: str
    comparison_group: str = "General"
    line_items: list[VendorQuoteLine] = Field(default_factory=list)
    scope: Optional[str] = None
    valid_until: Optional[date] = None
    status: str
    submitted_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None
    decided_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class ChangeOrderIn(BaseModel):
    quote_id: Optional[str] = None
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=20_000)
    amount_delta: float = Field(default=0, ge=-999_999_999_999.99, le=999_999_999_999.99)


class ChangeOrderDecision(BaseModel):
    decision: Literal["approved", "rejected", "acknowledged"]


class ChangeOrderOut(BaseModel):
    id: str
    event_id: str
    vendor_id: str
    quote_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    amount_delta: float
    status: str
    requested_by: str
    decided_by: Optional[str] = None
    decided_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class VendorPortalLinkOut(BaseModel):
    url_path: str
    expires_at: datetime


class QuoteSelectionIn(BaseModel):
    comparison_group: str = Field(min_length=1, max_length=120)
    item_key: str = Field(min_length=1, max_length=320)
    item_name: str = Field(min_length=1, max_length=200)
    unit: str = Field(default="", max_length=80)
    quote_id: str
    vendor_id: str
    unit_price: float = Field(ge=0, le=999_999_999_999.99)
    quantity: float = Field(default=1, gt=0, le=1_000_000)


class QuoteSelectionOut(QuoteSelectionIn):
    id: str
    selected_by: str
    selected_at: datetime
    model_config = {"from_attributes": True}


class ProcurementRequirementIn(BaseModel):
    comparison_group: str = Field(min_length=1, max_length=120)
    item_key: str = Field(min_length=1, max_length=320)
    required_quantity: float = Field(gt=0, le=1_000_000)


class ProcurementRequirementOut(ProcurementRequirementIn):
    id: str
    updated_by: str
    updated_at: datetime
    model_config = {"from_attributes": True}


# ── Timeline ─────────────────────────────────────────────────────────────────

class TaskIn(BaseModel):
    milestone_id: str
    title: str
    assigned_to: Optional[str] = None
    due_at: Optional[date] = None
    priority: Literal["low", "normal", "high"] = "normal"
    status: Literal["todo", "in_progress", "done"] = "todo"
    notes: Optional[str] = None
    vendor_id: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    assigned_to: Optional[str] = None
    due_at: Optional[date] = None
    priority: Optional[Literal["low", "normal", "high"]] = None
    status: Optional[Literal["todo", "in_progress", "done"]] = None
    notes: Optional[str] = None
    vendor_id: Optional[str] = None


class TaskOut(BaseModel):
    id: str
    milestone_id: str
    title: str
    assigned_to: Optional[str] = None
    due_at: Optional[date] = None
    priority: str
    status: str
    notes: Optional[str] = None
    vendor_id: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MilestoneIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    due_at: Optional[date] = None
    status: Literal["not_started", "in_progress", "done"] = "not_started"
    sort_order: int = 0


class MilestoneUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_at: Optional[date] = None
    status: Optional[Literal["not_started", "in_progress", "done"]] = None
    sort_order: Optional[int] = None


class MilestoneOut(BaseModel):
    id: str
    event_id: str
    title: str
    description: Optional[str] = None
    due_at: Optional[date] = None
    status: str
    sort_order: int
    tasks: list[TaskOut] = Field(default_factory=list)
    completion_pct: int = 0

    model_config = {"from_attributes": True}


class StarterPlanIn(BaseModel):
    event_name: str = Field(min_length=1, max_length=255)
    event_type: Optional[str] = Field(default=None, max_length=80)
    attendance_mode: Literal["rsvp", "ticketed", "hybrid", "private"] = "rsvp"
    event_date: date
    venue_name: Optional[str] = Field(default=None, max_length=255)


class StarterPlanOut(BaseModel):
    created: bool
    milestones_created: int
    tasks_created: int


# ── Runsheet ─────────────────────────────────────────────────────────────────

class RunsheetItemIn(BaseModel):
    start_time: time
    end_time: Optional[time] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    timezone: str = Field(default="UTC", min_length=1, max_length=64)
    location: Optional[str] = Field(default=None, max_length=200)
    dependency_id: Optional[str] = None
    title: str = Field(min_length=1, max_length=300)
    type: Literal["setup", "program", "break", "ceremony", "other"] = "other"
    owner: Optional[str] = None
    cue: Optional[str] = None
    notes: Optional[str] = None
    status: Literal["upcoming", "in_progress", "done"] = "upcoming"
    sort_order: int = 0

    @model_validator(mode="after")
    def validate_schedule(self):
        if self.start_at is not None and self.start_at.tzinfo is None:
            raise ValueError("start_at must include a timezone offset")
        if self.end_at is not None and self.end_at.tzinfo is None:
            raise ValueError("end_at must include a timezone offset")
        if self.start_at and self.end_at and self.end_at <= self.start_at:
            raise ValueError("end_at must be later than start_at")
        return self


class RunsheetItemUpdate(BaseModel):
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    timezone: Optional[str] = Field(default=None, min_length=1, max_length=64)
    location: Optional[str] = Field(default=None, max_length=200)
    dependency_id: Optional[str] = None
    version: Optional[int] = Field(default=None, ge=1)
    title: Optional[str] = None
    type: Optional[Literal["setup", "program", "break", "ceremony", "other"]] = None
    owner: Optional[str] = None
    cue: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[Literal["upcoming", "in_progress", "done"]] = None
    sort_order: Optional[int] = None

    @model_validator(mode="after")
    def validate_schedule(self):
        for value in (self.start_at, self.end_at):
            if value is not None and value.tzinfo is None:
                raise ValueError("runsheet datetimes must include a timezone offset")
        if self.start_at and self.end_at and self.end_at <= self.start_at:
            raise ValueError("end_at must be later than start_at")
        return self


class RunsheetItemOut(BaseModel):
    id: str
    event_id: str
    start_time: time
    end_time: Optional[time] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    timezone: str = "UTC"
    location: Optional[str] = None
    dependency_id: Optional[str] = None
    version: int = 1
    conflict_ids: list[str] = Field(default_factory=list)
    title: str
    type: str
    owner: Optional[str] = None
    cue: Optional[str] = None
    notes: Optional[str] = None
    status: str
    sort_order: int

    model_config = {"from_attributes": True}


class RunsheetReorderEntry(BaseModel):
    id: str
    sort_order: int


class RunsheetReorderIn(BaseModel):
    items: list[RunsheetReorderEntry]


# ── Documents ────────────────────────────────────────────────────────────────

class DocumentUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[Literal["draft", "sent", "signed", "expired"]] = None
    expires_at: Optional[date] = None
    vendor_id: Optional[str] = None
    type: Optional[Literal["contract", "quote", "invoice", "proposal", "other"]] = None


class DocumentOut(BaseModel):
    id: str
    event_id: str
    vendor_id: Optional[str] = None
    type: str
    name: str
    file_url: str
    file_size_bytes: Optional[int] = None
    status: str
    expires_at: Optional[date] = None
    uploaded_at: datetime

    model_config = {"from_attributes": True}


# ── Dashboard ────────────────────────────────────────────────────────────────

class DashboardOut(BaseModel):
    role: str = "member"
    capabilities: list[str] = Field(default_factory=list)
    budget_total: float = 0
    budget_estimated: float = 0
    budget_actual: float = 0
    budget_remaining: float = 0
    currency: str = "USD"
    vendor_counts: dict[str, int] = Field(default_factory=dict)
    tasks_due_this_week: list[TaskOut] = Field(default_factory=list)
    overdue_tasks: list[TaskOut] = Field(default_factory=list)
    documents_expiring_soon: list[DocumentOut] = Field(default_factory=list)
    next_runsheet_item: Optional[RunsheetItemOut] = None
    milestones_total: int = 0
    milestones_done: int = 0
