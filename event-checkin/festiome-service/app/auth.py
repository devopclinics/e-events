import asyncio
import json
import secrets
from dataclasses import dataclass

import firebase_admin
import jwt
from fastapi import Header, HTTPException
from firebase_admin import auth as firebase_auth, credentials

from .config import settings


@dataclass(frozen=True)
class Identity:
    subject: str
    email: str
    name: str
    kind: str = "user"


_firebase_app = None


def _ensure_firebase():
    global _firebase_app
    if _firebase_app is None:
        if not settings.firebase_credentials and not settings.firebase_project_id:
            raise HTTPException(503, "Festio identity verification is not configured")
        if settings.firebase_credentials:
            _firebase_app = firebase_admin.initialize_app(credentials.Certificate(json.loads(settings.firebase_credentials)))
        else:
            _firebase_app = firebase_admin.initialize_app(options={"projectId": settings.firebase_project_id})


async def current_identity(authorization: str | None = Header(default=None)) -> Identity:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = authorization[7:].strip()
    if settings.internal_service_token:
        try:
            decoded = jwt.decode(
                token, settings.internal_service_token, algorithms=["HS256"],
                audience="festiome", issuer="guesthub",
            )
            kind = decoded.get("identity_kind", "user")
            if kind not in {"user", "guest"}:
                raise jwt.InvalidTokenError("invalid identity kind")
            return Identity(decoded["sub"], (decoded.get("email") or "").lower(), decoded.get("name") or decoded.get("email") or "Member", kind)
        except jwt.PyJWTError:
            pass
    _ensure_firebase()
    try:
        decoded = await asyncio.to_thread(firebase_auth.verify_id_token, token)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    return Identity(decoded["uid"], (decoded.get("email") or "").lower(), decoded.get("name") or decoded.get("email") or "Member")


async def internal_service(authorization: str | None = Header(default=None)) -> None:
    expected = settings.internal_service_token
    supplied = authorization[7:].strip() if authorization and authorization.startswith("Bearer ") else ""
    if not expected or not secrets.compare_digest(supplied, expected):
        raise HTTPException(401, "Invalid Festio service credential")
