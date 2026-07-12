"""Logistics / Fulfillment add-on.

Lets an organizer collect each guest's shipping address + size and produce a
packing list for a vendor — as a downloadable spreadsheet and as a tokenized,
read-only public vendor page. The organizer pays the vendor off-platform; no
money flows through here.

Two routers:
  * `router`        — admin/member endpoints, mounted at /api/events, paid-gated.
  * `vendor_router` — public, no-auth, by share_token, mounted at /api/vendor.
"""
import io
import json
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from openpyxl import Workbook

from ..database import get_db
from ..models import Event, Guest, Shipment, GuestShipment, User
from ..schemas import (
    ShipmentCreate, ShipmentUpdate, ShipmentOut,
    GuestShipmentOut, GuestShipmentUpdate, ShippingAddressUpdate, VendorPageOut,
)
from ..auth import require_paid_event_admin, require_paid_event_member
from ..entitlements import can_use_paid_channels, last_credit_ledger_id, take_message_credit
from ..template_resolve import load_overrides, channel_text as template_channel_text, channel_text_or_default, email_or_default
from services import messaging
from services.credit_ledger import send_with_credit_ledger
from services import email_service
from services.templates import build_context as build_template_context

router = APIRouter()
vendor_router = APIRouter()

_XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# ── helpers ───────────────────────────────────────────────────────────────────

