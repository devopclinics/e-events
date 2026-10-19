"""Operational, separately default-OFF journey worker using existing transports.

No calls on import/startup. Inject httpx.MockTransport in tests. Persisted claims
are the correctness boundary; neither process restarts nor leases resume humans.
"""
import json
import os
import re
import threading
import secrets
from datetime import timedelta
from urllib.parse import urlsplit

import httpx
import jwt
from fastapi import HTTPException
from sqlalchemy import select, update, or_, literal,case,insert
from sqlalchemy.exc import IntegrityError

from . import sales_responses as sales
from .organizer_journey import Handoff


def endpoint(value):
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(503, "A configured HTTPS destination is required")
    return value.rstrip("/")


def schedule_work(db,identity,at):
    """Atomic insert/update on both supported databases; never move backwards."""
    table=sales.QueueSchedule.__table__
    dialect=db.get_bind().dialect.name
    values={"next_at":case((table.c.next_at<at,at),else_=table.c.next_at)}
    if dialect in {"sqlite","postgresql"}:
        if dialect=="sqlite":
            from sqlalchemy.dialects.sqlite import insert as upsert
        else:
            from sqlalchemy.dialects.postgresql import insert as upsert
        db.execute(upsert(table).values(id=identity,next_at=at).on_conflict_do_update(index_elements=[table.c.id],set_=values))
    else:
        try:
            with db.begin_nested():db.execute(insert(table).values(id=identity,next_at=at))
        except IntegrityError:
            db.execute(update(table).where(table.c.id==identity).values(**values))


def source_ready(m):
    target = os.getenv("MARKETING_SALES_READINESS_URL", "")
    parsed, authority = urlsplit(target), urlsplit(os.getenv("MARKETING_EMAIL_READINESS_URL", ""))
    if (parsed.scheme not in {"http", "https"} or parsed.scheme != authority.scheme or parsed.netloc != authority.netloc
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path != "/api/internal/marketing/sales-readiness" or not m.TOKEN_SECRET):
        raise HTTPException(503, "Sales source readiness is not configured")
    challenge, at = secrets.token_hex(16), m.now()
    token = jwt.encode(dict(sub="marketing-email-readiness", iss="marketing-service", aud="marketing-email-readiness",
        jti=challenge, iat=at, exp=at+timedelta(seconds=10)), m.TOKEN_SECRET, algorithm="HS256")
    try:
        response = httpx.get(target, params={"challenge":challenge}, headers={"Authorization":"Bearer "+token}, timeout=5, follow_redirects=False)
        response.raise_for_status()
        proof = jwt.decode(response.json()["proof"], m.TOKEN_SECRET, algorithms=["HS256"], issuer="festio-backend", audience="sales-readiness-response",
            options={"require":["iat","exp","jti","ready","checked_at"]})
        checked = m.email_pilot.utc(proof["checked_at"])
        if proof["jti"] != challenge or proof["ready"] is not True or not checked or not m.now()-timedelta(seconds=5) <= checked <= m.now():
            raise ValueError()
    except Exception:
        raise HTTPException(503, "Authenticated inbound backlog is not clear")
    return True


