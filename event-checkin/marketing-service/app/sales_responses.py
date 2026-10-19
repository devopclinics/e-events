"""Bounded factual replies; adapters are injected, never arbitrary tools.

Provider adapters must authenticate inbound destination/sender metadata before
calling ingest. Contact keys are channel-scoped and never resolve CRM accounts.
Unknown outcomes require reconciliation; restart cannot retry them.
"""
import hashlib
import os
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import Column, String, Integer, JSON, select, update
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.exc import IntegrityError

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


KNOWLEDGE = {
    "discovery": "Festio supports guest lists, invitations, RSVPs and check-in. Which of these are you planning to use?",
    "setup": "Create an event draft, check its date and timezone, and follow the event guide. Review and rehearse each tool before guest use.",
    "pricing": "Review the current options and prices in Festio before purchasing. I cannot offer a discount or confirm a purchase here.",
    "handoff": "Your request needs a person to review it. This does not confirm a booking. You can also use the contact section on the Festio website.",
}
CTA = "https://festio.events/setup-redesign"


def clock():
    return datetime.now(timezone.utc)


def flag(name):
    return os.getenv(name, "false").lower() == "true"


def authenticated_time(raw):
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if value.tzinfo is None or value > clock():
            raise ValueError()
        return value.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError):
        raise HTTPException(422, "Authenticated nonfuture timestamp required")


def ingest(db, body):
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
    if clock() - at > timedelta(days=7):
        raise HTTPException(422, "Stale inbound metadata")
    fp = fingerprint(body)
    saved = db.get(Reply, body["event_id"])
    if saved:
        if saved.fingerprint != fp:
            raise HTTPException(409, "Inbound event identity conflict")
        return saved
    key = hashlib.sha256((body["channel"] + ":" + body["contact_id"]).encode()).hexdigest()
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
    elif row.status != "open":
        status = "suppressed"
    elif row.turns >= 6 or (row.hour == hour and row.hourly >= 4):
        status = "limited"
    elif intent not in KNOWLEDGE or intent == "handoff":
        next_status = "handoff"
        intent = "handoff"
    # Consent claims never re-open an opt-out or human takeover.
    if next_status == "open" and body.get("consent") is True:
        consent = 1
    if body.get("consent") is False:
        consent = 0
    inbound_at = max(at, authenticated_time(row.inbound_at)).isoformat()
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
                           "intent": intent, "channel": body["channel"]})
    db.add(reply)
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


def dispatch(db, reply_id, adapter, *, template=None):
    """Persist claim before contact. Re-read consent/window at every dispatch.

    Adapter results: accepted + provider_id, rejected (known unaccepted), or
    unknown. No automatic retry of sending/unknown, including after restart.
    """
    db.expire_all()
    reply = db.get(Reply, reply_id)
    if not reply or reply.status not in {"prepared", "rejected"}:
        return "reconciliation_required" if reply and reply.status in {"sending", "unknown"} else "blocked"
    row = db.get(Conversation, reply.conversation_id)
    if reply.attempts >= 3:
        return "retry_limit"
    channel = row.channel
    if not (flag("MARKETING_OUTBOUND_ENABLED") and flag("MARKETING_SALES_" + channel.upper() + "_ENABLED")):
        return "disabled"
    if row.status in {"opted_out", "paused"} or (row.status == "handoff" and reply.payload["intent"] != "handoff"):
        return "suppressed"
    content = reply.payload
    if channel == "whatsapp":
        if not os.getenv("MARKETING_SALES_WHATSAPP_SENDER"):
            return "sender_unconfigured"
        # Only the authenticated inbound source can open/extend this window.
        if clock() - authenticated_time(row.inbound_at) >= timedelta(hours=24):
            if not (row.consent == 1 and template and template.get("approved") is True
                    and template.get("id") == os.getenv("MARKETING_SALES_WHATSAPP_TEMPLATE")
                    and fingerprint(template.get("content")) == os.getenv("MARKETING_SALES_WHATSAPP_TEMPLATE_SHA256")):
                return "outside_service_window"
            content = template["content"]
    claimed = db.execute(update(Reply).where(Reply.id == reply_id, Reply.status.in_(("prepared", "rejected")), Reply.attempts < 3).values(status="sending", attempts=Reply.attempts + 1))
    db.commit()
    if claimed.rowcount != 1:
        return "blocked"
    try:
        result = adapter.send(channel=channel, contact_key=row.id, content=content, idempotency_key=reply.id)
        state = result.get("status")
        if state == "accepted" and isinstance(result.get("provider_id"), str) and result["provider_id"]:
            reply.status, reply.provider_id = "accepted", result["provider_id"][:128]
        elif state == "rejected":
            reply.status = "rejected"
        else:
            reply.status = "unknown"
    except Exception:
        reply.status = "unknown"
    if reply.status == "unknown":
        row.status = "paused"
    db.commit()
    return reply.status


def reconcile(db, reply_id, *, provider_id=None, definitely_not_sent=False):
    reply = db.get(Reply, reply_id)
    if not reply or reply.status not in {"unknown", "sending"}:
        raise HTTPException(409, "No uncertain attempt")
    # Caller must independently inspect authenticated provider records.
    if provider_id:
        reply.status, reply.provider_id = "accepted", provider_id
    elif definitely_not_sent is True:
        reply.status = "rejected"
    else:
        raise HTTPException(409, "Definitive provider evidence required")
    db.commit()
    return reply.status
