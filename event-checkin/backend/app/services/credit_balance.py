"""Read the spendable wallet without confusing event usage with organization funds."""
from ..config import settings
from ..models import Organization

async def available_credits(db, event):
    if settings.organization_entitlements_v2:
        org = await db.get(Organization, event.org_id)
        return (org.message_credit_units or 0) / 10 if org else 0
    return event.message_credits or 0

def credit_scope():
    return "organization" if settings.organization_entitlements_v2 else "event"
