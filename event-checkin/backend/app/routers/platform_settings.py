"""Platform-wide operational toggles, controlled from the operator Console.
Single settings row, created lazily on first read/write."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, PlatformSettings, User
from sqlalchemy import select
from ..schemas import PlatformSettingsOut, PlatformSettingsUpdate
from ..auth import get_current_user, require_superadmin

router = APIRouter()

SINGLETON_ID = "singleton"


async def _get_or_create(db: AsyncSession) -> PlatformSettings:
    row = await db.get(PlatformSettings, SINGLETON_ID)
    if not row:
        row = PlatformSettings(id=SINGLETON_ID)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


@router.get("", response_model=PlatformSettingsOut)
async def get_platform_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _get_or_create(db)


@router.patch("", response_model=PlatformSettingsOut)
async def update_platform_settings(
    body: PlatformSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    row = await _get_or_create(db)
    if body.support_chat_enabled is not None:
        row.support_chat_enabled = body.support_chat_enabled
    if body.clear_addon_promo:
        row.addon_promo_until = None
    elif body.addon_promo_until is not None:
        row.addon_promo_until = body.addon_promo_until.replace(tzinfo=None)
    if body.clear_addon_promo or body.addon_promo_until is not None:
        events = (await db.execute(select(Event))).scalars().all()
        for event in events:
            event.addon_promo_until = row.addon_promo_until
    await db.commit()
    await db.refresh(row)
    return row