def _size_list(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    try:
        val = json.loads(raw)
        return val if isinstance(val, list) else None
    except Exception:
        return None


async def _logi_event(event_id: str, db: AsyncSession) -> Event:
    """Fetch the event and confirm the logistics add-on is enabled.
    (The paid-plan check is already done by the route dependency.)"""
    ev = await db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    if not ev.logistics_enabled:
        raise HTTPException(400, "Logistics is not enabled for this event")
    return ev


async def _get_shipment(event_id: str, sid: str, db: AsyncSession) -> Shipment:
    s = await db.get(Shipment, sid)
    if not s or s.event_id != event_id:
        raise HTTPException(404, "Shipment not found")
    return s


async def _shipment_out(s: Shipment, db: AsyncSession) -> ShipmentOut:
    cnt = await db.scalar(select(func.count(GuestShipment.id)).where(GuestShipment.shipment_id == s.id)) or 0
    return ShipmentOut(
        id=s.id, event_id=s.event_id, name=s.name, phase=s.phase,
        collect_size=s.collect_size, auto_add=s.auto_add, size_options=_size_list(s.size_options),
        notes=s.notes, vendor_name=s.vendor_name, vendor_email=s.vendor_email,
        vendor_phone=s.vendor_phone, share_token=s.share_token,
        sent_at=s.sent_at, viewed_at=s.viewed_at, line_count=cnt, created_at=s.created_at,
    )


def _line_out(line: GuestShipment, g: Guest) -> GuestShipmentOut:
    has_addr = bool(g.ship_address1 or g.ship_city or g.ship_postal)
    return GuestShipmentOut(
        guest_id=g.id, first_name=g.first_name, last_name=g.last_name,
        phone=g.phone, email=g.email,
        ship_address1=g.ship_address1, ship_address2=g.ship_address2,
        ship_city=g.ship_city, ship_state=g.ship_state,
        ship_postal=g.ship_postal, ship_country=g.ship_country,
        has_address=has_addr,
        item=line.item, size=line.size, quantity=line.quantity,
        ship_status=line.ship_status, tracking_number=line.tracking_number,
    )


async def _build_lines(sid: str, db: AsyncSession) -> list[GuestShipmentOut]:
    rows = (await db.execute(
        select(GuestShipment, Guest)
        .join(Guest, Guest.id == GuestShipment.guest_id)
        .where(GuestShipment.shipment_id == sid)
        .order_by(Guest.last_name, Guest.first_name)
    )).all()
    return [_line_out(line, g) for line, g in rows]


def _build_xlsx(shipment_name: str, lines: list[GuestShipmentOut]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Shipping List"
    headers = ["Name", "Phone", "Email", "Address 1", "Address 2", "City",
               "State", "Postal", "Country", "Item", "Size", "Qty", "Status", "Tracking"]
    ws.append(headers)
    for ln in lines:
        ws.append([
            f"{ln.first_name} {ln.last_name}".strip(), ln.phone or "", ln.email or "",
            ln.ship_address1 or "", ln.ship_address2 or "", ln.ship_city or "",
            ln.ship_state or "", ln.ship_postal or "", ln.ship_country or "",
            ln.item or shipment_name, ln.size or "", ln.quantity, ln.ship_status, ln.tracking_number or "",
        ])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _safe_filename(name: str) -> str:
    keep = "".join(c if c.isalnum() or c in "-_ " else "_" for c in name).strip().replace(" ", "_")
    return (keep or "shipping-list") + ".xlsx"


# ── Shipments CRUD ────────────────────────────────────────────────────────────

@router.get("/{event_id}/shipments", response_model=list[ShipmentOut])
async def list_shipments(event_id: str, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_member)):
    await _logi_event(event_id, db)
    rows = (await db.execute(
        select(Shipment).where(Shipment.event_id == event_id).order_by(Shipment.created_at)
    )).scalars().all()
    return [await _shipment_out(s, db) for s in rows]


@router.post("/{event_id}/shipments", response_model=ShipmentOut, status_code=201)
async def create_shipment(event_id: str, data: ShipmentCreate, db: AsyncSession = Depends(get_db),
                          _: User = Depends(require_paid_event_admin)):
    await _logi_event(event_id, db)
    # Default auto-add by phase: pre-event ships to everyone, post-event is curated.
    auto_add = data.auto_add if data.auto_add is not None else (data.phase == "pre")
    s = Shipment(
        event_id=event_id, name=data.name, phase=data.phase,
        collect_size=data.collect_size, auto_add=auto_add,
        size_options=json.dumps(data.size_options) if data.size_options else None,
        notes=data.notes, vendor_name=data.vendor_name,
        vendor_email=data.vendor_email, vendor_phone=data.vendor_phone,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return await _shipment_out(s, db)


@router.put("/{event_id}/shipments/{sid}", response_model=ShipmentOut)
async def update_shipment(event_id: str, sid: str, data: ShipmentUpdate,
                          db: AsyncSession = Depends(get_db),
                          _: User = Depends(require_paid_event_admin)):
    await _logi_event(event_id, db)
    s = await _get_shipment(event_id, sid, db)
    fields = data.model_dump(exclude_unset=True)
    if "size_options" in fields:
        s.size_options = json.dumps(fields.pop("size_options")) if fields["size_options"] else None
        fields.pop("size_options", None)
    for k, v in fields.items():
        setattr(s, k, v)
    await db.commit()
    await db.refresh(s)
    return await _shipment_out(s, db)


@router.delete("/{event_id}/shipments/{sid}", status_code=204)
async def delete_shipment(event_id: str, sid: str, db: AsyncSession = Depends(get_db),
                          _: User = Depends(require_paid_event_admin)):
    await _logi_event(event_id, db)
    s = await _get_shipment(event_id, sid, db)
    await db.delete(s)
    await db.commit()


@router.post("/{event_id}/shipments/{sid}/populate")
async def populate_shipment(event_id: str, sid: str, db: AsyncSession = Depends(get_db),
                            _: User = Depends(require_paid_event_admin)):
    """Add all confirmed guests to this shipment as lines. Idempotent — skips
    guests already on the shipment."""
    await _logi_event(event_id, db)
    await _get_shipment(event_id, sid, db)
    existing = set((await db.execute(
        select(GuestShipment.guest_id).where(GuestShipment.shipment_id == sid)
    )).scalars().all())
    guests = (await db.execute(
        select(Guest).where(Guest.event_id == event_id, Guest.rsvp_status == "confirmed")
    )).scalars().all()
    added = 0
    for g in guests:
        if g.id in existing:
            continue
        db.add(GuestShipment(shipment_id=sid, guest_id=g.id))
        added += 1
    await db.commit()
    return {"added": added}


# ── Per-guest lines ───────────────────────────────────────────────────────────

@router.get("/{event_id}/shipments/{sid}/lines", response_model=list[GuestShipmentOut])
async def list_lines(event_id: str, sid: str, db: AsyncSession = Depends(get_db),
                     _: User = Depends(require_paid_event_member)):
    await _logi_event(event_id, db)
    await _get_shipment(event_id, sid, db)
    return await _build_lines(sid, db)


@router.put("/{event_id}/shipments/{sid}/lines/{gid}", response_model=GuestShipmentOut)
async def update_line(event_id: str, sid: str, gid: str, data: GuestShipmentUpdate,
                      background_tasks: BackgroundTasks,
                      db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_admin)):
    ev = await _logi_event(event_id, db)
    shipment = await _get_shipment(event_id, sid, db)
    line = await db.scalar(
        select(GuestShipment).where(GuestShipment.shipment_id == sid, GuestShipment.guest_id == gid)
    )
    if not line:
        raise HTTPException(404, "Guest is not on this shipment")
    previous_status = line.ship_status
    fields = data.model_dump(exclude_unset=True)
    for k, v in fields.items():
        setattr(line, k, v)
    if fields.get("ship_status") == "shipped" and not line.shipped_at:
        line.shipped_at = datetime.utcnow()
    g = await db.get(Guest, gid)
    if fields.get("ship_status") == "shipped" and previous_status != "shipped" and g:
        overrides = await load_overrides(event_id, db)
        ctx = build_template_context(ev, g, extras={
            "message": shipment.name,
            "tracking_number": line.tracking_number or "",
        })
        if ev.notify_email and g.email:
            subj, body = email_or_default(overrides, "logistics_notification", ctx)
            if body:
                background_tasks.add_task(
                    email_service.send_simple_email,
                    g.email, subj or f"Shipping update — {ev.name}", body, ev.id,
                )
        if (can_use_paid_channels(ev) and ev.notify_sms and g.phone
                and g.sms_consent and take_message_credit(ev, "sms")):
            sms = channel_text_or_default(overrides, "logistics_notification", "sms", ctx)
            if sms:
                background_tasks.add_task(send_with_credit_ledger, last_credit_ledger_id(ev), messaging.send_custom_sms, phone=g.phone, body=sms)
        if (can_use_paid_channels(ev) and ev.notify_whatsapp and g.phone
                and g.whatsapp_consent and take_message_credit(ev, "whatsapp")):
            # WhatsApp initiates the conversation → approved template only; a
            # custom free-text override can't open a session (fails 15003).
            background_tasks.add_task(
                send_with_credit_ledger,
                last_credit_ledger_id(ev),
                messaging.send_logistics_whatsapp,
                phone=g.phone, first_name=g.first_name, event_name=ev.name,
            )
    await db.commit()
    return _line_out(line, g)


@router.post("/{event_id}/shipments/{sid}/lines/{gid}", response_model=GuestShipmentOut, status_code=201)
async def add_line(event_id: str, sid: str, gid: str, data: GuestShipmentUpdate,
                   db: AsyncSession = Depends(get_db),
                   _: User = Depends(require_paid_event_admin)):
    """Add a single guest to a shipment (for hand-picked / curated lists)."""
    await _logi_event(event_id, db)
    await _get_shipment(event_id, sid, db)
    g = await db.get(Guest, gid)
    if not g or g.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    line = await db.scalar(
        select(GuestShipment).where(GuestShipment.shipment_id == sid, GuestShipment.guest_id == gid)
    )
    if not line:
        line = GuestShipment(shipment_id=sid, guest_id=gid)
        db.add(line)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(line, k, v)
    await db.commit()
    await db.refresh(line)
    return _line_out(line, g)


@router.delete("/{event_id}/shipments/{sid}/lines/{gid}", status_code=204)
async def remove_line(event_id: str, sid: str, gid: str, db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_admin)):
    """Remove a guest from a shipment (omit them from this item)."""
    await _logi_event(event_id, db)
    await _get_shipment(event_id, sid, db)
    line = await db.scalar(
        select(GuestShipment).where(GuestShipment.shipment_id == sid, GuestShipment.guest_id == gid)
    )
    if line:
        await db.delete(line)
        await db.commit()


