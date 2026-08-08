from dataclasses import dataclass
import jwt
from fastapi import Header, HTTPException
from .config import settings


@dataclass(frozen=True)
class Identity:
    subject: str
    event_id: str
    org_id: str
    role: str
    is_platform_superadmin: bool = False


async def current_identity(authorization: str | None = Header(default=None)) -> Identity:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    if not settings.internal_service_token:
        raise HTTPException(503, "Ticketing service is not configured")
    try:
        data = jwt.decode(authorization[7:], settings.internal_service_token,
                          algorithms=["HS256"], audience="ticketing", issuer="guesthub")
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    if not data.get("event_id") or not data.get("org_id"):
        raise HTTPException(401, "Token is missing event scope")
    return Identity(data["sub"], data["event_id"], data["org_id"], data.get("role", "member"),
                    bool(data.get("is_platform_superadmin", False)))


def require_admin(identity: Identity) -> None:
    if identity.role not in ("owner", "admin"):
        raise HTTPException(403, "Only event admins can manage ticketing")


def require_service_enabled() -> None:
    if not settings.service_enabled:
        raise HTTPException(404, "Ticketing is not available")
