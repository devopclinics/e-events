from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import Event, User, Membership, EventUser, Organization
from ..schemas import UserOut
from ..auth import get_current_user, require_superadmin, _org_role
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


@router.post("/planner-token")
async def planner_token(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mint a short-lived scoped token for the standalone planner-service —
    same token-exchange pattern as /festiome-token. The frontend calls this
    once per planner session and then talks to planner-service directly."""
    from ..config import settings
    if not settings.planner_internal_token:
        raise HTTPException(503, "Planner is not configured")
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    subject = user.firebase_uid or user.id
    role: str | None = None
    capabilities: list[str] = []
    if user.is_platform_superadmin:
        role = "admin"
    else:
        org_role = await _org_role(user, event.org_id, db)
        if org_role in ("owner", "admin"):
            role = "admin"
        else:
            eu = await db.scalar(select(EventUser).where(
                EventUser.event_id == event_id, EventUser.user_id == user.id
            ))
            if eu:
                if eu.event_role == "manager":
                    role = "admin"
                elif eu.can_view_planner:
                    role = "member"
                    capabilities = [
                        name for allowed, name in (
                            (eu.can_manage_planner_tasks, "tasks"),
                            (eu.can_manage_planner_budget, "budget"),
                            (eu.can_manage_planner_vendors, "vendors"),
                            (eu.can_manage_planner_documents, "documents"),
                            (eu.can_manage_planner_runsheet, "runsheet"),
                        ) if allowed
                    ]
    if role is None:
        raise HTTPException(404, "Event not found")
    if role == "admin":
        capabilities = ["tasks", "budget", "vendors", "documents", "runsheet"]
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": subject,
        "email": user.email,
        "name": user.name,
        "event_id": event.id,
        "org_id": event.org_id,
        "role": role,
        "capabilities": capabilities,
        "is_platform_superadmin": bool(user.is_platform_superadmin),
        "iss": "guesthub",
        "aud": "planner",
        "iat": now,
        "exp": now + timedelta(minutes=15),
    }, settings.planner_internal_token, algorithm="HS256")
    return {"token": token, "expires_in": 900}


@router.post("/marketing-token")
async def marketing_token(user: User = Depends(get_current_user)):
    """Mint identity-only access for the isolated Marketing service.

    Marketing owns staff grants and performs the final authorization check.
    Reusing the internal service secret avoids introducing another operational
    secret while the JWT audience prevents a planner token being replayed.
    """
    from ..config import settings
    if not settings.planner_internal_token:
        raise HTTPException(503, "Marketing is not configured")
    timestamp = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": user.firebase_uid or user.id,
        "email": user.email,
        "name": user.name,
        "is_platform_superadmin": bool(user.is_platform_superadmin),
        "iss": "guesthub",
        "aud": "marketing",
        "iat": timestamp,
        "exp": timestamp + timedelta(minutes=15),
    }, settings.planner_internal_token, algorithm="HS256")
    return {"token": token, "expires_in": 900}


@router.get("/marketing-preferences")
async def get_marketing_preferences(user: User = Depends(get_current_user)):
    from ..services.marketing_client import marketing_preferences
    try:
        return await marketing_preferences(user.email)
    except Exception:
        raise HTTPException(503, "Communication preferences are temporarily unavailable")


@router.put("/marketing-preferences")
async def save_marketing_preferences(body: dict, user: User = Depends(get_current_user)):
    from ..services.marketing_client import marketing_preferences
    try:
        return await marketing_preferences(user.email, body)
    except Exception:
        raise HTTPException(503, "Communication preferences could not be saved")


@router.post("/ticketing-token")
async def ticketing_token(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mint a short-lived, event-scoped admin token for ticketing-service."""
    from ..config import settings
    if not settings.ticketing_internal_token:
        raise HTTPException(503, "Ticketing is not configured")
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    role = "admin" if user.is_platform_superadmin else await _org_role(user, event.org_id, db)
    if role not in ("owner", "admin"):
        raise HTTPException(404, "Event not found")
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": user.firebase_uid or user.id,
        "email": user.email,
        "name": user.name,
        "event_id": event.id,
        "org_id": event.org_id,
        "role": role,
        "iss": "guesthub",
        "aud": "ticketing",
        "iat": now,
        "exp": now + timedelta(minutes=15),
    }, settings.ticketing_internal_token, algorithm="HS256")
    return {"token": token, "expires_in": 900}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Effective role reflects org membership. A user is considered an org admin
    # only if they are owner/admin in an org that has at least one event. This
    # prevents staff members (who auto-get an empty personal org on registration)
    # from being treated as admins when they're really staff at another org.
    # New organizers are safe because RegisterPage always redirects to /setup
    # directly, bypassing role-based routing.
    is_org_admin = bool(await db.scalar(
        select(Membership.id)
        .join(Event, Event.org_id == Membership.org_id)
        .where(
            Membership.user_id == user.id,
            Membership.role.in_(["owner", "admin"]),
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
    # Redesign cohort of the org the user owns/admins — deliberately NOT
    # gated on that org having an event (unlike is_org_admin above), so a
    # brand-new organizer with zero events still gets their org's real
    # cohort instead of the RedesignGate's zero-event "legacy_only" fallback.
    redesign_cohort = "legacy_only"
    owned_org_id = await db.scalar(
        select(Membership.org_id)
        .where(
            Membership.user_id == user.id,
            Membership.role.in_(["owner", "admin"]),
        )
        .order_by(Membership.created_at)
        .limit(1)
    )
    if owned_org_id:
        redesign_cohort = await db.scalar(
            select(Organization.redesign_cohort).where(Organization.id == owned_org_id)
        ) or "legacy_only"
    return UserOut(
        id=user.id, name=user.name, email=user.email,
        role=role,
        created_at=user.created_at,
        is_platform_superadmin=user.is_platform_superadmin,
        is_org_admin=is_org_admin,
        redesign_cohort=redesign_cohort,
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
