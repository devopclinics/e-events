from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import (
    Event, MenuCategory, MenuItem, GuestMenuChoice, Guest, User,
    EventUser, MenuCombination, MenuCombinationItem, SeatingTable,
)
from ..schemas import (
    MenuCategoryCreate, MenuCategoryOut, MenuItemCreate, MenuItemOut,
    MenuCombinationCreate, MenuCombinationOut, MenuCombinationItemOut,
    MenuDashboardOut, MenuDashboardGuest, MenuItemTotal, MenuCombinationTotal,
)
from ..auth import require_paid_event_member, is_org_manager

router = APIRouter()


async def _require_menu_access(event_id: str, db: AsyncSession, user: User) -> None:
    event = await db.get(Event, event_id)
    if await is_org_manager(user, event.org_id if event else None, db):
        return
    # Staff need the per-event "manage menu" permission.
    eu = await db.scalar(
        select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == user.id)
    )
    if not eu or not eu.can_manage_menu:
        raise HTTPException(403, "You don't have permission to manage menus for this event")


async def _combo_out(combo: MenuCombination, db: AsyncSession) -> MenuCombinationOut:
    rows = (await db.execute(
        select(MenuCombinationItem, MenuItem)
        .join(MenuItem, MenuItem.id == MenuCombinationItem.menu_item_id)
        .where(MenuCombinationItem.combination_id == combo.id)
    )).all()
    items = [
        MenuCombinationItemOut(menu_item_id=mi.id, name=mi.name, quantity=ci.quantity)
        for ci, mi in rows
    ]
    return MenuCombinationOut(
        id=combo.id,
        name=combo.name,
        description=combo.description,
        sort_order=combo.sort_order,
        items=items,
    )


async def _cat_out(cat: MenuCategory, db: AsyncSession) -> MenuCategoryOut:
    items = (await db.execute(select(MenuItem).where(MenuItem.category_id == cat.id))).scalars().all()
    combos = (await db.execute(
        select(MenuCombination).where(MenuCombination.category_id == cat.id).order_by(MenuCombination.sort_order, MenuCombination.name)
    )).scalars().all()
    combo_outs = [await _combo_out(c, db) for c in combos]
    return MenuCategoryOut(
        id=cat.id,
        event_id=cat.event_id,
        name=cat.name,
        sort_order=cat.sort_order,
        selection_type=cat.selection_type,
        min_selections=cat.min_selections,
        max_selections=cat.max_selections,
        is_required=cat.is_required,
        items=[MenuItemOut(id=i.id, category_id=i.category_id, name=i.name, description=i.description) for i in items],
        combinations=combo_outs,
    )


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/{event_id}/menu-categories", response_model=list[MenuCategoryOut])
async def list_categories(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_member)):
    cats = (await db.execute(select(MenuCategory).where(MenuCategory.event_id == event_id).order_by(MenuCategory.sort_order, MenuCategory.name))).scalars().all()
    return [await _cat_out(c, db) for c in cats]


@router.post("/{event_id}/menu-categories", response_model=MenuCategoryOut, status_code=201)
async def create_category(event_id: str, data: MenuCategoryCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_paid_event_member)):
    await _require_menu_access(event_id, db, current_user)
    if not await db.get(Event, event_id):
        raise HTTPException(404, "Event not found")
    if data.selection_type not in ("single", "multi", "combo"):
        raise HTTPException(400, "selection_type must be single, multi, or combo")
    cat = MenuCategory(
        event_id=event_id,
        name=data.name,
        sort_order=data.sort_order,
        selection_type=data.selection_type,
        min_selections=data.min_selections,
        max_selections=data.max_selections,
        is_required=data.is_required,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return await _cat_out(cat, db)


@router.put("/{event_id}/menu-categories/{category_id}", response_model=MenuCategoryOut)
async def update_category(event_id: str, category_id: str, data: MenuCategoryCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_paid_event_member)):
    await _require_menu_access(event_id, db, current_user)
    cat = await db.get(MenuCategory, category_id)
    if not cat or cat.event_id != event_id:
        raise HTTPException(404, "Category not found")
    if data.selection_type not in ("single", "multi", "combo"):
        raise HTTPException(400, "selection_type must be single, multi, or combo")
    cat.name = data.name
    cat.sort_order = data.sort_order
    cat.selection_type = data.selection_type
    cat.min_selections = data.min_selections
    cat.max_selections = data.max_selections
    cat.is_required = data.is_required
    await db.commit()
    await db.refresh(cat)
    return await _cat_out(cat, db)


