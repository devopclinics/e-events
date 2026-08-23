from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException

from .config import settings


@dataclass(frozen=True)
class Identity:
    """Decoded from the scoped JWT the main backend mints — either
    POST /api/auth/live-token (staff, identity_kind="staff") or
    POST /api/events/{id}/live/guest-token (guest, identity_kind="guest").
    aud="engagement", iss="guesthub" — same family as planner/ticketing/festiome.
    engagement-service trusts these claims as-is; there is no callback to the
    main backend on any request."""
    identity_kind: str  # "staff" | "guest"
    subject: str
    event_id: str
    org_id: str
    role: str = "viewer"  # staff: owner|admin|presenter|moderator|analyst|viewer; guest tokens always "guest"
    capabilities: tuple[str, ...] = ()
    name: str = ""
    email: str = ""
    guest_admitted: bool = False
    # True for a broadcast/QR join (no Guest record) — minted by the main
    # backend's POST /api/events/{id}/live/anon-token. Such participants are
    # tracked by ActivityParticipant.anon_id instead of .guest_id.
    is_anonymous: bool = False


async def current_identity(authorization: str | None = Header(default=None)) -> Identity:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    if not settings.internal_service_token:
        raise HTTPException(503, "Festio Live is not configured")
    token = authorization[7:].strip()
    try:
        decoded = jwt.decode(
            token, settings.internal_service_token, algorithms=["HS256"],
            audience="engagement", issuer="guesthub",
        )
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    event_id = decoded.get("event_id")
    if not event_id:
        raise HTTPException(401, "Token is missing event scope")
    kind = decoded.get("identity_kind", "staff")
    return Identity(
        identity_kind=kind,
        subject=decoded["sub"],
        event_id=event_id,
        org_id=decoded.get("org_id") or "",
        role=decoded.get("role", "guest" if kind == "guest" else "viewer"),
        capabilities=tuple(decoded.get("capabilities") or ()),
        name=decoded.get("name") or "",
        email=(decoded.get("email") or "").lower(),
        guest_admitted=bool(decoded.get("guest_admitted")),
        is_anonymous=bool(decoded.get("anon")),
    )


def require_staff(identity: Identity) -> Identity:
    if identity.identity_kind != "staff":
        raise HTTPException(403, "Staff access required")
    return identity


def require_admin(identity: Identity) -> Identity:
    require_staff(identity)
    if identity.role not in ("owner", "admin"):
        raise HTTPException(403, "Only event admins can do this")
    return identity


def require_capability(identity: Identity, capability: str) -> Identity:
    """Presenter/Moderator/Analyst capability check — owner/admin always pass."""
    require_staff(identity)
    if identity.role in ("owner", "admin"):
        return identity
    if capability not in identity.capabilities:
        raise HTTPException(403, f"The {capability} capability is required")
    return identity


def require_guest(identity: Identity) -> Identity:
    if identity.identity_kind != "guest":
        raise HTTPException(403, "Guest access required")
    return identity
