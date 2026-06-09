import json
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

import uuid

from .database import get_db
from .models import User, Organization, Membership, Event
from .config import settings


def _superadmin_emails() -> set[str]:
    return {e.strip().lower() for e in (settings.superadmin_emails or "").split(",") if e.strip()}

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

    is_super = bool(email) and email in _superadmin_emails()

    if not user:
        # New account → provision a personal Organization and make them its owner.
        user = User(
            name=name, email=email, firebase_uid=firebase_uid, role="official",
            is_platform_superadmin=is_super,
        )
        db.add(user)
        await db.flush()
        org = Organization(
            name=f"{name}'s organization",
            slug=f"org-{uuid.uuid4().hex[:10]}",
        )
        db.add(org)
        await db.flush()
        db.add(Membership(org_id=org.id, user_id=user.id, role="owner"))
        await db.commit()
        await db.refresh(user)
    elif is_super and not user.is_platform_superadmin:
        # Promote an existing account listed in SUPERADMIN_EMAILS.
        user.is_platform_superadmin = True
        await db.commit()
        await db.refresh(user)

    return user


async def require_superadmin(user: User = Depends(get_current_user)) -> User:
    """Operator-only (you). For cross-tenant/global endpoints."""
    if not user.is_platform_superadmin:
        raise HTTPException(403, "Not authorized")
    return user


async def is_org_manager(user: User, org_id: str | None, db: AsyncSession) -> bool:
    """True if the user can manage this org's events (owner/admin or superadmin)."""
    if user.is_platform_superadmin:
        return True
    return (await _org_role(user, org_id, db)) in ("owner", "admin")


async def _org_role(user: User, org_id: str | None, db: AsyncSession) -> str | None:
    """The caller's role in a given org, or None if not a member."""
    if not org_id:
        return None
    return await db.scalar(
        select(Membership.role).where(
            Membership.user_id == user.id, Membership.org_id == org_id
        )
    )


# ── Account-level guards (no specific event in scope) ────────────────────────

async def require_admin(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> User:
    """User is an owner/admin in at least one org (or platform superadmin).
    Per-event tenant isolation is enforced separately by require_event_admin."""
    if user.is_platform_superadmin:
        return user
    has = await db.scalar(
        select(Membership.id).where(
            Membership.user_id == user.id, Membership.role.in_(["owner", "admin"])
        ).limit(1)
    )
    if not has:
        raise HTTPException(403, "Admin access required")
    return user


async def require_official(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> User:
    """User belongs to at least one org (or platform superadmin)."""
    if user.is_platform_superadmin:
        return user
    has = await db.scalar(
        select(Membership.id).where(Membership.user_id == user.id).limit(1)
    )
    if not has:
        raise HTTPException(403, "Access denied")
    return user


# ── Per-event tenant guards (event_id injected from the path) ────────────────

async def require_event_member(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Caller must belong to the event's org (any role) or be superadmin.
    Returns 404 (not 403) for non-members so event existence isn't leaked."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin:
        return user
    if await _org_role(user, event.org_id, db) is None:
        raise HTTPException(404, "Event not found")
    return user


async def require_event_admin(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Caller must be owner/admin of the event's org (or superadmin)."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin:
        return user
    role = await _org_role(user, event.org_id, db)
    if role is None:
        raise HTTPException(404, "Event not found")
    if role not in ("owner", "admin"):
        raise HTTPException(403, "Admin access required")
    return user


_PAID_REQUIRED = "This feature requires an Event Pass — upgrade this event to unlock it."


async def require_paid_event_admin(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Org owner/admin AND the event is on a paid plan (or superadmin)."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin:
        return user
    role = await _org_role(user, event.org_id, db)
    if role is None:
        raise HTTPException(404, "Event not found")
    if role not in ("owner", "admin"):
        raise HTTPException(403, "Admin access required")
    if not event.is_paid:
        raise HTTPException(402, _PAID_REQUIRED)
    return user


async def require_paid_event_member(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Any org member AND the event is on a paid plan (or superadmin)."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin:
        return user
    if await _org_role(user, event.org_id, db) is None:
        raise HTTPException(404, "Event not found")
    if not event.is_paid:
        raise HTTPException(402, _PAID_REQUIRED)
    return user
