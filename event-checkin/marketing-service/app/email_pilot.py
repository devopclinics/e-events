"""Default-OFF email-only pilot and global marketing-email send budget.

No channel, scheduler, social or retention gate is enabled by this module.
All tables are additive and belong to the Marketing service.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import re
import secrets
from urllib.parse import urlsplit

import httpx
import jwt
from fastapi import HTTPException
from sqlalchemy import Boolean, DateTime, Integer, String, select, update, or_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, object_session


class PilotBase(DeclarativeBase):
    pass


class IdentityEvidence(PilotBase):
    __tablename__ = "marketing_email_identity_evidence"
    account_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    lead_id: Mapped[str] = mapped_column(String(36), unique=True)
    recipient_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consent_event_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    organizer: Mapped[bool] = mapped_column(Boolean, default=False)
    ownership_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EmailCap(PilotBase):
    __tablename__ = "marketing_email_caps"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    claim_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    blocked_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    uncertain: Mapped[bool] = mapped_column(Boolean, default=False)


class EmailDispatch(PilotBase):
    __tablename__ = "marketing_email_dispatches"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    lead_id: Mapped[str] = mapped_column(String(36), index=True)
    account_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    recipient_key: Mapped[str] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(20))
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    provider_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EmailBlocked(HTTPException):
    def __init__(self, reason):
        super().__init__(409, reason)


def utc(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def enabled(mode):
    name = {"pilot": "MARKETING_EMAIL_PILOT_ENABLED", "test": "MARKETING_EMAIL_TEST_ENABLED"}.get(mode)
    return bool(name and os.getenv(name, "false").lower() in {"true", "1", "yes"})


def config(mode):
    try:
        accounts = json.loads(os.getenv("MARKETING_EMAIL_" + mode.upper() + "_ACCOUNTS", "[]"))
    except (ValueError, TypeError):
        raise EmailBlocked("Invalid explicit email cohort")
    limit = 10 if mode == "pilot" else 1
    if (not isinstance(accounts, list) or not 1 <= len(accounts) <= limit
            or any(not isinstance(x, str) or not x.strip() or len(x) > 128 for x in accounts)
            or len(set(accounts)) != len(accounts)):
        raise EmailBlocked("Explicit bounded account cohort required")
    raw = os.getenv("MARKETING_EMAIL_PILOT_LAUNCH_AT", "")
    launch = utc(raw)
    # Launch must have an explicit timezone. Do not reinterpret local time.
    if not launch or not (raw.endswith("Z") or "+" in raw[10:] or "-" in raw[10:]):
        raise EmailBlocked("Timezone-qualified pilot launch required")
    if mode == "test":
        pilot_accounts, pilot_launch = config("pilot")
        if not set(accounts) <= pilot_accounts or launch != pilot_launch:
            raise EmailBlocked("Test account must belong to the same bounded pilot cohort")
    return set(accounts), launch


def stopped(lead):
    return bool(not lead.consent_email or lead.unsubscribed or lead.automation_paused
                or lead.suppression_reason or lead.deletion_requested_at)


def invalidate_consent(lead):
    db = object_session(lead)
    if db is not None and lead.festio_user_id:
        evidence = db.get(IdentityEvidence, lead.festio_user_id)
        if evidence and evidence.lead_id == lead.id:
            evidence.consent_event_id, evidence.consented_at = None, None


def capture_evidence(m, db, lead, body):
    """Retain ordered ownership independently of verified mailbox evidence.

    An ownership revocation can arrive before first verification. Its minimal
    tombstone must survive until older queued verification/milestones arrive.
    Missing proof still never enrolls or backfills an existing lead.
    """
    account = lead.festio_user_id
    if not account:
        return
    row = db.get(IdentityEvidence, account)
    occurred = utc(body.get("occurred_at"))
    registered = utc(body.get("account_registered_at"))
    verified = bool(body.get("email_verified") is True and registered and occurred and body.get("event_id"))
    ownership = body.get("organizer_account")
    if row is None and (verified or type(ownership) is bool):
        row = IdentityEvidence(account_id=account, lead_id=lead.id, organizer=False)
        db.add(row)
    if row and row.lead_id != lead.id:
        raise EmailBlocked("Conflicting source account evidence")
    if verified:
        if row.registered_at is not None and utc(row.registered_at) != registered:
            raise EmailBlocked("Conflicting source account evidence")
        row.registered_at = registered
        recipient_key = key("email:", lead.email.strip().lower())
        if row.recipient_key != recipient_key:
            if row.verified_at is not None and occurred < utc(row.verified_at):
                raise EmailBlocked("Stale verification cannot rebind a mailbox")
            row.recipient_key = recipient_key
            row.consent_event_id, row.consented_at = None, None
        row.verified_at = max(utc(row.verified_at), occurred) if row.verified_at else occurred
        if body.get("consent_email") is True and lead.consent_email and not stopped(lead):
            row.consent_event_id = body["event_id"]
            row.consented_at = occurred
    if row and type(ownership) is bool:
        prior = utc(row.ownership_at)
        if occurred and (prior is None or occurred > prior or (occurred == prior and ownership is False)):
            row.organizer, row.ownership_at = ownership, occurred
        elif not occurred and ownership is False:
            # A grant without ordering evidence is never authority. An
            # undated revocation conservatively blocks older queued grants.
            row.organizer, row.ownership_at = False, max(prior, m.now()) if prior else m.now()
    if row and body.get("consent_email") is False:
        row.consent_event_id = None
        row.consented_at = None


def eligible(m, db, lead, mode):
    accounts, launch = config(mode)
    if not enabled(mode) or stopped(lead) or lead.stage not in {"registered", "event_created"} or lead.festio_user_id not in accounts:
        return False
    proof = db.get(IdentityEvidence, lead.festio_user_id)
    if (not proof or proof.lead_id != lead.id
            or proof.recipient_key != key("email:", lead.email.strip().lower())
            or not proof.organizer or not proof.consent_event_id):
        return False
    stamps = [proof.registered_at, proof.verified_at, proof.consented_at, proof.ownership_at, lead.created_at, lead.registered_at]
    current = m.now()
    if any(not utc(x) or utc(x) < launch or utc(x) > current for x in stamps):
        return False
    # Evidence must still refer to the durable consent receipt and the same lead.
    receipt = db.get(m.IngestReceipt, proof.consent_event_id)
    return bool(receipt and receipt.kind == "lifecycle" and receipt.lead_id == lead.id)


def template_fingerprint(sequence):
    try:
        payload = {"id": sequence.id, "module": sequence.module,
                   "name": sequence.name, "payload": sequence.payload}
        return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    except (ValueError, TypeError):
        raise EmailBlocked("Template cannot be pinned")


def template_pins():
    try:
        pins = json.loads(os.getenv("MARKETING_EMAIL_PILOT_TEMPLATES", "{}"))
    except (ValueError, TypeError):
        raise EmailBlocked("Approved template pins required")
    if not isinstance(pins, dict) or set(pins) != {"registered", "event_created"}:
        raise EmailBlocked("Pin exactly the two organizer lifecycle templates")
    for pin in pins.values():
        if (not isinstance(pin, dict) or set(pin) != {"id", "sha256"}
                or not isinstance(pin["id"], str) or not 1 <= len(pin["id"]) <= 36
                or not isinstance(pin["sha256"], str) or not re.fullmatch("[0-9a-f]{64}", pin["sha256"])):
            raise EmailBlocked("Invalid approved template pin")
    if len({pin["id"] for pin in pins.values()}) != 2:
        raise EmailBlocked("Each lifecycle stage needs a distinct template")
    return pins


def approved_template(db, sequence, stage):
    pin = template_pins().get(stage)
    current = db.get(type(sequence), sequence.id, populate_existing=True)
    if (not pin or not current or current.id != pin["id"] or current.module != "sequences"
            or current.status != "active" or current.payload.get("stage") != stage
            or template_fingerprint(current) != pin["sha256"]
            or template_fingerprint(sequence) != pin["sha256"]):
        raise EmailBlocked("Template or lifecycle stage differs from its approved pin")
    return True


def readiness(m):
    domain = os.getenv("MARKETING_REPLY_DOMAIN", "").strip().lower()
    target = os.getenv("MARKETING_EMAIL_READINESS_URL", "")
    try:
        parsed = urlsplit(target)
    except ValueError:
        raise EmailBlocked("Invalid backend readiness URL")
    if (not domain or "@" in domain or not m.TOKEN_SECRET or not m.TOKEN_SECRET.strip() or not parsed.hostname
            or parsed.scheme not in {"http", "https"} or parsed.username or parsed.password
            or parsed.path != "/api/internal/marketing/email-readiness" or parsed.query or parsed.fragment):
        raise EmailBlocked("Verified reply routing and backend readiness URL required")
    timestamp = m.now()
    challenge = secrets.token_hex(16)
    token = jwt.encode({"sub": "marketing-email-readiness", "iss": "marketing-service",
                        "aud": "marketing-email-readiness", "jti": challenge, "iat": timestamp,
                        "exp": timestamp + timedelta(seconds=30)}, m.TOKEN_SECRET, algorithm="HS256")
    try:
        response = httpx.get(target, params={"reply_domain": domain, "challenge": challenge},
                            headers={"Authorization": "Bearer " + token},
                            timeout=5, follow_redirects=False)
        response.raise_for_status()
        envelope = response.json()
        result = jwt.decode(envelope["proof"], m.TOKEN_SECRET, algorithms=["HS256"],
                            audience="marketing-email-readiness-response", issuer="festio-backend",
                            options={"verify_exp": False, "verify_iat": False,
                                     "require": ["sub", "jti", "iat", "exp", "checked_at"]})
    except Exception:
        raise EmailBlocked("Backend stop/outbox readiness unavailable")
    received = m.now()
    checked = utc(result.get("checked_at")) if isinstance(result, dict) else None
    if (not isinstance(result, dict)
            or result.get("sub") != "marketing-email-readiness-response" or result.get("jti") != challenge
            or type(result.get("iat")) is not int or type(result.get("exp")) is not int
            or not 0 < result["exp"] - result["iat"] <= 5
            or not result["iat"] <= received.timestamp() < result["exp"]
            or result.get("ready") is not True
            or result.get("reply_routing_ready") is not True or result.get("reply_domain") != domain
            or any(type(result.get(k)) is not int or result[k] != 0 for k in ("pending", "failed"))
            or not checked or not received - timedelta(seconds=5) <= checked <= received):
        raise EmailBlocked("Unreconciled CRM outbox/stops or reply routing")
    return True


def key(prefix, value):
    return prefix + hashlib.sha256(value.encode()).hexdigest()


def reserve(m, lead, sequence, index, mode):
    claim = hashlib.sha256(f"{lead.id}/{sequence.id}/{index}".encode()).hexdigest()
    moment = m.now()
    with m.SessionLocal() as db:
        current = db.get(m.Lead, lead.id)
        if not current or stopped(current) or current.email.strip().lower() != lead.email.strip().lower():
            raise EmailBlocked("Lead is not eligible")
        if mode != "legacy" and not eligible(m, db, current, mode):
            raise EmailBlocked("Account is outside the approved new-organizer cohort")
        keys = [key("email:", current.email.strip().lower())]
        if current.festio_user_id:
            keys.append(key("account:", current.festio_user_id))
        # INSERT+conditional UPDATE serialize absent rows too; row locks alone do not.
        dialect = db.bind.dialect.name
        if dialect == "sqlite":
            from sqlalchemy.dialects.sqlite import insert
        elif dialect == "postgresql":
            from sqlalchemy.dialects.postgresql import insert
        else:
            raise EmailBlocked("Unsupported atomic email-cap database")
        if mode != "legacy":
            accounts, launch = config("pilot")
            cohort_key = key("cohort:", launch.isoformat())
            approved_template(db, sequence, current.stage)
            fingerprint = key("", json.dumps({"accounts": sorted(accounts), "templates": template_pins()}, sort_keys=True))
            db.execute(insert(EmailCap).values(key=cohort_key, claim_id=fingerprint,
                       blocked_until=launch, uncertain=False).on_conflict_do_nothing(index_elements=["key"]))
            recorded = db.scalar(select(EmailCap.claim_id).where(EmailCap.key == cohort_key))
            if recorded != fingerprint:
                raise EmailBlocked("Launched cohort is immutable; configuration review required")
        for cap_key in sorted(keys):
            db.execute(insert(EmailCap).values(key=cap_key, blocked_until=moment - timedelta(days=1),
                                             uncertain=False).on_conflict_do_nothing(index_elements=["key"]))
            acquired = db.execute(update(EmailCap).where(
                EmailCap.key == cap_key, EmailCap.uncertain.is_(False),
                EmailCap.blocked_until <= moment,
            ).values(claim_id=claim, uncertain=True, blocked_until=moment + timedelta(hours=24)))
            if acquired.rowcount != 1:
                raise EmailBlocked("Recipient/account email cap or unresolved dispatch")
        same = func.lower(func.trim(m.Lead.email)) == current.email.strip().lower()
        if current.festio_user_id:
            same = or_(same, m.Lead.festio_user_id == current.festio_user_id)
        own_step = f"{lead.id}/{sequence.id}/{index}"
        unresolved = db.scalar(select(m.SendAttempt.id).join(m.Lead, m.Lead.id == m.SendAttempt.lead_id).where(
            same, or_(m.SendAttempt.status == "uncertain",
                      (m.SendAttempt.status == "sending") & or_(
                          m.SendAttempt.id != own_step,
                          m.SendAttempt.updated_at < moment - timedelta(minutes=2)))).limit(1))
        if unresolved:
            raise EmailBlocked("Older unresolved sequence attempt requires reconciliation")
        # Include accepted sends recorded by older releases during the last 24h.
        same = or_(func.lower(func.trim(m.Lead.email)) == current.email.strip().lower())
        if current.festio_user_id:
            same = or_(same, m.Lead.festio_user_id == current.festio_user_id)
        recent = db.scalar(select(m.Activity.id).join(m.Lead, m.Lead.id == m.Activity.lead_id).where(
            same, m.Activity.kind == "email_sent", m.Activity.actor != "resend",
            m.Activity.created_at > moment - timedelta(hours=24)).limit(1))
        if recent:
            raise EmailBlocked("Previously accepted marketing email in last 24h")
        dispatch = db.get(EmailDispatch, claim)
        if dispatch:
            if dispatch.status not in {"failed", "cancelled"} or dispatch.attempts >= 5:
                raise EmailBlocked("Step already accepted or needs reconciliation")
            dispatch.status = "sending"
            dispatch.recipient_key = keys[0]
            dispatch.account_key = keys[1] if len(keys) > 1 else None
            dispatch.attempts += 1
            dispatch.updated_at = moment
        else:
            db.add(EmailDispatch(id=claim, lead_id=current.id, recipient_key=keys[0],
                                account_key=keys[1] if len(keys) > 1 else None,
                                status="sending", attempts=1, updated_at=moment))
        db.commit()
    return claim


def finish(m, claim, status, provider_id=None):
    moment = m.now()
    with m.SessionLocal() as db:
        row = db.get(EmailDispatch, claim)
        if not row or row.status != "sending":
            raise EmailBlocked("Dispatch reconciliation required")
        row.status, row.updated_at = status, moment
        row.provider_id = str(provider_id)[:128] if provider_id else None
        if status == "accepted":
            row.accepted_at = moment
        elif status == "cancelled":
            row.attempts = max(0, row.attempts - 1)  # Proven unsent readiness cancellation is not a provider try.
        db.execute(update(EmailCap).where(EmailCap.claim_id == claim).values(
            claim_id=claim if status in {"accepted", "uncertain"} else None,
            uncertain=status == "uncertain",
            blocked_until=moment + timedelta(hours=24) if status == "accepted" else moment))
        if status == "uncertain":
            # Never replace a newer reply, unsubscribe, bounce or handoff reason.
            db.execute(update(m.Lead).where(m.Lead.id == row.lead_id,
                       m.Lead.suppression_reason.is_(None)).values(
                       automation_paused=True, suppression_reason="delivery_outcome_unknown",
                       next_follow_up_at=None))
        db.commit()


def recover_stale_claims(m):
    with m.SessionLocal() as db:
        rows = db.scalars(select(EmailDispatch).where(
            EmailDispatch.status == "sending", EmailDispatch.updated_at < m.now() - timedelta(minutes=2))).all()
        for row in rows:
            changed = db.execute(update(EmailDispatch).where(
                EmailDispatch.id == row.id, EmailDispatch.status == "sending").values(status="uncertain"))
            if changed.rowcount:
                db.execute(update(m.Lead).where(m.Lead.id == row.lead_id,
                           m.Lead.suppression_reason.is_(None)).values(
                           automation_paused=True, suppression_reason="delivery_outcome_unknown",
                           next_follow_up_at=None))
        db.commit()


def send(m, lead, sequence, index=0, mode="legacy", stop_requested=None):
    if stop_requested and stop_requested():
        raise EmailBlocked("Email pilot is stopping")
    if mode == "legacy":
        m.require_outbound_enabled()
    elif mode not in {"pilot", "test"} or not enabled(mode):
        raise EmailBlocked("Email-only gate is disabled")
    if mode != "legacy" and not os.getenv("RESEND_API_KEY"):
        raise EmailBlocked("Pilot requires the verified Resend delivery path; SMTP fallback is disabled")
    recover_stale_claims(m)
    steps = m.sequence_steps(sequence)
    step = steps[min(index, len(steps) - 1)] if steps else {}
    m.safe_cta_url(step.get("cta_url") or sequence.payload.get("cta_url"))
    if mode != "legacy":
        with m.SessionLocal() as db:
            approved_template(db, sequence, lead.stage)
    readiness(m)
    if stop_requested and stop_requested():
        raise EmailBlocked("Email pilot is stopping")
    claim = reserve(m, lead, sequence, index, mode)
    try:
        readiness(m)  # Recheck after taking the global claim, immediately before provider dispatch.
        with m.SessionLocal() as db:
            current = db.get(m.Lead, lead.id)
            if (not current or stopped(current) or current.stage != lead.stage
                    or current.email.strip().lower() != lead.email.strip().lower()
                    or current.festio_user_id != lead.festio_user_id
                    or (mode != "legacy" and not eligible(m, db, current, mode))):
                raise EmailBlocked("Eligibility changed before dispatch")
            if mode != "legacy":
                approved_template(db, sequence, current.stage)
        if stop_requested and stop_requested():
            raise EmailBlocked("Email pilot is stopping")
        result = m._deliver_follow_up(lead, sequence, index)
    except HTTPException:
        finish(m, claim, "cancelled")
        raise
    except httpx.HTTPStatusError as exc:
        finish(m, claim, "failed" if 400 <= exc.response.status_code < 500 else "uncertain")
        raise
    except Exception:
        finish(m, claim, "uncertain")
        raise
    finish(m, claim, "accepted" if result.get("status") == "sent" else "failed", result.get("provider_id"))
    return result
