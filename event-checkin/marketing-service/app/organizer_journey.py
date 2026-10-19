"""Durable event-scoped evidence and owned handoff cases.

No provider calls, timers, account lookup by contact details, or historical backfill.
Only the existing authenticated backend may attest to source outcomes.
"""
import hashlib
import json
import os
from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from sqlalchemy import Column, String, Integer, JSON, select
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
    config_revision = Column(String(64), nullable=True)


class Handoff(Base):
    __tablename__ = "marketing_handoff_cases"
    id = Column(String(36), primary_key=True)
    lead_id = Column(String(128), nullable=False, unique=True)
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
    generation = Column(Integer, nullable=False, default=1, server_default="1")
    owner = Column(String(240), nullable=True)
    status = Column(String(30), nullable=False, default="open")
    notification = Column(String(30), nullable=False, default="pending")
    history = Column(JSON, nullable=False, default=list)


class CommerceFact(Base):
    __tablename__ = "marketing_commerce_facts"
    id = Column(String(128), primary_key=True)
    fingerprint = Column(String(64), nullable=False)
    logical_key = Column(String(64), nullable=False)
    account_id = Column(String(128), nullable=False, index=True)
    org_id = Column(String(128), nullable=False)
    event_id = Column(String(128), nullable=True)
    kind = Column(String(40), nullable=False)
    amount = Column(Integer, nullable=False)
    currency = Column(String(3), nullable=False)
    occurred_at = Column(String(40), nullable=False)


def commerce_metrics(rows):
    acquired = {r.account_id for r in rows if r.kind == "event_pass" and r.amount > 0}
    unique = {(r.org_id, r.kind, r.logical_key): r for r in rows}
    kinds = {k: [r for r in unique.values() if r.kind == k] for k in ("event_pass", "attendee_order", "ticket_sales", "subscription_started", "subscription_renewed")}
    return {"organizer_acquired": len(acquired),
        "counts": {k: len([r for r in values if r.amount > 0]) for k, values in kinds.items()},
        "free_orders": len([r for r in kinds["attendee_order"] if r.amount == 0]),
        "amounts_by_currency": {k: {currency: sum(r.amount for r in values if r.currency == currency)
            for currency in sorted({r.currency for r in values})} for k, values in kinds.items()}}


MILESTONES = frozenset({"configured", "ready", "rehearsal", "guest_imported",
    "invitation_delivered", "rsvp_received", "checkin_succeeded", "event_completed",
    "event_cancelled", "event_created", "event_pass_purchased", "ticket_order_paid",
    "subscription_started", "subscription_renewed"})
