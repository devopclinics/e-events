"""Tag-based zone access (isolated add-on).

Customer-defined guest tags → per-zone allow-lists → gate-bound scanning that
auto-detects the zone and evaluates the guest's tags. Completely separate from
the legacy check-in (scan_qr) and the manual zone scan (scan_qr_zone): this
module adds new tables + endpoints and does not modify either existing flow.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (Event, Guest, Zone, ScanEvent, GuestTag, GuestTagLink,
                      ZoneTagRule, Gate, RSVPAnswer, User)
from ..schemas import (GuestTagIn, GuestTagOut, TagIdList, GateIn, GateOut,
                       GateScanRequest, GateScanResult)
from ..auth import require_paid_event_admin, require_paid_event_member, get_current_user
from .access import zone_occupancy   # read-only reuse; access.py doesn't import this

router = APIRouter()


async def _event(event_id: str, db: AsyncSession) -> Event:
    ev = await db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    if not ev.venue_access_enabled:
        raise HTTPException(400, "Venue access is not enabled for this event")
    return ev


async def _tag_count(tag_id: str, db: AsyncSession) -> int:
    return int(await db.scalar(
        select(func.count(GuestTagLink.id)).where(GuestTagLink.tag_id == tag_id)) or 0)


# ── Tags CRUD ────────────────────────────────────────────────────────────────

@router.get("/{event_id}/tags", response_model=list[GuestTagOut])
async def list_tags(event_id: str, db: AsyncSession = Depends(get_db),
                    _: User = Depends(require_paid_event_member)):
    await _event(event_id, db)
    tags = (await db.execute(select(GuestTag).where(GuestTag.event_id == event_id)
                             .order_by(GuestTag.sort_order, GuestTag.name))).scalars().all()
    out = []
    for t in tags:
        o = GuestTagOut.model_validate(t)
        o.guest_count = await _tag_count(t.id, db)
        out.append(o)
    return out


@router.post("/{event_id}/tags", response_model=GuestTagOut, status_code=201)
async def create_tag(event_id: str, data: GuestTagIn, db: AsyncSession = Depends(get_db),
                     _: User = Depends(require_paid_event_admin)):
    await _event(event_id, db)
    tag = GuestTag(event_id=event_id, **data.model_dump())
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return GuestTagOut.model_validate(tag)


@router.put("/{event_id}/tags/{tag_id}", response_model=GuestTagOut)
async def update_tag(event_id: str, tag_id: str, data: GuestTagIn, db: AsyncSession = Depends(get_db),
                     _: User = Depends(require_paid_event_admin)):
    tag = await db.get(GuestTag, tag_id)
    if not tag or tag.event_id != event_id:
        raise HTTPException(404, "Tag not found")
    for k, v in data.model_dump().items():
        setattr(tag, k, v)
    await db.commit()
    await db.refresh(tag)
    o = GuestTagOut.model_validate(tag)
    o.guest_count = await _tag_count(tag.id, db)
    return o


@router.delete("/{event_id}/tags/{tag_id}", status_code=204)
async def delete_tag(event_id: str, tag_id: str, db: AsyncSession = Depends(get_db),
                     _: User = Depends(require_paid_event_admin)):
    tag = await db.get(GuestTag, tag_id)
    if not tag or tag.event_id != event_id:
        raise HTTPException(404, "Tag not found")
    await db.execute(delete(GuestTagLink).where(GuestTagLink.tag_id == tag_id))
    await db.execute(delete(ZoneTagRule).where(ZoneTagRule.tag_id == tag_id))
    await db.delete(tag)
    await db.commit()


# ── Assign tags to a guest ───────────────────────────────────────────────────

@router.get("/{event_id}/guests/{gid}/tags", response_model=list[str])
async def get_guest_tags(event_id: str, gid: str, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_member)):
    return list((await db.execute(
        select(GuestTagLink.tag_id).where(GuestTagLink.guest_id == gid))).scalars())


@router.put("/{event_id}/guests/{gid}/tags", response_model=list[str])
async def set_guest_tags(event_id: str, gid: str, body: TagIdList, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_admin)):
    guest = await db.get(Guest, gid)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    valid = set((await db.execute(
        select(GuestTag.id).where(GuestTag.event_id == event_id))).scalars())
    await db.execute(delete(GuestTagLink).where(GuestTagLink.guest_id == gid))
    for tid in body.tag_ids:
        if tid in valid:
            db.add(GuestTagLink(guest_id=gid, tag_id=tid))
    await db.commit()
    return [t for t in body.tag_ids if t in valid]


@router.post("/{event_id}/tags/sync")
async def sync_rsvp_tags(event_id: str, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_admin)):
    """Auto-assign tags from RSVP answers: for each tag with rsvp_question_id +
    rsvp_value, link every guest whose answer matches. Idempotent."""
    await _event(event_id, db)
    tags = (await db.execute(select(GuestTag).where(
        GuestTag.event_id == event_id, GuestTag.rsvp_question_id.isnot(None)))).scalars().all()
    existing = set((await db.execute(
        select(GuestTagLink.guest_id, GuestTagLink.tag_id)
        .join(GuestTag, GuestTag.id == GuestTagLink.tag_id)
        .where(GuestTag.event_id == event_id))).all())
    added = 0
    for tag in tags:
        gids = (await db.execute(
            select(RSVPAnswer.guest_id).where(
                RSVPAnswer.question_id == tag.rsvp_question_id,
                func.lower(RSVPAnswer.answer) == (tag.rsvp_value or "").strip().lower(),
            ))).scalars().all()
        for gid in gids:
            if (gid, tag.id) not in existing:
                db.add(GuestTagLink(guest_id=gid, tag_id=tag.id))
                existing.add((gid, tag.id))
                added += 1
    await db.commit()
    return {"linked": added}


# ── Zone → allowed tags ──────────────────────────────────────────────────────

@router.get("/{event_id}/zones/{zid}/tags", response_model=list[str])
async def get_zone_tags(event_id: str, zid: str, db: AsyncSession = Depends(get_db),
                        _: User = Depends(require_paid_event_member)):
    return list((await db.execute(
        select(ZoneTagRule.tag_id).where(ZoneTagRule.zone_id == zid))).scalars())


@router.put("/{event_id}/zones/{zid}/tags", response_model=list[str])
async def set_zone_tags(event_id: str, zid: str, body: TagIdList, db: AsyncSession = Depends(get_db),
                        _: User = Depends(require_paid_event_admin)):
    zone = await db.get(Zone, zid)
    if not zone or zone.event_id != event_id:
        raise HTTPException(404, "Zone not found")
    valid = set((await db.execute(
        select(GuestTag.id).where(GuestTag.event_id == event_id))).scalars())
    await db.execute(delete(ZoneTagRule).where(ZoneTagRule.zone_id == zid))
    for tid in body.tag_ids:
        if tid in valid:
            db.add(ZoneTagRule(zone_id=zid, tag_id=tid))
    await db.commit()
    return [t for t in body.tag_ids if t in valid]


# ── Gates CRUD ───────────────────────────────────────────────────────────────

async def _gate_out(g: Gate, db: AsyncSession) -> GateOut:
    zone = await db.get(Zone, g.zone_id)
    o = GateOut.model_validate(g)
    o.zone_name = zone.name if zone else None
    return o


@router.get("/{event_id}/gates", response_model=list[GateOut])
async def list_gates(event_id: str, db: AsyncSession = Depends(get_db),
                     _: User = Depends(require_paid_event_member)):
    await _event(event_id, db)
    gates = (await db.execute(select(Gate).where(Gate.event_id == event_id)
                              .order_by(Gate.created_at))).scalars().all()
    return [await _gate_out(g, db) for g in gates]


@router.post("/{event_id}/gates", response_model=GateOut, status_code=201)
async def create_gate(event_id: str, data: GateIn, db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_admin)):
    await _event(event_id, db)
    zone = await db.get(Zone, data.zone_id)
    if not zone or zone.event_id != event_id:
        raise HTTPException(400, "Zone not found in this event")
    gate = Gate(event_id=event_id, name=data.name, zone_id=data.zone_id, direction=data.direction)
    db.add(gate)
    await db.commit()
    await db.refresh(gate)
    return await _gate_out(gate, db)


@router.put("/{event_id}/gates/{gid}", response_model=GateOut)
async def update_gate(event_id: str, gid: str, data: GateIn, db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_admin)):
    gate = await db.get(Gate, gid)
    if not gate or gate.event_id != event_id:
        raise HTTPException(404, "Gate not found")
    zone = await db.get(Zone, data.zone_id)
    if not zone or zone.event_id != event_id:
        raise HTTPException(400, "Zone not found in this event")
    gate.name, gate.zone_id, gate.direction = data.name, data.zone_id, data.direction
    await db.commit()
    await db.refresh(gate)
    return await _gate_out(gate, db)


@router.delete("/{event_id}/gates/{gid}", status_code=204)
async def delete_gate(event_id: str, gid: str, db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_admin)):
    gate = await db.get(Gate, gid)
    if not gate or gate.event_id != event_id:
        raise HTTPException(404, "Gate not found")
    await db.delete(gate)
    await db.commit()


# ── Gate scan (auto-zone + tag evaluation) ───────────────────────────────────

async def _guest_allowed(guest_id: str, zone_id: str, db: AsyncSession) -> tuple[bool, list[str], str | None]:
    """Tag allow-list check. Zone with no rules admits everyone; otherwise the
    guest needs at least one matching tag."""
    rule_tag_ids = set((await db.execute(
        select(ZoneTagRule.tag_id).where(ZoneTagRule.zone_id == zone_id))).scalars())
    if not rule_tag_ids:
        return True, [], None
    guest_tag_ids = set((await db.execute(
        select(GuestTagLink.tag_id).where(GuestTagLink.guest_id == guest_id))).scalars())
    matched = rule_tag_ids & guest_tag_ids
    if matched:
        names = list((await db.execute(
            select(GuestTag.name).where(GuestTag.id.in_(matched)))).scalars())
        return True, names, None
    return False, [], "Guest's tags don't permit this zone"


@router.post("/{event_id}/gates/{gid}/scan", response_model=GateScanResult)
async def gate_scan(event_id: str, gid: str, body: GateScanRequest,
                    db: AsyncSession = Depends(get_db),
                    user: User = Depends(require_paid_event_member)):
    event = await _event(event_id, db)
    if event.status != "active":
        raise HTTPException(409, f"'{event.name}' is not active. Scanning is disabled.")
    gate = await db.get(Gate, gid)
    if not gate or gate.event_id != event_id or not gate.is_active:
        raise HTTPException(404, "Gate not found")
    guest = (await db.execute(select(Guest).where(Guest.qr_token == body.qr_token))).scalar_one_or_none()
    if not guest or guest.event_id != event_id:
        return GateScanResult(status="invalid", message="Invalid QR for this event.")

    zone = await db.get(Zone, gate.zone_id)
    direction = gate.direction
    allowed, matched, reason = await _guest_allowed(guest.id, gate.zone_id, db)
    denied, deny_reason = (not allowed), reason
    if not denied and direction == "in" and zone and zone.capacity:
        if await zone_occupancy(zone.id, db) >= zone.capacity:
            denied, deny_reason = True, "Zone is at capacity"

    db.add(ScanEvent(event_id=event_id, guest_id=guest.id, zone_id=gate.zone_id,
                     direction=direction, scanned_by=user.id, denied=denied, deny_reason=deny_reason))
    # First allowed entry doubles as check-in (mirrors scan_qr_zone, not shared).
    if not denied and direction == "in" and not guest.admitted:
        guest.admitted = True
        guest.admitted_at = datetime.utcnow()
    await db.commit()

    occ = await zone_occupancy(gate.zone_id, db) if zone else None
    name = f"{guest.first_name} {guest.last_name}".strip()
    if denied:
        return GateScanResult(status="denied", message=f"Denied — {deny_reason}", allowed=False,
                              guest_name=name, zone_name=zone.name if zone else None,
                              direction=direction, occupancy=occ)
    return GateScanResult(status="allowed", message=f"{name} — {direction.upper()} {zone.name if zone else ''}",
                          allowed=True, guest_name=name, zone_name=zone.name if zone else None,
                          direction=direction, occupancy=occ, matched_tags=matched)
