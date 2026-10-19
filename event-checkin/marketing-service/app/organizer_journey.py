"""Durable event-scoped evidence and owned handoff cases.

No provider calls, timers, account lookup by contact details, or historical backfill.
Only the existing authenticated backend may attest to source outcomes.
"""
import hashlib
import json
import os
from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from sqlalchemy import Column, String, JSON, select
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.exc import IntegrityError


class Base(DeclarativeBase):
    pass


class Evidence(Base):
    __tablename__ = "marketing_organizer_evidence"
    id = Column(String(128), primary_key=True)
    fingerprint = Column(String(64), nullable=False)
    account_id = Column(String(128), nullable=False, index=True)
    org_id = Column(String(128), nullable=False, index=True)
    event_id = Column(String(128), nullable=False, index=True)
    use_case = Column(String(40), nullable=False)
    milestone = Column(String(40), nullable=False)
    source_id = Column(String(128), nullable=False)
    occurred_at = Column(String(40), nullable=False)


class Handoff(Base):
    __tablename__ = "marketing_handoff_cases"
    id = Column(String(36), primary_key=True)
    lead_id = Column(String(36), nullable=False, unique=True)
    owner = Column(String(240), nullable=True)
    status = Column(String(30), nullable=False, default="open")
    notification = Column(String(30), nullable=False, default="pending")
    history = Column(JSON, nullable=False, default=list)


MILESTONES = frozenset({"configured", "ready", "rehearsal", "guest_imported",
    "invitation_delivered", "rsvp_received", "checkin_succeeded", "event_completed",
    "event_cancelled", "event_created", "event_pass_purchased", "ticket_order_paid",
    "subscription_started", "subscription_renewed"})
OUTCOMES = frozenset({"guest_imported", "invitation_delivered", "rsvp_received", "checkin_succeeded"})


def stamp():
    return datetime.now(timezone.utc).isoformat()


def fingerprint(body):
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def summary(rows):
    """Derive from evidence sets, so duplicate/out-of-order delivery cannot regress."""
    events = {}
    for row in rows:
        key = (row.org_id, row.event_id, row.use_case)
        events.setdefault(key, set()).add(row.milestone)
    cancelled = {(r.org_id, r.event_id) for r in rows if r.milestone == "event_cancelled"}
    completed = {(r.org_id, r.event_id) for r in rows if r.milestone == "event_completed"} - cancelled
    return {"events": [dict(org_id=org, event_id=event, use_case=use_case,
        milestones=sorted(values), first_value=bool(values & OUTCOMES),
        complete="event_completed" in values and (org, event) not in cancelled, cancelled=(org, event) in cancelled)
        for (org, event, use_case), values in sorted(events.items())],
        "completed_events": len(completed), "repeat_event_completed": len(completed) > 1,
        "metrics": {kind: len({(r.org_id, r.event_id, r.source_id) for r in rows if r.milestone == kind})
                    for kind in sorted(MILESTONES)}}


def retention_guidance(m, db, lead):
    """Organizer category only; never sends or creates guest thank-you work."""
    from .sales_responses import flag
    if not flag("MARKETING_ORGANIZER_RETENTION_ENABLED") or m.email_pilot.stopped(lead) or not lead.consent_email:
        return {"eligible": False, "reason": "disabled_or_suppressed", "guidance": []}
    rows = db.scalars(select(Evidence).where(Evidence.account_id == lead.festio_user_id)).all()
    state = summary(rows)
    items = [dict(event_id=e["event_id"], org_id=e["org_id"], category="organizer_retention",
                  text="Review event results and outstanding exceptions. When you are ready, create a new draft and review its dates and readiness checks.")
             for e in state["events"] if e["complete"] and not e["cancelled"]]
    # Multiple use cases for an event still produce only one organizer next step.
    unique = {(i["org_id"], i["event_id"]): i for i in items}
    return {"eligible": bool(unique), "guidance": list(unique.values()), "sends": 0}


