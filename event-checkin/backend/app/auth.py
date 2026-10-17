import asyncio
import hashlib
import json
import secrets
from urllib.parse import unquote
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError, MultipleResultsFound

import uuid

from .database import get_db
from .models import User, Organization, Membership, Event, EventUser, ApiKey
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


async def _capture_registration(
    db: AsyncSession, user: User, request: Request, *, email_verified: bool = False,
) -> None:
    """Capture signup and its explicit consent once, including auth-state races.

    Firebase's auth listener can provision the user before the signup page sends
    its checkbox values. A separate stable consent event allows that second
    request, without letting later logins replay an old grant after opt-out.
    """
    from .services.marketing_client import ingest_marketing_lead, lifecycle_event_id
    try:
        raw = request.headers.get("x-festio-attribution", "")
        attribution = json.loads(unquote(raw)) if len(raw) <= 10000 else {}
    except (ValueError, TypeError):
        attribution = {}
    if not isinstance(attribution, dict):
        attribution = {}
    # Proof is supplied only by the current verified token, never attribution.
    # Version both namespaces: an old immutable outbox row without proof must
    # not prevent a later verified capture, or become verified retroactively.
    email_verified = email_verified is True
    identity_namespace = "verified-email-v2" if email_verified else "unverified-email-v2"
    # Match the Marketing schema so valid signup capture cannot be stranded
    # by overlong attribution supplied in a browser header.
    attribution_limits = {"source": 100, "medium": 100, "campaign": 160, "referrer": 500, "landing_page": 500}
    fields = {
        key: attribution[key][:limit] for key, limit in attribution_limits.items()
        if isinstance(attribution.get(key), str) and attribution[key]
    }
    await ingest_marketing_lead(
        db, user, stage="registered", registered_at=user.created_at.isoformat() if user.created_at else None,
        event_id=lifecycle_event_id("registered", user.id, identity_namespace),
        # No header means no new acquisition claim. Marketing supplies its
        # website default only when creating a lead, not on identity refresh.
        email_verified=email_verified, **fields,
    )
    consent = {
        key: attribution[key] for key in ("consent_email", "consent_sms", "consent_whatsapp")
        if type(attribution.get(key)) is bool
    }
    if consent:
        await ingest_marketing_lead(
            db, user, stage="registered", lifecycle_event="signup_consent", **fields, **consent,
            event_id=lifecycle_event_id("signup_consent", user.id, identity_namespace),
            email_verified=email_verified,
        )


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    # Request-local provenance must never survive from another token, request,
    # or a cached ORM User. Email-authority routes require this exact identity.
    request.state.verified_email_identity = None
    if not creds:
        raise HTTPException(401, "Not authenticated")

    _ensure_firebase()
    try:
        # verify_id_token is a synchronous, CPU-bound crypto call. Off-loading it
        # to a thread keeps the single event loop free to serve other requests
        # (critical once multiple requests hit auth concurrently).
        decoded = await asyncio.to_thread(firebase_auth.verify_id_token, creds.credentials)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    firebase_uid = decoded["uid"]
    email = (decoded.get("email") or "").lower()
    email_verified = decoded.get("email_verified") is True
    name = decoded.get("name") or (decoded.get("email") or "user").split("@")[0]

    # Look up by firebase_uid first
    result = await db.execute(select(User).where(User.firebase_uid == firebase_uid))
    user = result.scalar_one_or_none()

    if not user and email:
        # Even unverified claims must check collisions rather than creating a
        # duplicate account. Matching an email alone never proves ownership.
        result = await db.execute(select(User).where(func.lower(User.email) == email))
        try:
            user = result.scalar_one_or_none()
        except MultipleResultsFound:
            raise HTTPException(409, "This email matches more than one account. Contact support.") from None
        if user:
            if not email_verified:
                raise HTTPException(403, "Verify your email before linking an existing account, then sign in again.")
            if user.firebase_uid is not None and user.firebase_uid != firebase_uid:
                raise HTTPException(409, "This email is already linked to another sign-in account. Contact support.")
            if user.firebase_uid is None:
                # Compare-and-set prevents two first sign-ins from overwriting
                # each other's link after both observed an unlinked account.
                try:
                    await db.execute(update(User).where(
                        User.id == user.id, User.firebase_uid.is_(None), func.lower(User.email) == email,
                    ).values(firebase_uid=firebase_uid).execution_options(synchronize_session=False))
                except IntegrityError:
                    await db.rollback()
                    raise HTTPException(409, "Account changed during sign-in. Please sign in again.") from None
                await db.refresh(user)
                if user.firebase_uid != firebase_uid:
                    raise HTTPException(409, "This email is already linked to another sign-in account. Contact support.")
            await db.commit()

    # A UID-first login remains valid if Firebase's email changed, but it must
    # not attest to the stale local address or grant an email-based privilege.
    trusted_email = bool(email) and email_verified and (not user or user.email.lower() == email)
    is_super = trusted_email and email in _superadmin_emails()

    created_user = not user
    if not user:
        # New account → provision a personal Organization and make them its owner.
        user = User(
            name=name, email=email, firebase_uid=firebase_uid, role="official",
            is_platform_superadmin=is_super,
        )
        db.add(user)
        try:
            await db.flush()
        except IntegrityError:
            # Another request may have provisioned this UID/email after the
            # initial reads. Fail closed; a retry resolves through UID first.
            await db.rollback()
            raise HTTPException(409, "Account changed during sign-in. Please sign in again.") from None
        org = Organization(
            name=f"{name}'s organization",
            slug=f"org-{uuid.uuid4().hex[:10]}",
        )
        db.add(org)
        await db.flush()
        db.add(Membership(org_id=org.id, user_id=user.id, role="owner"))
        await _capture_registration(db, user, request, email_verified=trusted_email)
        await db.commit()
        await db.refresh(user)
    elif is_super and not user.is_platform_superadmin:
        # Promote an existing account listed in SUPERADMIN_EMAILS.
        user.is_platform_superadmin = True
        await db.commit()
        await db.refresh(user)

    if decoded.get("name") and user.name in {None, "", email.split("@")[0]}:
        user.name = decoded["name"]
        await db.commit()

    # Suspended account → no access (paired with a disabled Firebase user).
    if not user.is_active:
        raise HTTPException(403, "This account has been suspended. Contact support.")

    if trusted_email:
        request.state.verified_email_identity = (user.id, email)

    if not created_user:
        # Local idempotent capture only. No untracked task or Marketing HTTP is
        # launched from authentication, and repeat logins retain the first row.
        await _capture_registration(db, user, request, email_verified=trusted_email)
        await db.commit()

    return user


