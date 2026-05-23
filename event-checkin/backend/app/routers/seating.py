from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Event, SeatingTable, Guest, EventUser, User
from ..schemas import SeatingTableCreate, SeatingTableOut, SeatAssignRequest
from ..auth import require_admin, get_current_user, require_official

router = APIRouter()


async def _table_out(table: SeatingTable, db: AsyncSession) -> SeatingTableOut:
    count = await db.scalar(select(func.count(Guest.id)).where(Guest.table_id == table.id)) or 0
    return SeatingTableOut(id=table.id, event_id=table.event_id, name=table.name, capacity=table.capacity, assigned_count=count)


# ── Tables CRUD ───────────────────────────────────────────────────────────────

@router.get("/{event_id}/tables", response_model=list[SeatingTableOut])
async def list_tables(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(select(SeatingTable).where(SeatingTable.event_id == event_id).order_by(SeatingTable.name))
    tables = result.scalars().all()
    return [await _table_out(t, db) for t in tables]


@router.post("/{event_id}/tables", response_model=SeatingTableOut, status_code=201)
async def create_table(event_id: str, data: SeatingTableCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    if not await db.get(Event, event_id):
        raise HTTPException(404, "Event not found")
    table = SeatingTable(event_id=event_id, name=data.name, capacity=data.capacity)
    db.add(table)
    await db.commit()
    await db.refresh(table)
    return SeatingTableOut(id=table.id, event_id=table.event_id, name=table.name, capacity=table.capacity, assigned_count=0)


@router.put("/{event_id}/tables/{table_id}", response_model=SeatingTableOut)
async def update_table(event_id: str, table_id: str, data: SeatingTableCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    table = await db.get(SeatingTable, table_id)
    if not table or table.event_id != event_id:
        raise HTTPException(404, "Table not found")
    table.name = data.name
    table.capacity = data.capacity
    await db.commit()
    await db.refresh(table)
    return await _table_out(table, db)


@router.delete("/{event_id}/tables/{table_id}", status_code=204)
async def delete_table(event_id: str, table_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
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
async def seating_chart(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
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
                seats.append({"seat": seat_str, "guest_id": g.id, "name": f"{g.first_name} {g.last_name}", "admitted": g.admitted, "meal_served": g.meal_served})
            else:
                seats.append({"seat": seat_str, "guest_id": None, "name": None, "admitted": False, "meal_served": False})
        # Guests with non-numeric or out-of-range seats
        for g in assigned:
            if g.seat_number not in assigned_nums or not (g.seat_number or "").isdigit() or int(g.seat_number) > t.capacity:
                seats.append({"seat": g.seat_number, "guest_id": g.id, "name": f"{g.first_name} {g.last_name}", "admitted": g.admitted, "meal_served": g.meal_served})
        chart.append({"id": t.id, "name": t.name, "capacity": t.capacity, "seats": seats})
    return chart


# ── Auto-assign ───────────────────────────────────────────────────────────────

@router.post("/{event_id}/seating/auto-assign")
async def auto_assign(event_id: str, clear: bool = False, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(require_official),
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
    _: User = Depends(require_admin),
):
    eu = await db.scalar(select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == user_id))
    if not eu:
        raise HTTPException(404, "Member not found")
    if "can_reassign_seats" in body:
        eu.can_reassign_seats = bool(body["can_reassign_seats"])
    await db.commit()
    return {"ok": True}
