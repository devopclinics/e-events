"""Customer-facing trial-credit requests. A logged-in org member asks to try
paid features; an operator approves in the Console (see admin.py)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User, Membership, TrialRequest
from ..schemas import TrialRequestCreate, TrialRequestOut
from ..auth import get_current_user

router = APIRouter()


async def _user_org_id(user: User, db: AsyncSession) -> str:
    """The org this user manages — prefer an owner/admin membership."""
    rows = (await db.execute(
        select(Membership.org_id, Membership.role).where(Membership.user_id == user.id)
    )).all()
    if not rows:
        raise HTTPException(400, "You don't belong to an organization yet.")
    for org_id, role in rows:
        if role in ("owner", "admin"):
            return org_id
    return rows[0][0]


@router.post("/trial-requests", response_model=TrialRequestOut, status_code=201)
async def submit_trial_request(
    body: TrialRequestCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    org_id = await _user_org_id(user, db)
    # One open request per org keeps the operator queue clean.
    existing = (await db.execute(
        select(TrialRequest).where(
            TrialRequest.org_id == org_id, TrialRequest.status == "pending"
        )
    )).scalars().first()
    if existing:
        raise HTTPException(409, "You already have a pending trial request — we'll be in touch shortly.")
    if not body.contact_name.strip():
        raise HTTPException(400, "Please tell us who to contact.")

    req = TrialRequest(
        org_id=org_id,
        user_id=user.id,
        contact_name=body.contact_name.strip(),
        event_name=(body.event_name or "").strip() or None,
        guest_count=body.guest_count,
        use_case=(body.use_case or "").strip() or None,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


@router.get("/trial-requests/mine", response_model=list[TrialRequestOut])
async def my_trial_requests(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    org_id = await _user_org_id(user, db)
    rows = (await db.execute(
        select(TrialRequest).where(TrialRequest.org_id == org_id)
        .order_by(desc(TrialRequest.created_at))
    )).scalars().all()
    return rows
