from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import User
from ..schemas import UserOut
from ..auth import get_current_user, require_superadmin

router = APIRouter()


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user


@router.get("/google-status")
async def google_status():
    # Google is now handled by Firebase — always available when Firebase is configured
    from ..config import settings
    return {"enabled": bool(settings.firebase_credentials)}


@router.get("/users", response_model=list[UserOut])
async def list_users(_: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return result.scalars().all()


@router.put("/users/{user_id}/role")
async def update_role(
    user_id: str,
    role: str,
    _: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    if role not in ("admin", "official"):
        raise HTTPException(400, "Role must be admin or official")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.role = role
    await db.commit()
    return {"ok": True}
