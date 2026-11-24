"""Event-scoped Junior Programme data. Never populated from convention guests implicitly."""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Boolean, Integer, DateTime, JSON, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


def uid():
    return str(uuid.uuid4())


class JuniorConfig(Base):
    __tablename__ = 'junior_configs'
    event_id: Mapped[str] = mapped_column(ForeignKey('events.id', ondelete='CASCADE'), primary_key=True)
    classrooms: Mapped[list] = mapped_column(JSON, default=list)
    staff: Mapped[dict] = mapped_column(JSON, default=dict)
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=False)


class JuniorChild(Base):
    __tablename__ = 'junior_children'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(ForeignKey('events.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(255))
    reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    age_group: Mapped[str] = mapped_column(String(80))
    classroom: Mapped[str] = mapped_column(String(100))
    location: Mapped[str] = mapped_column(String(30), default='not_arrived')
    allergy: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    accommodation: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    allergy_cleared: Mapped[bool] = mapped_column(Boolean, default=False)
    accommodation_cleared: Mapped[bool] = mapped_column(Boolean, default=False)
    allergy_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    accommodation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint('event_id', 'reference', name='uq_junior_reference'),)


class JuniorContact(Base):
    __tablename__ = 'junior_contacts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    child_id: Mapped[str] = mapped_column(ForeignKey('junior_children.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(255))
    relationship: Mapped[str] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    sms_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    adult_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    pickup_authorized: Mapped[bool] = mapped_column(Boolean, default=False)
    notify: Mapped[bool] = mapped_column(Boolean, default=True)
    verified_by: Mapped[str] = mapped_column(String(36))


class JuniorMovement(Base):
    __tablename__ = 'junior_movements'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(ForeignKey('events.id', ondelete='CASCADE'), index=True)
    child_id: Mapped[str] = mapped_column(ForeignKey('junior_children.id', ondelete='CASCADE'), index=True)
    request_id: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(40))
    from_location: Mapped[str] = mapped_column(String(30))
    to_location: Mapped[str] = mapped_column(String(30))
    adult_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    relationship: Mapped[str | None] = mapped_column(String(30), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contact_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_id: Mapped[str] = mapped_column(String(36))
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint('event_id', 'request_id', name='uq_junior_movement_request'),)


class JuniorOuting(Base):
    __tablename__ = 'junior_outings'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(ForeignKey('events.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(255))
    outing_date: Mapped[str] = mapped_column(String(10))
    closed: Mapped[bool] = mapped_column(Boolean, default=False)


class JuniorOutingMember(Base):
    __tablename__ = 'junior_outing_members'
    outing_id: Mapped[str] = mapped_column(ForeignKey('junior_outings.id', ondelete='CASCADE'), primary_key=True)
    child_id: Mapped[str] = mapped_column(ForeignKey('junior_children.id', ondelete='CASCADE'), primary_key=True)
    permission_verified_by: Mapped[str] = mapped_column(String(36))
    departed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    returned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class JuniorNotification(Base):
    __tablename__ = 'junior_notifications'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(ForeignKey('events.id', ondelete='CASCADE'), index=True)
    movement_id: Mapped[str] = mapped_column(ForeignKey('junior_movements.id', ondelete='CASCADE'), index=True)
    contact_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    channel: Mapped[str] = mapped_column(String(10))
    recipient: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default='queued', index=True)
    error: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ledger_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    attempted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class JuniorInventory(Base):
    __tablename__ = 'junior_inventory'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(ForeignKey('events.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(255))
    total: Mapped[int] = mapped_column(Integer)
    issued: Mapped[int] = mapped_column(Integer, default=0)
    damaged: Mapped[int] = mapped_column(Integer, default=0)
    lost: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)


class JuniorInventoryEntry(Base):
    __tablename__ = 'junior_inventory_entries'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    item_id: Mapped[str] = mapped_column(ForeignKey('junior_inventory.id', ondelete='CASCADE'), index=True)
    request_id: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(20))
    quantity: Mapped[int] = mapped_column(Integer)
    responsible: Mapped[str] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    actor_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint('item_id', 'request_id', name='uq_junior_inventory_request'),)
