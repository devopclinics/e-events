"""Self-serve WhatsApp template submission -- a client writes a template,
pays a one-time $5 fee, and Festio submits it to Bird/Meta on their behalf
(services/bird_templates.py runs the same Bird API calls as
scripts/bird_submit_message_templates.py, just triggered by the customer
through the product instead of a developer running the script by hand).

Mounted at /api/organizations/me, mirroring org_billing.py's
checkout-then-webhook-fulfillment shape -- but with its own fulfillment
(services/wa_template_submissions.py::fulfill_payment, which calls Bird)
instead of apply_organization_purchase, since PricingPlan/apply_purchase only
know how to flip a generic entitlement flag, not run a customer-authored
submission. The webhook *event handling* stays centralized in
routers/billing.py's existing /webhook/stripe and /webhook/paystack (see
_fulfill dispatch there), same convention org_billing.py already follows for
subscription events -- deliberately not a second webhook URL per provider.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Membership, Organization, User, WhatsAppTemplateSubmission
from ..schemas import (
    WhatsAppTemplateSubmissionCreate, WhatsAppTemplateSubmissionRetry,
    WhatsAppTemplateSubmissionOut, WhatsAppTemplateSubmissionCheckoutOut,
)
from ..auth import get_current_user
from ..config import settings
from .admin import DEFAULT_ORG_ID
from services import payments, bird_templates
from services.wa_template_submissions import (
    MAX_RETRIES, PRICE_USD_CENTS, PRICE_NGN_KOBO,
    extract_vars, validate_submission, generate_platform_name,
)

logger = logging.getLogger(__name__)
router = APIRouter()


async def _org_admin(user: User, db: AsyncSession) -> Organization:
    """The org this user can administer -- owner or admin, mirrors how
    billing.py gates the per-event checkout. This is a real charge, so
    staff-level membership doesn't qualify."""
    org_id = await db.scalar(
        select(Membership.org_id)
        .join(Organization, Organization.id == Membership.org_id)
        .where(Membership.user_id == user.id, Membership.role.in_(("owner", "admin")))
        .order_by(case((Organization.id == DEFAULT_ORG_ID, 1), else_=0), Organization.created_at.asc())
        .limit(1)
    )
    org = await db.get(Organization, org_id) if org_id else None
    if not org:
        raise HTTPException(403, "You must be an owner or admin of an organization to do this")
    return org


def _provider_for(currency: str) -> str:
    return "paystack" if currency.upper() == "NGN" else "stripe"


def _out(sub: WhatsAppTemplateSubmission) -> WhatsAppTemplateSubmissionOut:
    return WhatsAppTemplateSubmissionOut(
        id=sub.id, name=sub.name, platform_name=sub.platform_name, category=sub.category,
        body=sub.body, variables=sub.variables or [], sample_values=sub.sample_values or {},
        status=sub.status, retry_count=sub.retry_count, max_retries=MAX_RETRIES,
        reject_reason=sub.reject_reason, bird_project_id=sub.bird_project_id,
        is_shared=sub.is_shared, created_at=sub.created_at, updated_at=sub.updated_at,
    )


@router.get("/whatsapp-templates/submissions", response_model=list[WhatsAppTemplateSubmissionOut])
async def list_submissions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org_admin(user, db)
    rows = (await db.execute(
        select(WhatsAppTemplateSubmission).where(WhatsAppTemplateSubmission.org_id == org.id)
        .order_by(WhatsAppTemplateSubmission.created_at.desc())
    )).scalars().all()
    return [_out(r) for r in rows]


