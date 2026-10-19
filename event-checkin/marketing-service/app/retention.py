"""Organizer-only follow-up through the existing cohort, caps and email claims."""
import hashlib
import json
import os
import secrets
import uuid
from datetime import timedelta

import httpx
import jwt
from sqlalchemy import Column, String, BigInteger, select, inspect, text
from sqlalchemy.orm import DeclarativeBase

from . import email_pilot, sales_responses
from .organizer_journey import Evidence


class Base(DeclarativeBase):
    pass


class RetentionJob(Base):
    __tablename__ = "marketing_organizer_retention_jobs"
    id = Column(String(64), primary_key=True)
    lead_id = Column(String(36), nullable=False)
    event_id = Column(String(128), nullable=False)
    org_id = Column(String(128), nullable=False)
    step = Column(BigInteger, nullable=False)
    sequence_id = Column(String(36), nullable=True)
    status = Column(String(30), nullable=False, default="pending")
    last_attempt_at = Column(String(40), nullable=True)


def migrate_checkpoint(engine):
    # Widen in place: changing the hash would change durable email identities.
    if engine.dialect.name == "postgresql":
        columns=inspect(engine).get_columns(RetentionJob.__tablename__)
        if any(c["name"]=="step" and not isinstance(c["type"],BigInteger) for c in columns):
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE marketing_organizer_retention_jobs ALTER COLUMN step TYPE BIGINT"))


def source_context(m, account_id, event_id):
    from urllib.parse import urlsplit
    target = os.getenv("MARKETING_ORGANIZER_CONTEXT_URL", "")
    parsed, authority = urlsplit(target), urlsplit(os.getenv("MARKETING_EMAIL_READINESS_URL", ""))
    if (parsed.scheme not in {"https", "http"} or parsed.scheme != authority.scheme or parsed.netloc != authority.netloc
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path != "/api/internal/marketing/organizer-context" or not m.TOKEN_SECRET):
        raise email_pilot.EmailBlocked("Organizer context is not configured")
    challenge = secrets.token_hex(16)
    at = m.now()
    token = jwt.encode(dict(sub="marketing-email-readiness", iss="marketing-service", aud="marketing-email-readiness",
        jti=challenge, iat=at, exp=at+timedelta(seconds=10)), m.TOKEN_SECRET, algorithm="HS256")
    try:
        response = httpx.get(target, params={"account_id": account_id, "event_id": event_id, "challenge": challenge},
            headers={"Authorization": "Bearer "+token}, timeout=5, follow_redirects=False)
        if response.status_code != 200:
            raise ValueError("Context unavailable")
        result = response.json()
        proof = jwt.decode(result["proof"], m.TOKEN_SECRET, algorithms=["HS256"], issuer="festio-backend", audience="organizer-context-response",
            options={"require": ["iat", "exp", "jti", "account_id", "event_id", "current_owner"]})
        checked = email_pilot.utc(proof.get("checked_at"))
        if proof["jti"] != challenge or proof["account_id"] != account_id or proof["event_id"] != event_id or not checked or not m.now()-timedelta(seconds=5) <= checked <= m.now():
            raise ValueError()
        return proof
    except Exception:
        raise email_pilot.EmailBlocked("Invalid current organizer ownership proof")


def validate_dispatch(m, lead, index, *, sequence_id=None):
    if not (sales_responses.flag("MARKETING_ORGANIZER_RETENTION_ENABLED") and sales_responses.flag("MARKETING_OUTBOUND_ENABLED")):
        raise email_pilot.EmailBlocked("Organizer retention is disabled")
    with m.SessionLocal() as db:
        if not email_pilot.eligible(m, db, lead, "pilot", retention=True):
            raise email_pilot.EmailBlocked("Organizer is outside the immutable pilot cohort")
        job = db.scalar(select(RetentionJob).where(RetentionJob.lead_id == lead.id, RetentionJob.step == index))
        if not job or not sequence_id or job.sequence_id != sequence_id or job.status in {"accepted", "uncertain"}:
            raise email_pilot.EmailBlocked("Retention job not pending")
        cancelled = db.scalar(select(Evidence.id).where(Evidence.account_id == lead.festio_user_id,
            Evidence.org_id == job.org_id, Evidence.event_id == job.event_id, Evidence.milestone == "event_cancelled"))
        if cancelled:
            raise email_pilot.EmailBlocked("Cancelled events do not receive post-event retention")
        current = source_context(m, lead.festio_user_id, job.event_id)
        if current.get("account_id")!=lead.festio_user_id or current.get("event_id")!=job.event_id or current.get("current_owner") is not True or current.get("org_id") != job.org_id or current.get("cancelled") is not False or current.get("status") != "ended" or current.get("is_test") is not False:
            raise email_pilot.EmailBlocked("Event no longer eligible for organizer retention")