@router.delete("/{event_id}/menu-categories/{category_id}", status_code=204)
async def delete_category(event_id: str, category_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_paid_event_member)):
    await _require_menu_access(event_id, db, current_user)
    cat = await db.get(MenuCategory, category_id)
    if not cat or cat.event_id != event_id:
        raise HTTPException(404, "Category not found")
    await db.delete(cat)
    await db.commit()


# ── Items ─────────────────────────────────────────────────────────────────────

@router.post("/{event_id}/menu-categories/{category_id}/items", response_model=MenuItemOut, status_code=201)
async def add_item(event_id: str, category_id: str, data: MenuItemCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_paid_event_member)):
    await _require_menu_access(event_id, db, current_user)
    cat = await db.get(MenuCategory, category_id)
    if not cat or cat.event_id != event_id:
        raise HTTPException(404, "Category not found")
    item = MenuItem(category_id=category_id, event_id=event_id, name=data.name, description=data.description)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return MenuItemOut(id=item.id, category_id=item.category_id, name=item.name, description=item.description)


@router.put("/{event_id}/menu-items/{item_id}", response_model=MenuItemOut)
async def update_item(event_id: str, item_id: str, data: MenuItemCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_paid_event_member)):
    await _require_menu_access(event_id, db, current_user)
    item = await db.get(MenuItem, item_id)
    if not item or item.event_id != event_id:
        raise HTTPException(404, "Item not found")
    item.name = data.name
    item.description = data.description
    await db.commit()
    return MenuItemOut(id=item.id, category_id=item.category_id, name=item.name, description=item.description)


@router.delete("/{event_id}/menu-items/{item_id}", status_code=204)
async def delete_item(event_id: str, item_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_paid_event_member)):
    await _require_menu_access(event_id, db, current_user)
    item = await db.get(MenuItem, item_id)
    if not item or item.event_id != event_id:
        raise HTTPException(404, "Item not found")
    choices = (await db.execute(
        select(GuestMenuChoice).where(GuestMenuChoice.menu_item_id == item_id)
    )).scalars().all()
    for choice in choices:
        await db.delete(choice)
    combo_links = (await db.execute(
        select(MenuCombinationItem).where(MenuCombinationItem.menu_item_id == item_id)
    )).scalars().all()
    for link in combo_links:
        await db.delete(link)
    await db.flush()
    await db.delete(item)
    await db.commit()


# ── Combinations ──────────────────────────────────────────────────────────────

@router.post("/{event_id}/menu-categories/{category_id}/combinations", response_model=MenuCombinationOut, status_code=201)
async def create_combination(event_id: str, category_id: str, data: MenuCombinationCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_paid_event_member)):
    await _require_menu_access(event_id, db, current_user)
    cat = await db.get(MenuCategory, category_id)
    if not cat or cat.event_id != event_id:
        raise HTTPException(404, "Category not found")
    combo = MenuCombination(
        event_id=event_id,
        category_id=category_id,
        name=data.name,
        description=data.description,
        sort_order=data.sort_order,
    )
    db.add(combo)
    await db.flush()
    for ci in data.items:
        item = await db.get(MenuItem, ci.menu_item_id)
        if not item or item.event_id != event_id:
            raise HTTPException(400, f"Invalid menu item: {ci.menu_item_id}")
        db.add(MenuCombinationItem(combination_id=combo.id, menu_item_id=ci.menu_item_id, quantity=ci.quantity))
    await db.commit()
    await db.refresh(combo)
    return await _combo_out(combo, db)


