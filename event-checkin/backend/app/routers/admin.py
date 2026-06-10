"""Platform-operator (superadmin) console — cross-tenant management.

All endpoints require platform superadmin. Lets operators run the business
without code: see all tenants, comp/credit events, manage operators, edit pricing.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Organization, Event, User, PricingPlan, AffiliateStore, TrialRequest
from ..schemas import (GrantRequest, OperatorInvite, PlanUpsert, UserOut,
                       AffiliateStoreIn, AffiliateStoreOut, TrialRequestOut, TrialResolve)
from ..auth import require_superadmin
from ..billing import get_plan, apply_purchase
from services.email_service import send_simple_email

router = APIRouter()


@router.get("/overview")
async def overview(_: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    """Every organization with its events (plan, paid status, credits)."""
    orgs = (await db.execute(select(Organization).order_by(Organization.created_at))).scalars().all()
    events = (await db.execute(select(Event).order_by(Event.created_at.desc()))).scalars().all()
    by_org: dict[str, list] = {}
    for e in events:
        by_org.setdefault(e.org_id, []).append({
            "id": e.id, "name": e.name, "status": e.status,
            "plan_tier": e.plan_tier, "is_paid": e.is_paid,
            "message_credits": e.message_credits, "guest_cap": e.guest_cap,
        })
    return [
        {
            "id": o.id, "name": o.name, "slug": o.slug,
            "region": o.region, "currency": o.currency, "plan": o.plan,
            "events": by_org.get(o.id, []),
        }
        for o in orgs
    ]


@router.post("/events/{event_id}/grant")
async def grant(event_id: str, body: GrantRequest, _: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    """Comp an event onto a tier and/or add message credits — no payment."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if body.tier:
        plan = await get_plan(db, body.tier)
        if not plan:
            raise HTTPException(400, "Unknown tier")
        apply_purchase(event, plan)
    if body.add_credits:
        event.message_credits = (event.message_credits or 0) + int(body.add_credits)
    await db.commit()
    await db.refresh(event)
    return {
        "ok": True, "plan_tier": event.plan_tier, "is_paid": event.is_paid,
        "guest_cap": event.guest_cap, "message_credits": event.message_credits,
    }


# ── Operators (platform superadmins) ────────────────────────────────────────

