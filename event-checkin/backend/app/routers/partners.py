"""Partner Showcase add-on — a public page listing an event's partners/sponsors,
grouped into admin-managed categories.

Two routers:
  * `router`         — admin endpoints at /api/events, paid-gated + partner_enabled.
  * `partner_router`  — public, no-auth, at /api/partners.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, Partner, PartnerCategory, User
from ..schemas import (
    PartnerCreate, PartnerUpdate, PartnerOut,
    PartnerCategoryCreate, PartnerCategoryUpdate, PartnerCategoryOut,
    PartnerSettingsOut, PartnerPageOut,
)
from ..auth import require_paid_event_admin, require_paid_event_member

router = APIRouter()
partner_router = APIRouter()


# ── helpers ───────────────────────────────────────────────────────────────────

async def _partner_event(event_id: str, db: AsyncSession) -> Event:
    ev = await db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    if not ev.partner_enabled:
        raise HTTPException(400, "Partner Showcase is not enabled for this event")
    return ev


async def ensure_partner_token(event: Event, db: AsyncSession) -> str:
    if not event.partner_token:
        event.partner_token = str(uuid.uuid4())
        await db.commit()
        await db.refresh(event)
    return event.partner_token


async def _category_names(event_id: str, db: AsyncSession) -> dict[str, str]:
    rows = (await db.execute(
        select(PartnerCategory.id, PartnerCategory.name).where(PartnerCategory.event_id == event_id)
    )).all()
    return {row[0]: row[1] for row in rows}


def _partner_out(partner: Partner, category_names: dict[str, str]) -> PartnerOut:
    return PartnerOut(
        id=partner.id, event_id=partner.event_id, name=partner.name,
        category_id=partner.category_id, category_name=category_names.get(partner.category_id),
        logo_url=partner.logo_url, description=partner.description, website_url=partner.website_url,
        sort_order=partner.sort_order, is_active=partner.is_active,
    )


async def _get_partner(event_id: str, partner_id: str, db: AsyncSession) -> Partner:
    partner = await db.get(Partner, partner_id)
    if not partner or partner.event_id != event_id:
        raise HTTPException(404, "Partner not found")
    return partner


async def _get_category(event_id: str, category_id: str, db: AsyncSession) -> PartnerCategory:
    category = await db.get(PartnerCategory, category_id)
    if not category or category.event_id != event_id:
        raise HTTPException(404, "Partner category not found")
    return category


# ── Admin: categories CRUD ──────────────────────────────────────────────────────

@router.get("/{event_id}/partner-categories", response_model=list[PartnerCategoryOut])
async def list_partner_categories(event_id: str, db: AsyncSession = Depends(get_db),
                                  _: User = Depends(require_paid_event_member)):
    await _partner_event(event_id, db)
    rows = (await db.execute(
        select(PartnerCategory).where(PartnerCategory.event_id == event_id)
        .order_by(PartnerCategory.sort_order, PartnerCategory.name)
    )).scalars().all()
    return [PartnerCategoryOut(id=c.id, event_id=c.event_id, name=c.name, sort_order=c.sort_order) for c in rows]


@router.post("/{event_id}/partner-categories", response_model=PartnerCategoryOut, status_code=201)
async def create_partner_category(event_id: str, data: PartnerCategoryCreate, db: AsyncSession = Depends(get_db),
                                  _: User = Depends(require_paid_event_admin)):
    await _partner_event(event_id, db)
    category = PartnerCategory(event_id=event_id, name=data.name, sort_order=data.sort_order)
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return PartnerCategoryOut(id=category.id, event_id=category.event_id, name=category.name, sort_order=category.sort_order)


@router.put("/{event_id}/partner-categories/{category_id}", response_model=PartnerCategoryOut)
async def update_partner_category(event_id: str, category_id: str, data: PartnerCategoryUpdate,
                                  db: AsyncSession = Depends(get_db),
                                  _: User = Depends(require_paid_event_admin)):
    await _partner_event(event_id, db)
    category = await _get_category(event_id, category_id, db)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(category, k, v)
    await db.commit()
    await db.refresh(category)
    return PartnerCategoryOut(id=category.id, event_id=category.event_id, name=category.name, sort_order=category.sort_order)


@router.delete("/{event_id}/partner-categories/{category_id}", status_code=204)
async def delete_partner_category(event_id: str, category_id: str, db: AsyncSession = Depends(get_db),
                                  _: User = Depends(require_paid_event_admin)):
    await _partner_event(event_id, db)
    category = await _get_category(event_id, category_id, db)
    # Partners referencing this category keep their row — category_id just goes
    # NULL, same "soft reference, no cascade surprise" choice as the Program-tab
    # speaker link. They fall back to showing as uncategorized, not disappearing.
    partners = (await db.execute(select(Partner).where(Partner.category_id == category_id))).scalars().all()
    for p in partners:
        p.category_id = None
    await db.delete(category)
    await db.commit()


# ── Admin: partners CRUD ─────────────────────────────────────────────────────────

@router.get("/{event_id}/partners", response_model=list[PartnerOut])
async def list_partners(event_id: str, db: AsyncSession = Depends(get_db),
                        _: User = Depends(require_paid_event_member)):
    await _partner_event(event_id, db)
    rows = (await db.execute(
        select(Partner).where(Partner.event_id == event_id)
        .order_by(Partner.sort_order, Partner.created_at)
    )).scalars().all()
    names = await _category_names(event_id, db)
    return [_partner_out(p, names) for p in rows]


@router.post("/{event_id}/partners", response_model=PartnerOut, status_code=201)
async def create_partner(event_id: str, data: PartnerCreate, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_admin)):
    await _partner_event(event_id, db)
    if data.category_id:
        await _get_category(event_id, data.category_id, db)
    partner = Partner(
        event_id=event_id, name=data.name, category_id=data.category_id, logo_url=data.logo_url,
        description=data.description, website_url=data.website_url, sort_order=data.sort_order,
    )
    db.add(partner)
    await db.commit()
    await db.refresh(partner)
    names = await _category_names(event_id, db)
    return _partner_out(partner, names)


@router.put("/{event_id}/partners/{partner_id}", response_model=PartnerOut)
async def update_partner(event_id: str, partner_id: str, data: PartnerUpdate,
                         db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_admin)):
    await _partner_event(event_id, db)
    partner = await _get_partner(event_id, partner_id, db)
    updates = data.model_dump(exclude_unset=True)
    if updates.get("category_id"):
        await _get_category(event_id, updates["category_id"], db)
    for k, v in updates.items():
        setattr(partner, k, v)
    await db.commit()
    await db.refresh(partner)
    names = await _category_names(event_id, db)
    return _partner_out(partner, names)


@router.delete("/{event_id}/partners/{partner_id}", status_code=204)
async def delete_partner(event_id: str, partner_id: str, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_admin)):
    await _partner_event(event_id, db)
    partner = await _get_partner(event_id, partner_id, db)
    await db.delete(partner)
    await db.commit()


@router.get("/{event_id}/partners/settings", response_model=PartnerSettingsOut)
async def get_partner_settings(event_id: str, db: AsyncSession = Depends(get_db),
                               _: User = Depends(require_paid_event_member)):
    ev = await _partner_event(event_id, db)
    token = await ensure_partner_token(ev, db)
    return PartnerSettingsOut(partner_token=token)


# ── Public partner page (no auth, by unguessable token) ────────────────────────

async def _event_by_partner_token(token: str, db: AsyncSession) -> Event:
    ev = await db.scalar(select(Event).where(Event.partner_token == token))
    if not ev or not ev.partner_enabled:
        raise HTTPException(404, "Partner page not found")
    return ev


@partner_router.get("/{token}", response_model=PartnerPageOut)
async def public_partners(token: str, db: AsyncSession = Depends(get_db)):
    ev = await _event_by_partner_token(token, db)
    categories = (await db.execute(
        select(PartnerCategory).where(PartnerCategory.event_id == ev.id)
        .order_by(PartnerCategory.sort_order, PartnerCategory.name)
    )).scalars().all()
    rows = (await db.execute(
        select(Partner)
        .where(Partner.event_id == ev.id, Partner.is_active.is_(True))
        .order_by(Partner.sort_order, Partner.created_at)
    )).scalars().all()
    names = {c.id: c.name for c in categories}
    return PartnerPageOut(
        event_name=ev.name,
        categories=[PartnerCategoryOut(id=c.id, event_id=c.event_id, name=c.name, sort_order=c.sort_order) for c in categories],
        partners=[_partner_out(p, names) for p in rows],
    )
