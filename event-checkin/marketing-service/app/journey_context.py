"""Factual context renderer, enabled only by reviewed template payloads."""
from urllib.parse import urlencode
from sqlalchemy import select
from .organizer_journey import Evidence
from . import email_pilot


def message_context(m, lead, sequence, index):
    if sequence.payload.get("journey_context") is not True:
        return None
    from .retention import source_context, RetentionJob
    with m.SessionLocal() as db:
        rows = db.scalars(select(Evidence).where(Evidence.account_id == lead.festio_user_id)).all()
        if sequence.payload.get("category") == "organizer_retention":
            job = db.scalar(select(RetentionJob).where(RetentionJob.lead_id == lead.id, RetentionJob.step == index))
            event_id = job.event_id if job else None
        else:
            closed = {(r.org_id,r.event_id) for r in rows if r.milestone in {"event_completed","event_cancelled"}}
            opened = [r for r in rows if (r.org_id,r.event_id) not in closed]
            ordered = sorted(opened or rows, key=lambda r: email_pilot.utc(r.occurred_at), reverse=True)
            event_id = ordered[0].event_id if ordered else None
        if not event_id:
            return None
        current = source_context(m, lead.festio_user_id, event_id)
        if current.get("current_owner") is not True or current.get("is_test") is not False:
            raise email_pilot.EmailBlocked("Current event ownership could not be established")
        if current.get("cancelled") is True:
            raise email_pilot.EmailBlocked("Cancelled event guidance is suppressed")
        milestones = {r.milestone for r in rows if r.event_id == event_id and r.org_id == current.get("org_id")}
        if sequence.payload.get("category") != "organizer_retention" and (current.get("status") == "ended" or "event_completed" in milestones):
            raise email_pilot.EmailBlocked("Event onboarding is complete; retention is separately gated")
        steps = [
            ("guest_imported", "Review the guest list task and import your intended guest list when it is ready.", "audience", "rsvp"),
            ("invitation_delivered", "Review invitation content, recipient consent and delivery exceptions before deciding whether to send.", "experience", "invitation"),
            ("rsvp_received", "Review the RSVP flow and check for actual guest responses. A controlled test is a rehearsal.", "audience", "rsvp"),
            ("checkin_succeeded", "Review check-in and staff access. Rehearse with marked test guests before admitting real attendees.", "operations", "checkin"),
        ]
        choice = next((step for step in steps if step[0] not in milestones),
            ("event_completed", "Review event results and outstanding exceptions before completing closeout.", "closeout", "results"))
        if sequence.payload.get("category") == "organizer_retention":
            choice = ("reuse", "Review closeout exceptions and create a new draft when you are ready. A copied draft needs new dates and its own checks.", "closeout", "reuse")
        date_note = ""
        if current.get("event_date") and current.get("timezone"):
            from datetime import datetime
            from zoneinfo import ZoneInfo
            try:
                zone = ZoneInfo(current["timezone"])
                local_day = m.now().astimezone(zone).date()
                event_day = datetime.fromisoformat(current["event_date"]).astimezone(zone).date()
                end_day = datetime.fromisoformat(current.get("event_end_date") or current["event_date"]).astimezone(zone).date()
                if sequence.payload.get("category")!="organizer_retention":
                    if local_day>end_day:
                        choice=("closeout","Review results, delivery and payment exceptions before recording event completion.","closeout","closeout")
                    elif event_day<=local_day<=end_day and "checkin_succeeded" not in milestones:
                        choice=("checkin_succeeded","Review check-in access and staff readiness before admitting real attendees.","operations","checkin")
                date_note = " Your event date has passed; review closeout rather than inferring completion from the date." if local_day > end_day else " Check outstanding operations for your event day." if event_day<=local_day<=end_day else " Check the event date and timezone before scheduling the next task."
            except (ValueError, KeyError):
                date_note = " Confirm the event timezone before scheduling guidance."
        return {"body": choice[1]+date_note,
            "cta_url": "https://festio.events/setup-redesign?"+urlencode({"event": event_id, "view": choice[2], "task": choice[3]}), "cta": "Review your next event task"}


def validate_current_event(m,lead):
    """Ownership barrier also applies to preserved templates without new copy."""
    from .retention import source_context
    with m.SessionLocal() as db:
        rows=db.scalars(select(Evidence).where(Evidence.account_id==lead.festio_user_id)).all()
        closed={(r.org_id,r.event_id) for r in rows if r.milestone in {"event_completed","event_cancelled"}}
        opened=[r for r in rows if (r.org_id,r.event_id) not in closed]
        if not rows:
            return
        if not opened:
            raise email_pilot.EmailBlocked("Event onboarding is complete")
        event=sorted(opened,key=lambda r:email_pilot.utc(r.occurred_at),reverse=True)[0]
        current=source_context(m,lead.festio_user_id,event.event_id)
        if current.get("current_owner") is not True or current.get("org_id")!=event.org_id or current.get("is_test") is not False or current.get("cancelled") is not False or current.get("status")=="ended":
            raise email_pilot.EmailBlocked("Current event no longer eligible for onboarding")
