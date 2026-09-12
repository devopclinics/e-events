"""Business logic for self-serve WhatsApp template submission, shared between
app/routers/wa_template_submissions.py (the client-facing CRUD/checkout/retry
API), app/routers/billing.py (webhook fulfillment after payment) and
services/wa_template_poller.py (status polling + notification). Kept out of
the router so billing.py's webhook handlers can call fulfill_payment()
without importing one router from another.
"""
import logging
import re
import secrets

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, WhatsAppTemplateSubmission
from services import bird_templates
from services.email_service import send_simple_email

logger = logging.getLogger("wa_template_submissions")

MAX_RETRIES = 5
PRICE_USD_CENTS = 500
PRICE_NGN_KOBO = 500000
VALID_CATEGORIES = {"UTILITY", "MARKETING", "AUTHENTICATION"}

_VAR_RE = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")


def extract_vars(body: str) -> list[str]:
    seen: list[str] = []
    for m in _VAR_RE.finditer(body):
        if m.group(1) not in seen:
            seen.append(m.group(1))
    return seen


def validate_submission(body: str, category: str, variables: list[str], sample_values: dict) -> str | None:
    """Returns an error message, or None if the submission is well-formed
    enough to send to Bird (doesn't guarantee Meta approval)."""
    if not body.strip():
        return "Template body can't be empty"
    if category not in VALID_CATEGORIES:
        return "Category must be UTILITY, MARKETING, or AUTHENTICATION"
    if re.search(r"}}\s*$", body.strip()):
        return "Template body can't end on a {{variable}} — Meta rejects this. Add static text after the last variable."
    missing = [v for v in variables if not (sample_values or {}).get(v)]
    if missing:
        return f"Missing a sample value for: {', '.join(missing)}"
    return None


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return slug or "template"


def generate_platform_name(org_id: str, name: str) -> str:
    """The actual WhatsApp-facing template name sent to Bird/Meta -- must be
    globally unique across every Festio customer, since they all share one
    Bird workspace (see services/bird_templates.py)."""
    return f"festio_c_{org_id[:8]}_{_slugify(name)[:60]}_{secrets.token_hex(3)}"


async def fulfill_payment(db: AsyncSession, submission_id: str) -> None:
    """Called from routers/billing.py's Stripe/Paystack webhook handlers once
    a checkout carrying this submission's id completes. Idempotent: a
    submission not in 'awaiting_payment' has already been fulfilled (webhook
    retry) or was never checked out."""
    sub = await db.get(WhatsAppTemplateSubmission, submission_id)
    if not sub or sub.status != "awaiting_payment":
        return
    sub.payment_status = "paid"
    try:
        project_id, channel_template_id = await bird_templates.submit_template(
            platform_name=sub.platform_name, body=sub.body, category=sub.category,
            variables=sub.variables or [], sample_values=sub.sample_values or {},
        )
        sub.bird_project_id = project_id
        sub.bird_channel_template_id = channel_template_id
        sub.status = "pending_review"
    except Exception:
        logger.exception("wa_template_submissions: Bird submission failed for %s", sub.id)
        sub.status = "submit_failed"
    await db.commit()
    logger.info("wa_template_submissions: fulfilled payment for %s -> status=%s", sub.id, sub.status)


async def notify_status_change(db: AsyncSession, sub: WhatsAppTemplateSubmission) -> None:
    """Emails the submitter once per status transition (approved/rejected).
    Called by the poller right after it flips sub.status; caller is
    responsible for setting last_notified_status so this doesn't repeat."""
    if not sub.created_by:
        return
    user = await db.get(User, sub.created_by)
    if not user or not user.email:
        return
    if sub.status == "approved":
        subject = f'Approved: your WhatsApp template "{sub.name}"'
        body = (
            f"<p>Good news — Meta approved your WhatsApp template <strong>{sub.name}</strong>.</p>"
            f"<p>It's ready to use in Festio's Broadcast and Reminders tools.</p>"
        )
    else:
        subject = f'Changes needed: your WhatsApp template "{sub.name}"'
        remaining = max(0, MAX_RETRIES - sub.retry_count)
        body = (
            f"<p>Meta didn't approve your WhatsApp template <strong>{sub.name}</strong> this time.</p>"
            f"<p><strong>Reason:</strong> {sub.reject_reason or 'No reason was given.'}</p>"
            f"<p>You can revise the wording and resubmit at no extra charge — "
            f"{remaining} retry{'s' if remaining != 1 else ''} remaining.</p>"
        )
    try:
        await send_simple_email(user.email, subject, body)
    except Exception:
        logger.exception("wa_template_submissions: notify failed submission=%s", sub.id)