@router.post("/whatsapp-templates/submissions", response_model=WhatsAppTemplateSubmissionOut, status_code=201)
async def create_submission(data: WhatsAppTemplateSubmissionCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not bird_templates.enabled():
        raise HTTPException(503, "WhatsApp template submission isn't configured yet.")
    org = await _org_admin(user, db)
    variables = extract_vars(data.body)
    error = validate_submission(data.body, data.category, variables, data.sample_values)
    if error:
        raise HTTPException(400, error)

    platform_name = generate_platform_name(org.id, data.name)
    for _ in range(3):
        clash = await db.scalar(select(WhatsAppTemplateSubmission.id).where(WhatsAppTemplateSubmission.platform_name == platform_name))
        if not clash:
            break
        platform_name = generate_platform_name(org.id, data.name)

    sub = WhatsAppTemplateSubmission(
        org_id=org.id, created_by=user.id, name=data.name.strip()[:160], platform_name=platform_name,
        category=data.category, body=data.body, variables=variables, sample_values=data.sample_values,
        status="draft",
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return _out(sub)


@router.post("/whatsapp-templates/submissions/{submission_id}/checkout", response_model=WhatsAppTemplateSubmissionCheckoutOut)
async def checkout_submission(submission_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org_admin(user, db)
    sub = await db.get(WhatsAppTemplateSubmission, submission_id)
    if not sub or sub.org_id != org.id:
        raise HTTPException(404, "Submission not found")
    if sub.status != "draft":
        raise HTTPException(400, f"This submission is already {sub.status.replace('_', ' ')}")

    currency = (org.currency or "USD").upper()
    provider = _provider_for(currency)
    if provider == "stripe" and not payments.stripe_enabled():
        raise HTTPException(503, "Stripe billing is not configured yet.")
    if provider == "paystack" and not payments.paystack_enabled():
        raise HTTPException(503, "Paystack billing is not configured yet.")

    amount = PRICE_NGN_KOBO if currency == "NGN" else PRICE_USD_CENTS
    base = (settings.public_base_url or settings.frontend_url).rstrip("/")
    success_url = f"{base}/admin?wa_template_submitted=1"
    cancel_url = f"{base}/admin"

    if provider == "stripe":
        url, reference = await payments.stripe_create_checkout(
            amount=amount, currency=currency, event_id="", tier_key="wa_tpl_submit",
            email=user.email, success_url=success_url, cancel_url=cancel_url,
            extra_metadata={"wa_submission_id": sub.id},
        )
    else:
        url, reference = await payments.paystack_create_checkout(
            amount=amount, currency=currency, event_id="", tier_key="wa_tpl_submit",
            email=user.email, callback_url=success_url,
            extra_metadata={"wa_submission_id": sub.id},
        )

    sub.status = "awaiting_payment"
    sub.payment_provider = provider
    sub.payment_reference = reference
    await db.commit()
    return WhatsAppTemplateSubmissionCheckoutOut(url=url, provider=provider)


@router.post("/whatsapp-templates/submissions/{submission_id}/retry", response_model=WhatsAppTemplateSubmissionOut)
async def retry_submission(submission_id: str, data: WhatsAppTemplateSubmissionRetry, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _org_admin(user, db)
    sub = await db.get(WhatsAppTemplateSubmission, submission_id)
    if not sub or sub.org_id != org.id:
        raise HTTPException(404, "Submission not found")
    if sub.status not in ("rejected", "submit_failed"):
        raise HTTPException(400, "Only a rejected submission can be retried")
    if sub.retry_count >= MAX_RETRIES:
        raise HTTPException(400, f"This submission has used all {MAX_RETRIES} free retries. Submit a new template instead.")

    variables = extract_vars(data.body)
    error = validate_submission(data.body, data.category, variables, data.sample_values)
    if error:
        raise HTTPException(400, error)

    sub.body = data.body
    sub.category = data.category
    sub.variables = variables
    sub.sample_values = data.sample_values
    sub.retry_count += 1
    sub.reject_reason = None
    sub.last_notified_status = None

    try:
        project_id, channel_template_id = await bird_templates.submit_template(
            platform_name=sub.platform_name, body=sub.body, category=sub.category,
            variables=variables, sample_values=data.sample_values,
        )
        sub.bird_project_id = project_id
        sub.bird_channel_template_id = channel_template_id
        sub.status = "pending_review"
    except Exception:
        logger.exception("wa_template_submissions: retry submission failed for %s", sub.id)
        sub.status = "submit_failed"
    await db.commit()
    await db.refresh(sub)
    return _out(sub)