class SalesAdapter:
    def __init__(self, m, *, transport=None):
        self.m, self.transport = m, transport

    def send(self, *, channel, contact_key, content, idempotency_key, claim_token=None):
        with self.m.SessionLocal() as db:
            target = db.get(sales.Target, idempotency_key)
            if not target or target.conversation_id != contact_key:
                raise HTTPException(409, "Missing bound transport target")
            try:
                value = json.loads(sales.cipher().decrypt(target.encrypted.encode()))
            except Exception:
                raise HTTPException(503,"Bound transport target cannot be decrypted")
        if value["channel"] != channel or value["destination"] != os.getenv("MARKETING_SALES_"+channel.upper()+"_DESTINATION"):
            raise HTTPException(409, "Transport destination changed")
        if value.get("binding") != sales.transport_binding(channel,value["destination"]):
            raise HTTPException(409, "Queued transport authority changed; do not retarget")
        headers = {"Idempotency-Key": idempotency_key}
        if channel == "chat":
            base = endpoint(os.getenv("MARKETING_SALES_CHAT_URL", ""))
            account = os.getenv("MARKETING_SALES_CHAT_ACCOUNT", "")
            token = os.getenv("MARKETING_SALES_CHAT_TOKEN", "")
            if not token or value["account_id"] != account or not account.isdigit() or not value["thread_id"].isdigit():
                raise HTTPException(503, "Chat transport is not configured for this inbox")
            path = f"{base}/api/v1/accounts/{account}/conversations/{value['thread_id']}/messages"
            headers["api_access_token"] = token
            payload = {"content": content["text"] + "\n" + content.get("cta_url", ""), "message_type": "outgoing", "private": False}
        elif channel == "whatsapp":
            # Same Bird channel API and payload shape as backend/services/messaging.py.
            workspace, sender, token = os.getenv("BIRD_WORKSPACE_ID", ""), os.getenv("MARKETING_SALES_WHATSAPP_SENDER", ""), os.getenv("BIRD_ACCESS_KEY", "")
            from .organizer_journey import fingerprint
            binding=fingerprint({"destination":value["destination"],"workspace":workspace,"sender":sender})
            if binding!=os.getenv("MARKETING_SALES_WHATSAPP_SENDER_BINDING"):
                raise HTTPException(503,"Sales WhatsApp sender mapping is not approved")
            phone = value["contact_id"].removeprefix("meta:")
            if not token or not re.fullmatch(r"\+[1-9][0-9]{6,14}", phone) or not re.fullmatch(r"[a-zA-Z0-9-]+", workspace) or not re.fullmatch(r"[a-zA-Z0-9-]+", sender):
                raise HTTPException(503, "Sales WhatsApp transport is not configured")
            path = f"https://api.bird.com/workspaces/{workspace}/channels/{sender}/messages"
            headers["Authorization"] = f"AccessKey {token}"
            payload = {"receiver": {"contacts": [{"identifierKey": "phonenumber", "identifierValue": phone}]}}
            if "template" in content:
                payload["template"] = content["template"]
            else:
                payload["body"] = {"type": "text", "text": {"text": content["text"] + "\n" + content.get("cta_url", "")}}
        else:
            raise HTTPException(409, "Unsupported transport")
        source_ready(self.m)
        # The source proof request is not a send grant. Recheck local stops,
        # gates and window after that I/O, at the provider submission boundary.
        with httpx.Client(transport=self.transport, timeout=15, follow_redirects=False) as client:
            # Persist the irreversible may-submit boundary before contact.
            # After arming, a not-found observation cannot authorize reclaim.
            with self.m.SessionLocal() as db:
                armed=db.execute(update(sales.DispatchGuard).where(sales.DispatchGuard.conversation_id==contact_key,
                    sales.DispatchGuard.active_reply==idempotency_key,sales.DispatchGuard.token==claim_token,
                    sales.DispatchGuard.submission_state=="preparing").values(submission_state="armed"))
                db.commit()
                if armed.rowcount!=1:
                    raise HTTPException(409,"Submission claim was revoked before arming")
            with self.m.SessionLocal() as db:
                sales.lock_dispatch(db,contact_key)
                reply = db.get(sales.Reply, idempotency_key)
                row = db.get(sales.Conversation, contact_key)
                guard=db.get(sales.DispatchGuard,contact_key)
                if (not reply or reply.status!="sending" or not guard or guard.active_reply!=idempotency_key
                        or not claim_token or guard.token!=claim_token or guard.submission_state!="armed"):
                    raise HTTPException(409,"Stale conversation dispatch claim")
                try:
                    template = json.loads(os.getenv("MARKETING_SALES_WHATSAPP_APPROVED_TEMPLATE", "null"))
                except ValueError:
                    template = None
                reason, current = sales.dispatch_policy(row, reply, template)
                if (reason or current != content or not sales.flag("MARKETING_JOURNEY_WORKER_ENABLED")
                        or guard.hour!=sales.clock().strftime("%Y-%m-%dT%H")):
                    raise HTTPException(409, "Dispatch eligibility changed during readiness verification")
                response = client.post(path, headers=headers, json=payload)
        if response.status_code in {408,409,425}:
            return {"status":"unknown"}
        if 400 <= response.status_code < 500:
            return {"status": "rejected"}
        if not 200 <= response.status_code < 300:
            return {"status": "unknown"}
        data = response.json()
        provider_id = data.get("id")
        return {"status": "accepted", "provider_id": str(provider_id)} if type(provider_id) in {str,int} and provider_id and len(str(provider_id))<=128 else {"status": "unknown"}