@router.get("/operators", response_model=list[UserOut])
async def list_operators(_: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    return (await db.execute(
        select(User).where(User.is_platform_superadmin.is_(True)).order_by(User.email)
    )).scalars().all()


@router.post("/operators", response_model=UserOut)
async def add_operator(body: OperatorInvite, _: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    email = body.email.lower().strip()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user:
        user = User(name=email.split("@")[0], email=email, role="official", is_platform_superadmin=True)
        db.add(user)
    else:
        user.is_platform_superadmin = True
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/operators/{user_id}", status_code=204)
async def remove_operator(user_id: str, current: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    if user_id == current.id:
        raise HTTPException(400, "You can't revoke your own operator access.")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.is_platform_superadmin = False
    await db.commit()


# ── Pricing plans (editable; reflects on live pricing + checkout) ────────────

@router.get("/plans")
async def list_all_plans(_: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(PricingPlan).order_by(PricingPlan.kind, PricingPlan.sort_order)
    )).scalars().all()
    return [
        {"key": p.key, "kind": p.kind, "label": p.label, "guest_cap": p.guest_cap,
         "credits": p.credits, "usd": p.usd, "ngn": p.ngn, "active": p.active,
         "sort_order": p.sort_order}
        for p in rows
    ]


@router.put("/plans/{key}")
async def upsert_plan(key: str, body: PlanUpsert, _: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    plan = await db.get(PricingPlan, key)
    if not plan:
        plan = PricingPlan(key=key)
        db.add(plan)
    plan.kind = body.kind
    plan.label = body.label
    plan.guest_cap = body.guest_cap
    plan.credits = body.credits
    plan.usd = body.usd
    plan.ngn = body.ngn
    plan.active = body.active
    plan.sort_order = body.sort_order
    await db.commit()
    return {"ok": True}


@router.delete("/plans/{key}", status_code=204)
async def delete_plan(key: str, _: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    plan = await db.get(PricingPlan, key)
    if not plan:
        raise HTTPException(404, "Plan not found")
    await db.delete(plan)
    await db.commit()


# ── Affiliate stores (registry Buy-link tags) ─────────────────────────────────

def _store_out(s: AffiliateStore) -> AffiliateStoreOut:
    return AffiliateStoreOut(
        id=s.id, domain=s.domain, label=s.label, param_key=s.param_key,
        param_value=s.param_value, active=s.active, sort_order=s.sort_order,
    )


@router.get("/affiliate-stores", response_model=list[AffiliateStoreOut])
async def list_affiliate_stores(_: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(AffiliateStore).order_by(AffiliateStore.sort_order, AffiliateStore.domain)
    )).scalars().all()
    return [_store_out(s) for s in rows]


@router.post("/affiliate-stores", response_model=AffiliateStoreOut, status_code=201)
async def create_affiliate_store(body: AffiliateStoreIn, _: User = Depends(require_superadmin),
                                 db: AsyncSession = Depends(get_db)):
    s = AffiliateStore(
        domain=body.domain.strip().lower(), label=body.label.strip(),
        param_key=body.param_key.strip(), param_value=body.param_value.strip(),
        active=body.active, sort_order=body.sort_order,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _store_out(s)


@router.put("/affiliate-stores/{store_id}", response_model=AffiliateStoreOut)
async def update_affiliate_store(store_id: str, body: AffiliateStoreIn,
                                 _: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    s = await db.get(AffiliateStore, store_id)
    if not s:
        raise HTTPException(404, "Store not found")
    s.domain = body.domain.strip().lower()
    s.label = body.label.strip()
    s.param_key = body.param_key.strip()
    s.param_value = body.param_value.strip()
    s.active = body.active
    s.sort_order = body.sort_order
    await db.commit()
    await db.refresh(s)
    return _store_out(s)


@router.delete("/affiliate-stores/{store_id}", status_code=204)
async def delete_affiliate_store(store_id: str, _: User = Depends(require_superadmin),
                                 db: AsyncSession = Depends(get_db)):
    s = await db.get(AffiliateStore, store_id)
    if not s:
        raise HTTPException(404, "Store not found")
    await db.delete(s)
    await db.commit()


# ── Trial-credit requests ────────────────────────────────────────────────────

async def _trial_out(req: TrialRequest, db: AsyncSession) -> TrialRequestOut:
    org = await db.get(Organization, req.org_id)
    requester = await db.get(User, req.user_id)
    out = TrialRequestOut.model_validate(req)
    out.org_name = org.name if org else None
    out.requester_email = requester.email if requester else None
    return out


@router.get("/trial-requests", response_model=list[TrialRequestOut])
async def list_trial_requests(status: str | None = None, _: User = Depends(require_superadmin),
                              db: AsyncSession = Depends(get_db)):
    """All trial requests for the operator queue. Pending first, newest first."""
    q = select(TrialRequest).order_by(TrialRequest.status != "pending", desc(TrialRequest.created_at))
    if status:
        q = select(TrialRequest).where(TrialRequest.status == status).order_by(desc(TrialRequest.created_at))
    rows = (await db.execute(q)).scalars().all()
    return [await _trial_out(r, db) for r in rows]


@router.post("/trial-requests/{req_id}/resolve", response_model=TrialRequestOut)
async def resolve_trial_request(req_id: str, body: TrialResolve,
                                background_tasks: BackgroundTasks,
                                operator: User = Depends(require_superadmin),
                                db: AsyncSession = Depends(get_db)):
    """Approve or decline a trial request. On approve, grant a tier and/or
    credits either to a specific event (comp now) or — when the org has no
    event yet — to the org, to auto-apply to the next event they create."""
    req = await db.get(TrialRequest, req_id)
    if not req:
        raise HTTPException(404, "Request not found")
    if req.status != "pending":
        raise HTTPException(409, "This request has already been resolved.")

    granted_desc = ""
    if body.action == "approve":
        plan = None
        if body.tier:
            plan = await get_plan(db, body.tier)
            if not plan:
                raise HTTPException(400, "Unknown tier")
        if body.event_id:
            # Comp a specific existing event now.
            event = await db.get(Event, body.event_id)
            if not event or event.org_id != req.org_id:
                raise HTTPException(400, "Event not found in this organization.")
            if plan:
                apply_purchase(event, plan)
            if body.add_credits:
                event.message_credits = (event.message_credits or 0) + int(body.add_credits)
            granted_desc = f"applied to “{event.name}”"
        elif body.tier or body.add_credits:
            # No event yet — stash on the org; consumed by their next event.
            org = await db.get(Organization, req.org_id)
            if not org:
                raise HTTPException(400, "Organization not found.")
            if body.tier:
                org.trial_tier = body.tier
            if body.add_credits:
                org.trial_credits = (org.trial_credits or 0) + int(body.add_credits)
            granted_desc = "saved to your account — it applies to the next event you create"
        req.status = "approved"
    else:
        req.status = "declined"

    req.resolved_at = datetime.utcnow()
    req.resolved_by = operator.id
    req.resolution_note = (body.note or "").strip() or None
    await db.commit()
    await db.refresh(req)

    # Email the requester the outcome (best-effort).
    requester = await db.get(User, req.user_id)
    if requester and requester.email:
        if req.status == "approved":
            extra = f" Your trial has been {granted_desc}." if granted_desc else ""
            note = f"<p>Note: {req.resolution_note}</p>" if req.resolution_note else ""
            background_tasks.add_task(
                send_simple_email, requester.email,
                "Your EventQR trial is approved 🎉",
                f"<p>Hi {req.contact_name},</p><p>Good news — your trial request is approved."
                f"{extra}</p>{note}<p>Sign in to get started.</p><p>— The EventQR team</p>",
            )
        else:
            note = f"<p>{req.resolution_note}</p>" if req.resolution_note else ""
            background_tasks.add_task(
                send_simple_email, requester.email,
                "About your EventQR trial request",
                f"<p>Hi {req.contact_name},</p><p>Thanks for your interest. We're not able to "
                f"approve this trial request right now.</p>{note}"
                "<p>You can still start free, or reply with more details.</p>",
            )
    return await _trial_out(req, db)
