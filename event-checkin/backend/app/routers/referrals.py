"""Partner referral program: an org shares its slug as a referral code, and
new orgs that sign up through that link get durably attributed to it. Reward
mechanics (credits, discounts) are applied manually by operators for now —
this only tracks attribution and surfaces it to the referring org."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import Event, Membership, Organization, User
from ..schemas import ReferralClaim, ReferralInfoOut, ReferredOrgOut
from ..auth import get_current_user, require_superadmin

router = APIRouter()
# Separate router: mounted at /api/organizations (not /api/organizations/me),
# since this is a cross-tenant operator view, not "my" data.
admin_router = APIRouter()


@admin_router.get("/referrals/all")
async def all_referrals(db: AsyncSession = Depends(get_db), _: User = Depends(require_superadmin)):
    """Every referral relationship on the platform, for operators to track
    partnership performance (e.g. a specific association's members signing
    up through their shared code)."""
    rows = (await db.execute(
        select(Organization, Organization.referred_by_org_id)
        .where(Organization.referred_by_org_id.isnot(None))
        .order_by(Organization.created_at.desc())
    )).all()
    referrer_ids = {referrer_id for _, referrer_id in rows}
    referrers = {}
    if referrer_ids:
        for org in (await db.execute(select(Organization).where(Organization.id.in_(referrer_ids)))).scalars().all():
            referrers[org.id] = org
    converted_ids = set()
    org_ids = [org.id for org, _ in rows]
    if org_ids:
        converted_ids = set((await db.execute(
            select(Event.org_id).distinct().where(Event.org_id.in_(org_ids), Event.is_paid.is_(True))
        )).scalars().all())
    return [
        {
            "org_name": org.name,
            "org_created_at": org.created_at,
            "referrer_name": referrers[referrer_id].name if referrer_id in referrers else None,
            "referrer_code": referrers[referrer_id].slug if referrer_id in referrers else None,
            "converted": org.id in converted_ids,
        }
        for org, referrer_id in rows
    ]


async def _primary_owned_org(user: User, db: AsyncSession) -> Organization | None:
    """The org this user owns that they were originally provisioned with —
    first by creation date, if they own more than one."""
    org_id = await db.scalar(
        select(Membership.org_id)
        .join(Organization, Organization.id == Membership.org_id)
        .where(Membership.user_id == user.id, Membership.role == "owner")
        .order_by(Organization.created_at.asc())
        .limit(1)
    )
    return await db.get(Organization, org_id) if org_id else None


@router.get("/referral", response_model=ReferralInfoOut)
async def my_referral(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _primary_owned_org(user, db)
    if not org:
        raise HTTPException(404, "No organization found for this account")
    referred = (await db.execute(
        select(Organization)
        .where(Organization.referred_by_org_id == org.id)
        .order_by(Organization.created_at.desc())
    )).scalars().all()
    converted_ids: set[str] = set()
    if referred:
        converted_ids = set((await db.execute(
            select(Event.org_id).distinct()
            .where(Event.org_id.in_([r.id for r in referred]), Event.is_paid.is_(True))
        )).scalars().all())
    base = (settings.public_base_url or "").rstrip("/")
    return ReferralInfoOut(
        referral_code=org.slug,
        referral_link=f"{base}/register?ref={org.slug}",
        referred_count=len(referred),
        converted_count=len(converted_ids),
        referred_orgs=[
            ReferredOrgOut(name=r.name, created_at=r.created_at, converted=r.id in converted_ids)
            for r in referred
        ],
    )


@router.post("/referral/claim")
async def claim_referral(
    body: ReferralClaim,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org = await _primary_owned_org(user, db)
    if not org:
        raise HTTPException(404, "No organization found for this account")
    if org.referred_by_org_id:
        return {"claimed": False, "reason": "already_attributed"}
    code = body.code.strip()
    if not code:
        return {"claimed": False, "reason": "invalid_code"}
    referrer = await db.scalar(select(Organization).where(Organization.slug == code))
    if not referrer or referrer.id == org.id:
        return {"claimed": False, "reason": "invalid_code"}
    org.referred_by_org_id = referrer.id
    await db.commit()
    return {"claimed": True}
