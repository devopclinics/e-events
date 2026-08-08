from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException

from .config import settings


@dataclass(frozen=True)
class Identity:
    """Decoded from the scoped JWT the main backend mints via
    POST /api/auth/planner-token (aud="planner", iss="guesthub"). Planner-
    service trusts these claims as-is — event/org access was already checked
    by the main backend before minting the token, so there is no callback."""
    subject: str
    email: str
    name: str
    event_id: str
    org_id: str
    role: str  # "admin" | "member" — mirrors the event's org role at mint time
    capabilities: tuple[str, ...] = ()


async def current_identity(authorization: str | None = Header(default=None)) -> Identity:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    if not settings.internal_service_token:
        raise HTTPException(503, "Planner service is not configured")
    token = authorization[7:].strip()
    try:
        decoded = jwt.decode(
            token, settings.internal_service_token, algorithms=["HS256"],
            audience="planner", issuer="guesthub",
        )
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    event_id = decoded.get("event_id")
    org_id = decoded.get("org_id")
    if not event_id or not org_id:
        raise HTTPException(401, "Token is missing event scope")
    return Identity(
        subject=decoded["sub"],
        email=(decoded.get("email") or "").lower(),
        name=decoded.get("name") or decoded.get("email") or "Member",
        event_id=event_id,
        org_id=org_id,
        role=decoded.get("role", "member"),
        capabilities=tuple(decoded.get("capabilities") or ()),
    )


def ensure_capability(identity: Identity, capability: str) -> None:
    if identity.role not in ("owner", "admin") and capability not in identity.capabilities:
        raise HTTPException(403, f"Planner {capability} permission is required")


async def require_admin(identity: Identity) -> Identity:
    if identity.role not in ("owner", "admin"):
        raise HTTPException(403, "Only event admins can do this")
    return identity
