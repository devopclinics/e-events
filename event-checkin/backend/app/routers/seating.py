from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Event, SeatingTable, Guest, EventUser, User
from ..schemas import SeatingTableCreate, SeatingTableOut, SeatAssignRequest
from ..auth import require_paid_event_admin, require_paid_event_member

router = APIRouter()


async def _table_out(table: SeatingTable, db: AsyncSession) -> SeatingTableOut:
    count = await db.scalar(select(func.count(Guest.id)).where(Guest.table_id == table.id)) or 0
    return SeatingTableOut(id=table.id, event_id=table.event_id, name=table.name, capacity=table.capacity, assigned_count=count)


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
    Caller is responsible for commit. No-op if guest already has a table.
    """
    if guest.table_id:
        return

    tables = (await db.execute(
        select(SeatingTable).where(SeatingTable.event_id == guest.event_id).order_by(SeatingTable.name)
    )).scalars().all()
    if not tables:
        return  # nothing we can do; admit without seat

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
    table = SeatingTable(event_id=event_id, name=data.name, capacity=data.capacity)
    db.add(table)
    await db.commit()
    await db.refresh(table)
    return SeatingTableOut(id=table.id, event_id=table.event_id, name=table.name, capacity=table.capacity, assigned_count=0)


@router.put("/{event_id}/tables/{table_id}", response_model=SeatingTableOut)
async def update_table(event_id: str, table_id: str, data: SeatingTableCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    table = await db.get(SeatingTable, table_id)
    if not table or table.event_id != event_id:
        raise HTTPException(404, "Table not found")
    table.name = data.name
    table.capacity = data.capacity
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
        chart.append({"id": t.id, "name": t.name, "capacity": t.capacity, "seats": seats})
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

    # Build ordered slots across all tables
    slots: list[tuple[SeatingTable, str]] = []
    for table in tables:
        current = await db.scalar(select(func.count(Guest.id)).where(Guest.table_id == table.id)) or 0
        for seat in range(current + 1, table.capacity + 1):
            slots.append((table, str(seat)))

    assigned_count = 0
    for guest, (table, seat_num) in zip(unassigned, slots):
        guest.table_id = table.id
        guest.seat_number = seat_num
        assigned_count += 1

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
    if current_user.role != "admin":
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
    if current_user.role == "official":
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
    await db.commit()
    return {"ok": True}