@router.put("/{event_id}/guests/{gid}/shipping", response_model=ShippingAddressUpdate)
async def update_guest_shipping(event_id: str, gid: str, data: ShippingAddressUpdate,
                                db: AsyncSession = Depends(get_db),
                                _: User = Depends(require_paid_event_admin)):
    await _logi_event(event_id, db)
    g = await db.get(Guest, gid)
    if not g or g.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(g, k, (v.strip() if isinstance(v, str) else v) or None)
    await db.commit()
    return ShippingAddressUpdate(
        ship_address1=g.ship_address1, ship_address2=g.ship_address2,
        ship_city=g.ship_city, ship_state=g.ship_state,
        ship_postal=g.ship_postal, ship_country=g.ship_country,
    )


# ── Export + send to vendor ───────────────────────────────────────────────────

@router.get("/{event_id}/shipments/{sid}/export.xlsx")
async def export_shipment(event_id: str, sid: str, db: AsyncSession = Depends(get_db),
                          _: User = Depends(require_paid_event_member)):
    await _logi_event(event_id, db)
    s = await _get_shipment(event_id, sid, db)
    lines = await _build_lines(sid, db)
    data = _build_xlsx(s.name, lines)
    return StreamingResponse(
        io.BytesIO(data), media_type=_XLSX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{_safe_filename(s.name)}"'},
    )


