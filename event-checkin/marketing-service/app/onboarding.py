"""Automatic future-registration enrollment using the existing guarded email path.

Legacy bulk sends, pilot cohorts, social publishing and retention stay independent.
"""
import os
import secrets
from datetime import timedelta
from urllib.parse import urlsplit

import httpx
import jwt
from sqlalchemy import select

from . import email_pilot
from .email_pilot_scheduler import EmailPilotScheduler


def configured():
    return email_pilot.enabled("production") and os.getenv("MARKETING_ONBOARDING_SCHEDULER_ENABLED", "false").lower() in {"1", "true", "yes"}


def validate_account(m, lead, sequence):
    """A live source check stops stale creation reminders and revoked ownership."""
    target = os.getenv("MARKETING_ONBOARDING_ACCOUNT_URL", "")
    parsed = urlsplit(target)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password
            or parsed.path != "/api/internal/marketing/organizer-account-context" or parsed.query or parsed.fragment):
        raise email_pilot.EmailBlocked("Current organizer account authority unavailable")
    at = m.now(); challenge = secrets.token_hex(16)
    token = jwt.encode({"sub": "marketing-email-readiness", "iss": "marketing-service", "aud": "marketing-email-readiness",
                        "jti": challenge, "iat": at, "exp": at + timedelta(seconds=30)}, m.TOKEN_SECRET, algorithm="HS256")
    try:
        response = httpx.get(target, params={"account_id": lead.festio_user_id, "challenge": challenge},
                            headers={"Authorization": "Bearer " + token}, timeout=5, follow_redirects=False)
        response.raise_for_status()
        proof = jwt.decode(response.json()["proof"], m.TOKEN_SECRET, algorithms=["HS256"], issuer="festio-backend",
                           audience="organizer-account-context-response", options={"verify_exp": False, "verify_iat": False, "require": ["iat", "exp", "jti", "sub"]})
    except Exception:
        raise email_pilot.EmailBlocked("Current organizer account could not be verified")
    moment = m.now()
    if (proof.get("sub") != "organizer-account-context-response" or proof.get("jti") != challenge
            or proof.get("account_id") != lead.festio_user_id or proof.get("current_owner") is not True
            or type(proof.get("event_count")) is not int or proof["event_count"] < 0
            or type(proof.get("iat")) is not int or type(proof.get("exp")) is not int
            or not 0 < proof["exp"]-proof["iat"] <= 5 or not proof["iat"] <= moment.timestamp() < proof["exp"]):
        raise email_pilot.EmailBlocked("Invalid current organizer account evidence")
    stage = sequence.payload.get("stage")
    if (stage == "registered" and proof["event_count"] > 0) or (stage == "event_created" and proof["event_count"] == 0):
        raise email_pilot.EmailBlocked("Account lifecycle changed; wait for source capture")
    return proof


def record_enrollment(m, db, lead):
    import uuid
    _, launch = email_pilot.config("production")
    identity = str(uuid.uuid5(uuid.NAMESPACE_URL, "festio-onboarding:"+launch.isoformat()+":"+lead.id))
    if not db.get(m.Activity, identity):
        db.add(m.Activity(id=identity, lead_id=lead.id, kind="onboarding_enrolled", actor="organizer-onboarding",
                          summary="Enrolled in automatic client onboarding", created_at=m.now(),
                          data={"launch_at": launch.isoformat(), "initial_stage": email_pilot.stage_for(db, lead)}))
        db.commit()


def conversion(m, db):
    try:
        _, launch = email_pilot.config("production")
    except email_pilot.EmailBlocked:
        return {"enrolled": 0, "first_event_created": 0, "rate": 0}
    rows = db.scalars(select(m.Activity).where(m.Activity.kind == "onboarding_enrolled")).all()
    enrolled = {r.lead_id for r in rows if (r.data or {}).get("launch_at") == launch.isoformat()}
    # Use authenticated source milestones, not manually edited sales stages.
    created = set(db.scalars(select(m.Activity.lead_id).where(m.Activity.lead_id.in_(enrolled),
        m.Activity.kind == "event_created", m.Activity.actor == "festio"))) if enrolled else set()
    return {"enrolled": len(enrolled), "first_event_created": len(created),
            "rate": round(100*len(created)/len(enrolled), 1) if enrolled else 0}


