"""Org-scoped outbound webhook management (Gatsby gap-backlog item). Mounted
at /api/organizations/me — same pattern as api_keys.py/referrals.py.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Membership, Organization, User, WebhookDelivery, WebhookEndpoint
from ..schemas import WebhookEndpointCreate, WebhookEndpointOut, WebhookEndpointCreated, WebhookDeliveryOut
from ..auth import get_current_user
from .admin import DEFAULT_ORG_ID

router = APIRouter()

# The same event vocabulary a customer can subscribe to. Kept as an explicit
# allowlist so a typo in event_types silently means "never fires" rather than
# quietly accepting garbage.
SUPPORTED_EVENT_TYPES = [
    "guest.created", "guest.checked_in", "rsvp.confirmed",
    "table.created", "table.deleted", "table_group.created", "table_group.deleted",
    "experience.workflow_published", "experience.consent_signed", "experience.feedback_submitted",
]


async def _owned_org(user: User, db: AsyncSession) -> Organization:
    """See api_keys.py's _owned_org for why DEFAULT_ORG_ID is deprioritized —
    same multi-org-owner bug, same fix, duplicated per-router by convention."""
    org_id = await db.scalar(
        select(Membership.org_id)
        .join(Organization, Organization.id == Membership.org_id)
        .where(Membership.user_id == user.id, Membership.role == "owner")
        .order_by(case((Organization.id == DEFAULT_ORG_ID, 1), else_=0), Organization.created_at.asc())
        .limit(1)
    )
    org = await db.get(Organization, org_id) if org_id else None
    if not org:
        raise HTTPException(403, "You must own an organization to manage webhooks")
    return org


@router.get("/webhooks", response_model=list[WebhookEndpointOut])
async def list_webhooks(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _owned_org(user, db)
    rows = (await db.execute(
        select(WebhookEndpoint).where(WebhookEndpoint.org_id == org.id).order_by(WebhookEndpoint.created_at.desc())
    )).scalars().all()
    return rows


@router.post("/webhooks", response_model=WebhookEndpointCreated, status_code=201)
async def create_webhook(data: WebhookEndpointCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _owned_org(user, db)
    url = data.url.strip()
    if not url.startswith("https://") and not url.startswith("http://"):
        raise HTTPException(400, "url must start with http:// or https://")
    bad_types = [t for t in data.event_types if t not in SUPPORTED_EVENT_TYPES]
    if bad_types:
        raise HTTPException(400, f"Unsupported event type(s): {', '.join(bad_types)}. Supported: {', '.join(SUPPORTED_EVENT_TYPES)}")
    if not data.event_types:
        raise HTTPException(400, "event_types must have at least one entry")
    secret = secrets.token_hex(32)
    row = WebhookEndpoint(org_id=org.id, url=url, secret=secret, event_types=data.event_types, created_by_user_id=user.id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return WebhookEndpointCreated(
        id=row.id, url=row.url, event_types=row.event_types, is_active=row.is_active,
        created_at=row.created_at, secret=secret,
    )


@router.delete("/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(webhook_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _owned_org(user, db)
    row = await db.get(WebhookEndpoint, webhook_id)
    if not row or row.org_id != org.id:
        raise HTTPException(404, "Webhook not found")
    await db.delete(row)
    await db.commit()


@router.get("/webhooks/{webhook_id}/deliveries", response_model=list[WebhookDeliveryOut])
async def list_webhook_deliveries(webhook_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _owned_org(user, db)
    endpoint = await db.get(WebhookEndpoint, webhook_id)
    if not endpoint or endpoint.org_id != org.id:
        raise HTTPException(404, "Webhook not found")
    rows = (await db.execute(
        select(WebhookDelivery).where(WebhookDelivery.endpoint_id == webhook_id)
        .order_by(WebhookDelivery.created_at.desc()).limit(100)
    )).scalars().all()
    return rows
