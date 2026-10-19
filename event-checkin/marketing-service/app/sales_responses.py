"""Bounded factual replies; adapters are injected, never arbitrary tools.

Provider adapters must authenticate inbound destination/sender metadata before
calling ingest. Contact keys are channel-scoped and never resolve CRM accounts.
Unknown outcomes require reconciliation; restart cannot retry them.
"""
import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import Column, String, Integer, JSON, Text, select, update, delete, case, or_,func,text
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.exc import IntegrityError,DBAPIError

from .organizer_journey import fingerprint


class Base(DeclarativeBase):
    pass


class Conversation(Base):
    __tablename__ = "marketing_sales_conversations"
    id = Column(String(64), primary_key=True)
    channel = Column(String(20), nullable=False)
    turns = Column(Integer, nullable=False, default=0)
    hour = Column(String(20), nullable=False)
    hourly = Column(Integer, nullable=False, default=0)
    version = Column(Integer, nullable=False, default=0)
    status = Column(String(20), nullable=False, default="open")
    inbound_at = Column(String(40), nullable=False)
    consent = Column(Integer, nullable=False, default=0)


class Reply(Base):
    __tablename__ = "marketing_sales_replies"
    id = Column(String(128), primary_key=True)
    fingerprint = Column(String(64), nullable=False)
    conversation_id = Column(String(64), nullable=False, index=True)
    status = Column(String(30), nullable=False)
    payload = Column(JSON, nullable=False)
    provider_id = Column(String(128), nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    claimed_at = Column(String(40), nullable=True)


class Target(Base):
    __tablename__ = "marketing_sales_targets"
    id = Column(String(128), primary_key=True)
    conversation_id = Column(String(64), nullable=False)
    encrypted = Column(Text, nullable=False)


class DispatchGuard(Base):
    """One durable claim and current-hour provider-attempt budget per contact."""
    __tablename__ = "marketing_sales_dispatch_guards"
    conversation_id = Column(String(64), primary_key=True)
    active_reply = Column(String(128), nullable=True)
    token = Column(String(36), nullable=True)
    submission_state = Column(String(20), nullable=True)
    hour = Column(String(20), nullable=False)
    attempts = Column(Integer, nullable=False, default=0)


class QueueSchedule(Base):
    __tablename__ = "marketing_journey_queue_schedule"
    id = Column(String(160), primary_key=True)
    next_at = Column(String(40), nullable=False)


DISPATCH_LOCK_TIMEOUT_MS = 5000


def dispatch_lock_timeout(db):
    if db.get_bind().dialect.name=="postgresql":
        with db.no_autoflush:
            db.execute(text("SELECT set_config('lock_timeout', :timeout, true)"),{"timeout":str(DISPATCH_LOCK_TIMEOUT_MS)+"ms"})


def lock_dispatch(db, conversation_id):
    """Transaction mutex shared by submission, reconciliation and finalization.

    A no-op UPDATE takes the conversation row lock on PostgreSQL and the
    write lock on SQLite. Caller must retain this transaction through contact.
    All writers acquire guard before reply to keep lock ordering consistent.
    """
    with db.no_autoflush:
        dispatch_lock_timeout(db)
        db.execute(update(DispatchGuard).where(DispatchGuard.conversation_id==conversation_id)
            .values(token=DispatchGuard.token).execution_options(synchronize_session=False))


def release_claim(db, reply, *, unsent=False, token=None):
    values={"active_reply":None,"submission_state":None}
    if unsent:
        values["attempts"]=case((DispatchGuard.attempts>0,DispatchGuard.attempts-1),else_=0)
    query=update(DispatchGuard).where(DispatchGuard.conversation_id==reply.conversation_id,DispatchGuard.active_reply==reply.id)
    if token is not None:
        query=query.where(DispatchGuard.token==token)
    db.execute(query.values(**values).execution_options(synchronize_session=False))


def cipher():
    import base64
    from cryptography.fernet import Fernet
    secret = os.getenv("MARKETING_INTERNAL_TOKEN") or os.getenv("PLANNER_INTERNAL_SERVICE_TOKEN", "")
    if not secret:
        raise HTTPException(503, "Transport encryption is not configured")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


KNOWLEDGE = {
    "discovery": "Festio supports guest lists, invitations, RSVPs and check-in. Which of these are you planning to use? For optional WhatsApp follow-up, reply: I agree to receive Festio WhatsApp guidance. Reply STOP to opt out.",
    "setup": "Create an event draft, check its date and timezone, and follow the event guide. Review and rehearse each tool before guest use.",
    "pricing": "Review the current options and prices in Festio before purchasing. I cannot offer a discount or confirm a purchase here.",
    "handoff": "Your request needs a person to review it. This does not confirm a booking. You can also use the contact section on the Festio website.",
}
CTA = "https://festio.events/setup-redesign"


def clock():
    return datetime.now(timezone.utc)


def flag(name):
    return os.getenv(name, "false").lower() == "true"


def hold_conversation(db, conversation_id, status="paused"):
    # A worker outcome is not permission to erase an authenticated STOP. Bump
    # the version so an older inbound snapshot cannot undo this hold either.
    db.execute(update(Conversation).where(Conversation.id==conversation_id,
        Conversation.status!="opted_out").values(status=status,version=Conversation.version+1).execution_options(synchronize_session=False))
    db.expire_all()


def transport_binding(channel, destination):
    mapping = {"channel":channel,"destination":destination}
    if channel=="chat":
        mapping.update(url=os.getenv("MARKETING_SALES_CHAT_URL",""),account=os.getenv("MARKETING_SALES_CHAT_ACCOUNT",""))
    else:
        mapping.update(workspace=os.getenv("BIRD_WORKSPACE_ID",""),sender=os.getenv("MARKETING_SALES_WHATSAPP_SENDER",""))
    return fingerprint(mapping)


def authenticated_time(raw):
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if value.tzinfo is None or value > clock():
            raise ValueError()
        return value.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError):
        raise HTTPException(422, "Authenticated nonfuture timestamp required")


