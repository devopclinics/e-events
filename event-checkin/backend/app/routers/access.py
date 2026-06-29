"""Venue Access Intelligence add-on — zones, ticket types, and scan analytics.

This module is self-contained and OFF by default (`Event.venue_access_enabled`).
It NEVER touches the legacy check-in flow (`scanner.scan_qr`). The new zone-scan
endpoint lives in scanner.py and reuses the helpers here.
"""
import json
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, Guest, Zone, TicketType, ScanEvent, User
from ..schemas import (
    ZoneCreate, ZoneUpdate, ZoneOut,
    TicketTypeCreate, TicketTypeUpdate, TicketTypeOut,
    GuestTicketAssign, PeakBucket, FlowEdge, JourneyStep,
)
from ..auth import require_paid_event_admin, require_paid_event_member

router = APIRouter()


# ── shared helpers (also used by the zone-scan endpoint in scanner.py) ────────

async def access_event(event_id: str, db: AsyncSession) -> Event:
    ev = await db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    if not ev.venue_access_enabled:
        raise HTTPException(400, "Venue access is not enabled for this event")
    return ev


async def zone_occupancy(zone_id: str, db: AsyncSession) -> int:
    """How many guests are currently inside a zone: non-denied ins minus outs."""
    ins = await db.scalar(select(func.count(ScanEvent.id)).where(
        ScanEvent.zone_id == zone_id, ScanEvent.direction == "in", ScanEvent.denied.is_(False))) or 0
    outs = await db.scalar(select(func.count(ScanEvent.id)).where(
        ScanEvent.zone_id == zone_id, ScanEvent.direction == "out", ScanEvent.denied.is_(False))) or 0
    return max(int(ins) - int(outs), 0)


def _zones_of_ticket(tt: TicketType | None) -> set[str] | None:
    """Allowed zone ids for a ticket type. None = all zones allowed."""
    if not tt or not tt.allowed_zone_ids:
        return None
    try:
        vals = json.loads(tt.allowed_zone_ids)
        return set(vals) if vals else None
    except Exception:
        return None


async def ticket_allows(guest: Guest, zone_id: str, db: AsyncSession) -> tuple[bool, str | None]:
    """(allowed, reason). A guest with no ticket type is unrestricted."""
    if not guest.ticket_type_id:
        return True, None
    tt = await db.get(TicketType, guest.ticket_type_id)
    allowed = _zones_of_ticket(tt)
    if allowed is None or zone_id in allowed:
        return True, None
    return False, f"{tt.name if tt else 'This'} ticket is not valid for this zone"


def _zone_list(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


async def _zone_out(z: Zone, db: AsyncSession) -> ZoneOut:
    return ZoneOut(
        id=z.id, event_id=z.event_id, name=z.name, description=z.description,
        capacity=z.capacity, direction_mode=z.direction_mode, sort_order=z.sort_order,
        is_active=z.is_active, occupancy=await zone_occupancy(z.id, db),
    )


async def _get_zone(event_id: str, zone_id: str, db: AsyncSession) -> Zone:
    z = await db.get(Zone, zone_id)
    if not z or z.event_id != event_id:
        raise HTTPException(404, "Zone not found")
    return z


# ── Zones CRUD ────────────────────────────────────────────────────────────────

@router.get("/{event_id}/zones", response_model=list[ZoneOut])
async def list_zones(event_id: str, db: AsyncSession = Depends(get_db),
                     _: User = Depends(require_paid_event_member)):
    await access_event(event_id, db)
    rows = (await db.execute(select(Zone).where(Zone.event_id == event_id)
                             .order_by(Zone.sort_order, Zone.created_at))).scalars().all()
    return [await _zone_out(z, db) for z in rows]


@router.post("/{event_id}/zones", response_model=ZoneOut, status_code=201)
async def create_zone(event_id: str, data: ZoneCreate, db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_admin)):
    await access_event(event_id, db)
    z = Zone(event_id=event_id, name=data.name, description=data.description,
             capacity=data.capacity, direction_mode=data.direction_mode, sort_order=data.sort_order)
    db.add(z)
    await db.commit()
    await db.refresh(z)
    return await _zone_out(z, db)


