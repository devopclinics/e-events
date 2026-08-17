"""Structured procurement, approvals, change orders and vendor portal links."""
import hashlib
import html as _html
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import models, schemas
from ..auth import Identity, current_identity, ensure_capability
from ..config import settings
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


# ── Contracts (e-signature) ─────────────────────────────────────────────────

async def _contract(db: AsyncSession, event_id: str, contract_id: str) -> models.PlannerContract:
    row = (await db.execute(select(models.PlannerContract).where(
        models.PlannerContract.id == contract_id, models.PlannerContract.event_id == event_id,
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Contract not found")
    return row


async def _contract_out(db: AsyncSession, contract: models.PlannerContract) -> schemas.ContractOut:
    vendor = await db.get(models.PlannerVendor, contract.vendor_id)
    signature = await db.scalar(select(models.PlannerContractSignature).where(
        models.PlannerContractSignature.contract_id == contract.id,
    ))
    return schemas.ContractOut(
        id=contract.id, event_id=contract.event_id, vendor_id=contract.vendor_id,
        vendor_name=vendor.name if vendor else None,
        title=contract.title, terms=contract.terms, terms_html=contract.terms_html, pdf_url=contract.pdf_url,
        status=contract.status, created_by=contract.created_by,
        sent_at=contract.sent_at, signed_at=contract.signed_at,
        created_at=contract.created_at, updated_at=contract.updated_at,
        signature=schemas.ContractSignatureOut.model_validate(signature) if signature else None,
    )


def _terms_to_html(raw: str) -> str:
    """Plain admin-typed text -> safe HTML paragraphs. Never accepts raw HTML
    from the request — every tag in the output is one this function generates."""
    paragraphs = [p.strip() for p in raw.replace("\r\n", "\n").split("\n\n") if p.strip()]
    return "".join(
        f"<p>{_html.escape(p).replace(chr(10), '<br>')}</p>"
        for p in paragraphs
    )


async def _render_contract_pdf(event_id: str, contract: models.PlannerContract, vendor_name: str) -> str:
    """Renders the contract to PDF via design-service (same Playwright
    renderer the main backend uses for floor-plan exports) and saves it to
    this service's own upload dir, alongside PlannerDocument's file storage."""
    document_html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
      body {{ font-family: -apple-system, sans-serif; color: #211a13; padding: 48px; max-width: 720px; }}
      h1 {{ font-size: 22px; margin: 0 0 4px; }}
      .sub {{ color: #6b5f52; font-size: 13px; margin-bottom: 32px; }}
      p {{ line-height: 1.6; font-size: 13px; margin: 0 0 14px; }}
    </style></head><body>
      <h1>{_html.escape(contract.title)}</h1>
      <div class="sub">Between the event organizer and {_html.escape(vendor_name)}</div>
      {contract.terms_html}
    </body></html>"""
    url = settings.design_service_url.rstrip("/") + "/api/v1/design/render-pdf"
    headers = {"X-Internal-Token": settings.design_internal_token} if settings.design_internal_token else {}
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(url, json={"html": document_html, "width": "816px", "height": "1200px", "landscape": False}, headers=headers)
    except httpx.HTTPError:
        raise HTTPException(502, "Contract PDF service is unavailable")
    if resp.status_code != 200:
        raise HTTPException(502, "Could not render the contract PDF")
    dest_dir = os.path.join(settings.upload_dir, event_id)
    os.makedirs(dest_dir, exist_ok=True)
    filename = f"{uuid.uuid4()}_contract.pdf"
    with open(os.path.join(dest_dir, filename), "wb") as out:
        out.write(resp.content)
    return f"/api/planner/{event_id}/contracts/{contract.id}/pdf/{filename}"


@router.get("/{event_id}/contracts", response_model=list[schemas.ContractOut])
async def list_contracts(
    event_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    rows = (await db.execute(select(models.PlannerContract).where(
        models.PlannerContract.event_id == event_id,
    ).order_by(models.PlannerContract.created_at.desc()))).scalars().all()
    return [await _contract_out(db, row) for row in rows]


@router.post("/{event_id}/vendors/{vendor_id}/contracts", response_model=schemas.ContractOut, status_code=201)
async def create_contract(
    event_id: str, vendor_id: str, payload: schemas.ContractIn,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    await _vendor(db, event_id, vendor_id)
    row = models.PlannerContract(
        event_id=event_id, vendor_id=vendor_id, title=payload.title,
        terms=payload.terms, terms_html=_terms_to_html(payload.terms),
        created_by=identity.email or identity.subject,
    )
    db.add(row)
    await db.commit(); await db.refresh(row)
    return await _contract_out(db, row)


@router.patch("/{event_id}/contracts/{contract_id}", response_model=schemas.ContractOut)
async def update_contract(
    event_id: str, contract_id: str, payload: schemas.ContractUpdate,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    row = await _contract(db, event_id, contract_id)
    if row.status != "draft":
        raise HTTPException(409, "Only draft contracts can be edited")
    if payload.title is not None:
        row.title = payload.title
    if payload.terms is not None:
        row.terms = payload.terms
        row.terms_html = _terms_to_html(payload.terms)
    await db.commit(); await db.refresh(row)
    return await _contract_out(db, row)


@router.post("/{event_id}/contracts/{contract_id}/send", response_model=schemas.ContractOut)
async def send_contract(
    event_id: str, contract_id: str,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    row = await _contract(db, event_id, contract_id)
    if row.status != "draft":
        raise HTTPException(409, "This contract has already been sent")
    vendor = await _vendor(db, event_id, row.vendor_id)
    row.pdf_url = await _render_contract_pdf(event_id, row, vendor.name)
    row.status = "sent"
    row.sent_at = datetime.now(timezone.utc)
    await db.commit(); await db.refresh(row)
    return await _contract_out(db, row)


@router.delete("/{event_id}/contracts/{contract_id}", status_code=204)
async def delete_contract(
    event_id: str, contract_id: str,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    ensure_capability(identity, "vendors")
    row = await _contract(db, event_id, contract_id)
    if row.status != "draft":
        raise HTTPException(409, "Only draft contracts can be deleted")
    await db.delete(row)
    await db.commit()


@router.get("/{event_id}/contracts/{contract_id}/pdf/{filename}")
async def download_contract_pdf(
    event_id: str, contract_id: str, filename: str,
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
) -> FileResponse:
    if identity.event_id != event_id:
        raise HTTPException(403, "Not authorized for this event")
    row = await _contract(db, event_id, contract_id)
    expected = f"/api/planner/{event_id}/contracts/{contract_id}/pdf/{filename}"
    if row.pdf_url != expected:
        raise HTTPException(404, "Not found")
    dest_dir = os.path.realpath(os.path.join(settings.upload_dir, event_id))
    file_path = os.path.realpath(os.path.join(dest_dir, filename))
    if not file_path.startswith(dest_dir + os.sep) or not os.path.isfile(file_path):
        raise HTTPException(404, "Not found")
    return FileResponse(file_path, media_type="application/pdf", filename=f"{row.title}.pdf")


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
    contracts = (await db.execute(select(models.PlannerContract).where(
        models.PlannerContract.event_id == access.event_id,
        models.PlannerContract.vendor_id == access.vendor_id,
        models.PlannerContract.status != "draft",  # drafts aren't visible until sent
    ).order_by(models.PlannerContract.created_at.desc()))).scalars().all()
    return {"vendor": schemas.VendorOut.model_validate(vendor), "event_id": access.event_id,
            "expires_at": access.expires_at,
            "quotes": [schemas.VendorQuoteOut.model_validate(row) for row in quotes],
            "change_orders": [schemas.ChangeOrderOut.model_validate(row) for row in changes],
            "contracts": [await _contract_out(db, row) for row in contracts]}


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


async def _vendor_contract(db: AsyncSession, access: models.PlannerVendorPortalToken, contract_id: str) -> models.PlannerContract:
    row = await _contract(db, access.event_id, contract_id)
    if row.vendor_id != access.vendor_id or row.status == "draft":
        raise HTTPException(404, "Contract not found")
    return row


@router.get("/vendor-portal/{raw_token}/contracts/{contract_id}/pdf/{filename}")
async def vendor_download_contract_pdf(raw_token: str, contract_id: str, filename: str, db: AsyncSession = Depends(get_db)) -> FileResponse:
    access = await _portal(db, raw_token)
    row = await _vendor_contract(db, access, contract_id)
    expected = f"/api/planner/{access.event_id}/contracts/{contract_id}/pdf/{filename}"
    if row.pdf_url != expected:
        raise HTTPException(404, "Not found")
    dest_dir = os.path.realpath(os.path.join(settings.upload_dir, access.event_id))
    file_path = os.path.realpath(os.path.join(dest_dir, filename))
    if not file_path.startswith(dest_dir + os.sep) or not os.path.isfile(file_path):
        raise HTTPException(404, "Not found")
    return FileResponse(file_path, media_type="application/pdf", filename=f"{row.title}.pdf")


@router.post("/vendor-portal/{raw_token}/contracts/{contract_id}/sign", response_model=schemas.ContractOut)
async def vendor_sign_contract(raw_token: str, contract_id: str, payload: schemas.ContractSignIn, request: Request, db: AsyncSession = Depends(get_db)):
    access = await _portal(db, raw_token)
    row = await _vendor_contract(db, access, contract_id)
    if row.status == "signed":
        raise HTTPException(409, "This contract has already been signed")
    vendor = await _vendor(db, access.event_id, access.vendor_id)

    db.add(models.PlannerContractSignature(
        contract_id=row.id, signer_name=payload.signer_name.strip(),
        ip_address=request.client.host if request.client else None,
        user_agent=(request.headers.get("user-agent") or "")[:500],
    ))
    row.status = "signed"
    row.signed_at = datetime.now(timezone.utc)
    # The payoff of scoping Contracts to Planner vendors: this backfills a
    # field (contract_url) that already existed on PlannerVendor but had no
    # writer before this feature.
    vendor.contract_url = row.pdf_url
    if vendor.status not in ("contracted", "paid"):
        vendor.status = "contracted"
    # Also surface the signed PDF in the general Documents vault, without
    # that feature needing to know anything about Contracts.
    db.add(models.PlannerDocument(
        event_id=access.event_id, vendor_id=access.vendor_id, type="contract",
        name=row.title, file_url=row.pdf_url, status="signed",
    ))
    await db.commit(); await db.refresh(row)
    return await _contract_out(db, row)
