"""Structured procurement, approvals, change orders and vendor portal links."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import models, schemas
from ..auth import Identity, current_identity, ensure_capability
from ..database import get_db

router = APIRouter(prefix="/api/planner", tags=["planner-procurement"])


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _quote_data(payload, *, exclude_unset: bool = False) -> dict:
    data = payload.model_dump(exclude_unset=exclude_unset)
    lines = data.get("line_items")
    if lines is not None:
        data["line_items"] = [line.model_dump() if hasattr(line, "model_dump") else line for line in lines]
        if lines:
            data["amount"] = round(sum(float(line["quantity"]) * float(line["unit_price"]) for line in data["line_items"]), 2)
    return data


async def _vendor(db: AsyncSession, event_id: str, vendor_id: str) -> models.PlannerVendor:
    row = (await db.execute(select(models.PlannerVendor).options(
        selectinload(models.PlannerVendor.payments)
    ).where(
        models.PlannerVendor.id == vendor_id, models.PlannerVendor.event_id == event_id,
        models.PlannerVendor.deleted_at.is_(None),
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Vendor not found")
    return row


async def _quote(db: AsyncSession, event_id: str, quote_id: str) -> models.PlannerVendorQuote:
    row = (await db.execute(select(models.PlannerVendorQuote).where(
        models.PlannerVendorQuote.id == quote_id, models.PlannerVendorQuote.event_id == event_id,
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Quote not found")
    return row


async def _change(db: AsyncSession, event_id: str, change_id: str) -> models.PlannerChangeOrder:
    row = (await db.execute(select(models.PlannerChangeOrder).where(
        models.PlannerChangeOrder.id == change_id, models.PlannerChangeOrder.event_id == event_id,
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Change order not found")
    return row


async def _portal(db: AsyncSession, raw_token: str) -> models.PlannerVendorPortalToken:
    row = (await db.execute(select(models.PlannerVendorPortalToken).where(
        models.PlannerVendorPortalToken.token_hash == _token_hash(raw_token),
        models.PlannerVendorPortalToken.revoked_at.is_(None),
        models.PlannerVendorPortalToken.expires_at > datetime.now(timezone.utc),
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Vendor portal link is invalid or expired")
    return row


@router.get("/{event_id}/procurement")
async def procurement_board(
    event_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    quotes = (await db.execute(select(models.PlannerVendorQuote).where(
        models.PlannerVendorQuote.event_id == event_id,
    ).order_by(models.PlannerVendorQuote.created_at.desc()))).scalars().all()
    changes = (await db.execute(select(models.PlannerChangeOrder).where(
        models.PlannerChangeOrder.event_id == event_id,
    ).order_by(models.PlannerChangeOrder.created_at.desc()))).scalars().all()
    selections = (await db.execute(select(models.PlannerQuoteSelection).where(
        models.PlannerQuoteSelection.event_id == event_id,
    ).order_by(models.PlannerQuoteSelection.comparison_group, models.PlannerQuoteSelection.item_name))).scalars().all()
    requirements = (await db.execute(select(models.PlannerProcurementRequirement).where(
        models.PlannerProcurementRequirement.event_id == event_id,
    ))).scalars().all()
    return {
        "role": identity.role,
        "capabilities": list(identity.capabilities),
        "quotes": [schemas.VendorQuoteOut.model_validate(row) for row in quotes],
        "change_orders": [schemas.ChangeOrderOut.model_validate(row) for row in changes],
        "selections": [schemas.QuoteSelectionOut.model_validate(row) for row in selections],
        "requirements": [schemas.ProcurementRequirementOut.model_validate(row) for row in requirements],
    }


@router.put("/{event_id}/procurement/selections", response_model=schemas.QuoteSelectionOut)
async def select_quote_item(
    event_id: str, payload: schemas.QuoteSelectionIn,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    quote = await _quote(db, event_id, payload.quote_id)
    if quote.vendor_id != payload.vendor_id or quote.comparison_group.casefold() != payload.comparison_group.casefold():
        raise HTTPException(400, "Selection does not match this quote")
    matching = next((line for line in (quote.line_items or []) if
        f"{line['item'].strip().lower()}::{(line.get('unit') or '').strip().lower()}" == payload.item_key), None)
    if not matching:
        raise HTTPException(400, "Quoted item was not found")
    row = (await db.execute(select(models.PlannerQuoteSelection).where(
        models.PlannerQuoteSelection.event_id == event_id,
        models.PlannerQuoteSelection.comparison_group == payload.comparison_group,
        models.PlannerQuoteSelection.item_key == payload.item_key,
        models.PlannerQuoteSelection.quote_id == payload.quote_id,
    ))).scalar_one_or_none()
    values = dict(item_name=matching["item"], unit=matching.get("unit") or "", quote_id=quote.id,
        vendor_id=quote.vendor_id, unit_price=float(matching["unit_price"]),
        quantity=payload.quantity, selected_by=identity.email or identity.subject,
        selected_at=datetime.now(timezone.utc))
    if row:
        for field, value in values.items(): setattr(row, field, value)
    else:
        row = models.PlannerQuoteSelection(event_id=event_id, comparison_group=payload.comparison_group,
            item_key=payload.item_key, **values)
        db.add(row)
    await db.commit(); await db.refresh(row)
    return row


@router.put("/{event_id}/procurement/requirements", response_model=schemas.ProcurementRequirementOut)
async def set_procurement_requirement(
    event_id: str, payload: schemas.ProcurementRequirementIn,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    row = (await db.execute(select(models.PlannerProcurementRequirement).where(
        models.PlannerProcurementRequirement.event_id == event_id,
        models.PlannerProcurementRequirement.comparison_group == payload.comparison_group,
        models.PlannerProcurementRequirement.item_key == payload.item_key,
    ))).scalar_one_or_none()
    values = dict(required_quantity=payload.required_quantity,
        updated_by=identity.email or identity.subject, updated_at=datetime.now(timezone.utc))
    if row:
        for field, value in values.items(): setattr(row, field, value)
    else:
        row = models.PlannerProcurementRequirement(event_id=event_id,
            comparison_group=payload.comparison_group, item_key=payload.item_key, **values)
        db.add(row)
    await db.commit(); await db.refresh(row)
    return row


@router.delete("/{event_id}/procurement/selections/{selection_id}", status_code=204)
async def clear_quote_item_selection(
    event_id: str, selection_id: str, identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    result = await db.execute(delete(models.PlannerQuoteSelection).where(
        models.PlannerQuoteSelection.id == selection_id,
        models.PlannerQuoteSelection.event_id == event_id,
    ))
    if not result.rowcount:
        raise HTTPException(404, "Selection not found")
    await db.commit()


@router.post("/{event_id}/vendors/{vendor_id}/quotes", response_model=schemas.VendorQuoteOut, status_code=201)
async def create_quote(
    event_id: str, vendor_id: str, payload: schemas.VendorQuoteIn,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    await _vendor(db, event_id, vendor_id)
    data = _quote_data(payload)
    if data["status"] == "submitted":
        data["submitted_at"] = datetime.now(timezone.utc)
    row = models.PlannerVendorQuote(event_id=event_id, vendor_id=vendor_id, **data)
    db.add(row)
    await db.commit(); await db.refresh(row)
    return row


@router.patch("/{event_id}/quotes/{quote_id}", response_model=schemas.VendorQuoteOut)
async def update_quote(
    event_id: str, quote_id: str, payload: schemas.VendorQuoteUpdate,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    row = await _quote(db, event_id, quote_id)
    if row.status in ("approved", "rejected"):
        raise HTTPException(409, "Decided quotes cannot be edited")
    data = _quote_data(payload, exclude_unset=True)
    for field, value in data.items(): setattr(row, field, value)
    if data.get("status") == "submitted" and not row.submitted_at:
        row.submitted_at = datetime.now(timezone.utc)
    await db.commit(); await db.refresh(row)
    return row


@router.post("/{event_id}/quotes/{quote_id}/decision", response_model=schemas.VendorQuoteOut)
async def decide_quote(
    event_id: str, quote_id: str, payload: schemas.VendorQuoteDecision,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id or identity.role != "admin":
        raise HTTPException(403, "Planner administrator approval is required")
    row = await _quote(db, event_id, quote_id)
    if row.status != "submitted":
        raise HTTPException(409, "Only submitted quotes can be decided")
    row.status = payload.decision
    row.decided_at = datetime.now(timezone.utc); row.decided_by = identity.email or identity.subject
    if payload.decision == "approved":
        vendor = await _vendor(db, event_id, row.vendor_id)
        vendor.agreed_amount = row.amount; vendor.status = "contracted"
    await db.commit(); await db.refresh(row)
    return row


@router.post("/{event_id}/vendors/{vendor_id}/change-orders", response_model=schemas.ChangeOrderOut, status_code=201)
async def create_change_order(
    event_id: str, vendor_id: str, payload: schemas.ChangeOrderIn,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    await _vendor(db, event_id, vendor_id)
    if payload.quote_id:
        quote = await _quote(db, event_id, payload.quote_id)
        if quote.vendor_id != vendor_id: raise HTTPException(400, "Quote belongs to another vendor")
    row = models.PlannerChangeOrder(
        event_id=event_id, vendor_id=vendor_id, requested_by=identity.email or identity.subject,
        **payload.model_dump(),
    )
    db.add(row); await db.commit(); await db.refresh(row)
    return row


@router.post("/{event_id}/change-orders/{change_id}/decision", response_model=schemas.ChangeOrderOut)
async def decide_change_order(
    event_id: str, change_id: str, payload: schemas.ChangeOrderDecision,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id or identity.role != "admin":
        raise HTTPException(403, "Planner administrator approval is required")
    row = await _change(db, event_id, change_id)
    if row.status != "proposed" or payload.decision == "acknowledged":
        raise HTTPException(409, "This change order cannot receive that decision")
    row.status = payload.decision; row.decided_by = identity.email or identity.subject
    row.decided_at = datetime.now(timezone.utc)
    if payload.decision == "approved":
        vendor = await _vendor(db, event_id, row.vendor_id)
        vendor.agreed_amount = float(vendor.agreed_amount or 0) + float(row.amount_delta)
        if vendor.agreed_amount < 0: raise HTTPException(400, "Change order would make the contract value negative")
    await db.commit(); await db.refresh(row)
    return row


@router.post("/{event_id}/vendors/{vendor_id}/portal-link", response_model=schemas.VendorPortalLinkOut)
async def create_portal_link(
    event_id: str, vendor_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors"); await _vendor(db, event_id, vendor_id)
    # Rotating a link invalidates every previous share immediately, avoiding
    # an unbounded collection of forgotten vendor credentials.
    await db.execute(update(models.PlannerVendorPortalToken).where(
        models.PlannerVendorPortalToken.event_id == event_id,
        models.PlannerVendorPortalToken.vendor_id == vendor_id,
        models.PlannerVendorPortalToken.revoked_at.is_(None),
    ).values(revoked_at=datetime.now(timezone.utc)))
    raw = secrets.token_urlsafe(32); expires = datetime.now(timezone.utc) + timedelta(days=30)
    db.add(models.PlannerVendorPortalToken(
        event_id=event_id, vendor_id=vendor_id, token_hash=_token_hash(raw),
        expires_at=expires, created_by=identity.email or identity.subject,
    ))
    await db.commit()
    return {"url_path": f"/vendor-portal/{raw}", "expires_at": expires}


@router.get("/vendor-portal/{raw_token}")
async def vendor_portal(raw_token: str, db: AsyncSession = Depends(get_db)):
    access = await _portal(db, raw_token)
    vendor = await _vendor(db, access.event_id, access.vendor_id)
    quotes = (await db.execute(select(models.PlannerVendorQuote).where(
        models.PlannerVendorQuote.event_id == access.event_id,
        models.PlannerVendorQuote.vendor_id == access.vendor_id,
    ).order_by(models.PlannerVendorQuote.created_at.desc()))).scalars().all()
    changes = (await db.execute(select(models.PlannerChangeOrder).where(
        models.PlannerChangeOrder.event_id == access.event_id,
        models.PlannerChangeOrder.vendor_id == access.vendor_id,
    ).order_by(models.PlannerChangeOrder.created_at.desc()))).scalars().all()
    return {"vendor": schemas.VendorOut.model_validate(vendor), "event_id": access.event_id,
            "expires_at": access.expires_at,
            "quotes": [schemas.VendorQuoteOut.model_validate(row) for row in quotes],
            "change_orders": [schemas.ChangeOrderOut.model_validate(row) for row in changes]}


@router.post("/vendor-portal/{raw_token}/quotes", response_model=schemas.VendorQuoteOut, status_code=201)
async def vendor_submit_quote(raw_token: str, payload: schemas.VendorQuoteIn, db: AsyncSession = Depends(get_db)):
    access = await _portal(db, raw_token)
    data = _quote_data(payload); data["status"] = "submitted"; data["submitted_at"] = datetime.now(timezone.utc)
    row = models.PlannerVendorQuote(event_id=access.event_id, vendor_id=access.vendor_id, **data)
    db.add(row); await db.commit(); await db.refresh(row)
    return row


@router.post("/vendor-portal/{raw_token}/change-orders", response_model=schemas.ChangeOrderOut, status_code=201)
async def vendor_request_change(raw_token: str, payload: schemas.ChangeOrderIn, db: AsyncSession = Depends(get_db)):
    access = await _portal(db, raw_token)
    if payload.quote_id:
        quote = await _quote(db, access.event_id, payload.quote_id)
        if quote.vendor_id != access.vendor_id: raise HTTPException(400, "Quote belongs to another vendor")
    row = models.PlannerChangeOrder(event_id=access.event_id, vendor_id=access.vendor_id,
        requested_by="vendor portal", **payload.model_dump())
    db.add(row); await db.commit(); await db.refresh(row)
    return row


@router.post("/vendor-portal/{raw_token}/change-orders/{change_id}/acknowledge", response_model=schemas.ChangeOrderOut)
async def vendor_acknowledge_change(raw_token: str, change_id: str, db: AsyncSession = Depends(get_db)):
    access = await _portal(db, raw_token); row = await _change(db, access.event_id, change_id)
    if row.vendor_id != access.vendor_id: raise HTTPException(404, "Change order not found")
    if row.status != "approved": raise HTTPException(409, "Only approved changes can be acknowledged")
    row.status = "acknowledged"; await db.commit(); await db.refresh(row)
    return row
