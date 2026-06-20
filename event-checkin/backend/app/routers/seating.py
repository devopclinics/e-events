from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Event, SeatingTable, Guest, EventUser, User, TableGroup, TableGroupTable
from ..schemas import (
    SeatingTableCreate, SeatingTableOut, SeatAssignRequest,
    TableGroupCreate, TableGroupOut, TableGroupTablesUpdate,
)
from ..auth import require_paid_event_admin, require_paid_event_member, is_org_manager

router = APIRouter()


async def group_table_ids(group_id: str, db: AsyncSession) -> set[str]:
    """Set of table ids that belong to a table group."""
    rows = (await db.execute(
        select(TableGroupTable.table_id).where(TableGroupTable.table_group_id == group_id)
    )).scalars().all()
    return set(rows)


async def _table_out(table: SeatingTable, db: AsyncSession) -> SeatingTableOut:
    count = await db.scalar(select(func.count(Guest.id)).where(Guest.table_id == table.id)) or 0
    return SeatingTableOut(id=table.id, event_id=table.event_id, name=table.name, capacity=table.capacity, category=table.category, assigned_count=count)


def _clean_table_name(name: str) -> str:
    cleaned = " ".join((name or "").split())
    if not cleaned:
        raise HTTPException(400, "Table name is required")
    return cleaned


async def _ensure_unique_table_name(
    event_id: str,
    name: str,
    db: AsyncSession,
    *,
    exclude_id: str | None = None,
) -> str:
    cleaned = _clean_table_name(name)
    conditions = [
        SeatingTable.event_id == event_id,
        func.lower(SeatingTable.name) == cleaned.lower(),
    ]
    if exclude_id:
        conditions.append(SeatingTable.id != exclude_id)
    existing = await db.scalar(
        select(SeatingTable).where(*conditions)
    )
    if existing:
        raise HTTPException(409, f'A table named "{cleaned}" already exists for this event')
    return cleaned


# ── First-come-first-served seat picker (used by scanner.py at admit time) ────

async def _seat_state(table: SeatingTable, db: AsyncSession) -> tuple[set[int], set[int]]:
    """Returns (taken_seats, held_seats) for the table — both as int sets.
    A 'held' seat is one a paired guest is keeping for their unseated partner."""
    rows = (await db.execute(
        select(Guest.seat_number, Guest.held_seat).where(Guest.table_id == table.id)
    )).all()
    taken: set[int] = set()
    held: set[int] = set()
    for seat, hold in rows:
        if seat and seat.isdigit():
            taken.add(int(seat))
        if hold and hold.isdigit():
            held.add(int(hold))
    return taken, held


def _first_free(taken: set[int], held: set[int], capacity: int, skip_held: bool) -> int | None:
    """Lowest seat number in 1..capacity not in taken, optionally skipping held."""
    blocked = taken | held if skip_held else taken
    for n in range(1, capacity + 1):
        if n not in blocked:
            return n
    return None


