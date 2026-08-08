"""Vendors and their payment schedules."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value

from .. import models, schemas
from ..auth import Identity, current_identity, ensure_capability
from ..database import get_db

router = APIRouter(prefix="/api/planner", tags=["planner-vendors"])


async def _get_vendor(db: AsyncSession, event_id: str, vendor_id: str) -> models.PlannerVendor:
    vendor = (await db.execute(
        select(models.PlannerVendor)
        .options(selectinload(models.PlannerVendor.payments))
        .where(
            models.PlannerVendor.id == vendor_id,
            models.PlannerVendor.event_id == event_id,
            models.PlannerVendor.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if vendor is None:
        raise HTTPException(404, "Not found")
    return vendor


async def _get_payment(db: AsyncSession, event_id: str, vendor_id: str, pay_id: str) -> models.PlannerVendorPayment:
    payment = (await db.execute(
        select(models.PlannerVendorPayment)
        .join(models.PlannerVendor, models.PlannerVendor.id == models.PlannerVendorPayment.vendor_id)
        .where(
            models.PlannerVendorPayment.id == pay_id,
            models.PlannerVendorPayment.vendor_id == vendor_id,
            models.PlannerVendor.event_id == event_id,
            models.PlannerVendor.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if payment is None:
        raise HTTPException(404, "Not found")
    return payment


@router.get("/{event_id}/vendors", response_model=list[schemas.VendorOut])
async def list_vendors(
    event_id: str,
    status: str | None = Query(None),
    category: str | None = Query(None),
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> list[models.PlannerVendor]:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    q = (
        select(models.PlannerVendor)
        .options(selectinload(models.PlannerVendor.payments))
        .where(models.PlannerVendor.event_id == event_id, models.PlannerVendor.deleted_at.is_(None))
    )
    if status:
        q = q.where(models.PlannerVendor.status == status)
    if category:
        q = q.where(models.PlannerVendor.category == category)
    return (await db.execute(q)).scalars().all()


@router.post("/{event_id}/vendors", response_model=schemas.VendorOut, status_code=201)
async def create_vendor(
    event_id: str,
    payload: schemas.VendorIn,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerVendor:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    vendor = models.PlannerVendor(event_id=event_id, org_id=identity.org_id, **payload.model_dump())
    db.add(vendor)
    await db.commit()
    await db.refresh(vendor)
    set_committed_value(vendor, "payments", [])
    return vendor


@router.get("/{event_id}/vendors/{vendor_id}", response_model=schemas.VendorOut)
async def get_vendor(
    event_id: str,
    vendor_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerVendor:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    return await _get_vendor(db, event_id, vendor_id)


@router.patch("/{event_id}/vendors/{vendor_id}", response_model=schemas.VendorOut)
async def update_vendor(
    event_id: str,
    vendor_id: str,
    payload: schemas.VendorUpdate,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerVendor:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    vendor = await _get_vendor(db, event_id, vendor_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(vendor, field, value)
    await db.commit()
    return await _get_vendor(db, event_id, vendor_id)


@router.delete("/{event_id}/vendors/{vendor_id}", status_code=204)
async def delete_vendor(
    event_id: str,
    vendor_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    vendor = await _get_vendor(db, event_id, vendor_id)
    vendor.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.get("/{event_id}/vendors/{vendor_id}/payments", response_model=list[schemas.VendorPaymentOut])
async def list_payments(
    event_id: str,
    vendor_id: str,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> list[models.PlannerVendorPayment]:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    vendor = await _get_vendor(db, event_id, vendor_id)
    return vendor.payments


@router.post("/{event_id}/vendors/{vendor_id}/payments", response_model=schemas.VendorPaymentOut, status_code=201)
async def create_payment(
    event_id: str,
    vendor_id: str,
    payload: schemas.VendorPaymentIn,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerVendorPayment:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    vendor = await _get_vendor(db, event_id, vendor_id)
    payment = models.PlannerVendorPayment(vendor_id=vendor.id, **payload.model_dump())
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    return payment


@router.patch(
    "/{event_id}/vendors/{vendor_id}/payments/{pay_id}", response_model=schemas.VendorPaymentOut,
)
async def update_payment(
    event_id: str,
    vendor_id: str,
    pay_id: str,
    payload: schemas.VendorPaymentUpdate,
    identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
) -> models.PlannerVendorPayment:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    payment = await _get_payment(db, event_id, vendor_id, pay_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(payment, field, value)
    await db.commit()
    await db.refresh(payment)
    return payment