async def require_verified_current_email(
    request: Request, user: User = Depends(get_current_user),
) -> User:
    """Allow email-based authority only with proof from this request's token."""
    expected = (user.id, user.email.lower())
    if not user.email or getattr(request.state, "verified_email_identity", None) != expected:
        raise HTTPException(403, "Verify your current email address, then sign in again to use Marketing.")
    return user


async def get_current_user_optional(
    request: Request,
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Like get_current_user, but returns None instead of raising when there's
    no token or it's invalid/expired -- for public endpoints (e.g. the pricing
    page) that behave differently for a signed-in viewer without requiring
    auth. Never use this where the caller needs to trust the identity for a
    security decision; only for "is someone signed in" display logic."""
    if not creds:
        return None
    try:
        return await get_current_user(request=request, creds=creds, db=db)
    except HTTPException:
        return None


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
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Caller must be org owner/admin, or an assigned event manager.

    Event managers are scoped to this one event. access_level=view can use
    read-only GET/HEAD/OPTIONS routes; access_level=edit can mutate setup.
    """
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin:
        return user
    role = await _org_role(user, event.org_id, db)
    if role is None:
        raise HTTPException(404, "Event not found")
    if role not in ("owner", "admin"):
        eu = await db.scalar(select(EventUser).where(
            EventUser.event_id == event_id, EventUser.user_id == user.id
        ))
        if not eu or eu.event_role != "manager":
            raise HTTPException(403, "Admin access required")
        if (eu.access_level or "edit") != "edit" and request.method not in ("GET", "HEAD", "OPTIONS"):
            raise HTTPException(403, "This event access is view-only.")
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
    eu = await db.scalar(select(EventUser).where(
        EventUser.event_id == event_id, EventUser.user_id == user.id))
    if eu and (eu.can_view_dashboard or eu.event_role == "manager"):
        return user
    raise HTTPException(403, "You don't have dashboard access for this event.")