async def assign_next_seat(guest: Guest, db: AsyncSession) -> None:
    """First-come-first-served seat assignment honoring couple pairings.

    Mutates guest.table_id / guest.seat_number / guest.held_seat in-place.
    Caller is responsible for commit.
    """
    # Already fully seated (table AND seat) — nothing to do.
    if guest.table_id and guest.seat_number:
        return

    # Pre-assigned to a table but no seat yet (e.g. manual table assignment, or
    # after an event reset that cleared seats) — give them a seat inside that
    # table instead of leaving them seatless. (ported from prod)
    if guest.table_id and not guest.seat_number:
        pre_table = await db.get(SeatingTable, guest.table_id)
        if pre_table:
            taken, held = await _seat_state(pre_table, db)
            seat = _first_free(taken, held, pre_table.capacity, skip_held=True)
            if seat is None:
                seat = _first_free(taken, set(), pre_table.capacity, skip_held=False)
            if seat is not None:
                guest.seat_number = str(seat)
        return

    tables = (await db.execute(
        select(SeatingTable).where(SeatingTable.event_id == guest.event_id).order_by(SeatingTable.name)
    )).scalars().all()
    if not tables:
        return  # nothing we can do; admit without seat

    # Table Groups: if this guest is assigned to a group and the event enforces
    # it, restrict the candidate tables to that group's tables. All downstream
    # FCFS/partner/held-seat/capacity logic then operates on this subset, so the
    # existing rules are preserved unchanged. Guests with no group are unaffected.
    if guest.assigned_table_group_id:
        event = await db.get(Event, guest.event_id)
        if event is None or event.enforce_table_groups:
            allowed_ids = await group_table_ids(guest.assigned_table_group_id, db)
            tables = [t for t in tables if t.id in allowed_ids]
            if not tables:
                return  # group has no tables / is full → leave unseated

    partner = await db.get(Guest, guest.partner_guest_id) if guest.partner_guest_id else None

    # Case 1 — partner is already seated. Join their table at the held seat
    # (if there is one), else the next free seat there.
    if partner and partner.table_id:
        partner_table = next((t for t in tables if t.id == partner.table_id), None)
        if partner_table:
            taken, held = await _seat_state(partner_table, db)
            target: int | None = None
            if partner.held_seat and partner.held_seat.isdigit():
                target = int(partner.held_seat)
                if target in taken:
                    target = None  # held seat got taken somehow; fall through
            if target is None:
                target = _first_free(taken, held, partner_table.capacity, skip_held=False)
            if target is not None:
                guest.table_id = partner_table.id
                guest.seat_number = str(target)
                # Release partner's hold now that we're sitting next to them.
                if partner.held_seat == str(target):
                    partner.held_seat = None
                return
        # Partner's table is full — fall through to find any seat for this guest

    # Case 2 — guest is paired but partner not yet arrived: find table with
    # ≥2 contiguous free seats (ignoring held seats — we want a real pair).
    if partner and not partner.table_id:
        for table in tables:
            taken, held = await _seat_state(table, db)
            blocked = taken | held
            for n in range(1, table.capacity):
                if n not in blocked and (n + 1) not in blocked:
                    guest.table_id = table.id
                    guest.seat_number = str(n)
                    guest.held_seat = str(n + 1)
                    return
        # No table has 2 contiguous seats — fall through to solo placement

    # Case 3 — solo guest, or paired fallback: lowest free non-held seat.
    for table in tables:
        taken, held = await _seat_state(table, db)
        seat = _first_free(taken, held, table.capacity, skip_held=True)
        if seat is not None:
            guest.table_id = table.id
            guest.seat_number = str(seat)
            return

    # Last resort: every table is full when held seats are honored.
    # Take a held seat from the lowest table to avoid turning the guest away.
    for table in tables:
        taken, _ = await _seat_state(table, db)
        seat = _first_free(taken, set(), table.capacity, skip_held=False)
        if seat is not None:
            guest.table_id = table.id
            guest.seat_number = str(seat)
            return
    # No capacity anywhere — leave guest unseated.


# ── Tables CRUD ───────────────────────────────────────────────────────────────

@router.get("/{event_id}/tables", response_model=list[SeatingTableOut])
async def list_tables(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_member)):
    result = await db.execute(select(SeatingTable).where(SeatingTable.event_id == event_id).order_by(SeatingTable.name))
    tables = result.scalars().all()
    return [await _table_out(t, db) for t in tables]


