from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Event, MenuCategory, MenuItem, GuestMenuChoice, Guest, User
from ..schemas import MenuCategoryCreate, MenuCategoryOut, MenuItemCreate, MenuItemOut, GuestMenuSubmit
from ..auth import require_admin

router = APIRouter()


async def _cat_out(cat: MenuCategory, db: AsyncSession) -> MenuCategoryOut:
    items = (await db.execute(select(MenuItem).where(MenuItem.category_id == cat.id))).scalars().all()
    return MenuCategoryOut(
        id=cat.id, event_id=cat.event_id, name=cat.name, sort_order=cat.sort_order,
        items=[MenuItemOut(id=i.id, category_id=i.category_id, name=i.name, description=i.description) for i in items],
    )


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/{event_id}/menu-categories", response_model=list[MenuCategoryOut])
async def list_categories(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    cats = (await db.execute(select(MenuCategory).where(MenuCategory.event_id == event_id).order_by(MenuCategory.sort_order, MenuCategory.name))).scalars().all()
    return [await _cat_out(c, db) for c in cats]


@router.post("/{event_id}/menu-categories", response_model=MenuCategoryOut, status_code=201)
async def create_category(event_id: str, data: MenuCategoryCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    if not await db.get(Event, event_id):
        raise HTTPException(404, "Event not found")
    cat = MenuCategory(event_id=event_id, name=data.name, sort_order=data.sort_order)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return MenuCategoryOut(id=cat.id, event_id=cat.event_id, name=cat.name, sort_order=cat.sort_order, items=[])


@router.put("/{event_id}/menu-categories/{category_id}", response_model=MenuCategoryOut)
async def update_category(event_id: str, category_id: str, data: MenuCategoryCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    cat = await db.get(MenuCategory, category_id)
    if not cat or cat.event_id != event_id:
        raise HTTPException(404, "Category not found")
    cat.name = data.name
    cat.sort_order = data.sort_order
    await db.commit()
    await db.refresh(cat)
    return await _cat_out(cat, db)


@router.delete("/{event_id}/menu-categories/{category_id}", status_code=204)
async def delete_category(event_id: str, category_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    cat = await db.get(MenuCategory, category_id)
    if not cat or cat.event_id != event_id:
        raise HTTPException(404, "Category not found")
    await db.delete(cat)
    await db.commit()


# ── Items ─────────────────────────────────────────────────────────────────────

@router.post("/{event_id}/menu-categories/{category_id}/items", response_model=MenuItemOut, status_code=201)
async def add_item(event_id: str, category_id: str, data: MenuItemCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    cat = await db.get(MenuCategory, category_id)
    if not cat or cat.event_id != event_id:
        raise HTTPException(404, "Category not found")
    item = MenuItem(category_id=category_id, event_id=event_id, name=data.name, description=data.description)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return MenuItemOut(id=item.id, category_id=item.category_id, name=item.name, description=item.description)


@router.put("/{event_id}/menu-items/{item_id}", response_model=MenuItemOut)
async def update_item(event_id: str, item_id: str, data: MenuItemCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    item = await db.get(MenuItem, item_id)
    if not item or item.event_id != event_id:
        raise HTTPException(404, "Item not found")
    item.name = data.name
    item.description = data.description
    await db.commit()
    return MenuItemOut(id=item.id, category_id=item.category_id, name=item.name, description=item.description)


@router.delete("/{event_id}/menu-items/{item_id}", status_code=204)
async def delete_item(event_id: str, item_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    item = await db.get(MenuItem, item_id)
    if not item or item.event_id != event_id:
        raise HTTPException(404, "Item not found")
    await db.delete(item)
    await db.commit()


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get("/{event_id}/menu/summary")
async def menu_summary(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
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


# ── Public: guest fetches full menu ──────────────────────────────────────────

@router.get("/{event_id}/menu")
async def get_public_menu(event_id: str, db: AsyncSession = Depends(get_db)):
    event = await db.get(Event, event_id)
    if not event or not event.menu_enabled:
        raise HTTPException(404, "Menu not available")
    cats = (await db.execute(select(MenuCategory).where(MenuCategory.event_id == event_id).order_by(MenuCategory.sort_order, MenuCategory.name))).scalars().all()
    out = []
    for cat in cats:
        items = (await db.execute(select(MenuItem).where(MenuItem.category_id == cat.id))).scalars().all()
        out.append({"id": cat.id, "name": cat.name, "items": [{"id": i.id, "name": i.name, "description": i.description} for i in items]})
    return out