@router.put("/{event_id}/menu-combinations/{combo_id}", response_model=MenuCombinationOut)
async def update_combination(event_id: str, combo_id: str, data: MenuCombinationCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_paid_event_member)):
    await _require_menu_access(event_id, db, current_user)
    combo = await db.get(MenuCombination, combo_id)
    if not combo or combo.event_id != event_id:
        raise HTTPException(404, "Combination not found")
    combo.name = data.name
    combo.description = data.description
    combo.sort_order = data.sort_order
    existing = (await db.execute(
        select(MenuCombinationItem).where(MenuCombinationItem.combination_id == combo.id)
    )).scalars().all()
    for ci in existing:
        await db.delete(ci)
    await db.flush()
    for ci in data.items:
        item = await db.get(MenuItem, ci.menu_item_id)
        if not item or item.event_id != event_id:
            raise HTTPException(400, f"Invalid menu item: {ci.menu_item_id}")
        db.add(MenuCombinationItem(combination_id=combo.id, menu_item_id=ci.menu_item_id, quantity=ci.quantity))
    await db.commit()
    await db.refresh(combo)
    return await _combo_out(combo, db)


@router.delete("/{event_id}/menu-combinations/{combo_id}", status_code=204)
async def delete_combination(event_id: str, combo_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_paid_event_member)):
    await _require_menu_access(event_id, db, current_user)
    combo = await db.get(MenuCombination, combo_id)
    if not combo or combo.event_id != event_id:
        raise HTTPException(404, "Combination not found")
    await db.delete(combo)
    await db.commit()


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get("/{event_id}/menu/summary")
async def menu_summary(event_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_paid_event_member)):
    await _require_menu_access(event_id, db, current_user)
    cats = (await db.execute(select(MenuCategory).where(MenuCategory.event_id == event_id).order_by(MenuCategory.sort_order, MenuCategory.name))).scalars().all()
    result = []
    for cat in cats:
        items = (await db.execute(select(MenuItem).where(MenuItem.category_id == cat.id))).scalars().all()
        item_rows = []
        for item in items:
            count = await db.scalar(select(func.count(GuestMenuChoice.id)).where(GuestMenuChoice.menu_item_id == item.id)) or 0
            item_rows.append({"id": item.id, "name": item.name, "count": count})
        no_choice = await db.scalar(
            select(func.count(Guest.id)).where(
                Guest.event_id == event_id,
                ~Guest.id.in_(select(GuestMenuChoice.guest_id).where(GuestMenuChoice.category_id == cat.id))
            )
        ) or 0
        result.append({"id": cat.id, "category": cat.name, "items": item_rows, "no_choice": no_choice})
    return result


# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/{event_id}/menu/dashboard", response_model=MenuDashboardOut)
async def menu_dashboard(event_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_paid_event_member)):
    await _require_menu_access(event_id, db, current_user)
    if not await db.get(Event, event_id):
        raise HTTPException(404, "Event not found")

    cats = (await db.execute(
        select(MenuCategory).where(MenuCategory.event_id == event_id).order_by(MenuCategory.sort_order, MenuCategory.name)
    )).scalars().all()
    cat_by_id = {c.id: c for c in cats}

    items = (await db.execute(
        select(MenuItem).where(MenuItem.event_id == event_id)
    )).scalars().all()
    item_by_id = {i.id: i for i in items}

    combos = (await db.execute(
        select(MenuCombination).where(MenuCombination.event_id == event_id)
    )).scalars().all()
    combo_by_id = {c.id: c for c in combos}

    combo_items_rows = (await db.execute(
        select(MenuCombinationItem, MenuItem)
        .join(MenuItem, MenuItem.id == MenuCombinationItem.menu_item_id)
        .where(MenuCombinationItem.combination_id.in_([c.id for c in combos]) if combos else MenuCombinationItem.combination_id.is_(None))
    )).all()
    combo_item_names: dict[str, list[str]] = {}
    for ci, mi in combo_items_rows:
        combo_item_names.setdefault(ci.combination_id, []).append(mi.name)

    guests = (await db.execute(
        select(Guest).where(Guest.event_id == event_id).order_by(Guest.last_name, Guest.first_name)
    )).scalars().all()

    tables = (await db.execute(
        select(SeatingTable).where(SeatingTable.event_id == event_id)
    )).scalars().all()
    table_name_by_id = {t.id: t.name for t in tables}

    choices = (await db.execute(
        select(GuestMenuChoice).where(GuestMenuChoice.guest_id.in_([g.id for g in guests]) if guests else GuestMenuChoice.guest_id.is_(None))
    )).scalars().all()

    item_counts: dict[str, int] = {}
    combo_counts: dict[str, int] = {}
    choices_by_guest: dict[str, list[GuestMenuChoice]] = {}
    for ch in choices:
        choices_by_guest.setdefault(ch.guest_id, []).append(ch)
        if ch.menu_item_id:
            item_counts[ch.menu_item_id] = item_counts.get(ch.menu_item_id, 0) + 1
        if ch.combination_id:
            combo_counts[ch.combination_id] = combo_counts.get(ch.combination_id, 0) + 1

    item_totals: list[MenuItemTotal] = []
    for item in items:
        cat = cat_by_id.get(item.category_id)
        item_totals.append(MenuItemTotal(
            item_id=item.id,
            name=item.name,
            category_name=cat.name if cat else "",
            count=item_counts.get(item.id, 0),
        ))

    combination_totals: list[MenuCombinationTotal] = []
    for combo in combos:
        combination_totals.append(MenuCombinationTotal(
            combination_id=combo.id,
            name=combo.name,
            count=combo_counts.get(combo.id, 0),
        ))

    dashboard_guests: list[MenuDashboardGuest] = []
    for g in guests:
        single: dict[str, dict] = {}
        multi: dict[str, dict] = {}
        combo_g: dict[str, dict] = {}
        for ch in choices_by_guest.get(g.id, []):
            cat = cat_by_id.get(ch.category_id)
            if not cat:
                continue
            sel = cat.selection_type
            if sel == "single" and ch.menu_item_id:
                item = item_by_id.get(ch.menu_item_id)
                if item:
                    single[cat.id] = {"item_name": item.name, "category_name": cat.name}
            elif sel == "multi" and ch.menu_item_id:
                item = item_by_id.get(ch.menu_item_id)
                if not item:
                    continue
                bucket = multi.setdefault(cat.id, {"category_name": cat.name, "items": []})
                bucket["items"].append(item.name)
            elif sel == "combo" and ch.combination_id:
                combo = combo_by_id.get(ch.combination_id)
                if not combo:
                    continue
                combo_g[cat.id] = {
                    "category_name": cat.name,
                    "combination_name": combo.name,
                    "items": list(combo_item_names.get(combo.id, [])),
                }

        dashboard_guests.append(MenuDashboardGuest(
            guest_id=g.id,
            name=f"{g.first_name} {g.last_name}".strip(),
            email=g.email,
            table_name=table_name_by_id.get(g.table_id) if g.table_id else None,
            seat_number=g.seat_number,
            admitted=g.admitted,
            meal_served=g.meal_served,
            is_vip=g.is_vip,
            single=single,
            multi=multi,
            combo=combo_g,
        ))

    return MenuDashboardOut(
        item_totals=item_totals,
        combination_totals=combination_totals,
        guests=dashboard_guests,
    )


# ── Public: guest fetches full menu ──────────────────────────────────────────

@router.get("/{event_id}/menu")
async def get_public_menu(event_id: str, db: AsyncSession = Depends(get_db)):
    event = await db.get(Event, event_id)
    if not event or not event.menu_enabled or not event.is_paid:
        raise HTTPException(404, "Menu not available")
    cats = (await db.execute(select(MenuCategory).where(MenuCategory.event_id == event_id).order_by(MenuCategory.sort_order, MenuCategory.name))).scalars().all()
    out = []
    for cat in cats:
        items = (await db.execute(select(MenuItem).where(MenuItem.category_id == cat.id))).scalars().all()
        combos = (await db.execute(
            select(MenuCombination).where(MenuCombination.category_id == cat.id).order_by(MenuCombination.sort_order, MenuCombination.name)
        )).scalars().all()
        combo_payload = []
        for combo in combos:
            rows = (await db.execute(
                select(MenuCombinationItem, MenuItem)
                .join(MenuItem, MenuItem.id == MenuCombinationItem.menu_item_id)
                .where(MenuCombinationItem.combination_id == combo.id)
            )).all()
            combo_payload.append({
                "id": combo.id,
                "name": combo.name,
                "description": combo.description,
                "sort_order": combo.sort_order,
                "items": [{"menu_item_id": mi.id, "name": mi.name, "quantity": ci.quantity} for ci, mi in rows],
            })
        out.append({
            "id": cat.id,
            "name": cat.name,
            "selection_type": cat.selection_type,
            "min_selections": cat.min_selections,
            "max_selections": cat.max_selections,
            "items": [{"id": i.id, "name": i.name, "description": i.description} for i in items],
            "combinations": combo_payload,
        })
    return out
