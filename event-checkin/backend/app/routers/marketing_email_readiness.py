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


@router.get("/api/internal/marketing/sales-readiness")
async def sales_readiness(challenge: str, db: AsyncSession = Depends(get_db), authorization: str = Header("")):
    claims = require_marketing_readiness(authorization)
    if challenge != claims["jti"]:
        raise HTTPException(403, "Readiness challenge mismatch")
    # A captured stop/handoff must reach Marketing before another reply leaves.
    # Aggregate only: this authority exposes no public visitor's account data.
    pending = await db.scalar(select(func.count(MarketingOutbox.id)).where(
        MarketingOutbox.endpoint.in_(("conversations", "sales-responses")),
        ~MarketingOutbox.status.in_(("delivered", "cancelled")))) or 0
    at = datetime.now(timezone.utc)
    result = dict(ready=pending == 0, pending=pending, checked_at=at.isoformat(),
        sub="sales-readiness-response", iss="festio-backend", aud="sales-readiness-response",
        jti=challenge, iat=at, exp=at+timedelta(seconds=5))
    return {"proof": jwt.encode(result, settings.planner_internal_token, algorithm="HS256")}


@router.get("/api/internal/marketing/organizer-context")
async def organizer_context(account_id: str, event_id: str, challenge: str,
                            db: AsyncSession = Depends(get_db),
                            authorization: str = Header("")):
    # Same narrowly scoped signed service authority as readiness; no public
    # sales conversation can retrieve private event/account context.
    proof_claims = require_marketing_readiness(authorization)
    if challenge != proof_claims["jti"] or len(account_id) > 128 or len(event_id) > 128:
        raise HTTPException(403, "Context challenge mismatch")
    from app.models import Event, User, Membership, Organization, Guest
    event = await db.get(Event, event_id)
    owner = await db.scalar(select(User.id).join(Membership, Membership.user_id == User.id).join(Organization,Organization.id==Membership.org_id).where(
        Organization.is_active.is_(True),User.is_active.is_(True),
        Membership.org_id == event.org_id, Membership.role == "owner",
        ((User.firebase_uid == account_id) | (User.firebase_uid.is_(None) & (User.id == account_id))))) if event else None
    at = datetime.now(timezone.utc)
    real_guests = await db.scalar(select(func.count(Guest.id)).where(Guest.event_id==event_id,Guest.is_test.is_(False))) if owner else None
    result = dict(account_id=account_id, event_id=event_id, current_owner=owner is not None,
        org_id=event.org_id if owner else None, status=event.status if owner else None,
        cancelled=event.cancelled if owner else None, is_test=event.is_test if owner else None,
        attendance_mode=event.attendance_mode if owner else None, invite_mode=event.invite_mode if owner else None,
        rsvp_enabled=event.rsvp_enabled if owner else None, manual_checkin_enabled=event.manual_checkin_enabled if owner else None,
        real_guest_count=real_guests,
        event_end_date=(event.event_end_date.replace(tzinfo=timezone.utc) if event.event_end_date.tzinfo is None else event.event_end_date).isoformat() if owner and event.event_end_date else None,
        event_date=(event.event_date.replace(tzinfo=timezone.utc) if event.event_date.tzinfo is None else event.event_date).isoformat() if owner else None, timezone=event.timezone if owner else None,
        checked_at=at.isoformat(), sub="organizer-context-response", iss="festio-backend", aud="organizer-context-response",
        jti=challenge, iat=at, exp=at+timedelta(seconds=5))
    return {"proof": jwt.encode(result, settings.planner_internal_token, algorithm="HS256")}


def require_marketing_readiness(authorization: str = Header("")):
    if not settings.planner_internal_token or not settings.planner_internal_token.strip():
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
        ~MarketingOutbox.status.in_(["pending", "retry", "delivered", "cancelled"]))) or 0
    moment = datetime.now(timezone.utc)
    result = {"ready": reply_ready and pending == 0 and failed == 0,
              "pending": pending, "failed": failed, "reply_routing_ready": reply_ready,
              "reply_domain": domain, "checked_at": moment.isoformat()}
    proof = jwt.encode({**result, "sub": "marketing-email-readiness-response",
                        "iss": "festio-backend", "aud": "marketing-email-readiness-response",
                        "jti": challenge, "iat": moment, "exp": moment + timedelta(seconds=5)},
                       settings.planner_internal_token, algorithm="HS256")
    return {**result, "proof": proof}
