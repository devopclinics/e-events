from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import Event, User, Membership, EventUser
from ..schemas import UserOut
from ..auth import get_current_user, require_superadmin
from ..services.festiome_client import FestioMeClient, FestioMeUnavailable, get_festiome_client

router = APIRouter()


@router.post("/festiome-token")
async def festiome_token(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    client: FestioMeClient = Depends(get_festiome_client),
):
    """Exchange a Festio login and reconcile its event-group memberships."""
    from ..config import settings
    if not settings.festiome_internal_token:
        raise HTTPException(503, "FestioMe authentication is not configured")
    subject = user.firebase_uid or user.id

    # Event access is scoped per event. Owning an unrelated personal org must
    # not make this user a moderator here; explicit assignment maps to the
    # event role, while an owner/admin in this event's org maps to group admin.
    managed = (await db.execute(
        select(Event)
        .join(Membership, Membership.org_id == Event.org_id)
        .where(
            Membership.user_id == user.id,
            Membership.role.in_(["owner", "admin"]),
            Event.festiome_addon_enabled.is_(True),
            Event.festiome_enabled.is_(True),
        )
    )).scalars().all()
    assigned = (await db.execute(
        select(Event, EventUser)
        .join(EventUser, EventUser.event_id == Event.id)
        .where(
            EventUser.user_id == user.id,
            Event.festiome_addon_enabled.is_(True),
            Event.festiome_enabled.is_(True),
        )
    )).all()
    access: dict[str, tuple[Event, str]] = {event.id: (event, "admin") for event in managed}
    for event, event_user in assigned:
        if event.id not in access:
            role = "moderator" if event_user.event_role == "manager" else "member"
            access[event.id] = (event, role)
    if access:
        if not client.configured:
            raise HTTPException(503, "FestioMe integration is not configured")
        try:
            for event, role in access.values():
                await client.upsert_user(
                    event.id,
                    subject=subject,
                    name=user.name,
                    email=user.email,
                    role=role,
                )
        except FestioMeUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": subject,
        "email": user.email,
        "name": user.name,
        "iss": "guesthub",
        "aud": "festiome",
        "iat": now,
        "exp": now + timedelta(minutes=15),
    }, settings.festiome_internal_token, algorithm="HS256")
    return {"token": token, "expires_in": 900}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Effective role reflects org membership so the UI gates on org standing, not
    # the legacy global role: org owner/admin (or superadmin) => "admin".
    is_org_admin = bool(await db.scalar(
        select(Membership.id).where(
            Membership.user_id == user.id, Membership.role.in_(["owner", "admin"])
        ).limit(1)
    ))
    is_event_manager = bool(await db.scalar(
        select(EventUser.id).where(
            EventUser.user_id == user.id,
            EventUser.event_role == "manager",
        ).limit(1)
    ))
    effective_admin = is_org_admin or user.is_platform_superadmin
    role = "admin" if effective_admin else "event_manager" if is_event_manager else "official"
    return UserOut(
        id=user.id, name=user.name, email=user.email,
        role=role,
        created_at=user.created_at,
        is_platform_superadmin=user.is_platform_superadmin,
        is_org_admin=is_org_admin,
    )


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
