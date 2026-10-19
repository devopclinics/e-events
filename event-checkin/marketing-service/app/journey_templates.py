"""Review candidates only. Importing this module never mutates stored templates."""
from copy import deepcopy


def retention_candidate():
    return {"category": "organizer_retention", "journey_context": True, "steps": [{"delay_hours": 0,
        "subject": "Review your event and plan your next draft", "body": "Review your event results and any outstanding delivery or payment exceptions. When you are ready to organize another event, create a new draft and check its dates, timezone and guest experience. A new event needs its own readiness checks.",
        "cta": "Create your next event draft", "cta_url": "https://festio.events/setup-redesign"}]}


def candidates():
    setup = "https://festio.events/setup-redesign"
    event = "https://festio.events/admin-redesign"
    def step(delay, subject, body, cta, url):
        return dict(delay_hours=delay, subject=subject, body=body, cta=cta, cta_url=url)
    result = deepcopy({
        "New registration welcome": dict(stage="registered", cadence_days=2, cta_url=setup, steps=[
            step(0, "Welcome to Festio", "Create an event draft and review the tools relevant to your event. Configuration is separate from testing and actual guest activity.", "Create an event draft", setup),
            step(24, "Continue your event setup", "Add your event details and check its date and timezone. Review the event guide for incomplete tasks before inviting guests.", "Continue setup", setup),
            step(72, "Choose your next event task", "Festio supports guest lists, invitations, RSVPs and check-in. Choose the tools your event needs and rehearse them with controlled test records.", "Review event setup", setup),
            step(168, "Need help planning the next step?", "Reply with the task you need help with. A person can review your request; a reply does not book a call or confirm a service.", "Review setup", setup),
        ]),
        "Event created onboarding": dict(stage="event_created", cadence_days=3, cta_url=event, steps=[
            step(0, "Your event draft is ready for setup", "Review the event date, timezone and guest list. Preview your invitation before deciding whether to send it.", "Review your event", event),
            step(48, "Rehearse your guest experience", "Use controlled test records to check RSVP, invitation delivery and check-in. A rehearsal does not prove a real guest outcome.", "Open your event guide", event),
            step(120, "Review outstanding event tasks", "Review incomplete tasks and any delivery exceptions. Confirm staff access and check-in readiness before your event.", "Review your setup", event),
        ]),
    })
    for payload in result.values():
        payload["journey_context"] = True
    return result
