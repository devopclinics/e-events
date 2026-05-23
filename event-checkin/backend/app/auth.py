import json
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .database import get_db
from .models import User
from .config import settings

_firebase_app = None


def _ensure_firebase():
    global _firebase_app
    if _firebase_app is not None:
        return
    if not settings.firebase_credentials:
        raise HTTPException(503, "Firebase not configured — set FIREBASE_CREDENTIALS in .env")
    cred_data = json.loads(settings.firebase_credentials)
    cred = credentials.Certificate(cred_data)
    _firebase_app = firebase_admin.initialize_app(cred)


bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not creds:
        raise HTTPException(401, "Not authenticated")

    _ensure_firebase()
    try:
        decoded = firebase_auth.verify_id_token(creds.credentials)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    firebase_uid = decoded["uid"]
    email = (decoded.get("email") or "").lower()
    name = decoded.get("name") or (decoded.get("email") or "user").split("@")[0]

    # Look up by firebase_uid first
    result = await db.execute(select(User).where(User.firebase_uid == firebase_uid))
    user = result.scalar_one_or_none()

    if not user and email:
        # Link existing account by email on first Firebase sign-in
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            user.firebase_uid = firebase_uid
            await db.commit()

    if not user:
        user = User(name=name, email=email, firebase_uid=firebase_uid, role="official")
        db.add(user)
        await db.commit()
        await db.refresh(user)

    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")
    return user


async def require_official(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("admin", "official"):
        raise HTTPException(403, "Access denied")
    return user