def open_handoff(m, db, lead, channel, event_id):
    case = db.scalar(select(Handoff).where(Handoff.lead_id == lead.id))
    if not case:
        grant = db.scalar(select(m.AccessGrant).where(m.AccessGrant.email == lead.owner_email,
                          m.AccessGrant.active.is_(True), m.AccessGrant.role != "viewer"))
        # The legacy fallback email is not proof that an operator is assigned.
        owner = lead.owner_email if grant else os.getenv("MARKETING_HANDOFF_OWNER") or None
        case = Handoff(id=m.uid(), lead_id=lead.id, owner=owner,
                       status="open", notification="pending", history=[])
        db.add(case)
    elif case.status == "resolved":
        case.status = "open"
        case.notification = "pending"
    case.history = [*case.history, {"at": stamp(), "action": "received", "channel": channel, "event_id": event_id}]
    # Notification is an explicit adapter operation; absent wiring is not success.
    if not case.owner:
        case.notification = "missing_owner"
    elif not os.getenv("MARKETING_HANDOFF_DESTINATION"):
        case.notification = "unconfigured"
    return case


def notify_handoff(case, adapter):
    """Adapter must be idempotent on case.id; errors preserve backlog and pause."""
    if not case.owner or not os.getenv("MARKETING_HANDOFF_DESTINATION"):
        case.notification = "unconfigured"
        return False
    try:
        accepted = adapter.notify(case_id=case.id, owner=case.owner,
                                  destination=os.environ["MARKETING_HANDOFF_DESTINATION"])
        case.notification = "accepted" if accepted is True else "uncertain"
    except Exception:
        case.notification = "failed"
    case.history = [*case.history, {"at": stamp(), "action": "notification", "result": case.notification}]
    return case.notification == "accepted"