async def require_guest_view_access(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Allow read-only guest-directory access without granting event admin.

    Org owners/admins and event managers always qualify. An assigned official
    qualifies only when the event owner explicitly enables can_view_guests.
    """
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
    eu = await db.scalar(select(EventUser).where(
        EventUser.event_id == event_id, EventUser.user_id == user.id
    ))
    if eu and (eu.event_role == "manager" or eu.can_view_guests or eu.can_manage_guests):
        return user
    raise HTTPException(403, "You don't have permission to view guests for this event.")


async def require_guest_manage_access(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Allow guest operations without granting general event administration."""
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
    eu = await db.scalar(select(EventUser).where(
        EventUser.event_id == event_id, EventUser.user_id == user.id
    ))
    if eu and (eu.event_role == "manager" or eu.can_manage_guests):
        return user
    raise HTTPException(403, "You don't have permission to manage guests for this event.")


async def verify_token_user(token: str, db: AsyncSession) -> User:
    """Resolve a User from a raw Firebase ID token. For SSE/EventSource, which
    can't send an Authorization header so passes the token as a query param.
    Mirrors get_current_user's verification but takes the token as an argument
    (does not provision new accounts)."""
    _ensure_firebase()
    try:
        decoded = await asyncio.to_thread(firebase_auth.verify_id_token, token)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    firebase_uid = decoded["uid"]
    email = (decoded.get("email") or "").lower()
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_uid))
    if not user and email:
        if decoded.get("email_verified") is not True:
            raise HTTPException(403, "Verify your email before linking an existing account, then sign in again.")
        result = await db.execute(select(User).where(func.lower(User.email) == email))
        try:
            user = result.scalar_one_or_none()
        except MultipleResultsFound:
            raise HTTPException(409, "This email matches more than one account. Contact support.") from None
        if user and user.firebase_uid is not None and user.firebase_uid != firebase_uid:
            raise HTTPException(409, "This email is already linked to another sign-in account. Contact support.")
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
    eu = await db.scalar(select(EventUser).where(
        EventUser.event_id == event.id, EventUser.user_id == user.id))
    return bool(eu and (eu.can_view_dashboard or eu.event_role == "manager"))


_PAID_REQUIRED = "This feature requires an Event Pass — upgrade this event to unlock it."


async def require_paid_event_admin(
    event_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Org owner/admin or event manager, and the event is paid.

    View-only event managers can read paid setup data but not mutate it.
    """
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if user.is_platform_superadmin:
        return user
    role = await _org_role(user, event.org_id, db)
    if role is None:
        raise HTTPException(404, "Event not found")
    if role not in ("owner", "admin"):
        eu = await db.scalar(select(EventUser).where(
            EventUser.event_id == event_id, EventUser.user_id == user.id
        ))
        if not eu or eu.event_role != "manager":
            raise HTTPException(403, "Admin access required")
        if (eu.access_level or "edit") != "edit" and request.method not in ("GET", "HEAD", "OPTIONS"):
            raise HTTPException(403, "This event access is view-only.")
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


# ── Public API key auth (programmatic access, no Firebase token) ────────────

API_KEY_HEADER = "X-API-Key"
_API_KEY_PREFIX = "fk_live_"


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    """Returns (full_key, key_prefix, key_hash). The full key is returned to
    the caller exactly once (at creation) — only the hash is persisted."""
    full_key = _API_KEY_PREFIX + secrets.token_urlsafe(32)
    return full_key, full_key[:16], hash_api_key(full_key)


async def require_api_key(request: Request, db: AsyncSession = Depends(get_db)) -> ApiKey:
    """Authenticates a public-API request via the X-API-Key header — a
    separate credential type from the Firebase bearer tokens the rest of the
    app uses, so a leaked API key can never be used to sign into the product
    itself, and vice versa. Stashes the key + org id on request.state so a
    rate-limit dependency declared after this one can bucket by key."""
    raw = request.headers.get(API_KEY_HEADER)
    if not raw:
        raise HTTPException(401, f"Missing {API_KEY_HEADER} header")
    api_key = await db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_api_key(raw)))
    if not api_key or api_key.revoked_at is not None:
        raise HTTPException(401, "Invalid or revoked API key")
    api_key.last_used_at = datetime.utcnow()
    await db.commit()
    request.state.api_key_id = api_key.id
    request.state.api_key_org_id = api_key.org_id
    return api_key


async def require_read_write_api_key(api_key: ApiKey = Depends(require_api_key)) -> ApiKey:
    """Same auth as require_api_key, but the key must additionally carry
    read_write scope — used on the public API's guest write endpoints, which
    a plain (read-only) key must not be able to reach."""
    if api_key.scope != "read_write":
        raise HTTPException(403, "This API key is read-only. Create a read-write key to use this endpoint.")
    return api_key