class NotificationAdapter:
    def __init__(self, *, transport=None):
        self.transport = transport

    def notify(self, *, case_id, owner, destination, idempotency_key=None):
        native = os.getenv("MARKETING_HANDOFF_TRANSPORT", "webhook") == "chatwoot"
        if os.getenv("MARKETING_HANDOFF_TRANSPORT", "webhook") not in {"webhook", "chatwoot"}:
            raise HTTPException(503, "Notification transport is not configured")
        token = os.getenv("MARKETING_HANDOFF_CHATWOOT_TOKEN" if native else "MARKETING_HANDOFF_WEBHOOK_TOKEN", "")
        if not token:
            raise HTTPException(503, "Notification adapter is not configured")
        destination = endpoint(destination)
        headers = {"Idempotency-Key": idempotency_key or case_id}
        payload = {"case_id": case_id, "owner": owner, "url": "https://festio.events/marketing?tab=handoffs"}
        if native:
            if not re.fullmatch(r"/api/v1/accounts/[0-9]+/conversations/[0-9]+/messages", urlsplit(destination).path):
                raise HTTPException(503, "Configured staff Chatwoot conversation required")
            headers["api_access_token"] = token
            payload = {"content": f"Organizer handoff {case_id}. Assigned owner: {owner}. Review https://festio.events/marketing?tab=handoffs . Provider acceptance is not owner acknowledgement.",
                "message_type": "outgoing", "private": True}
        else:
            headers["Authorization"] = f"Bearer {token}"
        with httpx.Client(transport=self.transport, timeout=15, follow_redirects=False) as client:
            response = client.post(destination, headers=headers, json=payload)
        if response.status_code in {408,409,425}:
            raise RuntimeError("Uncertain notification outcome")
        if 400 <= response.status_code < 500:
            return False
        if not 200 <= response.status_code < 300:
            raise RuntimeError("Uncertain notification outcome")
        data = response.json()
        acknowledged = type(data.get("id")) in {str,int} and bool(data["id"]) if native else data.get("recorded") is True
        if not acknowledged:
            raise RuntimeError("Missing notification receipt")
        return True