@router.post("/{event_id}/tables", response_model=SeatingTableOut, status_code=201)
async def create_table(event_id: str, data: SeatingTableCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    if not await db.get(Event, event_id):
        raise HTTPException(404, "Event not found")
    name = await _ensure_unique_table_name(event_id, data.name, db)
    table = SeatingTable(event_id=event_id, name=name, capacity=data.capacity, category=data.category)
    db.add(table)
    await db.commit()
    await db.refresh(table)
    return SeatingTableOut(id=table.id, event_id=table.event_id, name=table.name, capacity=table.capacity, category=table.category, assigned_count=0)


@router.put("/{event_id}/tables/{table_id}", response_model=SeatingTableOut)
async def update_table(event_id: str, table_id: str, data: SeatingTableCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    table = await db.get(SeatingTable, table_id)
    if not table or table.event_id != event_id:
        raise HTTPException(404, "Table not found")
    table.name = await _ensure_unique_table_name(event_id, data.name, db, exclude_id=table_id)
    table.capacity = data.capacity
    table.category = data.category
    await db.commit()
    await db.refresh(table)
    return await _table_out(table, db)


@router.delete("/{event_id}/tables/{table_id}", status_code=204)
async def delete_table(event_id: str, table_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    table = await db.get(SeatingTable, table_id)
    if not table or table.event_id != event_id:
        raise HTTPException(404, "Table not found")
    # Clear assignments
    guests = (await db.execute(select(Guest).where(Guest.table_id == table_id))).scalars().all()
    for g in guests:
        g.table_id = None
        g.seat_number = None
    await db.delete(table)
    await db.commit()


# ── Table Groups ──────────────────────────────────────────────────────────────

def _clean_group_name(name: str) -> str:
    cleaned = " ".join((name or "").split())
    if not cleaned:
        raise HTTPException(400, "Table group name is required")
    return cleaned


async def _ensure_unique_group_tag(event_id: str, tag: str, db: AsyncSession, *, exclude_id: str | None = None) -> str:
    cleaned = " ".join((tag or "").split())
    if not cleaned:
        raise HTTPException(400, "Table group tag is required")
    conditions = [TableGroup.event_id == event_id, func.lower(TableGroup.tag) == cleaned.lower()]
    if exclude_id:
        conditions.append(TableGroup.id != exclude_id)
    if await db.scalar(select(TableGroup).where(*conditions)):
        raise HTTPException(409, f'A table group with tag "{cleaned}" already exists for this event')
    return cleaned


async def _set_group_tables(group: TableGroup, table_ids: list[str], event_id: str, db: AsyncSession) -> None:
    """Replace a group's member tables. Validates ownership and single-group rule."""
    wanted = [tid for tid in dict.fromkeys(table_ids or [])]  # dedupe, keep order
    for tid in wanted:
        table = await db.get(SeatingTable, tid)
        if not table or table.event_id != event_id:
            raise HTTPException(404, f"Table {tid} not found for this event")
        owner = await db.scalar(
            select(TableGroupTable).where(
                TableGroupTable.table_id == tid,
                TableGroupTable.table_group_id != group.id,
            )
        )
        if owner:
            raise HTTPException(409, f'"{table.name}" already belongs to another table group')
    # Wipe and re-add.
    await db.execute(
        TableGroupTable.__table__.delete().where(TableGroupTable.table_group_id == group.id)
    )
    for tid in wanted:
        db.add(TableGroupTable(table_group_id=group.id, table_id=tid))


async def _group_out(group: TableGroup, db: AsyncSession) -> TableGroupOut:
    table_ids = list(await group_table_ids(group.id, db))
    total_seats = 0
    if table_ids:
        total_seats = await db.scalar(
            select(func.coalesce(func.sum(SeatingTable.capacity), 0)).where(SeatingTable.id.in_(table_ids))
        ) or 0
    assigned = await db.scalar(
        select(func.count(Guest.id)).where(Guest.assigned_table_group_id == group.id)
    ) or 0
    return TableGroupOut(
        id=group.id, event_id=group.event_id, name=group.name, tag=group.tag,
        description=group.description, table_ids=table_ids,
        assigned_guest_count=int(assigned), total_seats=int(total_seats),
        remaining_seats=int(total_seats) - int(assigned),
        over_capacity=int(assigned) > int(total_seats),
    )


@router.get("/{event_id}/table-groups", response_model=list[TableGroupOut])
async def list_table_groups(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_member)):
    groups = (await db.execute(
        select(TableGroup).where(TableGroup.event_id == event_id).order_by(TableGroup.name)
    )).scalars().all()
    return [await _group_out(g, db) for g in groups]


@router.post("/{event_id}/table-groups", response_model=TableGroupOut, status_code=201)
async def create_table_group(event_id: str, data: TableGroupCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    if not await db.get(Event, event_id):
        raise HTTPException(404, "Event not found")
    name = _clean_group_name(data.name)
    tag = await _ensure_unique_group_tag(event_id, data.tag or name, db)
    group = TableGroup(event_id=event_id, name=name, tag=tag, description=data.description)
    db.add(group)
    await db.flush()
    if data.table_ids:
        await _set_group_tables(group, data.table_ids, event_id, db)
    await db.commit()
    await db.refresh(group)
    return await _group_out(group, db)


@router.put("/{event_id}/table-groups/{group_id}", response_model=TableGroupOut)
async def update_table_group(event_id: str, group_id: str, data: TableGroupCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    group = await db.get(TableGroup, group_id)
    if not group or group.event_id != event_id:
        raise HTTPException(404, "Table group not found")
    group.name = _clean_group_name(data.name)
    group.tag = await _ensure_unique_group_tag(event_id, data.tag or group.name, db, exclude_id=group_id)
    group.description = data.description
    if data.table_ids is not None:
        await _set_group_tables(group, data.table_ids, event_id, db)
    await db.commit()
    await db.refresh(group)
    return await _group_out(group, db)


@router.put("/{event_id}/table-groups/{group_id}/tables", response_model=TableGroupOut)
async def set_table_group_tables(event_id: str, group_id: str, data: TableGroupTablesUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    group = await db.get(TableGroup, group_id)
    if not group or group.event_id != event_id:
        raise HTTPException(404, "Table group not found")
    await _set_group_tables(group, data.table_ids, event_id, db)
    await db.commit()
    await db.refresh(group)
    return await _group_out(group, db)


@router.delete("/{event_id}/table-groups/{group_id}", status_code=204)
async def delete_table_group(event_id: str, group_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    group = await db.get(TableGroup, group_id)
    if not group or group.event_id != event_id:
        raise HTTPException(404, "Table group not found")
    assigned = await db.scalar(select(func.count(Guest.id)).where(Guest.assigned_table_group_id == group_id)) or 0
    if assigned:
        raise HTTPException(
            409,
            f"{assigned} guest(s) are assigned to this group — reassign them first, then delete.",
        )
    await db.execute(TableGroupTable.__table__.delete().where(TableGroupTable.table_group_id == group_id))
    await db.delete(group)
    await db.commit()


# ── Seating chart ─────────────────────────────────────────────────────────────

@router.get("/{event_id}/seating")
async def seating_chart(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_member)):
    """Full chart: each table with all seat slots (filled and empty)."""
    tables = (await db.execute(select(SeatingTable).where(SeatingTable.event_id == event_id).order_by(SeatingTable.name))).scalars().all()
    guests = (await db.execute(select(Guest).where(Guest.event_id == event_id, Guest.table_id.isnot(None)))).scalars().all()

    by_table: dict[str, list] = {}
    for g in guests:
        by_table.setdefault(g.table_id, []).append(g)

    chart = []
    for t in tables:
        assigned = sorted(by_table.get(t.id, []), key=lambda g: int(g.seat_number or 0) if (g.seat_number or "").isdigit() else 0)
        seats = []
        assigned_nums = {g.seat_number for g in assigned}
        for i in range(1, t.capacity + 1):
            seat_str = str(i)
            g = next((x for x in assigned if x.seat_number == seat_str), None)
            if g:
                seats.append({"seat": seat_str, "guest_id": g.id, "name": f"{g.first_name} {g.last_name}", "admitted": g.admitted, "meal_served": g.meal_served, "is_vip": g.is_vip})
            else:
                seats.append({"seat": seat_str, "guest_id": None, "name": None, "admitted": False, "meal_served": False})
        # Guests with non-numeric or out-of-range seats
        for g in assigned:
            if g.seat_number not in assigned_nums or not (g.seat_number or "").isdigit() or int(g.seat_number) > t.capacity:
                seats.append({"seat": g.seat_number, "guest_id": g.id, "name": f"{g.first_name} {g.last_name}", "admitted": g.admitted, "meal_served": g.meal_served, "is_vip": g.is_vip})
        chart.append({"id": t.id, "name": t.name, "capacity": t.capacity, "category": t.category, "seats": seats})
    return chart


# ── Auto-assign ───────────────────────────────────────────────────────────────

@router.post("/{event_id}/seating/auto-assign")
async def auto_assign(event_id: str, clear: bool = False, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    if not await db.get(Event, event_id):
        raise HTTPException(404, "Event not found")

    if clear:
        all_g = (await db.execute(select(Guest).where(Guest.event_id == event_id))).scalars().all()
        for g in all_g:
            g.table_id = None
            g.seat_number = None
        await db.flush()

    tables = (await db.execute(select(SeatingTable).where(SeatingTable.event_id == event_id).order_by(SeatingTable.name))).scalars().all()
    if not tables:
        raise HTTPException(400, "No tables defined — create tables first")

    unassigned = (await db.execute(
        select(Guest).where(Guest.event_id == event_id, Guest.table_id.is_(None)).order_by(Guest.last_name, Guest.first_name)
    )).scalars().all()

    # Seat each guest via the shared FCFS picker so table-group restrictions,
    # partner pairing, held seats and capacity are all honored consistently.
    assigned_count = 0
    for guest in unassigned:
        await assign_next_seat(guest, db)
        if guest.table_id:
            assigned_count += 1
        await db.flush()

    await db.commit()
    return {"assigned": assigned_count, "unassigned": len(unassigned) - assigned_count}


# ── Per-guest seat assignment ─────────────────────────────────────────────────

@router.patch("/{event_id}/guests/{guest_id}/seat")
async def assign_seat(
    event_id: str,
    guest_id: str,
    body: SeatAssignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_paid_event_member),
):
    _ev = await db.get(Event, event_id)
    if not await is_org_manager(current_user, _ev.org_id if _ev else None, db):
        eu = await db.scalar(select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == current_user.id))
        if not eu or not eu.can_reassign_seats:
            raise HTTPException(403, "You don't have permission to reassign seats")

    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")

    if body.table_id:
        table = await db.get(SeatingTable, body.table_id)
        if not table or table.event_id != event_id:
            raise HTTPException(404, "Table not found")

        # Table Groups: a grouped guest may only be seated within their group.
        if guest.assigned_table_group_id and (_ev is None or _ev.enforce_table_groups):
            allowed_ids = await group_table_ids(guest.assigned_table_group_id, db)
            if body.table_id not in allowed_ids:
                group = await db.get(TableGroup, guest.assigned_table_group_id)
                gname = group.name if group else "their table group"
                raise HTTPException(
                    409,
                    f"{guest.first_name} {guest.last_name} is assigned to "
                    f"'{gname}' and cannot be seated at this table.",
                )

    guest.table_id = body.table_id
    guest.seat_number = body.seat_number
    await db.commit()
    return {"ok": True, "table_id": guest.table_id, "seat_number": guest.seat_number}


# ── Mark meal served ──────────────────────────────────────────────────────────

@router.patch("/{event_id}/guests/{guest_id}/meal-served")
async def mark_meal_served(
    event_id: str,
    guest_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_paid_event_member),
):
    _ev = await db.get(Event, event_id)
    if not await is_org_manager(current_user, _ev.org_id if _ev else None, db):
        eu = await db.scalar(select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == current_user.id))
        if not eu:
            raise HTTPException(403, "You are not assigned to this event")
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    guest.meal_served = True
    await db.commit()
    return {"ok": True}


# ── Member seat permission ────────────────────────────────────────────────────

@router.patch("/{event_id}/members/{user_id}/permissions")
async def update_member_permissions(
    event_id: str,
    user_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
):
    eu = await db.scalar(select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == user_id))
    if not eu:
        raise HTTPException(404, "Member not found")
    if "can_reassign_seats" in body:
        eu.can_reassign_seats = bool(body["can_reassign_seats"])
    if "can_manage_menu" in body:
        eu.can_manage_menu = bool(body["can_manage_menu"])
    if "can_view_dashboard" in body:
        eu.can_view_dashboard = bool(body["can_view_dashboard"])
    await db.commit()
    return {"ok": True}
