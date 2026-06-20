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

import logging as _logging
_log = _logging.getLogger(__name__)


def set_firebase_disabled(firebase_uid: str | None, disabled: bool) -> None:
    """Disable/enable a Firebase login so a suspended user can't authenticate.
    Best-effort: never breaks the operator action if Firebase is unconfigured."""
    if not firebase_uid:
        return
    try:
        _ensure_firebase()
        firebase_auth.update_user(firebase_uid, disabled=disabled)
    except Exception as e:
        _log.warning("Firebase disable(%s)=%s failed: %s", firebase_uid, disabled, e)


def delete_firebase_user(firebase_uid: str | None) -> None:
    """Delete a Firebase login so a removed account can't sign back in."""
    if not firebase_uid:
        return
    try:
        _ensure_firebase()
        firebase_auth.delete_user(firebase_uid)
    except Exception as e:
        _log.warning("Firebase delete(%s) failed: %s", firebase_uid, e)


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

    # Suspended account → no access (paired with a disabled Firebase user).
    if not user.is_active:
        raise HTTPException(403, "This account has been suspended. Contact support.")

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
    """The caller's role in a given org, or None if not a member. A suspended
    org reports None for non-operators, so every per-event guard denies access."""
    if not org_id:
        return None
    return await db.scalar(
        select(Membership.role)
        .join(Organization, Organization.id == Membership.org_id)
        .where(
            Membership.user_id == user.id, Membership.org_id == org_id,
            Organization.is_active.is_(True),
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


async def require_dashboard_access(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Org owner/admin (or superadmin) always; a staffer only if granted
    can_view_dashboard on this event."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin:
        return user
    role = await _org_role(user, event.org_id, db)
    if role is None:
        raise HTTPException(404, "Event not found")
    if role in ("owner", "admin"):
        return user
    from .models import EventUser
    eu = await db.scalar(select(EventUser).where(
        EventUser.event_id == event_id, EventUser.user_id == user.id))
    if eu and eu.can_view_dashboard:
        return user
    raise HTTPException(403, "You don't have dashboard access for this event.")


async def verify_token_user(token: str, db: AsyncSession) -> User:
    """Resolve a User from a raw Firebase ID token. For SSE/EventSource, which
    can't send an Authorization header so passes the token as a query param.
    Mirrors get_current_user's verification but takes the token as an argument
    (does not provision new accounts)."""
    _ensure_firebase()
    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    firebase_uid = decoded["uid"]
    email = (decoded.get("email") or "").lower()
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_uid))
    if not user and email:
        user = await db.scalar(select(User).where(User.email == email))
    if not user:
        raise HTTPException(403, "User not found")
    if not user.is_active:
        raise HTTPException(403, "This account has been suspended. Contact support.")
    return user


async def user_has_dashboard_access(user: User, event: Event, db: AsyncSession) -> bool:
    """Same rule as require_dashboard_access, but for an already-resolved user
    (used by the token-authenticated SSE stream)."""
    if user.is_platform_superadmin:
        return True
    role = await _org_role(user, event.org_id, db)
    if role in ("owner", "admin"):
        return True
    from .models import EventUser
    eu = await db.scalar(select(EventUser).where(
        EventUser.event_id == event.id, EventUser.user_id == user.id))
    return bool(eu and eu.can_view_dashboard)


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
