"""Customer-facing trial-credit requests. A logged-in org member asks to try
paid features; an operator approves in the Console (see admin.py)."""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User, Membership, Organization, TrialRequest
from ..schemas import TrialRequestCreate, TrialRequestOut
from ..auth import get_current_user
from services.email_service import send_simple_email

router = APIRouter()


async def _operator_emails(db: AsyncSession) -> list[str]:
    rows = (await db.execute(
        select(User.email).where(User.is_platform_superadmin.is_(True))
    )).scalars().all()
    return [e for e in rows if e]


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
    background_tasks: BackgroundTasks,
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
        phone=(body.phone or "").strip() or None,
        event_name=(body.event_name or "").strip() or None,
        guest_count=body.guest_count,
        use_case=(body.use_case or "").strip() or None,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    # Notify: acknowledge the requester + alert operators (best-effort, async).
    org = await db.get(Organization, org_id)
    org_name = org.name if org else "your organization"
    if user.email:
        background_tasks.add_task(
            send_simple_email, user.email,
            "We got your trial request — Festio",
            f"<p>Hi {req.contact_name},</p><p>Thanks for requesting a free trial of "
            "Festio's paid features. Our team will review it and set you up shortly — "
            "you'll get an email once it's approved.</p><p>— The Festio team</p>",
        )
    for op_email in await _operator_emails(db):
        background_tasks.add_task(
            send_simple_email, op_email,
            f"New trial request — {org_name}",
            f"<p><strong>{org_name}</strong> requested a trial.</p><ul>"
            f"<li>Contact: {req.contact_name}</li>"
            f"<li>Email: {user.email or '—'}</li>"
            f"<li>Phone: {req.phone or '—'}</li>"
            f"<li>Event: {req.event_name or '—'}</li>"
            f"<li>Expected guests: {req.guest_count if req.guest_count is not None else '—'}</li>"
            f"<li>Wants: {req.use_case or '—'}</li></ul>"
            "<p>Resolve it in the Operator Console → Trial requests.</p>",
        )
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
