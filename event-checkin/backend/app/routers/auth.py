import urllib.parse
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import User
from ..schemas import RegisterRequest, LoginRequest, TokenResponse, UserOut
from ..auth import (
    hash_password,
    verify_password,
    create_token,
    get_current_user,
    require_admin,
    google_enabled,
    google_auth_url,
    exchange_google_code,
    get_google_user_info,
)
from ..config import settings

router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == data.email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")
    user = User(
        name=data.name,
        email=data.email.lower(),
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(access_token=create_token(user), user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == data.email.lower()))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    return TokenResponse(access_token=create_token(user), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user


@router.get("/google")
async def google_login(role: str = "official"):
    if not google_enabled():
        raise HTTPException(503, "Google OAuth not configured")
    state = urllib.parse.quote(role)
    return RedirectResponse(google_auth_url(state=state))


@router.get("/google/callback")
async def google_callback(code: str = "", error: str = "", state: str = "", db: AsyncSession = Depends(get_db)):
    frontend = settings.frontend_url.rstrip("/")

    if error or not code:
        return RedirectResponse(f"{frontend}/login?error=google_denied")

    token_data = await exchange_google_code(code)
    access_token = token_data.get("access_token")
    if not access_token:
        return RedirectResponse(f"{frontend}/login?error=google_failed")

    info = await get_google_user_info(access_token)
    google_id = info.get("id")
    email = (info.get("email") or "").lower()
    name = info.get("name") or email.split("@")[0]

    if not email:
        return RedirectResponse(f"{frontend}/login?error=no_email")

    # Find by google_id first, then by email
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()

    if not user:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            user.google_id = google_id  # link existing account
        else:
            role = urllib.parse.unquote(state) if state in ("admin", "official") else "official"
            user = User(name=name, email=email, google_id=google_id, role=role)
            db.add(user)

    await db.commit()
    await db.refresh(user)
    jwt = create_token(user)
    return RedirectResponse(f"{frontend}/auth/callback?token={jwt}")


@router.get("/users", response_model=list[UserOut])
async def list_users(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return result.scalars().all()


@router.put("/users/{user_id}/role")
async def update_role(user_id: str, role: str, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if role not in ("admin", "official"):
        raise HTTPException(400, "Role must be admin or official")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.role = role
    await db.commit()
    return {"ok": True}