def operational_status(m, db):
    clock = getattr(m.app.state, "onboarding_scheduler", None)
    record = db.scalar(select(m.ModuleRecord).where(m.ModuleRecord.module == "automation_runtime", m.ModuleRecord.name == "organizer_onboarding"))
    details = dict(record.payload or {}) if record else {}
    blockers = []
    if not email_pilot.enabled("production"): blockers.append("Automatic onboarding is disabled")
    if not configured(): blockers.append("Automatic onboarding scheduler is disabled")
    try:
        email_pilot.config("production")
        pins = email_pilot.template_pins("production")
        for stage, pin in pins.items():
            seq = db.get(m.ModuleRecord, pin["id"])
            if not seq: raise email_pilot.EmailBlocked("Approved onboarding template missing")
            email_pilot.approved_template(db, seq, stage, "production")
    except email_pilot.EmailBlocked as exc:
        blockers.append(str(exc.detail))
    if not os.getenv("RESEND_API_KEY"): blockers.append("Email provider is not configured")
    for key in ["MARKETING_REPLY_DOMAIN", "MARKETING_EMAIL_READINESS_URL", "MARKETING_ONBOARDING_ACCOUNT_URL"]:
        if not os.getenv(key): blockers.append(key + " is not configured")
    last = email_pilot.utc(details.get("checked_at"))
    if not blockers and (not clock or not clock.running): blockers.append("Scheduler is not running on this replica")
    if not blockers and last and last < m.now()-timedelta(minutes=10): blockers.append("Scheduler heartbeat is stale")
    if details.get("blocked") and not blockers: blockers.append(details["blocked"])
    state = "paused" if not configured() else "blocked" if blockers else "running" if last else "starting"
    return {"state": state, "enabled": configured(), "scheduler_running": bool(clock and clock.running),
            "interval_seconds": 60, "blockers": blockers, "last_run": details,
            "legacy_scheduler_enabled": os.getenv("MARKETING_SCHEDULER_ENABLED", "false").lower() in {"1", "true", "yes"},
            "historical_contacts_enrolled": False, "conversion": conversion(m, db)}


class OnboardingScheduler(EmailPilotScheduler):
    def __init__(self, runtime, **kwargs):
        super().__init__(runtime, interval_seconds=kwargs.get("interval_seconds", 60))

    def start(self):
        with self._lock:
            if self.running or not configured(): return False
            try:
                email_pilot.config("production")
                email_pilot.template_pins("production")
            except email_pilot.EmailBlocked:
                return False
            import threading
            self.stop_event.clear()
            self._thread = threading.Thread(target=self._loop, name="organizer-onboarding", daemon=True)
            self._thread.start()
            return True

    def cancelled(self):
        return self.stop_event.is_set() or not configured()

    def tick(self):
        m = self.runtime
        if self.cancelled(): return {"disabled": True}
        with m.SessionLocal() as db:
            if not m.acquire_lease(db, "organizer-onboarding", seconds=55): return {"leased": True}
        result = {}
        try:
            email_pilot.readiness(m)
            with m.SessionLocal() as db:
                actor = m.Identity(subject="organizer-onboarding", email="automation@festio.events", name="Festio onboarding", is_superadmin=True, role="superadmin")
                result = m.run_automation_service(db, actor, email_mode="production", stop_requested=self.cancelled)
        except email_pilot.EmailBlocked as exc:
            result = {"blocked": str(exc.detail)}
        except Exception as exc:
            # Do not persist provider bodies, contact details or credentials.
            result = {"blocked": "Automation check failed: " + type(exc).__name__}
        with m.SessionLocal() as db:
            row = db.scalar(select(m.ModuleRecord).where(m.ModuleRecord.module == "automation_runtime", m.ModuleRecord.name == "organizer_onboarding"))
            if not row:
                row = m.ModuleRecord(module="automation_runtime", name="organizer_onboarding", status="active", created_by="automation@festio.events")
                db.add(row)
            row.payload = {"checked_at": m.now().isoformat(), **result}
            db.commit()
        return result
