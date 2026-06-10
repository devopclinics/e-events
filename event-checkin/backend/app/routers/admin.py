"""Platform-operator (superadmin) console — cross-tenant management.

All endpoints require platform superadmin. Lets operators run the business
without code: see all tenants, comp/credit events, manage operators, edit pricing.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select, desc, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Organization, Event, User, Membership, PricingPlan, AffiliateStore, TrialRequest
from ..schemas import (GrantRequest, OperatorInvite, PlanUpsert, UserOut,
                       AffiliateStoreIn, AffiliateStoreOut, TrialRequestOut, TrialResolve,
                       AccountOrgOut, AccountMemberOut, ActiveToggle, MemberRole)
from ..auth import require_superadmin, set_firebase_disabled, delete_firebase_user
from ..billing import get_plan, apply_purchase
from services.email_service import send_simple_email

DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001"  # legacy default org — protected

# Child tables to clear when hard-deleting an org, in FK-safe order. Scoped to
# the org's events (E) or the org itself. See db FK map.
_ORG_DELETE_SQL = [
    "DELETE FROM scan_events WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM guest_shipments WHERE shipment_id IN (SELECT id FROM shipments WHERE event_id IN (SELECT id FROM events WHERE org_id=:o))",
    "DELETE FROM shipments WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM rsvp_answers WHERE question_id IN (SELECT id FROM rsvp_questions WHERE event_id IN (SELECT id FROM events WHERE org_id=:o))",
    "DELETE FROM rsvp_questions WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM guest_menu_choices WHERE guest_id IN (SELECT id FROM guests WHERE event_id IN (SELECT id FROM events WHERE org_id=:o))",
    "DELETE FROM menu_combination_items WHERE combination_id IN (SELECT id FROM menu_combinations WHERE event_id IN (SELECT id FROM events WHERE org_id=:o))",
    "DELETE FROM menu_combinations WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM menu_items WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM menu_categories WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM registry_claims WHERE item_id IN (SELECT id FROM registry_items WHERE event_id IN (SELECT id FROM events WHERE org_id=:o))",
    "DELETE FROM registry_items WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "UPDATE guests SET partner_guest_id=NULL, table_id=NULL WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM guests WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM seating_tables WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM ticket_types WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM zones WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM event_users WHERE event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM payments WHERE org_id=:o OR event_id IN (SELECT id FROM events WHERE org_id=:o)",
    "DELETE FROM events WHERE org_id=:o",
    "DELETE FROM trial_requests WHERE org_id=:o",
    "DELETE FROM memberships WHERE org_id=:o",
    "DELETE FROM organizations WHERE id=:o",
]


async def _delete_org(org_id: str, db: AsyncSession) -> None:
    for stmt in _ORG_DELETE_SQL:
        await db.execute(text(stmt), {"o": org_id})

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


# ── Account management (orgs, members, users) ────────────────────────────────

@router.get("/accounts", response_model=list[AccountOrgOut])
async def list_accounts(_: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    """Every org with its members and event count — for the Accounts panel."""
    orgs = (await db.execute(select(Organization).order_by(Organization.created_at))).scalars().all()
    counts = dict((await db.execute(
        select(Event.org_id, func.count(Event.id)).group_by(Event.org_id)
    )).all())
    rows = (await db.execute(
        select(Membership.org_id, Membership.role, User)
        .join(User, User.id == Membership.user_id)
    )).all()
    members_by_org: dict[str, list[AccountMemberOut]] = {}
    for org_id, role, u in rows:
        members_by_org.setdefault(org_id, []).append(AccountMemberOut(
            user_id=u.id, name=u.name, email=u.email, role=role,
            is_active=u.is_active, is_platform_superadmin=u.is_platform_superadmin,
        ))
    return [AccountOrgOut(
        id=o.id, name=o.name, slug=o.slug, is_active=o.is_active,
        created_at=o.created_at, event_count=int(counts.get(o.id, 0)),
        members=members_by_org.get(o.id, []),
    ) for o in orgs]


@router.patch("/orgs/{org_id}/active", response_model=AccountOrgOut)
async def set_org_active(org_id: str, body: ActiveToggle,
                         _: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    """Suspend or reactivate a tenant. Suspended → members lose access to its
    events (enforced in _org_role / list_events); reversible, no data loss."""
    if org_id == DEFAULT_ORG_ID:
        raise HTTPException(400, "The default organization cannot be suspended.")
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(404, "Organization not found")
    org.is_active = body.active
    await db.commit()
    await db.refresh(org)
    cnt = await db.scalar(select(func.count(Event.id)).where(Event.org_id == org_id)) or 0
    return AccountOrgOut(id=org.id, name=org.name, slug=org.slug, is_active=org.is_active,
                         created_at=org.created_at, event_count=int(cnt), members=[])


@router.delete("/orgs/{org_id}", status_code=204)
async def delete_org(org_id: str, _: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    """Hard-delete a tenant and ALL its data (events, guests, scans, …).
    Irreversible. Member user accounts remain (delete them separately)."""
    if org_id == DEFAULT_ORG_ID:
        raise HTTPException(400, "The default organization cannot be deleted.")
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(404, "Organization not found")
    await _delete_org(org_id, db)
    await db.commit()


@router.patch("/orgs/{org_id}/members/{user_id}", response_model=AccountMemberOut)
async def set_member_role(org_id: str, user_id: str, body: MemberRole,
                          _: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    m = await db.scalar(select(Membership).where(
        Membership.org_id == org_id, Membership.user_id == user_id))
    if not m:
        raise HTTPException(404, "Membership not found")
    m.role = body.role
    await db.commit()
    u = await db.get(User, user_id)
    return AccountMemberOut(user_id=u.id, name=u.name, email=u.email, role=body.role,
                            is_active=u.is_active, is_platform_superadmin=u.is_platform_superadmin)


@router.delete("/orgs/{org_id}/members/{user_id}", status_code=204)
async def remove_member(org_id: str, user_id: str,
                        _: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    """Remove a user from an org. Their account itself is untouched."""
    m = await db.scalar(select(Membership).where(
        Membership.org_id == org_id, Membership.user_id == user_id))
    if not m:
        raise HTTPException(404, "Membership not found")
    await db.delete(m)
    await db.commit()


@router.patch("/users/{user_id}/active", response_model=UserOut)
async def set_user_active(user_id: str, body: ActiveToggle,
                          operator: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    """Suspend or reactivate a user account — also disables/enables the Firebase
    login so a suspended user can't re-authenticate."""
    if user_id == operator.id:
        raise HTTPException(400, "You can't suspend your own account.")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.is_active = body.active
    await db.commit()
    set_firebase_disabled(user.firebase_uid, not body.active)
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: str, operator: User = Depends(require_superadmin),
                      db: AsyncSession = Depends(get_db)):
    """Delete a user account everywhere + delete their Firebase login. Blocks
    deleting yourself or the last remaining operator."""
    if user_id == operator.id:
        raise HTTPException(400, "You can't delete your own account.")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.is_platform_superadmin:
        others = await db.scalar(select(func.count(User.id)).where(
            User.is_platform_superadmin.is_(True), User.id != user_id))
        if not others:
            raise HTTPException(400, "Can't delete the last operator.")
    uid = user.firebase_uid
    # Unlink references that must survive / can't cascade, then remove the user.
    await db.execute(text("UPDATE scan_events SET scanned_by=NULL WHERE scanned_by=:u"), {"u": user_id})
    await db.execute(text("UPDATE trial_requests SET resolved_by=NULL WHERE resolved_by=:u"), {"u": user_id})
    await db.execute(text("DELETE FROM trial_requests WHERE user_id=:u"), {"u": user_id})
    await db.execute(text("DELETE FROM event_users WHERE user_id=:u"), {"u": user_id})
    await db.execute(text("DELETE FROM memberships WHERE user_id=:u"), {"u": user_id})
    await db.delete(user)
    await db.commit()
    delete_firebase_user(uid)


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