@router.post("/{event_id}/shipments/{sid}/send-to-vendor")
async def send_to_vendor(event_id: str, sid: str, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_admin)):
    ev = await _logi_event(event_id, db)
    s = await _get_shipment(event_id, sid, db)
    if not s.vendor_email:
        raise HTTPException(400, "Add a vendor email to this shipment first")
    lines = await _build_lines(sid, db)
    xlsx = _build_xlsx(s.name, lines)
    base = (ev.checkin_base_url or "").rstrip("/")
    vendor_url = f"{base}/vendor/{s.share_token}"
    await email_service.send_vendor_shipping_email(
        vendor_email=s.vendor_email, vendor_name=s.vendor_name,
        event_name=ev.name, shipment_name=s.name, vendor_url=vendor_url,
        item_count=len(lines), notes=s.notes,
        attachment=xlsx, attachment_name=_safe_filename(s.name),
        event_id=ev.id,
    )
    s.sent_at = datetime.utcnow()
    await db.commit()
    await db.refresh(s)
    return await _shipment_out(s, db)


# ── Public vendor page (no auth, by share_token) ──────────────────────────────

async def _shipment_by_token(share_token: str, db: AsyncSession) -> Shipment:
    s = await db.scalar(select(Shipment).where(Shipment.share_token == share_token))
    if not s:
        raise HTTPException(404, "Shipping list not found")
    return s


@vendor_router.get("/{share_token}", response_model=VendorPageOut)
async def vendor_page(share_token: str, db: AsyncSession = Depends(get_db)):
    s = await _shipment_by_token(share_token, db)
    if not s.viewed_at:
        s.viewed_at = datetime.utcnow()
        await db.commit()
    ev = await db.get(Event, s.event_id)
    lines = await _build_lines(s.id, db)
    return VendorPageOut(
        shipment_name=s.name, phase=s.phase,
        event_name=ev.name if ev else "", notes=s.notes,
        vendor_name=s.vendor_name, collect_size=s.collect_size, lines=lines,
    )


@vendor_router.get("/{share_token}/export.xlsx")
async def vendor_export(share_token: str, db: AsyncSession = Depends(get_db)):
    s = await _shipment_by_token(share_token, db)
    lines = await _build_lines(s.id, db)
    data = _build_xlsx(s.name, lines)
    return StreamingResponse(
        io.BytesIO(data), media_type=_XLSX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{_safe_filename(s.name)}"'},
    )