@router.put("/{event_id}/zones/{zone_id}", response_model=ZoneOut)
async def update_zone(event_id: str, zone_id: str, data: ZoneUpdate,
                      db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    await access_event(event_id, db)
    z = await _get_zone(event_id, zone_id, db)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(z, k, v)
    await db.commit()
    await db.refresh(z)
    return await _zone_out(z, db)


@router.delete("/{event_id}/zones/{zone_id}", status_code=204)
async def delete_zone(event_id: str, zone_id: str, db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_admin)):
    await access_event(event_id, db)
    z = await _get_zone(event_id, zone_id, db)
    await db.delete(z)
    await db.commit()


# ── Ticket types CRUD ─────────────────────────────────────────────────────────

async def _tt_out(tt: TicketType, db: AsyncSession) -> TicketTypeOut:
    count = await db.scalar(select(func.count(Guest.id)).where(Guest.ticket_type_id == tt.id)) or 0
    return TicketTypeOut(
        id=tt.id, event_id=tt.event_id, name=tt.name, color=tt.color, description=tt.description,
        capacity=tt.capacity, allowed_zone_ids=_zone_list(tt.allowed_zone_ids),
        sort_order=tt.sort_order, is_active=tt.is_active, assigned_count=int(count),
    )


@router.get("/{event_id}/ticket-types", response_model=list[TicketTypeOut])
async def list_ticket_types(event_id: str, db: AsyncSession = Depends(get_db),
                            _: User = Depends(require_paid_event_member)):
    await access_event(event_id, db)
    rows = (await db.execute(select(TicketType).where(TicketType.event_id == event_id)
                             .order_by(TicketType.sort_order, TicketType.created_at))).scalars().all()
    return [await _tt_out(t, db) for t in rows]


@router.post("/{event_id}/ticket-types", response_model=TicketTypeOut, status_code=201)
async def create_ticket_type(event_id: str, data: TicketTypeCreate, db: AsyncSession = Depends(get_db),
                             _: User = Depends(require_paid_event_admin)):
    await access_event(event_id, db)
    tt = TicketType(
        event_id=event_id, name=data.name, color=data.color, description=data.description,
        capacity=data.capacity,
        allowed_zone_ids=json.dumps(data.allowed_zone_ids) if data.allowed_zone_ids else None,
        sort_order=data.sort_order,
    )
    db.add(tt)
    await db.commit()
    await db.refresh(tt)
    return await _tt_out(tt, db)