def install(m):
    Base.metadata.create_all(m.engine)
    from . import sales_responses
    sales_responses.Base.metadata.create_all(m.engine)

    @m.app.post("/api/marketing/internal/sales-responses")
    def prepare_reply(body: dict, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        if not identity.is_superadmin or identity.subject != "festio-backend":
            raise HTTPException(403, "Authenticated ingress adapter required")
        if not sales_responses.flag("MARKETING_SALES_INGRESS_ENABLED"):
            raise HTTPException(503, "Sales response ingress disabled")
        reply = sales_responses.ingest(db, body)
        return {"recorded": True, "id": reply.id, "status": reply.status}

    @m.app.post("/api/marketing/internal/organizer-milestones")
    def ingest(body: dict, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        if not identity.is_superadmin or identity.subject != "festio-backend":
            raise HTTPException(403, "Authenticated backend outcome producer required")
        required = ("id", "account_id", "org_id", "organizer_event_id", "use_case", "milestone", "source_id", "occurred_at")
        if any(not isinstance(body.get(k), str) or not 1 <= len(body[k]) <= 128 for k in required):
            raise HTTPException(422, "Bounded source evidence required")
        if body["milestone"] not in MILESTONES:
            raise HTTPException(422, "Unknown milestone")
        try:
            at = datetime.fromisoformat(body["occurred_at"].replace("Z", "+00:00"))
            if at.tzinfo is None or at > datetime.now(timezone.utc):
                raise ValueError()
        except ValueError:
            raise HTTPException(422, "Nonfuture timezone-qualified outcome required")
        # Source adapter must establish current exact tenant ownership; this
        # endpoint does not infer account identity from email or phone.
        if body.get("current_owner") is not True:
            raise HTTPException(403, "Current ownership required")
        if body.get("synthetic") is not False:
            raise HTTPException(422, "Explicit real-source provenance required")
        fp = fingerprint(body)
        old = db.get(Evidence, body["id"])
        if old:
            if old.fingerprint != fp:
                raise HTTPException(409, "Evidence identity conflict")
            return {"recorded": True, "duplicate": True}
        fields = {k: body[k] for k in required if k != "organizer_event_id"}
        db.add(Evidence(**fields, event_id=body["organizer_event_id"], fingerprint=fp))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            old = db.get(Evidence, body["id"])
            if not old or old.fingerprint != fp:
                raise HTTPException(409, "Evidence identity conflict")
            return {"recorded": True, "duplicate": True}
        return {"recorded": True, "duplicate": False}

    @m.app.get("/api/marketing/organizer-funnel/{lead_id}")
    def funnel(lead_id: str, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        lead = db.get(m.Lead, lead_id)
        if not lead or (not identity.is_superadmin and lead.owner_email != identity.email):
            raise HTTPException(404, "Lead not found")
        return summary(db.scalars(select(Evidence).where(Evidence.account_id == lead.festio_user_id)).all())

    @m.app.get("/api/marketing/handoffs")
    def backlog(identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        query = select(Handoff).where(Handoff.status != "resolved")
        if not identity.is_superadmin:
            query = query.where(Handoff.owner == identity.email)
        return [dict(id=c.id, lead_id=c.lead_id, owner=c.owner, status=c.status,
                     notification=c.notification, history=c.history) for c in db.scalars(query)]

    @m.app.post("/api/marketing/handoffs/{case_id}/assign-owner")
    def assign_owner(case_id: str, body: dict, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        if not identity.is_superadmin:
            raise HTTPException(403, "Superadmin assignment required")
        case = db.get(Handoff, case_id)
        owner = body.get("owner")
        grant = db.scalar(select(m.AccessGrant).where(m.AccessGrant.email == owner, m.AccessGrant.active.is_(True))) if isinstance(owner, str) else None
        if not case or not grant or grant.role == "viewer":
            raise HTTPException(409, "An active operator owner is required")
        case.owner, case.notification = owner, "pending"
        case.history = [*case.history, {"at": stamp(), "action": "assigned", "actor": identity.email, "owner": owner}]
        db.commit()
        return {"id": case.id, "owner": case.owner}

    @m.app.get("/api/marketing/organizer-retention/{lead_id}")
    def retention(lead_id: str, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        lead = db.get(m.Lead, lead_id)
        if not lead or (not identity.is_superadmin and lead.owner_email != identity.email):
            raise HTTPException(404, "Lead not found")
        return retention_guidance(m, db, lead)

    @m.app.get("/api/marketing/journey-safety")
    def safety(identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        if not identity.is_superadmin:
            raise HTTPException(403, "Safety metrics require superadmin")
        from sqlalchemy import func
        return {"reply_outcomes": dict(db.execute(select(sales_responses.Reply.status, func.count()).group_by(sales_responses.Reply.status)).all()),
                "handoff_backlog": dict(db.execute(select(Handoff.notification, func.count()).where(Handoff.status != "resolved").group_by(Handoff.notification)).all()),
                "gates": {name: sales_responses.flag(name) for name in (
                    "MARKETING_OUTBOUND_ENABLED", "MARKETING_SALES_INGRESS_ENABLED", "MARKETING_SALES_CHAT_ENABLED",
                    "MARKETING_SALES_WHATSAPP_ENABLED", "MARKETING_ORGANIZER_RETENTION_ENABLED")}}

    @m.app.post("/api/marketing/handoffs/{case_id}/{action}")
    def transition(case_id: str, action: str, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        case = db.get(Handoff, case_id)
        if not case or (not identity.is_superadmin and case.owner != identity.email):
            raise HTTPException(404, "Case not found")
        if identity.role == "viewer" or action not in {"acknowledge", "resolve"}:
            raise HTTPException(403, "Owned operator action required")
        if not case.owner:
            raise HTTPException(409, "Assign an owner before resolving")
        case.status = "acknowledged" if action == "acknowledge" else "resolved"
        case.history = [*case.history, {"at": stamp(), "action": action, "actor": identity.email}]
        # Resolving a case does not silently resume lead automation.
        db.commit()
        return {"id": case.id, "status": case.status, "automation_paused": True}

    @m.app.get("/api/marketing/template-review")
    def review(identity=Depends(m.decode_identity)):
        if not identity.is_superadmin:
            raise HTTPException(403, "Template review requires superadmin")
        from .journey_templates import candidates
        return {"candidates": candidates(), "stored_templates_changed": False}

    @m.app.post("/api/marketing/template-review/{sequence_id}")
    def migrate(sequence_id: str, body: dict, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        if not identity.is_superadmin:
            raise HTTPException(403, "Template migration requires superadmin")
        sequence = db.get(m.ModuleRecord, sequence_id)
        from .journey_templates import candidates
        if not sequence or sequence.module != "sequences" or sequence.name not in candidates():
            raise HTTPException(404, "Sequence not found")
        if body.get("expected_fingerprint") != m.email_pilot.template_fingerprint(sequence):
            raise HTTPException(409, "Stored template changed; review again")
        sequence.payload = candidates()[sequence.name]
        m.audit(db, identity, "template.review_migration", "sequence", sequence.id)
        db.commit()
        return {"id": sequence.id, "fingerprint": m.email_pilot.template_fingerprint(sequence), "requires_new_approval": True}
