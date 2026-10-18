"""Authenticated, read-only barrier for email pilot delivery."""
from datetime import datetime, timezone, timedelta
import re

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.engagement_config import engagement_settings
from app.models import MarketingOutbox
from app.services.resend_inbound_routing import prospect_reply_bases

router = APIRouter()


def require_marketing_readiness(authorization: str = Header("")):
    if not settings.planner_internal_token:
        raise HTTPException(503, "Email readiness authority unavailable")
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Email readiness authentication required")
    try:
        claims = jwt.decode(
            authorization[7:], settings.planner_internal_token, algorithms=["HS256"],
            audience="marketing-email-readiness", issuer="marketing-service",
            options={"require": ["sub", "iss", "aud", "iat", "exp", "jti"]},
        )
        if claims.get("sub") != "marketing-email-readiness" or not re.fullmatch("[0-9a-f]{32}", claims.get("jti", "")):
            raise ValueError()
    except Exception:
        raise HTTPException(403, "Invalid email readiness authority")
    return claims


@router.get("/api/internal/marketing/email-readiness")
async def email_readiness(reply_domain: str = Query(...), challenge: str = Query(...),
                         claims: dict = Depends(require_marketing_readiness), db: AsyncSession = Depends(get_db)):
    if challenge != claims["jti"]:
        raise HTTPException(403, "Readiness challenge mismatch")
    domain = reply_domain.strip().lower()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", domain):
        raise HTTPException(400, "Invalid reply domain")
    recipients = prospect_reply_bases()
    reply_ready = bool(
        engagement_settings.prospect_ingress_enabled
        and engagement_settings.marketing_outbox_enabled
        and settings.resend_inbound_webhook_secret.strip()
        and f"reply@{domain}" in recipients
    )
    pending = await db.scalar(select(func.count(MarketingOutbox.id)).where(
        MarketingOutbox.status.in_(["pending", "retry"]))) or 0
    failed = await db.scalar(select(func.count(MarketingOutbox.id)).where(
        ~MarketingOutbox.status.in_(["pending", "retry", "delivered"]))) or 0
    moment = datetime.now(timezone.utc)
    result = {"ready": reply_ready and pending == 0 and failed == 0,
              "pending": pending, "failed": failed, "reply_routing_ready": reply_ready,
              "reply_domain": domain, "checked_at": moment.isoformat()}
    proof = jwt.encode({**result, "sub": "marketing-email-readiness-response",
                        "iss": "festio-backend", "aud": "marketing-email-readiness-response",
                        "jti": challenge, "iat": moment, "exp": moment + timedelta(seconds=5)},
                       settings.planner_internal_token, algorithm="HS256")
    return {**result, "proof": proof}