def tick(m, *, sales_adapter=None, notification_adapter=None, dry_run=False, stop_requested=None):
    cancelled=lambda: not sales.flag("MARKETING_JOURNEY_WORKER_ENABLED") or bool(stop_requested and stop_requested())
    if cancelled():
        return {"disabled": True, "sent": 0}
    result = {"sent": 0, "notifications": 0, "retention": 0, "dry_run": dry_run}
    with m.SessionLocal() as db:
        for stale in ([] if dry_run else db.scalars(select(sales.Reply).where(sales.Reply.status == "sending"))):
            at = sales.authenticated_time(stale.claimed_at) if stale.claimed_at else None
            if at is None or at < sales.clock()-timedelta(minutes=2):
                changed=db.execute(update(sales.Reply).where(sales.Reply.id==stale.id,sales.Reply.status=="sending",
                    sales.Reply.claimed_at==stale.claimed_at).values(status="unknown").execution_options(synchronize_session=False))
                if not changed.rowcount:
                    continue
                sales.hold_conversation(db,stale.conversation_id)
                from types import SimpleNamespace
                from .organizer_journey import open_handoff
                open_handoff(m, db, SimpleNamespace(id="sales:"+stale.conversation_id, owner_email=None), stale.payload["channel"], stale.id)
        if not dry_run:
            from types import SimpleNamespace
            from .organizer_journey import open_handoff
            for exhausted in db.scalars(select(sales.Reply).where(sales.Reply.status.in_(("prepared","rejected")),sales.Reply.attempts>=3).limit(20)):
                changed=db.execute(update(sales.Reply).where(sales.Reply.id==exhausted.id,sales.Reply.status.in_(("prepared","rejected")),sales.Reply.attempts>=3)
                    .values(status="exhausted").execution_options(synchronize_session=False))
                if not changed.rowcount:
                    continue
                sales.hold_conversation(db,exhausted.conversation_id)
                open_handoff(m,db,SimpleNamespace(id="sales:"+exhausted.conversation_id,owner_email=None),exhausted.payload["channel"],exhausted.id)
            missing_case=~select(Handoff.id).where(Handoff.lead_id==literal("sales:")+sales.Conversation.id).exists()
            for row in db.scalars(select(sales.Conversation).where(sales.Conversation.status.in_(("paused","handoff")),missing_case).limit(20)):
                if not db.scalar(select(Handoff.id).where(Handoff.lead_id=="sales:"+row.id)):
                    reply=db.scalar(select(sales.Reply).where(sales.Reply.conversation_id==row.id).limit(1))
                    if reply:
                        open_handoff(m,db,SimpleNamespace(id="sales:"+row.id,owner_email=None),row.channel,reply.id)
        db.commit()
        schedule=sales.QueueSchedule
        at=sales.clock().isoformat()
        ids = list(db.scalars(select(sales.Reply.id).outerjoin(schedule,schedule.id==literal("reply:")+sales.Reply.id).where(
            sales.Reply.status.in_(("prepared", "rejected")),sales.Reply.attempts<3,or_(schedule.next_at.is_(None),schedule.next_at<=at))
            .order_by(schedule.next_at.asc().nullsfirst(),sales.Reply.id).limit(20)))
        cases = list(db.scalars(select(Handoff).outerjoin(schedule,schedule.id==literal("case:")+Handoff.id).where(
            Handoff.status != "resolved",Handoff.attempts<3,
            Handoff.notification.in_(("pending", "failed", "unconfigured", "missing_owner")),or_(schedule.next_at.is_(None),schedule.next_at<=at))
            .order_by(schedule.next_at.asc().nullsfirst(),Handoff.id).limit(20)))
        if dry_run:
            return {**result, "prepared_replies": len(ids), "handoff_backlog": len(cases)}
        if sales.flag("MARKETING_OUTBOUND_ENABLED") and sales.flag("MARKETING_HANDOFF_NOTIFICATIONS_ENABLED"):
            adapter = notification_adapter or NotificationAdapter()
            for case in cases:
                if cancelled():
                    break
                schedule_work(db,"case:"+case.id,at)
                grant=db.scalar(select(m.AccessGrant).where(m.AccessGrant.email==case.owner)) if case.owner else None
                owner_available=bool(case.owner and ((grant.active and grant.role!="viewer") if grant else case.owner==os.getenv("MARKETING_HANDOFF_OWNER")))
                if not owner_available or not os.getenv("MARKETING_HANDOFF_DESTINATION"):
                    db.execute(update(Handoff).where(Handoff.id==case.id,Handoff.generation==case.generation,
                        Handoff.owner==case.owner,Handoff.status!="resolved",Handoff.attempts<3,
                        Handoff.notification.in_(("pending","failed","unconfigured","missing_owner")))
                        .values(notification="missing_owner" if not owner_available else "unconfigured").execution_options(synchronize_session=False))
                    db.commit()
                    continue
                generation = case.generation
                claimed = db.execute(update(Handoff).where(Handoff.id == case.id, Handoff.generation == generation,
                    Handoff.owner==case.owner,Handoff.status!="resolved",Handoff.notification.in_(("pending", "failed", "unconfigured", "missing_owner")), Handoff.attempts < 3).values(notification="sending", attempts=Handoff.attempts+1))
                db.commit()
                if not claimed.rowcount:
                    continue
                db.refresh(case)
                if case.generation!=generation or case.status=="resolved" or case.notification!="sending":
                    continue
                if cancelled() or not sales.flag("MARKETING_OUTBOUND_ENABLED") or not sales.flag("MARKETING_HANDOFF_NOTIFICATIONS_ENABLED"):
                    db.execute(update(Handoff).where(Handoff.id==case.id,Handoff.generation==generation,Handoff.notification=="sending").values(notification="pending",attempts=max(0,case.attempts-1)))
                    db.commit()
                    break
                try:
                    accepted = adapter.notify(case_id=case.id, owner=case.owner, destination=os.environ["MARKETING_HANDOFF_DESTINATION"], idempotency_key=f"handoff/{case.id}/{generation}")
                    outcome = "accepted" if accepted is True else "failed"
                except HTTPException as exc:
                    outcome = "unconfigured" if exc.status_code == 503 else "failed"
                except Exception:
                    outcome = "uncertain"
                values={"notification":outcome}
                if outcome=="unconfigured":
                    values["attempts"]=max(0,case.attempts-1)
                changed = db.execute(update(Handoff).where(Handoff.id == case.id, Handoff.generation == generation, Handoff.notification == "sending").values(**values))
                db.refresh(case)
                case.history = [*case.history, {"at": m.now().isoformat(), "action": "notification", "result": outcome, "generation": generation, "superseded": changed.rowcount != 1}]
                result["notifications"] += outcome == "accepted" and changed.rowcount == 1
                db.commit()
        adapter = sales_adapter or SalesAdapter(m)
        try:
            template = json.loads(os.getenv("MARKETING_SALES_WHATSAPP_APPROVED_TEMPLATE", "null"))
        except ValueError:
            template = None
        for identity in ids:
            if cancelled():
                break
            from .organizer_journey import fingerprint
            if os.getenv("MARKETING_SALES_KNOWLEDGE_SHA256") != fingerprint({"knowledge":sales.KNOWLEDGE,"cta":sales.CTA}):
                result["knowledge_unapproved"] = True
                break
            reply=db.get(sales.Reply,identity)
            schedule_work(db,"reply:"+identity,at)
            db.commit()
            if reply.payload.get("knowledge_sha256")!=os.getenv("MARKETING_SALES_KNOWLEDGE_SHA256"):
                changed=db.execute(update(sales.Reply).where(sales.Reply.id==identity,sales.Reply.status.in_(("prepared","rejected")))
                    .values(status="review_required").execution_options(synchronize_session=False))
                if not changed.rowcount:
                    db.rollback()
                    continue
                sales.hold_conversation(db,reply.conversation_id,"handoff")
                db.commit()
                continue
            outcome = sales.dispatch(db, identity, adapter, template=template, stop_requested=cancelled)
            result["sent"] += outcome == "accepted"
            reply=db.get(sales.Reply,identity)
            if outcome=="rejected" and reply.attempts>=3:
                outcome="retry_limit"
            if outcome in {"suppressed","retry_limit"}:
                changed=db.execute(update(sales.Reply).where(sales.Reply.id==identity,sales.Reply.status.in_(("prepared","rejected")))
                    .values(status="cancelled" if outcome=="suppressed" else "exhausted").execution_options(synchronize_session=False))
                db.commit()
                db.expire_all()
                if not changed.rowcount:
                    continue
            if outcome in {"unknown", "retry_limit"}:
                from types import SimpleNamespace
                from .organizer_journey import open_handoff
                reply = db.get(sales.Reply, identity)
                sales.hold_conversation(db,reply.conversation_id)
                open_handoff(m, db, SimpleNamespace(id="sales:"+reply.conversation_id, owner_email=None), reply.payload["channel"], identity)
                db.commit()
    from .retention import run_retention
    result["retention"] = run_retention(m,stop_requested=cancelled)
    return result


class JourneyClock:
    def __init__(self, m):
        self.m, self.stop_event, self.thread = m, threading.Event(), None

    def start(self):
        if not sales.flag("MARKETING_JOURNEY_WORKER_ENABLED") or (self.thread and self.thread.is_alive()):
            return False
        self.thread = threading.Thread(target=self.loop, name="organizer-journey", daemon=True)
        self.thread.start()
        return True

    def loop(self):
        while not self.stop_event.wait(60):
            try:
                tick(self.m,stop_requested=self.stop_event.is_set)
            except Exception:
                self.m.logger.warning("Journey tick failed; durable claims retained")

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=20)