OUTCOMES = frozenset({"guest_imported", "invitation_delivered", "rsvp_received", "checkin_succeeded", "ticket_order_paid"})


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
    def readiness(org,event,use_case):
        configured=[r for r in rows if r.org_id==org and r.event_id==event and r.milestone in {"configured","event_created"} and getattr(r,"config_revision",None)]
        ready=[r for r in rows if r.org_id==org and r.event_id==event and r.use_case==use_case and r.milestone=="ready" and getattr(r,"config_revision",None)]
        latest=max(configured,key=lambda r:utc(r.occurred_at)) if configured else None
        return bool(latest and any(r.config_revision==latest.config_revision for r in ready))
    cancelled = {(r.org_id, r.event_id) for r in rows if r.milestone == "event_cancelled"}
    completed = {(r.org_id, r.event_id) for r in rows if r.milestone == "event_completed"} - cancelled
    from .email_pilot import utc
    completions = [(r.event_id, utc(getattr(r, "occurred_at", None))) for r in rows if r.milestone == "event_completed" and (r.org_id, r.event_id) in completed]
    next_event = any(r.milestone == "event_created" and r.event_id != previous and at and utc(getattr(r, "occurred_at", None)) and utc(r.occurred_at) >= at
                     for r in rows for previous, at in completions)
    return {"events": [dict(org_id=org, event_id=event, use_case=use_case,
        milestones=sorted(values), first_value=bool(values & OUTCOMES),
        ready=readiness(org,event,use_case), ready_recorded="ready" in values, readiness_scope="organizer_recorded_event_configuration",
        complete=(org, event) in completed, cancelled=(org, event) in cancelled)
        for (org, event, use_case), values in sorted(events.items())],
        "completed_events": len(completed), "next_event_created": next_event, "repeat_event_completed": len(completed) > 1,
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
        case.generation += 1
        case.attempts = 0
    if not any(item.get("event_id") == event_id for item in case.history):
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
    from .retention import Base as RetentionBase
    RetentionBase.metadata.create_all(m.engine)
    # Checkpoint upgrades are additive; no historical enrollment or repair.
    from sqlalchemy import inspect, text
    if "sequence_id" not in {c["name"] for c in inspect(m.engine).get_columns("marketing_organizer_retention_jobs")}:
        with m.engine.begin() as connection:
            connection.execute(text("ALTER TABLE marketing_organizer_retention_jobs ADD COLUMN sequence_id VARCHAR(36)"))
    if "last_attempt_at" not in {c["name"] for c in inspect(m.engine).get_columns("marketing_organizer_retention_jobs")}:
        with m.engine.begin() as connection:
            connection.execute(text("ALTER TABLE marketing_organizer_retention_jobs ADD COLUMN last_attempt_at VARCHAR(40)"))
    if "attempts" not in {c["name"] for c in inspect(m.engine).get_columns(Handoff.__tablename__)}:
        with m.engine.begin() as connection:
            connection.execute(text("ALTER TABLE marketing_handoff_cases ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0"))
    if "generation" not in {c["name"] for c in inspect(m.engine).get_columns(Handoff.__tablename__)}:
        with m.engine.begin() as connection:
            connection.execute(text("ALTER TABLE marketing_handoff_cases ADD COLUMN generation INTEGER NOT NULL DEFAULT 1"))
    if "claimed_at" not in {c["name"] for c in inspect(m.engine).get_columns(sales_responses.Reply.__tablename__)}:
        with m.engine.begin() as connection:
            connection.execute(text("ALTER TABLE marketing_sales_replies ADD COLUMN claimed_at VARCHAR(40)"))
    if "config_revision" not in {c["name"] for c in inspect(m.engine).get_columns(Evidence.__tablename__)}:
        with m.engine.begin() as connection:
            connection.execute(text("ALTER TABLE marketing_organizer_evidence ADD COLUMN config_revision VARCHAR(64)"))

    @m.app.post("/api/marketing/journey/run")
    def run_journey(dry_run: bool = True, identity=Depends(m.decode_identity)):
        if not identity.is_superadmin:
            raise HTTPException(403, "Journey worker requires superadmin")
        from .journey_workers import tick
        return tick(m, dry_run=dry_run)

    @m.app.post("/api/marketing/sales-replies/{reply_id}/reconcile")
    def reconcile_reply(reply_id: str, body: dict, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        reply = db.get(sales_responses.Reply, reply_id)
        case = db.scalar(select(Handoff).where(Handoff.lead_id == "sales:"+reply.conversation_id)) if reply else None
        if not reply or not case or (not identity.is_superadmin and (case.owner != identity.email or identity.role == "viewer")):
            raise HTTPException(403, "Assigned reconciliation operator required")
        provider_id = body.get("provider_id")
        if provider_id is not None and (not isinstance(provider_id, str) or not 1 <= len(provider_id) <= 128):
            raise HTTPException(422, "Bounded provider evidence required")
        result = sales_responses.reconcile(db, reply_id, provider_id=provider_id, definitely_not_sent=body.get("definitely_not_sent") is True)
        case.history=[*case.history,{"at":stamp(),"action":"reply_reconciled","event_id":reply_id,"actor":identity.email,"result":result}]
        m.audit(db, identity, "sales.reconciled", "sales_reply", reply_id, result=result)
        db.commit()
        return {"status": result, "automation_paused": True}

    @m.app.get("/api/marketing/sales-conversations/{conversation_id}/attempts")
    def sales_attempts(conversation_id: str, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        case=db.scalar(select(Handoff).where(Handoff.lead_id=="sales:"+conversation_id))
        if not case or (not identity.is_superadmin and case.owner!=identity.email):
            raise HTTPException(403,"Assigned operator required")
        return [dict(id=r.id,status=r.status,provider_id=r.provider_id,attempts=r.attempts,claimed_at=r.claimed_at)
            for r in db.scalars(select(sales_responses.Reply).where(sales_responses.Reply.conversation_id==conversation_id))]

    @m.app.post("/api/marketing/handoffs/{case_id}/reconcile-notification")
    def reconcile_notification(case_id: str, body: dict, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        case = db.get(Handoff, case_id)
        if not case or (not identity.is_superadmin and (case.owner != identity.email or identity.role == "viewer")):
            raise HTTPException(403, "Assigned notification operator required")
        if case.notification not in {"sending", "uncertain"} or not isinstance(body.get("delivered"), bool):
            raise HTTPException(409, "Definitive notification reconciliation required")
        case.notification = "accepted" if body["delivered"] else "pending"
        case.history = [*case.history, {"at": stamp(), "action": "notification_reconciled", "actor": identity.email, "result": case.notification}]
        db.commit()
        return {"notification": case.notification, "automation_paused": True}

    @m.app.post("/api/marketing/sales-conversations/{conversation_id}/resume")
    def resume_conversation(conversation_id: str, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        from sqlalchemy import update, delete
        row = db.get(sales_responses.Conversation, conversation_id)
        case = db.scalar(select(Handoff).where(Handoff.lead_id == "sales:"+conversation_id))
        if not row or not case or (not identity.is_superadmin and (case.owner != identity.email or identity.role == "viewer")):
            raise HTTPException(403, "Assigned operator required")
        uncertain = db.scalar(select(sales_responses.Reply.id).where(sales_responses.Reply.conversation_id == conversation_id, sales_responses.Reply.status.in_(("sending", "unknown"))).limit(1))
        if case.status != "resolved" or row.status == "opted_out" or uncertain:
            raise HTTPException(409, "Resolve handoff and uncertainty; opt-out cannot be overridden")
        row.status = "open"
        db.execute(update(sales_responses.Reply).where(sales_responses.Reply.conversation_id == conversation_id, sales_responses.Reply.status.in_(("prepared", "rejected"))).values(status="cancelled"))
        db.execute(delete(sales_responses.Target).where(sales_responses.Target.conversation_id==conversation_id))
        case.history = [*case.history, {"at": stamp(), "action": "explicit_resume", "actor": identity.email}]
        db.commit()
        return {"resumed_for_future_inbound": True}

    @m.app.on_event("startup")
    def start_clock():
        from .journey_workers import JourneyClock
        clock = getattr(m.app.state, "journey_clock", None) or JourneyClock(m)
        m.app.state.journey_clock = clock
        clock.start()

    @m.app.on_event("shutdown")
    def stop_clock():
        clock = getattr(m.app.state, "journey_clock", None)
        if clock:
            clock.stop()

    @m.app.post("/api/marketing/internal/commerce-facts")
    def commerce(body: dict, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        if not identity.is_superadmin or identity.subject != "festio-backend":
            raise HTTPException(403, "Authenticated commerce source required")
        for key in ("event_id", "account_id", "org_id", "reference", "provider", "occurred_at"):
            if not isinstance(body.get(key), str) or not 1 <= len(body[key]) <= 128:
                raise HTTPException(422, "Bounded commerce source required")
        if body.get("kind") not in {"event_pass", "attendee_order", "ticket_sales", "subscription_started", "subscription_renewed"} or type(body.get("amount")) is not int or body["amount"] < 0:
            raise HTTPException(422, "Invalid commerce fact")
        if body.get("synthetic") is not False or body.get("current_owner") is not True:
            raise HTTPException(403, "Real source and current ownership required")
        if not isinstance(body.get("currency"), str) or len(body["currency"]) != 3 or not body["currency"].isascii() or not body["currency"].isalpha():
            raise HTTPException(422, "Currency required")
        sales_responses.authenticated_time(body["occurred_at"])
        fp = fingerprint(body)
        previous = db.get(CommerceFact, body["event_id"])
        if previous:
            if previous.fingerprint != fp:
                raise HTTPException(409, "Commerce source conflict")
            return {"recorded": True, "duplicate": True}
        db.add(CommerceFact(id=body["event_id"], fingerprint=fp, logical_key=fingerprint([body["org_id"], body["provider"], body["kind"], body["reference"]]), account_id=body["account_id"], org_id=body["org_id"],
            event_id=body.get("organizer_event_id"), kind=body["kind"], amount=body["amount"], currency=body["currency"].upper(), occurred_at=body["occurred_at"]))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            previous = db.get(CommerceFact, body["event_id"])
            if not previous or previous.fingerprint != fp:
                raise HTTPException(409, "Commerce source conflict")
            return {"recorded": True, "duplicate": True}
        return {"recorded": True, "duplicate": False}

    @m.app.get("/api/marketing/commerce-metrics")
    def metrics(identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        query = select(CommerceFact)
        if not identity.is_superadmin:
            query = query.join(m.Lead, m.Lead.festio_user_id == CommerceFact.account_id).where(m.Lead.owner_email == identity.email)
        return commerce_metrics(db.scalars(query).all())

    @m.app.post("/api/marketing/internal/sales-responses")
    def prepare_reply(body: dict, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        if not identity.is_superadmin or identity.subject != "festio-backend":
            raise HTTPException(403, "Authenticated ingress adapter required")
        if not sales_responses.flag("MARKETING_SALES_INGRESS_ENABLED"):
            raise HTTPException(503, "Sales response ingress disabled")
        reply = sales_responses.ingest(db, body, runtime=m)
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
        if body.get("config_revision") is not None and (not isinstance(body["config_revision"],str) or len(body["config_revision"])!=64):
            raise HTTPException(422,"Invalid configuration revision")
        fields["config_revision"]=body.get("config_revision")
        db.add(Evidence(**fields, event_id=body["organizer_event_id"], fingerprint=fp))
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            old=db.get(Evidence,body["id"])
            if not old or old.fingerprint!=fp:
                raise HTTPException(409,"Evidence identity conflict")
            return {"recorded":True,"duplicate":True}
        lead = db.scalar(select(m.Lead).where(m.Lead.festio_user_id == body["account_id"]))
        if lead:
            if m.email_pilot.stopped(lead) or m.email_pilot.stage_for(db,lead) is None:
                lead.next_follow_up_at = None
            elif lead.next_follow_up_at is None:
                from datetime import timedelta
                lead.next_follow_up_at = m.now()+timedelta(hours=1)
            db.add(m.Activity(lead_id=lead.id,kind=body["milestone"],summary="Organizer event milestone recorded",actor="organizer_journey",
                data={"event_id":body["organizer_event_id"],"org_id":body["org_id"],"use_case":body["use_case"],"source_event_id":body["id"]}))
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
    def backlog(include_resolved: bool = False, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        query = select(Handoff)
        if not include_resolved:
            query=query.where(Handoff.status != "resolved")
        if not identity.is_superadmin:
            query = query.where(Handoff.owner == identity.email)
        return [dict(id=c.id, lead_id=None if c.lead_id.startswith("sales:") else c.lead_id,
                     conversation_id=c.lead_id[6:] if c.lead_id.startswith("sales:") else None, owner=c.owner, status=c.status,
                     notification=c.notification, attempts=c.attempts, generation=c.generation, history=c.history) for c in db.scalars(query)]

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
        lead=db.get(m.Lead,case.lead_id)
        if lead:
            lead.owner_email=owner
        case.generation += 1
        case.attempts = 0
        case.history = [*case.history, {"at": stamp(), "action": "assigned", "actor": identity.email, "owner": owner}]
        db.commit()
        return {"id": case.id, "owner": case.owner}

    @m.app.post("/api/marketing/handoffs/{case_id}/resume-lead")
    def resume_lead(case_id: str, identity=Depends(m.decode_identity), db=Depends(m.db_session)):
        case=db.get(Handoff,case_id)
        if not case or (not identity.is_superadmin and (case.owner!=identity.email or identity.role=="viewer")):
            raise HTTPException(403,"Assigned operator required")
        lead=db.get(m.Lead,case.lead_id)
        if not lead or case.status!="resolved" or not case.owner:
            raise HTTPException(409,"Resolve an owned organizer case first")
        uncertain=db.scalar(select(m.email_pilot.EmailDispatch.id).where(m.email_pilot.EmailDispatch.lead_id==lead.id,m.email_pilot.EmailDispatch.status.in_(("sending","uncertain"))).limit(1))
        attempt=db.scalar(select(m.SendAttempt.id).where(m.SendAttempt.lead_id==lead.id,m.SendAttempt.status.in_(("sending","uncertain"))).limit(1))
        if uncertain or attempt or lead.unsubscribed or not lead.consent_email or lead.deletion_requested_at or lead.suppression_reason not in {None,"inbound_reply","human_handoff","demo_requested"}:
            raise HTTPException(409,"Consent, suppression or provider reconciliation still blocks resumption")
        lead.automation_paused=False;lead.suppression_reason=None
        lead.next_follow_up_at=m.now()
        case.history=[*case.history,{"at":stamp(),"action":"explicit_resume","actor":identity.email}]
        db.commit()
        return {"resumed":True}

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
        from .retention import RetentionJob
        rows=db.scalars(select(Evidence)).all()
        accounts={r.account_id for r in rows}
        states=[summary([r for r in rows if r.account_id==account]) for account in accounts]
        return {"organizer_funnel":{"organizers_with_source_evidence":len(accounts),
                    "realized_first_value":sum(any(e["first_value"] for e in state["events"]) for state in states),
                    "completed_event":sum(state["completed_events"]>0 for state in states),
                    "next_event_created":sum(state["next_event_created"] for state in states),
                    "repeat_event_completed":sum(state["repeat_event_completed"] for state in states),
                    "milestones":{kind:len({(r.account_id,r.org_id,r.event_id,r.use_case) for r in rows if r.milestone==kind}) for kind in MILESTONES}},
                "retention_outcomes":dict(db.execute(select(RetentionJob.status,func.count()).group_by(RetentionJob.status)).all()),
                "email_dispatch_outcomes":dict(db.execute(select(m.email_pilot.EmailDispatch.status,func.count()).group_by(m.email_pilot.EmailDispatch.status)).all()),
                "reply_outcomes": dict(db.execute(select(sales_responses.Reply.status, func.count()).group_by(sales_responses.Reply.status)).all()),
                "handoff_backlog": dict(db.execute(select(Handoff.notification, func.count()).where(Handoff.status != "resolved").group_by(Handoff.notification)).all()),
                "gates": {name: sales_responses.flag(name) for name in (
                    "MARKETING_OUTBOUND_ENABLED", "MARKETING_JOURNEY_WORKER_ENABLED", "MARKETING_HANDOFF_NOTIFICATIONS_ENABLED", "MARKETING_SALES_INGRESS_ENABLED", "MARKETING_SALES_CHAT_ENABLED",
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
        from .journey_templates import retention_candidate
        return {"candidates": candidates(), "organizer_retention_candidate": retention_candidate(), "stored_templates_changed": False}

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