def accepted_job(m, db, job, provider_id):
    job.status = "accepted"
    identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f"festio-retention/{job.id}/{job.sequence_id}"))
    if not db.get(m.Activity, identity):
        db.add(m.Activity(id=identity, lead_id=job.lead_id, kind="email_sent", summary="Organizer post-event guidance accepted", actor="organizer_retention",
            data={"category":"organizer_retention","sequence_id":job.sequence_id,"event_id":job.event_id,"provider_id":provider_id}))


def recover_jobs(m, db, lead):
    for job in db.scalars(select(RetentionJob).where(RetentionJob.lead_id==lead.id, RetentionJob.status!="accepted")):
        if not job.sequence_id:
            job.status="review_required"  # Never guess an old dispatch's template identity.
            continue
        claim=hashlib.sha256(f"{lead.id}/{job.sequence_id}/{job.step}".encode()).hexdigest()
        dispatch=db.get(email_pilot.EmailDispatch,claim,populate_existing=True)
        if dispatch and dispatch.status=="accepted":
            accepted_job(m,db,job,dispatch.provider_id)
        elif dispatch and dispatch.status in {"sending","uncertain"}:
            job.status="uncertain"
        elif job.status=="uncertain" and dispatch and dispatch.status in {"failed","cancelled"}:
            job.status="pending"  # Still requires all current consent/takeover/cap checks.
    db.commit()


def run_retention(m, *, stop_requested=None):
    if stop_requested and stop_requested():
        return 0
    if not (sales_responses.flag("MARKETING_ORGANIZER_RETENTION_ENABLED") and sales_responses.flag("MARKETING_OUTBOUND_ENABLED") and email_pilot.enabled("pilot")):
        return 0
    sent = 0
    with m.SessionLocal() as db:
        try:
            pin = json.loads(os.getenv("MARKETING_ORGANIZER_RETENTION_TEMPLATE", "{}"))
        except ValueError:
            return 0
        sequence = db.get(m.ModuleRecord, pin.get("id"))
        if not sequence or sequence.payload.get("category") != "organizer_retention":
            return 0
        email_pilot.approved_template(db, sequence, "")
        accounts, _ = email_pilot.config("pilot")
        leads = db.scalars(select(m.Lead).where(m.Lead.festio_user_id.in_(accounts))).all()
        for lead in leads:
            if stop_requested and stop_requested():
                break
            recover_jobs(m,db,lead)
            if not email_pilot.eligible(m, db, lead, "pilot", retention=True):
                continue
            outcomes = db.scalars(select(Evidence).outerjoin(RetentionJob,
                (RetentionJob.lead_id == lead.id) & (RetentionJob.org_id == Evidence.org_id) & (RetentionJob.event_id == Evidence.event_id)).where(
                Evidence.account_id == lead.festio_user_id, Evidence.milestone == "event_completed", RetentionJob.id.is_(None)).limit(20)).all()
            for outcome in outcomes:
                if stop_requested and stop_requested():
                    break
                identity = hashlib.sha256(f"{lead.id}/{outcome.org_id}/{outcome.event_id}".encode()).hexdigest()
                job = db.get(RetentionJob, identity)
                if not job:
                    job = RetentionJob(id=identity, lead_id=lead.id, org_id=outcome.org_id, event_id=outcome.event_id,
                        step=int(identity[:12],16), sequence_id=sequence.id, status="pending")
                    db.add(job)
                    try:
                        db.commit()
                    except Exception:
                        db.rollback()
                        continue
            jobs = db.scalars(select(RetentionJob).where(RetentionJob.lead_id == lead.id,
                RetentionJob.sequence_id == sequence.id,
                RetentionJob.status.in_(("pending", "failed"))).order_by(RetentionJob.last_attempt_at, RetentionJob.id).limit(20)).all()
            for job in jobs:
                if stop_requested and stop_requested():
                    break
                job.last_attempt_at = m.now().isoformat()
                db.commit()
                try:
                    validate_dispatch(m, lead, job.step, sequence_id=sequence.id)
                    result = email_pilot.send(m, lead, sequence, job.step, "pilot",stop_requested=stop_requested)
                    job.status = "accepted" if result.get("status") == "sent" else "failed"
                    sent += job.status == "accepted"
                    if job.status == "accepted":
                        accepted_job(m,db,job,result.get("provider_id"))
                except Exception:
                    claim = hashlib.sha256(f"{lead.id}/{sequence.id}/{job.step}".encode()).hexdigest()
                    dispatch = db.get(email_pilot.EmailDispatch, claim, populate_existing=True)
                    job.status = "uncertain" if dispatch and dispatch.status in {"sending", "uncertain"} else "pending"
                db.commit()
    return sent