@router.put("/{event_id}/ticket-types/{tt_id}", response_model=TicketTypeOut)
async def update_ticket_type(event_id: str, tt_id: str, data: TicketTypeUpdate,
                             db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    await access_event(event_id, db)
    tt = await db.get(TicketType, tt_id)
    if not tt or tt.event_id != event_id:
        raise HTTPException(404, "Ticket type not found")
    fields = data.model_dump(exclude_unset=True)
    if "allowed_zone_ids" in fields:
        tt.allowed_zone_ids = json.dumps(fields.pop("allowed_zone_ids")) if fields.get("allowed_zone_ids") else None
        fields.pop("allowed_zone_ids", None)
    for k, v in fields.items():
        setattr(tt, k, v)
    await db.commit()
    await db.refresh(tt)
    return await _tt_out(tt, db)


@router.delete("/{event_id}/ticket-types/{tt_id}", status_code=204)
async def delete_ticket_type(event_id: str, tt_id: str, db: AsyncSession = Depends(get_db),
                             _: User = Depends(require_paid_event_admin)):
    await access_event(event_id, db)
    tt = await db.get(TicketType, tt_id)
    if not tt or tt.event_id != event_id:
        raise HTTPException(404, "Ticket type not found")
    # Unassign from guests first (FK is nullable, no cascade).
    guests = (await db.execute(select(Guest).where(Guest.ticket_type_id == tt_id))).scalars().all()
    for g in guests:
        g.ticket_type_id = None
    await db.delete(tt)
    await db.commit()


@router.put("/{event_id}/guests/{gid}/ticket-type", response_model=TicketTypeOut | None)
async def assign_ticket_type(event_id: str, gid: str, data: GuestTicketAssign,
                             db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    await access_event(event_id, db)
    g = await db.get(Guest, gid)
    if not g or g.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    if data.ticket_type_id:
        tt = await db.get(TicketType, data.ticket_type_id)
        if not tt or tt.event_id != event_id:
            raise HTTPException(404, "Ticket type not found")
        # Capacity: a ticket class holds at most `capacity` guests. Only checked
        # when newly assigning this ticket (re-saving the same one is a no-op).
        if tt.capacity is not None and g.ticket_type_id != tt.id:
            held = await db.scalar(
                select(func.count(Guest.id)).where(
                    Guest.ticket_type_id == tt.id, Guest.id != gid
                )
            ) or 0
            if held >= tt.capacity:
                raise HTTPException(409, f"{tt.name} is sold out (capacity {tt.capacity}).")
    g.ticket_type_id = data.ticket_type_id
    await db.commit()
    if not g.ticket_type_id:
        return None
    tt = await db.get(TicketType, g.ticket_type_id)
    return await _tt_out(tt, db)


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/{event_id}/access/occupancy")
async def occupancy(event_id: str, db: AsyncSession = Depends(get_db),
                    _: User = Depends(require_paid_event_member)):
    await access_event(event_id, db)
    zones = (await db.execute(select(Zone).where(Zone.event_id == event_id, Zone.is_active.is_(True))
                              .order_by(Zone.sort_order))).scalars().all()
    out = []
    total = 0
    for z in zones:
        occ = await zone_occupancy(z.id, db)
        total += occ
        out.append({"id": z.id, "name": z.name, "occupancy": occ, "capacity": z.capacity})
    return {"zones": out, "total_inside": total}


@router.get("/{event_id}/access/peak", response_model=list[PeakBucket])
async def peak(event_id: str, bucket_minutes: int = 15, db: AsyncSession = Depends(get_db),
               _: User = Depends(require_paid_event_member)):
    await access_event(event_id, db)
    bucket_minutes = max(1, min(bucket_minutes, 240))
    rows = (await db.execute(
        select(ScanEvent.scanned_at, ScanEvent.direction)
        .where(ScanEvent.event_id == event_id, ScanEvent.denied.is_(False))
        .order_by(ScanEvent.scanned_at)
    )).all()
    buckets: dict[datetime, list[int]] = defaultdict(lambda: [0, 0])
    for ts, direction in rows:
        if not ts:
            continue
        floored = ts - timedelta(minutes=ts.minute % bucket_minutes, seconds=ts.second, microseconds=ts.microsecond)
        idx = 0 if direction == "in" else 1
        buckets[floored][idx] += 1
    return [PeakBucket(t=k.isoformat(), ins=v[0], outs=v[1]) for k, v in sorted(buckets.items())]


@router.get("/{event_id}/access/flow", response_model=list[FlowEdge])
async def flow(event_id: str, db: AsyncSession = Depends(get_db),
               _: User = Depends(require_paid_event_member)):
    await access_event(event_id, db)
    rows = (await db.execute(
        select(ScanEvent.guest_id, ScanEvent.zone_id, ScanEvent.scanned_at)
        .where(ScanEvent.event_id == event_id, ScanEvent.direction == "in", ScanEvent.denied.is_(False))
        .order_by(ScanEvent.guest_id, ScanEvent.scanned_at)
    )).all()
    names = {z.id: z.name for z in (await db.execute(
        select(Zone).where(Zone.event_id == event_id))).scalars().all()}
    edges: dict[tuple, int] = defaultdict(int)
    seqs: dict[str, list[str]] = defaultdict(list)
    for gid, zid, _ts in rows:
        seqs[gid].append(zid)
    for gid, zs in seqs.items():
        prev = None
        for zid in zs:
            edges[(prev, zid)] += 1
            prev = zid
    out = []
    for (frm, to), cnt in sorted(edges.items(), key=lambda kv: -kv[1]):
        out.append(FlowEdge(from_zone=names.get(frm) if frm else None, to_zone=names.get(to, "?"), count=cnt))
    return out


@router.get("/{event_id}/guests/{gid}/journey", response_model=list[JourneyStep])
async def journey(event_id: str, gid: str, db: AsyncSession = Depends(get_db),
                  _: User = Depends(require_paid_event_member)):
    await access_event(event_id, db)
    rows = (await db.execute(
        select(ScanEvent).where(ScanEvent.event_id == event_id, ScanEvent.guest_id == gid)
        .order_by(ScanEvent.scanned_at)
    )).scalars().all()
    names = {z.id: z.name for z in (await db.execute(
        select(Zone).where(Zone.event_id == event_id))).scalars().all()}
    return [
        JourneyStep(zone_name=names.get(s.zone_id), direction=s.direction,
                    scanned_at=s.scanned_at, denied=s.denied, deny_reason=s.deny_reason)
        for s in rows
    ]
