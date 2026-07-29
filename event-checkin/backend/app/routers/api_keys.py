"""Org-scoped API key management for the public API (Gatsby gap-backlog item:
'Publish a public API + API-key auth'). Mounted at /api/organizations/me —
same "resolve the org this admin owns" pattern as referrals.py.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import ApiKey, ApiKeyRequestLog, Membership, Organization, User
from ..schemas import ApiKeyCreate, ApiKeyOut, ApiKeyCreated
from ..auth import get_current_user, generate_api_key
from ..billing import org_has_active_subscription
from .admin import DEFAULT_ORG_ID
from .public_api import build_scoped_openapi_schema

router = APIRouter()


async def _owned_org(user: User, db: AsyncSession) -> Organization:
    """The org this user owns. API keys grant programmatic access to that
    org's data, so only an owner mints them — the same bar as who can see
    billing/referrals for the org.

    Prefers a real, deliberately-created org over the legacy shared
    DEFAULT_ORG_ID ("vsgs") — every pre-2026-06-07 user was auto-enrolled as
    a member of that org during the multi-tenancy migration, so picking
    "earliest-created org this user owns" alone would silently operate on
    that shared legacy org instead of the org a multi-org owner is actually
    working in (confirmed bug: a user who owns both ended up creating
    Calendars/Contact Lists under "vsgs" with no indication anywhere in the
    UI). Falls back to DEFAULT_ORG_ID only if it's the only org they own."""
    org_id = await db.scalar(
        select(Membership.org_id)
        .join(Organization, Organization.id == Membership.org_id)
        .where(Membership.user_id == user.id, Membership.role == "owner")
        .order_by(case((Organization.id == DEFAULT_ORG_ID, 1), else_=0), Organization.created_at.asc())
        .limit(1)
    )
    org = await db.get(Organization, org_id) if org_id else None
    if not org:
        raise HTTPException(403, "You must own an organization to manage API keys")
    return org


@router.get("/api-keys", response_model=list[ApiKeyOut])
async def list_api_keys(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _owned_org(user, db)
    rows = (await db.execute(
        select(ApiKey).where(ApiKey.org_id == org.id).order_by(ApiKey.created_at.desc())
    )).scalars().all()
    return rows


@router.post("/api-keys", response_model=ApiKeyCreated, status_code=201)
async def create_api_key(data: ApiKeyCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _owned_org(user, db)
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    if data.scope == "read_write" and not org_has_active_subscription(org):
        raise HTTPException(402, "Read-write API keys require an active API Access subscription. "
                                  "Subscribe in Organization Settings to create one.")
    full_key, prefix, key_hash = generate_api_key()
    row = ApiKey(org_id=org.id, name=name, key_prefix=prefix, key_hash=key_hash,
                 scope=data.scope, created_by_user_id=user.id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ApiKeyCreated(
        id=row.id, name=row.name, key_prefix=row.key_prefix, scope=row.scope, created_at=row.created_at,
        last_used_at=row.last_used_at, revoked_at=row.revoked_at, key=full_key,
    )


@router.delete("/api-keys/{key_id}", status_code=204)
async def revoke_api_key(key_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _owned_org(user, db)
    row = await db.get(ApiKey, key_id)
    if not row or row.org_id != org.id:
        raise HTTPException(404, "API key not found")
    if row.revoked_at is None:
        row.revoked_at = datetime.utcnow()
        await db.commit()


@router.get("/public-api-schema")
async def public_api_schema(request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Scoped OpenAPI schema for the interactive API explorer (a real
    in-app React page, not a bare browsable URL — see ApiExplorerPage.jsx).
    Deliberately NOT reachable via X-API-Key or an unauthenticated route:
    only the org owner, and only once the org has an active API Access
    subscription, can see this — the prose docs (/api-docs, .../v1/docs)
    stay public for anyone evaluating the API before they have access."""
    org = await _owned_org(user, db)
    if not org_has_active_subscription(org):
        raise HTTPException(402, "The interactive API explorer requires an active API Access subscription. "
                                  "Subscribe in Organization Settings to use it.")
    return build_scoped_openapi_schema(request.app)


@router.get("/api-keys/{key_id}/requests")
async def list_api_key_requests(key_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Recent request audit trail for one key — 'what has this integration
    actually been doing', visible to the org that owns it."""
    org = await _owned_org(user, db)
    row = await db.get(ApiKey, key_id)
    if not row or row.org_id != org.id:
        raise HTTPException(404, "API key not found")
    rows = (await db.execute(
        select(ApiKeyRequestLog).where(ApiKeyRequestLog.api_key_id == key_id)
        .order_by(ApiKeyRequestLog.created_at.desc()).limit(100)
    )).scalars().all()
    return [
        {"id": r.id, "method": r.method, "path": r.path, "status_code": r.status_code, "created_at": r.created_at}
        for r in rows
    ]
