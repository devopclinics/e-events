import json

import firebase_admin
from firebase_admin import auth as firebase_auth, credentials
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import get_db
from .models import Event, EventUser, Membership, Organization, User

bearer = HTTPBearer(auto_error=False)
_firebase_app = None


def _ensure_firebase():
    global _firebase_app
    if _firebase_app is not None:
        return
    if not settings.firebase_credentials:
        raise HTTPException(503, "Firebase not configured")
    _firebase_app = firebase_admin.initialize_app(
        credentials.Certificate(json.loads(settings.firebase_credentials))
    )


def _superadmin_emails() -> set[str]:
    return {e.strip().lower() for e in (settings.superadmin_emails or "").split(",") if e.strip()}


async def current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Verifies the same Firebase ID token `backend` issues — no shared secret,
    no network hop back to `backend`. Matches messaging-service's approach."""
    if not creds:
        raise HTTPException(401, "Not authenticated")
    _ensure_firebase()
    try:
        decoded = firebase_auth.verify_id_token(creds.credentials)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    firebase_uid = decoded["uid"]
    email = (decoded.get("email") or "").lower()
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_uid))
    if not user and email:
        user = await db.scalar(select(User).where(User.email == email))
    if not user or not user.is_active:
        raise HTTPException(403, "Access denied")
    return user


async def require_event_admin(
    event_id: str, user: User, db: AsyncSession, request: Request | None = None
) -> Event:
    """Org owner/admin, or an assigned event manager — matches
    `backend`'s require_event_admin (duplicated here since this service reads
    the same tables but never calls back into `backend`)."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin or user.email.lower() in _superadmin_emails():
        return event
    role = await db.scalar(
        select(Membership.role)
        .join(Organization, Organization.id == Membership.org_id)
        .where(
            Membership.user_id == user.id,
            Membership.org_id == event.org_id,
            Organization.is_active.is_(True),
        )
    )
    if role is None:
        raise HTTPException(404, "Event not found")
    if role in ("owner", "admin"):
        return event
    eu = await db.scalar(select(EventUser).where(
        EventUser.event_id == event_id, EventUser.user_id == user.id
    ))
    if not eu or eu.event_role != "manager":
        raise HTTPException(403, "Admin access required")
    return event
