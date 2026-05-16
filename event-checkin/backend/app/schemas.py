from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional


class EventCreate(BaseModel):
    name: str
    couples_name: str
    event_date: datetime
    description: Optional[str] = None
    checkin_base_url: str


class EventUpdate(BaseModel):
    name: Optional[str] = None
    couples_name: Optional[str] = None
    event_date: Optional[datetime] = None
    description: Optional[str] = None
    checkin_base_url: Optional[str] = None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    couples_name: str
    event_date: datetime
    description: Optional[str]
    checkin_base_url: str
    created_at: datetime


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


class ScanResult(BaseModel):
    status: str  # "admitted" | "already_admitted" | "invalid"
    message: str
    guest: Optional[GuestOut] = None


class DashboardStats(BaseModel):
    total: int
    admitted: int
    pending: int
    admitted_guests: list[GuestOut]