def ingest(db, body, *, runtime=None):
    required = ("event_id", "channel", "contact_id", "destination", "received_at", "intent")
    if any(not isinstance(body.get(k), str) or not 1 <= len(body[k]) <= 128 for k in required):
        raise HTTPException(422, "Bounded adapter metadata required")
    if body["channel"] not in {"chat", "whatsapp"}:
        raise HTTPException(422, "Unsupported sales channel")
    if body.get("authenticated") is not True or body.get("direction") != "inbound":
        raise HTTPException(403, "Authenticated inbound messages only")
    destination = os.getenv("MARKETING_SALES_" + body["channel"].upper() + "_DESTINATION")
    if not destination or body["destination"] != destination:
        raise HTTPException(403, "Unconfigured or wrong sales destination")
    at = authenticated_time(body["received_at"])
    if "window_verified" in body and type(body["window_verified"]) is not bool:
        raise HTTPException(422,"Window provenance must be a boolean")
    window_verified=body.get("window_verified") is not False
    if clock() - at > timedelta(days=7):
        raise HTTPException(422, "Stale inbound metadata")
    fp = fingerprint(body)
    saved = db.get(Reply, body["event_id"])
    if saved:
        if saved.fingerprint != fp:
            raise HTTPException(409, "Inbound event identity conflict")
        return saved
    key = hashlib.sha256((body["channel"] + ":" + body["destination"] + ":" + body["contact_id"]).encode()).hexdigest()
    row = db.get(Conversation, key)
    hour = clock().strftime("%Y-%m-%dT%H")
    if not row:
        row = Conversation(id=key, channel=body["channel"], hour=hour, turns=0,
                           hourly=0, version=0, status="open", inbound_at=at.isoformat(), consent=0)
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Concurrent inbound; retry exact event")
    status = "prepared"
    next_status, consent = row.status, row.consent
    intent = body["intent"]
    if intent == "opt_out":
        next_status, consent, status = "opted_out", 0, "suppressed"
        db.execute(delete(Target).where(Target.conversation_id==key))
    elif row.status != "open":
        status = "suppressed"
    elif row.turns >= 6 or (row.hour == hour and row.hourly >= 4):
        status = "limited"
        next_status = "handoff"
    elif intent not in KNOWLEDGE or intent == "handoff":
        next_status = "handoff"
        intent = "handoff"
    if not window_verified and next_status!="opted_out":
        next_status,status,intent="handoff","suppressed","handoff"
    # Consent claims never re-open an opt-out or human takeover.
    if next_status == "open" and body.get("consent") is True and at >= authenticated_time(row.inbound_at):
        consent = 1
    if body.get("consent") is False:
        consent = 0
    inbound_at = max(at, authenticated_time(row.inbound_at)).isoformat() if window_verified and intent!="opt_out" else row.inbound_at
    old_version = row.version
    count = 1 if status == "prepared" else 0
    changed = db.execute(update(Conversation).where(Conversation.id == key, Conversation.version == old_version).values(
        version=old_version + 1, turns=row.turns + count,
        hourly=(row.hourly if row.hour == hour else 0) + count, hour=hour,
        status=next_status, consent=consent, inbound_at=inbound_at).execution_options(synchronize_session=False))
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Concurrent inbound; retry exact event")
    reply = Reply(id=body["event_id"], fingerprint=fp, conversation_id=key, status=status,
                  payload={"text": KNOWLEDGE.get(intent, KNOWLEDGE["handoff"]), "cta_url": CTA,
                           "intent": intent, "channel": body["channel"], "received_at":at.isoformat(),
                           "knowledge_sha256":fingerprint({"knowledge":KNOWLEDGE,"cta":CTA}),
                           "window_verified":window_verified,
                           "consent_evidence":body.get("consent") if type(body.get("consent")) is bool else None})
    db.add(reply)
    import json
    target = {"channel": body["channel"], "destination": body["destination"], "contact_id": body["contact_id"],
              "thread_id": str(body.get("thread_id") or ""), "account_id": str(body.get("transport_account_id") or "")}
    target["binding"] = transport_binding(body["channel"],body["destination"])
    if any(len(value) > 512 for value in target.values()):
        raise HTTPException(422, "Transport metadata too long")
    if next_status!="opted_out":
        db.add(Target(id=reply.id, conversation_id=key, encrypted=cipher().encrypt(json.dumps(target).encode()).decode()))
    if runtime and next_status in {"handoff","paused"}:
        from types import SimpleNamespace
        from .organizer_journey import open_handoff
        open_handoff(runtime,db,SimpleNamespace(id="sales:"+key,owner_email=None),body["channel"],reply.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.get(Reply, body["event_id"])
        if not existing or existing.fingerprint != fp:
            raise HTTPException(409, "Concurrent inbound conflict")
        return existing
    db.expire_all()
    return reply


def dispatch_policy(row,reply,template):
    channel=row.channel
    if not (flag("MARKETING_OUTBOUND_ENABLED") and flag("MARKETING_SALES_"+channel.upper()+"_ENABLED")):
        return "disabled",None
    if row.status in {"opted_out","paused"} or (row.status=="handoff" and reply.payload["intent"]!="handoff"):
        return "suppressed",None
    content=reply.payload
    if channel=="whatsapp":
        if not os.getenv("MARKETING_SALES_WHATSAPP_SENDER"):
            return "sender_unconfigured",None
        if clock()-authenticated_time(row.inbound_at)>=timedelta(hours=24)-timedelta(seconds=30):
            if not (row.consent==1 and template and template.get("approved") is True
                    and template.get("id")==os.getenv("MARKETING_SALES_WHATSAPP_TEMPLATE")
                    and fingerprint(template.get("content"))==os.getenv("MARKETING_SALES_WHATSAPP_TEMPLATE_SHA256")):
                return "outside_service_window",None
            content=template["content"]
    return None,content


def dispatch(db, reply_id, adapter, *, template=None, stop_requested=None):
    """Persist claim before contact. Re-read consent/window at every dispatch.

    Adapter results: accepted + provider_id, rejected (known unaccepted), or
    unknown. No automatic retry of sending/unknown, including after restart.
    """
    db.expire_all()
    if stop_requested and stop_requested():
        return "stopping"
    reply = db.get(Reply, reply_id)
    if not reply or reply.status not in {"prepared", "rejected"}:
        return "reconciliation_required" if reply and reply.status in {"sending", "unknown"} else "blocked"
    row = db.get(Conversation, reply.conversation_id)
    unresolved = db.scalar(select(Reply.id).where(Reply.conversation_id == row.id, Reply.id != reply.id, Reply.status.in_(("sending", "unknown"))).limit(1))
    if unresolved:
        return "reconciliation_required"
    if reply.attempts >= 3:
        return "retry_limit"
    channel = row.channel
    reason,content=dispatch_policy(row,reply,template)
    if reason:
        return reason
    dispatch_lock_timeout(db)
    hour=clock().strftime("%Y-%m-%dT%H")
    token=str(uuid.uuid4())
    if not db.get(DispatchGuard,row.id):
        # Conservatively account for pre-upgrade provider attempts this hour.
        # This is a send-budget barrier, never an enrollment/provenance backfill.
        start=clock().replace(minute=0,second=0,microsecond=0).isoformat()
        observed=db.scalar(select(func.coalesce(func.sum(Reply.attempts),0)).where(
            Reply.conversation_id==row.id,Reply.claimed_at>=start))
        db.add(DispatchGuard(conversation_id=row.id,hour=hour,attempts=min(4,int(observed))))
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            return "conversation_busy"
    unresolved=select(Reply.id).where(Reply.conversation_id==row.id,Reply.status.in_(("sending","unknown"))).exists()
    serialized=db.execute(update(DispatchGuard).where(DispatchGuard.conversation_id==row.id,
        DispatchGuard.active_reply.is_(None),~unresolved,
        or_(DispatchGuard.hour!=hour,DispatchGuard.attempts<4)).values(active_reply=reply.id,token=token,hour=hour,submission_state="preparing",
        attempts=case((DispatchGuard.hour==hour,DispatchGuard.attempts+1),else_=1)).execution_options(synchronize_session=False))
    if serialized.rowcount!=1:
        db.rollback()
        return "conversation_busy_or_limited"
    claimed = db.execute(update(Reply).where(Reply.id == reply_id, Reply.status.in_(("prepared", "rejected")), Reply.attempts < 3).values(status="sending", attempts=Reply.attempts + 1, claimed_at=clock().isoformat()))
    if claimed.rowcount != 1:
        db.rollback()
        return "blocked"
    db.commit()
    owned=select(DispatchGuard.conversation_id).where(DispatchGuard.conversation_id==row.id,
        DispatchGuard.active_reply==reply.id,DispatchGuard.token==token).exists()
    def finish(values, *, unsent=False):
        lock_dispatch(db,row.id)
        changed=db.execute(update(Reply).where(Reply.id==reply.id,Reply.status=="sending",owned)
            .values(**values).execution_options(synchronize_session=False))
        if changed.rowcount:
            if values["status"] in {"prepared","cancelled","accepted","rejected"}:
                release_claim(db,reply,unsent=unsent,token=token)
            if values["status"]=="accepted":
                db.execute(delete(Target).where(Target.id==reply.id))
            if values["status"]=="unknown":
                hold_conversation(db,row.id)
        db.commit();db.expire_all();db.refresh(reply)
        return bool(changed.rowcount)
    # The claim is not consent. Re-read stops and authenticated window timing
    # after the durable claim, immediately before transport contact.
    db.refresh(row)
    reason,content=dispatch_policy(row,reply,template)
    if stop_requested and stop_requested():
        reason="stopping"
    if reason:
        finish({"status":"cancelled" if reason=="suppressed" else "prepared","attempts":max(0,reply.attempts-1)},unsent=True)
        return reason
    try:
        result = adapter.send(channel=channel, contact_key=row.id, content=content, idempotency_key=reply.id,claim_token=token)
        state = result.get("status")
        if state == "accepted" and isinstance(result.get("provider_id"), str) and result["provider_id"]:
            values={"status":"accepted","provider_id":result["provider_id"][:128]}
        elif state == "rejected":
            values={"status":"rejected"}
        else:
            values={"status":"unknown"}
    except HTTPException:
        # Adapter contract: typed validation failures occur before client.post.
        # The current owner may prove its own attempt unsent even if recovery
        # concurrently marked Reply unknown; do not overwrite that status.
        lock_dispatch(db,row.id)
        db.execute(update(DispatchGuard).where(DispatchGuard.conversation_id==row.id,
            DispatchGuard.active_reply==reply.id,DispatchGuard.token==token)
            .values(submission_state="preparing").execution_options(synchronize_session=False))
        changed=finish({"status":"prepared","attempts":max(0,reply.attempts-1)},unsent=True)
        return "unconfigured" if changed else "reconciliation_required"
    except Exception:
        values={"status":"unknown"}
    return values["status"] if finish(values) else "reconciliation_required"


def reconcile(db, reply_id, *, provider_id=None, definitely_not_sent=False):
    reply = db.get(Reply, reply_id)
    if reply:
        try:
            lock_dispatch(db,reply.conversation_id)
            db.refresh(reply)
        except DBAPIError:
            db.rollback()
            raise HTTPException(409,"Submission is active or coordination is unavailable; no reconciliation applied") from None
    if not reply or reply.status not in {"unknown", "sending"}:
        raise HTTPException(409, "No uncertain attempt")
    # Caller must independently inspect authenticated provider records.
    if provider_id:
        reply.status, reply.provider_id = "accepted", provider_id
        db.execute(delete(Target).where(Target.id==reply.id))
    elif definitely_not_sent is True:
        guard=db.get(DispatchGuard,reply.conversation_id,populate_existing=True)
        if not guard or guard.active_reply!=reply.id or guard.submission_state!="preparing":
            # Armed (and legacy unknown-phase) attempts may still submit even
            # after a connection/process failure. Not-found is not a fence.
            raise HTTPException(409,"Submission may have started; authenticated provider receipt required")
        reply.status = "rejected"
    else:
        raise HTTPException(409, "Definitive provider evidence required")
    release_claim(db,reply)
    db.commit()
    return reply.status
